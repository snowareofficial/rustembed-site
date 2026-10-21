'use strict';
/* 无头浏览器验收 + 截图：node tests/browser-check.js
 *
 * 只依赖 Node 内置能力（fetch + 全局 WebSocket）+ 本机 Edge/Chrome 的 CDP，
 * 不给站点引任何第三方东西。真实测量：
 *   - 三栏是否真的存在、中栏是否 ≤ 42rem
 *   - 右栏是否默认收起、展开后是否 10 个入口
 *   - 375px / 1280px 下 documentElement.scrollWidth 是否溢出（横向滚动）
 *   - 代码块 / 表格是否撑破页面
 *   - 暗色令牌是否真的生效
 * 并输出 375×812 / 1280×900 / 暗色 1280×900 三张截图到 tests/shots/。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const BASE = process.env.REC_BASE || 'http://127.0.0.1:8080/';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const fails = [];
let checks = 0;
function need(cond, msg, extra) {
  checks++;
  console.log('  %s %s%s', cond ? 'PASS' : 'FAIL', msg, extra === undefined ? '' : ' → ' + extra);
  if (!cond) fails.push(msg);
  return !!cond;
}

function pickBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  return null;
}

/* 下面这些用例要比较字面量与子串，need() 的签名不够顺手，补两个薄封装 */
function eq2(got, want, msg) { return need(got === want, msg, '期望 ' + want + '，实得 ' + got); }
function includes2(hay, needle, msg) {
  return need(String(hay).indexOf(needle) >= 0, msg, '实测 ' + JSON.stringify(String(hay)));
}

/* 挑一个真能 bind 的调试端口。
 * 为什么不能写死 9222+pid%200：Windows 默认保留 9211–9310 这段（Hyper-V 动态端口），
 * 落进去时 Edge 起得来但 CDP 端口 bind 失败，/json/list 永远不通 ⇒ 干等 20s 超时。
 * 这里逐个试，bind 成功才算数（保留段里 listen 直接报错，能正确跳过）。 */
async function pickDebugPort() {
  const net = require('node:net');
  for (let i = 0; i < 40; i++) {
    const port = 9600 + (process.pid + i * 13) % 300;
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  return 9222 + (process.pid % 200);
}

async function waitFor(fn, timeout = 15000, gap = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, gap));
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', (e) => reject(new Error('WebSocket ' + (e.message || ''))));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(m.method || '' + JSON.stringify(m.error)));
        else p.res(m.result);
      } else if (m.method) {
        events.push(m);
      }
    });
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej, method });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const api = {
      send,
      close: () => ws.close(),
      waitEvent: async (name, timeout = 15000) => {
        const t0 = Date.now();
        for (;;) {
          const i = events.findIndex((e) => e.method === name);
          if (i >= 0) return events.splice(i, 1)[0];
          if (Date.now() - t0 > timeout) throw new Error('等待事件超时：' + name);
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      eval: async (expr) => {
        const r = await send('Runtime.evaluate', {
          expression: expr, returnByValue: true, awaitPromise: true
        });
        if (r.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.exceptionDetails));
        return r.result.value;
      },
      shot: async (file) => {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      }
    };
  });
}

async function main() {
  const browser = pickBrowser();
  if (!browser) {
    console.log('没有找到 Edge/Chrome，跳过浏览器验收（结构断言与 DOM 冒烟仍然有效）。');
    process.exit(0);
  }
  const PORT = await pickDebugPort();
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recblog-'));
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars',
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => { try { child.kill(); } catch (e) { void e; } };
  process.on('exit', cleanup);

  // /json/version 是浏览器级端点（只有 Browser.*/Target.*），要用页面级目标才能 Page.*
  let target = null;
  await waitFor(async () => {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { target = page.webSocketDebuggerUrl; return true; }
      return false;
    } catch (e) { return false; }
  }, 20000, 300);

  const cdp = await connect(target);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /*
   * hash 变化是同文档导航，不会触发 load 事件：等 data-page 变成目标页且 #view 有内容。
   * 注意 data-page 是在视图 Promise 之前就写好的，而 data-toc 要等 buildToc()（渲染末尾）才写，
   * 所以要校验左栏的用例必须再等 data-toc 变成期望值，否则会读到上一页的目录状态。
   */
  const go = async (hash, page, opts) => {
    await cdp.send('Page.navigate', { url: BASE + hash });
    await waitFor(() => cdp.eval(
      'document.body.getAttribute("data-page") === ' + JSON.stringify(page) +
      ' && document.getElementById("view").children.length > 0'));
    await new Promise((r) => setTimeout(r, 250));
    if (opts && opts.toc) {
      await waitFor(() => cdp.eval(
        'document.body.getAttribute("data-toc") === ' + JSON.stringify(opts.toc)));
    }
  };

  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile
  });

  /* 对比度：读当前生效的令牌，按 WCAG 相对亮度公式算比值 */
  const measureContrast = () => cdp.eval(`(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const cs = getComputedStyle(document.documentElement);
    const t = (n) => cs.getPropertyValue(n).trim();
    const rgb = (hex) => { const h = hex.replace('#', '');
      return 'rgb(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ')'; };
    return {
      body: ratio(rgb(t('--ink')), rgb(t('--paper'))),
      soft: ratio(rgb(t('--ink-soft')), rgb(t('--paper'))),
      mute: ratio(rgb(t('--ink-mute')), rgb(t('--paper'))),
      link: ratio(rgb(t('--accent')), rgb(t('--paper')))
    };
  })()`);

  /* ---------- 桌面 1280×900 ---------- */
  console.log('== 1280×900 亮色 ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  /* 左栏只在「有分节标题」的页面存在（文章页）；索引页左栏应整块收起 */
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  let r = await cdp.eval(`(() => {
    const g = (s) => document.querySelector(s);
    const rect = (s) => { const e = g(s); return e ? e.getBoundingClientRect() : null; };
    const left = rect('#col-left'), main = rect('#main');
    const links = Array.from(document.querySelectorAll('#col-left a')).map(a => a.getAttribute('href'));
    const input = g('.search-input'), sbtn = g('.search-btn'), drawer = g('#nav-drawer');
    return {
      left: left && { w: left.width, h: left.height, display: getComputedStyle(g('#col-left')).display },
      main: main && { w: main.width },
      drawerInTopbar: !!(drawer && drawer.closest('.topbar')),
      navLeftOfSearch: !!(drawer && input && drawer.getBoundingClientRect().right <= input.getBoundingClientRect().left + 1),
      btnRightOfInput: !!(sbtn && input && sbtn.getBoundingClientRect().left >= input.getBoundingClientRect().right - 1),
      navBtnW: drawer ? Math.round(drawer.querySelector('summary').getBoundingClientRect().width) : -1,
      searchBtnW: sbtn ? Math.round(sbtn.getBoundingClientRect().width) : -1,
      leftLinks: links,
      drawerOpen: drawer && drawer.hasAttribute('open'),
      navVisible: g('#site-nav').checkVisibility
        ? g('#site-nav').checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })
        : null,
      navCount: document.querySelectorAll('#site-nav a').length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bg: getComputedStyle(document.body).backgroundColor
    };
  })()`);
  need(r.left && r.left.display !== 'none' && r.left.w > 0, '文章页左栏存在且可见', r.left && Math.round(r.left.w) + 'px');
  need(r.drawerInTopbar === true, '站点导航在顶栏里', String(r.drawerInTopbar));
  need(r.navLeftOfSearch === true, '站点导航在搜索框左侧', String(r.navLeftOfSearch));
  need(r.btnRightOfInput === true, '搜索按钮在搜索框右侧', String(r.btnRightOfInput));
  need(Math.abs(r.navBtnW - r.searchBtnW) <= 1,
    '导航与搜索按钮等宽', r.navBtnW + ' vs ' + r.searchBtnW);
  need(r.main && r.main.w <= 672.5, '中栏宽度 ≤ 42rem（672px）', r.main && Math.round(r.main.w) + 'px');
  need(r.drawerOpen === false, '站点导航默认收起（details 无 open）');
  need(r.navVisible === false, '收起时导航不可见', 'checkVisibility=' + r.navVisible);
  need(r.navCount === 10, '顶栏含 10 个站点入口', r.navCount);
  need(r.leftLinks.filter((h) => /^#\/(library|knowledge|topics|projects|resources|members|services|weekly|pages|join)$/.test(h)).length === 0,
    '左栏不含任何站点入口', r.leftLinks.join(' ') || '（无链接）');
  need(r.scrollW <= r.clientW + 1, '1280px 无横向滚动', r.scrollW + ' ≤ ' + r.clientW);

  await go('#/library', 'library', { toc: 'none' });
  const idx = await cdp.eval(`(() => {
    const el = document.querySelector('#col-left');
    const cs = getComputedStyle(el);
    return {
      display: cs.display, visibility: cs.visibility,
      toc: document.body.getAttribute('data-toc'),
      page: document.body.getAttribute('data-page'),
      width: el.getBoundingClientRect().width
    };
  })()`);
  need(idx.display === 'none',
    '无分节标题的页面左栏收起（不再只显示一句空话）display=' + idx.display +
    ' data-toc=' + idx.toc + ' page=' + idx.page + ' w=' + Math.round(idx.width));

  console.log('== 对比度（亮色，实测） ==');
  const light = await measureContrast();
  need(light.body >= 4.5, '亮色正文对比度 ≥ 4.5', light.body.toFixed(2));
  need(light.soft >= 4.5, '亮色次级文字对比度 ≥ 4.5', light.soft.toFixed(2));
  need(light.mute >= 4.5, '亮色说明文字对比度 ≥ 4.5', light.mute.toFixed(2));
  need(light.link >= 4.5, '亮色链接对比度 ≥ 4.5', light.link.toFixed(2));

  /* 展开右栏 */
  await cdp.eval('document.getElementById("nav-drawer").setAttribute("open","open")');
  await new Promise((s) => setTimeout(s, 200));
  const opened = await cdp.eval(`(() => {
    const a = Array.from(document.querySelectorAll('#site-nav a'));
    return { n: a.length, visible: a.filter(x => x.getBoundingClientRect().height > 0).length,
             cur: a.filter(x => x.classList.contains('cur')).map(x => x.textContent) };
  })()`);
  need(opened.visible === 10, '展开后 10 个入口全部可见', opened.visible);
  need(opened.cur.length === 1, '当前项唯一（弱左边框 + 加粗）', opened.cur.join(','));
  await cdp.shot(path.join(SHOTS, 'nav-open-1280.png'));

  /* 文章页：代码块 / 表格 / 出血图 */
  console.log('== 文章页（代码块 / 表格 / 出血） ==');
  await go('#/post/md-writing', 'post');
  const art = await cdp.eval(`(() => {
    const pre = document.querySelector('.code pre');
    const tbl = document.querySelector('.col-main table');
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      preOverflow: pre ? getComputedStyle(pre).overflowX : null,
      tblOverflow: tbl ? getComputedStyle(tbl).overflowX : null,
      tblW: tbl ? tbl.getBoundingClientRect().width : -1,
      mainW: document.getElementById('main').getBoundingClientRect().width,
      copyBtn: document.querySelectorAll('.code .copy').length,
      langTag: (document.querySelector('.code-head span') || {}).textContent || ''
    };
  })()`);
  need(art.scrollW <= art.clientW + 1, '文章页无横向滚动', art.scrollW + ' ≤ ' + art.clientW);
  need(art.preOverflow === 'auto', '代码块只内部横滚', art.preOverflow);
  if (art.tblOverflow !== null) need(art.tblOverflow === 'auto', '表格只内部横滚', art.tblOverflow);
  need(art.tblW <= art.mainW + 1, '表格不超出中栏', Math.round(art.tblW) + ' ≤ ' + Math.round(art.mainW));
  need(art.copyBtn >= 1, '代码块有复制按钮', art.copyBtn);
  await cdp.shot(path.join(SHOTS, 'post-1280.png'));

  /* ---------- 900×900（左栏隐藏后的单列） ---------- */
  console.log('== 900×900 ==');
  await metrics(900, 900, false);
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  const mid = await cdp.eval(`(() => {
    const m = document.querySelector('#main').getBoundingClientRect();
    return { w: Math.round(m.width), left: Math.round(m.left), rightGap: Math.round(window.innerWidth - m.right) };
  })()`);
  need(mid.w >= 500 && Math.abs(mid.left - mid.rightGap) <= 2,
    '900px 单列居中（左栏隐藏后内容不挤在 13rem 列）',
    '宽 ' + mid.w + '，左 ' + mid.left + ' / 右 ' + mid.rightGap);

  /* ---------- 375×812 ---------- */
  console.log('== 375×812 ==');
  await metrics(375, 812, true);
  await cdp.eval('document.getElementById("nav-drawer").removeAttribute("open")');
  await go('#/post/md-writing', 'post');
  const mob = await cdp.eval(`(() => {
    const g = (s) => document.querySelector(s);
    return {
      leftDisplay: getComputedStyle(g('#col-left')).display,
      tocVisible: g('#mobile-toc').getBoundingClientRect().height > 0,
      drawerInTopbar: !!(g('#nav-drawer') && g('#nav-drawer').closest('.topbar')),
      summaryText: (g('#nav-drawer summary') || {}).textContent || '',
      summaryLabel: (g('#nav-drawer summary') || {}).getAttribute
        ? g('#nav-drawer summary').getAttribute('aria-label') : '',
      summaryIcon: !!g('#nav-drawer summary .ico'),
      searchIcon: !!g('.search-btn .ico'),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      mainW: g('#main').getBoundingClientRect().width
    };
  })()`);
  need(mob.leftDisplay === 'none', '窄屏隐藏左栏', mob.leftDisplay);
  need(mob.tocVisible === true, '内容顶部出现「本页目录」折叠条');
  need(mob.drawerInTopbar === true, '窄屏站点导航仍在顶栏', String(mob.drawerInTopbar));
  need(mob.summaryLabel === '站点导航', '导航按钮 aria-label 是「站点导航」', String(mob.summaryLabel));
  need(mob.summaryIcon === true, '导航按钮有指南针 SVG', String(mob.summaryIcon));
  need(mob.searchIcon === true, '搜索按钮有放大镜 SVG', String(mob.searchIcon));
  need(mob.scrollW <= mob.clientW + 1, '375px 无横向滚动', mob.scrollW + ' ≤ ' + mob.clientW);
  await cdp.shot(path.join(SHOTS, 'post-375.png'));
  await go('#/library', 'library');
  await cdp.shot(path.join(SHOTS, 'library-375.png'));
  await cdp.eval('document.getElementById("nav-drawer").setAttribute("open","open")');
  await new Promise((r) => setTimeout(r, 200));
  const navPop = await cdp.eval(`(() => {
    const n = document.querySelector('#site-nav');
    const cs = getComputedStyle(n);
    return { visible: n.checkVisibility ? n.checkVisibility({ checkVisibilityCSS: true }) : cs.display !== 'none',
             position: cs.position };
  })()`);
  need(navPop.visible === true, '展开后站点导航可见', String(navPop.visible));
  need(navPop.position === 'absolute', '展开后是浮层（absolute）', navPop.position);
  await cdp.shot(path.join(SHOTS, 'library-375-drawer.png'));
  await cdp.eval('document.getElementById("nav-drawer").removeAttribute("open")');

  /* ---------- 视频门面 / 附件卡片 ---------- */
  await go('#/post/hello-rec', 'post');
  const vid = await cdp.eval(`(async () => {
    const face = document.querySelector('.video-face');
    if (!face) return { found: false };
    face.click();
    await new Promise((r) => setTimeout(r, 300));
    const hasFrame = !!document.querySelector('.video-frame');
    const close = document.querySelector('.video-collapse');
    if (close) close.click();
    await new Promise((r) => setTimeout(r, 200));
    return { found: true, hasFrame, closed: !document.querySelector('.video-frame') && !!document.querySelector('.video-face') };
  })()`);
  need(vid.found === true, '文章有视频门面卡');
  need(vid.hasFrame === true, '点击后注入播放器 iframe');
  need(vid.closed === true, '收起后 iframe 移除、门面恢复');

  const att = await cdp.eval(`(() => ({
    cards: document.querySelectorAll('.attach-card').length,
    icon: !!document.querySelector('.attach-card .file-ico')
  }))()`);
  need(att.cards >= 1, '附件渲染成卡片', String(att.cards));
  need(att.icon === true, '附件有统一文件图标', String(att.icon));

  /* ---------- 构建期摘要 / 可选导图（可拖动） ---------- */
  await go('#/post/hello-rec', 'post', { toc: 'yes' });
  const ai = await cdp.eval(`(() => ({
    card: !!document.querySelector('.ai-summary'),
    points: document.querySelectorAll('.ai-points li').length
  }))()`);
  need(ai.card === true, '文章页有构建期摘要卡');
  need(ai.points >= 1, '摘要卡有要点列表', String(ai.points));

  const mapUI = await cdp.eval(`(async () => {
    const link = document.querySelector('#map-link');
    if (!link) return { found: false };
    link.click();
    await new Promise((r) => setTimeout(r, 300));
    const view = document.querySelector('.map-view');
    const img = document.querySelector('.map-img');
    const open = !!document.querySelector('#modal:not([hidden])');
    const before = img ? img.style.transform : '';
    if (view && img) {
      view.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
      view.dispatchEvent(new PointerEvent('pointermove', { clientX: 170, clientY: 150, bubbles: true }));
      view.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }
    const after = img ? img.style.transform : '';
    const close = document.querySelector('.modal-close');
    if (close) close.click();
    return { found: true, view: !!view, img: !!img, open, moved: before !== after, before, after };
  })()`);
  need(mapUI.found === true, '文章有章节结构入口');
  need(mapUI.open === true, '章节结构弹层能打开');
  need(mapUI.view === true, '导图有可拖动视口');
  need(mapUI.img === true, '导图 SVG 已载入');
  need(mapUI.moved === true, '导图支持拖动（transform 变化）', mapUI.before + ' → ' + mapUI.after);

  /* ---------- 暗色 1280×900 ---------- */
  console.log('== 1280×900 暗色 ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await go('#/library', 'library');
  const dark = await cdp.eval(`(() => {
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, fg: s.color };
  })()`);
  need(dark.bg !== r.bg, '暗色令牌生效（背景跟随）', r.bg + ' → ' + dark.bg);
  await cdp.shot(path.join(SHOTS, 'library-1280-dark.png'));
  await go('#/member/sal', 'member');
  await cdp.shot(path.join(SHOTS, 'member-1280-dark.png'));

  /* ---------- 对比度实测（暗色） ---------- */
  console.log('== 对比度（暗色，实测） ==');
  const contrast = await measureContrast();
  need(contrast.body >= 4.5, '暗色正文对比度 ≥ 4.5', contrast.body.toFixed(2));
  need(contrast.soft >= 4.5, '暗色次级文字对比度 ≥ 4.5', contrast.soft.toFixed(2));
  need(contrast.mute >= 4.5, '暗色说明文字对比度 ≥ 4.5', contrast.mute.toFixed(2));
  need(contrast.link >= 4.5, '暗色链接对比度 ≥ 4.5', contrast.link.toFixed(2));

  /* ---------- 首页：单列居中 + 隐藏右侧站点导航 ---------- */
  console.log('== 首页 ==');
  await go('#/home', 'home');
  const home = await cdp.eval(`(() => {
    const main = document.querySelector('#main').getBoundingClientRect();
    return {
      hasRight: !!document.querySelector('#col-right'),
      left: Math.round(main.left),
      rightGap: Math.round(window.innerWidth - main.right),
      w: Math.round(main.width)
    };
  })()`);
  need(home.hasRight === false, '首页没有独立右侧栏（导航已并入顶栏）', String(home.hasRight));
  need(Math.abs(home.left - home.rightGap) <= 2,
    '首页内容水平居中', '左 ' + home.left + ' / 右 ' + home.rightGap + '（宽 ' + home.w + '）');

  /* ---------- 标签页系列合并 + 成员页滚动区 + 页脚声明（真实 CSS 断言） ----------
   * DOM 桩不算 CSS，所以这三类的显隐/尺寸在这里量。
   * 真实站点可能有多个系列；选章节最多的那条，长度从 DOM 推导，避免把内容数量写死。
   */
  console.log('== 标签页系列合并（真实样式 + 键盘可用） ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('#/library?tag=rust', 'library');
  const series = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('#view li.row-series'));
    if (!rows.length) return { count: 0 };
    const row = rows.reduce((best, cur) =>
      cur.querySelectorAll('.series-posts li.row').length >
      best.querySelectorAll('.series-posts li.row').length ? cur : best, rows[0]);
    const sum = row.querySelector('.series-sum');
    const badge = row.querySelector('.series-badge');
    const details = row.querySelector('details');
    const expected = row.querySelectorAll('.series-posts li.row').length;
    sum.focus();
    const focused = document.activeElement === sum;
    sum.click();
    const opened = !!(details && details.open);
    const chapters = row.querySelectorAll('.series-posts li.row');
    const hidden = Array.from(chapters).filter((li) =>
      getComputedStyle(li).display === 'none' || !li.checkVisibility());
    return {
      count: rows.length,
      expected,
      title: row.querySelector('.row-title').textContent,
      badge: badge && badge.textContent.trim(),
      focused,
      opened,
      chapters: chapters.length,
      visibleChapters: chapters.length - hidden.length,
      sumDisplay: getComputedStyle(sum).display,
      badgeColor: getComputedStyle(badge).color,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  })()`);
  need(series.count >= 1, '标签页 #rust 上至少 1 条系列行', String(series.count));
  includes2(series.badge, '系列', '徽章写着「系列」');
  includes2(series.badge, String(series.expected) + ' 章', '徽章写着系列章数');
  eq2(series.focused, true, 'summary 可获得焦点（键盘可达）');
  eq2(series.opened, true, '回车/点击能展开 series details');
  eq2(series.chapters, series.expected, '展开后列出全部章节');
  eq2(series.visibleChapters, series.expected, '展开后章节真的可见');
  need(series.scrollW <= series.clientW, '标签页无横向溢出',
    series.scrollW + ' / ' + series.clientW);

  console.log('== 成员页滚动区（不横向溢出） ==');
  await go('#/member/sal', 'member');
  const member = await cdp.eval(`(() => {
    const view = document.getElementById('view');
    /* 真实站点里每位成员都不足 7 篇，所以页面本身没有 .rows-scroll。
     * 这里按视图的写法现造一个（同样式同结构），量的就是真实 CSS 生效后的结果。 */
    const own = view.querySelector('.rows-scroll');
    const box = own || view.appendChild(Object.assign(document.createElement('ol'), {
      className: 'rows rows-scroll'
    }));
    const made = !own;
    for (let i = 0; i < 20; i++) {
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = '<span class="row-date">2026-01-01</span>' +
        '<span class="row-title">第 ' + (i + 1) + '篇：一个刻意写得很长的标题，看会不会把行撑宽</span>' +
        '<span class="row-words">123 字</span><p class="row-sum">摘要</p>' +
        '<p class="row-tags"><span class="tag">rust</span></p>';
      box.appendChild(li);
    }
    const cs = getComputedStyle(box);
    const rows = box.querySelectorAll('li.row').length;
    const out = {
      made,
      overflowY: cs.overflowY,
      maxH: Math.round(parseFloat(cs.maxHeight)),
      scrollH: Math.round(box.scrollHeight),
      clientH: Math.round(box.clientHeight),
      scrollW: box.scrollWidth,
      clientW: box.clientWidth,
      rows,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth
    };
    if (made) box.remove();
    return out;
  })()`);
  need(member.overflowY === 'auto', '滚动区 overflow-y: auto', member.overflowY);
  need(member.maxH > 0, '滚动区有 max-height 上限', member.maxH + 'px');
  need(member.scrollH > member.clientH, '内容超高时真的可滚动（上限生效）',
    member.scrollH + ' > ' + member.clientH);
  need(member.scrollW <= member.clientW, '滚动区自身不横向溢出',
    member.scrollW + ' / ' + member.clientW);
  need(member.docScrollW <= member.docClientW, '成员页整页无横向溢出',
    member.docScrollW + ' / ' + member.docClientW);
  eq2(member.rows, 20, '造出来的滚动区有 20 行');

  console.log('== 页脚：互助免责声明只在互助页显示 ==');
  const footerAt = async (hash, page) => {
    await go(hash, page);
    return cdp.eval(`(() => {
      const site = document.getElementById('license-notice-site');
      const foot = document.getElementById('footer');
      const other = Array.from(foot.querySelectorAll('span[id^="license-notice"]'))
        .filter((s) => s.id !== 'license-notice-site');
      return {
        has: !!site,
        display: site ? getComputedStyle(site).display : null,
        othersShown: other.filter((s) => getComputedStyle(s).display !== 'none').length,
        othersTotal: other.length,
        maxW: site ? Math.round(parseFloat(getComputedStyle(site).maxWidth)) : 0,
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth
      };
    })()`);
  };
  const footServices = await footerAt('#/services', 'services');
  need(footServices.has === true, '页脚有 #license-notice-site');
  eq2(footServices.display, 'block', '#/services 上互助免责声明显示');
  eq2(footServices.othersTotal, 2, '页脚另外两行授权声明仍在');
  eq2(footServices.othersShown, 2, '另外两行授权声明正常显示');
  need(footServices.maxW > 0 && footServices.maxW <= 672,
    '声明宽度 ≤ 42rem', footServices.maxW + 'px');
  need(footServices.docScrollW <= footServices.docClientW, '互助页无横向溢出',
    footServices.docScrollW + ' / ' + footServices.docClientW);

  const footHome = await footerAt('#/home', 'home');
  eq2(footHome.display, 'none', '首页上互助免责声明隐藏');
  const footPost = await footerAt('#/post/hello-rec', 'post');
  eq2(footPost.display, 'none', '文章页上互助免责声明隐藏');

  /* 375px：页脚声明正常换行、不撑破页面；成员页滚动区同样不溢出 */
  await metrics(375, 812, true);
  await go('#/member/sal', 'member');
  const memberMobile = await cdp.eval(`(() => {
    const view = document.getElementById('view');
    const box = view.appendChild(Object.assign(document.createElement('ol'), {
      className: 'rows rows-scroll'
    }));
    for (let i = 0; i < 20; i++) {
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = '<span class="row-date">2026-01-01</span>' +
        '<span class="row-title">第 ' + (i + 1) + '篇：一个刻意写得很长的标题，看会不会把行撑宽</span>' +
        '<span class="row-words">123 字</span><p class="row-sum">摘要</p>';
      box.appendChild(li);
    }
    const out = {
      scrollW: box.scrollWidth, clientW: box.clientWidth,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth
    };
    box.remove();
    return out;
  })()`);
  need(memberMobile.scrollW <= memberMobile.clientW, '375px 滚动区不横向溢出',
    memberMobile.scrollW + ' / ' + memberMobile.clientW);
  need(memberMobile.docScrollW <= memberMobile.docClientW, '375px 成员页无横向溢出',
    memberMobile.docScrollW + ' / ' + memberMobile.docClientW);
  await go('#/services', 'services');
  const footMobile = await cdp.eval(`(() => {
    const site = document.getElementById('license-notice-site');
    const cs = getComputedStyle(site);
    return {
      display: cs.display,
      w: Math.round(site.getBoundingClientRect().width),
      h: Math.round(site.getBoundingClientRect().height),
      lines: Math.round(site.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  })()`);
  eq2(footMobile.display, 'block', '375px 下互助页声明仍显示');
  need(footMobile.lines >= 2, '窄屏下声明换行（多行）', footMobile.lines + ' 行');
  need(footMobile.scrollW <= footMobile.clientW, '375px 互助页无横向溢出',
    footMobile.scrollW + ' / ' + footMobile.clientW);
  await cdp.shot(path.join(SHOTS, 'services-375.png'));

  /* ---------- 阅读控制：最近条数 / 长代码折叠 / 本地高亮 ----------
   * 这几项只有真实 CSS + 真实交互才有意义（最大高度、溢出、token 上色），放在这里；
   * 结构与逻辑断言在 tests/reading_controls_test.js。 */
  console.log('== 阅读控制：最近更新条数 ==');
  await metrics(1280, 900, false);
  await go('#/', 'home');
  const recent0 = await cdp.eval(`(() => {
    const rows = document.querySelectorAll('#recent-list li');
    return { rows: rows.length, btn: !!document.getElementById('recent-btn'),
             panelHidden: document.getElementById('recent-panel').hasAttribute('hidden'),
             max: document.getElementById('recent-range').getAttribute('max'),
             min: document.getElementById('recent-range').getAttribute('min'),
             val: document.getElementById('recent-range').value,
             labelled: !!(document.querySelector('label[for="recent-range"]')) };
  })()`);
  eq2(recent0.rows, 3, '首页默认显示 3 条最近更新');
  need(recent0.btn, '首页有「调整条数」按钮');
  need(recent0.panelHidden, '条数面板默认收起');
  eq2(recent0.min, '1', '滑条下限 1');
  eq2(recent0.max, '15', '滑条上限 15');
  eq2(recent0.val, '3', '滑条初值 = 当前条数');
  need(recent0.labelled, '滑条有关联的 <label>');

  const recent1 = await cdp.eval(`(() => {
    window.__noReload = 1;
    document.getElementById('recent-btn').click();
    const open = !document.getElementById('recent-panel').hasAttribute('hidden');
    const r = document.getElementById('recent-range');
    r.value = '15';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    const total = document.querySelectorAll('#recent-list li').length;
    r.value = '7';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      open: open,
      aria: document.getElementById('recent-btn').getAttribute('aria-expanded'),
      rows: document.querySelectorAll('#recent-list li').length,
      total: total,
      stored: localStorage.getItem('rec-blog:recent-limit'),
      noReload: window.__noReload === 1,
      hidden: document.getElementById('recent-panel').hasAttribute('hidden')
    };
  })()`);
  need(recent1.open, '点按钮展开条数面板');
  eq2(recent1.aria, 'true', '展开态 aria-expanded=true');
  eq2(recent1.rows, Math.min(7, recent1.total), '拖到 7 → 显示 min(7, 条目总数)');
  eq2(recent1.stored, '7', '条数写进 localStorage');
  need(recent1.noReload, '改条数只重绘列表，不刷新整页');
  need(!recent1.hidden, '面板里的操作不会误触发「点外部关闭」');

  const recent2 = await cdp.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    localStorage.removeItem('rec-blog:recent-limit');
    return { hidden: document.getElementById('recent-panel').hasAttribute('hidden') };
  })()`);
  need(recent2.hidden, 'Esc 关闭条数面板（并清掉本用例写的选择）');
  await cdp.shot(path.join(SHOTS, 'home-recent-1280.png'));

  /* 窄屏：面板要在 375px 里完整放得下，不把页面推成横向滚动 */
  await metrics(375, 812, true);
  await go('#/', 'home');
  const recentMob = await cdp.eval(`(() => {
    document.getElementById('recent-btn').click();
    const p = document.getElementById('recent-panel');
    const r = p.getBoundingClientRect();
    return {
      hidden: p.hasAttribute('hidden'), left: Math.round(r.left), right: Math.round(r.right),
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  })()`);
  need(!recentMob.hidden, '375px 也能打开条数面板');
  need(recentMob.left >= 0 && recentMob.right <= recentMob.vw, '375px 下面板不出屏',
    recentMob.left + '–' + recentMob.right + ' / ' + recentMob.vw);
  need(recentMob.scrollW <= recentMob.clientW + 1, '375px 首页无横向滚动',
    recentMob.scrollW + ' ≤ ' + recentMob.clientW);
  await cdp.shot(path.join(SHOTS, 'home-recent-375.png'));
  console.log('== 长代码折叠（阈值来自 site.sml） ==');
  const collapse = await cdp.eval(`(() => {
    const lines = 30;
    const code = Array.from({ length: lines }, (_, i) => '    let x' + i + ' = ' + i + ';').join('\\n');
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="code">'
      + '<div class="code-head"><span>rust</span>'
      + '<button class="copy" type="button">复制</button></div>'
      + '<pre><code class="language-rust">' + code + '</code></pre></div>';
    document.getElementById('view').appendChild(wrap);
    window.__rec.code.setup(wrap);
    const box = wrap.querySelector('.code');
    const pre = box.querySelector('pre');
    const btn = box.querySelector('.code-more');
    const collapsedH = Math.round(pre.getBoundingClientRect().height);
    const overflowY = getComputedStyle(pre).overflowY;
    const scrollX = Math.round(wrap.getBoundingClientRect().width)
      - Math.round(wrap.scrollWidth);
    const label = btn ? btn.textContent : '';
    const aria = btn ? btn.getAttribute('aria-expanded') : null;
    if (btn) btn.click();
    const openH = Math.round(pre.getBoundingClientRect().height);
    const openAria = btn ? btn.getAttribute('aria-expanded') : null;
    if (btn) btn.click();
    const reH = Math.round(pre.getBoundingClientRect().height);
    const textLines = box.querySelector('code').textContent.split('\\n').length;
    wrap.remove();
    return { threshold: window.__rec.code.threshold(), label: label, aria: aria,
             overflowY: overflowY, noXOverflow: scrollX >= 0, collapsedH: collapsedH,
             openH: openH, reH: reH, openAria: openAria, textLines: textLines };
  })()`);
  eq2(collapse.threshold, 20, '折叠阈值取 manifest.site.code_collapse_lines（来自 site.sml）');
  eq2(collapse.label, '展开全部（30 行）', '折叠按钮写明总行数');
  eq2(collapse.aria, 'false', '折叠态 aria-expanded=false');
  need(collapse.openH > collapse.collapsedH, '展开后确实变高',
    collapse.collapsedH + 'px → ' + collapse.openH + 'px');
  eq2(collapse.openAria, 'true', '展开态 aria-expanded=true');
  need(collapse.reH === collapse.collapsedH, '再点一次收回原高度', collapse.reH + 'px');
  eq2(collapse.overflowY, 'auto', '折叠时可上下滚动（不外溢页面）');
  need(collapse.noXOverflow, '代码块不横向溢出');
  eq2(collapse.textLines, 30, '折叠不改代码文本：复制到的仍是完整 30 行');

  console.log('== 成员头像：三份档案都要真加载出图 ==');
  await metrics(1280, 900, false);
  for (const id of ['sal', 'cxi', 'cshonor']) {
    await go('#/member/' + id, 'member');
    const av = await cdp.eval(`(() => {
      const img = document.querySelector('#view img');
      if (!img) return { has: false };
      return { has: true, src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight };
    })()`);
    need(av.has, '#/member/' + id + ' 有头像 img');
    need(!!av.has && av.w > 0 && av.h > 0, '#/member/' + id + ' 头像不是裂图',
      (av.src || '') + ' ' + av.w + '×' + av.h);
    need(!!av.has && /^assets\/members\//.test(av.src || ''),
      '#/member/' + id + ' 头像走构建期本地化的产物路径', av.src);
  }
  console.log('== 语法高亮（本地 Prism，无外部请求） ==');
  await go('#/post/md-writing', 'post');
  const hl = await cdp.eval(`(() => {
    const ext = performance.getEntriesByType('resource')
      .filter((r) => ['script', 'link', 'css'].indexOf(r.initiatorType) >= 0)
      .map((r) => r.name)
      .filter((u) => u.indexOf(location.origin) !== 0);
    const tok = document.querySelector('.code code .token');
    return {
      hasPrism: typeof window.Prism === 'object',
      languages: window.Prism ? Object.keys(window.Prism.languages).length : 0,
      tokens: document.querySelectorAll('.code code .token').length,
      tokenColor: tok ? getComputedStyle(tok).color : '',
      external: ext
    };
  })()`);
  need(hl.hasPrism, '本地 Prism 已加载');
  need(hl.tokens >= 3, '代码块里有高亮 token', hl.tokens + ' 个');
  need(hl.tokenColor !== '' && hl.tokenColor !== 'rgb(0, 0, 0)', 'token 真的上了色', hl.tokenColor);
  eq2(hl.external.length, 0, '没有向本站以外请求任何脚本 / 样式'
    + (hl.external.length ? '（' + hl.external.join(',') + '）' : ''));

  console.log('== 首页「一言」：数据与按钮一致 ==');
  await go('#/', 'home');
  const quote = await cdp.eval(`(() => {
    const n = (window.__rec.quotes.list() || []).length;
    const btn = document.getElementById('quote-btn');
    return { quotes: n, hasBtn: !!btn, w: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
             h: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
             radius: btn ? getComputedStyle(btn).borderRadius : '',
             round: btn ? Math.round(btn.getBoundingClientRect().width)
               === Math.round(btn.getBoundingClientRect().height) : false };
  })()`);
  eq2(quote.hasBtn, quote.quotes > 0, '「一言」按钮只在有句子时出现（不编造句子）');
  if (quote.hasBtn) {
    need(quote.w >= 52 && quote.w <= 56, '按钮直径 52–56px', quote.w + 'px');
    need(quote.round, '按钮是正圆');
  }
  /* ---------- 本页目录：读到哪儿（真实 CSS + 真实滚动） ----------
   * DOM 桩只能断言规则文本；「三角有没有被裁掉 / 会不会把页面挤宽 / 颜色对不对」
   * 只有真浏览器能量。窄屏那份目录是抽屉，单独量一次。 */
  console.log('== 本页目录：当前阅读位置的小三角 ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  const tocMark = await cdp.eval(`(async () => {
    const links = Array.from(document.querySelectorAll('#toc-nav a'));
    if (links.length < 2) return { links: links.length };
    const want = links[1].getAttribute('data-anchor');
    const target = document.getElementById(want);
    window.scrollTo(0, target.getBoundingClientRect().top + (window.pageYOffset || 0) - 60);
    await new Promise((r) => setTimeout(r, 400));
    const cur = document.querySelector('#toc-nav a.cur');
    if (!cur) return { links: links.length, cur: null };
    const cs = getComputedStyle(cur, '::before');
    const col = document.getElementById('col-left');
    const box = cur.getBoundingClientRect();
    const colBox = col.getBoundingClientRect();
    return {
      links: links.length, want: want, cur: cur.getAttribute('data-anchor'),
      curCount: document.querySelectorAll('#toc-nav a.cur').length,
      content: cs.content, color: cs.color, curColor: getComputedStyle(cur).color,
      inCol: box.left >= colBox.left - 1 && box.right <= colBox.right + 1,
      colScrollW: col.scrollWidth, colClientW: col.clientWidth,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
    };
  })()`);
  need(tocMark.links >= 2, '文章页目录至少 2 个分节', String(tocMark.links));
  eq2(tocMark.cur, tocMark.want, '滚到第二节 → 目录高亮第二节');
  eq2(tocMark.curCount, 1, '同一时刻只有一个当前项');
  includes2(tocMark.content, '▸', '当前项有小三角 ▸');
  eq2(tocMark.color, tocMark.curColor, '三角是 accent 色（与当前项同色）');
  need(tocMark.inCol, '整行（含三角）在左栏框内，没被裁切');
  need(tocMark.colScrollW <= tocMark.colClientW + 1, '左栏不出横向滚动条（三角没撑宽）',
    tocMark.colScrollW + ' ≤ ' + tocMark.colClientW);
  need(tocMark.scrollW <= tocMark.clientW + 1, '1280px 整页无横向滚动',
    tocMark.scrollW + ' ≤ ' + tocMark.clientW);
  await cdp.shot(path.join(SHOTS, 'toc-mark-1280.png'));

  await metrics(375, 812, true);
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  const tocMob = await cdp.eval(`(async () => {
    const d = document.getElementById('mobile-toc');
    d.setAttribute('open', 'open');
    await new Promise((r) => setTimeout(r, 300));
    const cur = document.querySelector('#toc-nav-m a.cur');
    if (!cur) return { cur: null };
    const cs = getComputedStyle(cur, '::before');
    const box = cur.getBoundingClientRect();
    const dBox = d.getBoundingClientRect();
    return {
      cur: cur.getAttribute('data-anchor'), content: cs.content,
      visible: cur.checkVisibility ? cur.checkVisibility({ checkVisibilityCSS: true }) : true,
      inDrawer: box.left >= dBox.left - 1 && box.right <= dBox.right + 1,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
    };
  })()`);
  need(!!tocMob.cur, '窄屏抽屉目录也标出当前项', String(tocMob.cur));
  includes2(tocMob.content, '▸', '抽屉里的三角同样画出来');
  need(tocMob.visible === true, '抽屉里的当前项真的可见');
  need(tocMob.inDrawer, '抽屉里的行（含三角）没被裁切');
  need(tocMob.scrollW <= tocMob.clientW + 1, '375px 抽屉展开后无横向滚动',
    tocMob.scrollW + ' ≤ ' + tocMob.clientW);
  await cdp.shot(path.join(SHOTS, 'toc-mark-375.png'));

  /* ---------- 系列目录页：点系列行进得去、章节回文章、无效 id 不崩 ---------- */
  console.log('== 系列目录页 #/series/<id> ==');
  await metrics(1280, 900, false);
  await go('#/library?tag=rust', 'library');
  const seriesEntry = await cdp.eval(`(() => {
    const a = document.querySelector('#view a[href^="#/series/"]');
    return a ? a.getAttribute('href') : null;
  })()`);
  need(!!seriesEntry, '书库 / 标签页的系列行有 #/series/<id> 入口', String(seriesEntry));
  if (seriesEntry) {
    await go(seriesEntry, 'series');
    /* 截图要能看见页头（面包屑 / h1 / 「共 N 章」/ 从第一章开始）：
       同文档导航不重置滚动，这里手动回到顶部。 */
    await cdp.eval('window.scrollTo(0, 0)');
    const sp = await cdp.eval(`(() => {
      const view = document.getElementById('view');
      const rows = view.querySelectorAll('.rows li.row');
      const first = rows.length ? rows[0].querySelector('a.row-title') : null;
      const chip = view.querySelector('.chips a.chip');
      return {
        h1: (view.querySelector('h1') || {}).textContent || '',
        title: document.title,
        lede: (view.querySelector('.lede') || {}).textContent || '',
        crumb: !!view.querySelector('.crumb a[href="#/library"]'),
        rows: rows.length,
        firstHref: first ? first.getAttribute('href') : null,
        chipHref: chip ? chip.getAttribute('href') : null,
        heads: Array.from(view.querySelectorAll('.section-h')).map((n) => n.textContent).join(','),
        toc: document.body.getAttribute('data-toc'),
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
      };
    })()`);
    need(sp.h1.length > 0, '系列页有 h1 标题', sp.h1);
    includes2(sp.title, sp.h1, '标签页标题写系列名（不是通用的「系列」）');
    includes2(sp.lede, '章 · 系列', '系列页写明「共 N 章 · 系列」');
    need(sp.rows >= 2, '目录列出全部章节', String(sp.rows));
    need(!!sp.firstHref && sp.firstHref.indexOf('#/post/') === 0, '章节链接回 #/post/<slug>',
      String(sp.firstHref));
    need(!!sp.chipHref && sp.chipHref.indexOf('#/post/') === 0, '「从第一章开始阅读」指向第一章',
      String(sp.chipHref));
    need(sp.crumb === true, '面包屑能回文章库');
    includes2(sp.heads, '目录', '系列页有「目录」段');
    eq2(sp.toc, 'none', '系列页没有分节标题 → 左栏不占位');
    need(sp.scrollW <= sp.clientW + 1, '系列页无横向滚动', sp.scrollW + ' ≤ ' + sp.clientW);
    await cdp.shot(path.join(SHOTS, 'series-1280.png'));

    await go('#/series/一定没有这个系列', 'series');
    const bad = await cdp.eval(`(() => document.getElementById('view').textContent)()`);
    includes2(bad, '没有这个系列', '无效系列 id 显示空态（不崩）');
  }

  /* ---------- 系列展开滚动框（真实 CSS） ---------- */
  console.log('== 系列展开：20 章滚动 / 5 章不限制 ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('#/library?tag=rust', 'library');
  const seriesScroll = await cdp.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('#view li.row-series'));
    if (!rows.length) return { count: 0 };
    const row = rows.reduce((best, cur) =>
      cur.querySelectorAll('.series-posts li.row').length >
      best.querySelectorAll('.series-posts li.row').length ? cur : best, rows[0]);
    const sum = row.querySelector('.series-sum');
    const details = row.querySelector('details');
    if (details && !details.open) sum.click();
    const box = row.querySelector('.series-posts');
    const cs = getComputedStyle(box);
    /* 5 章的短系列：同结构现造，量的就是「不加限制」 */
    const short = document.createElement('ol');
    short.className = 'rows series-posts';
    for (let i = 0; i < 5; i++) {
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = '<span class="row-date">2026-01-01</span>'
        + '<span class="row-title">第 ' + (i + 1) + ' 章</span><span class="row-words">100 字</span>';
      short.appendChild(li);
    }
    document.getElementById('view').appendChild(short);
    const shortMaxH = getComputedStyle(short).maxHeight;
    short.remove();
    return {
      count: rows.length,
      chapters: box.querySelectorAll('li.row').length,
      overflowY: cs.overflowY, overflowX: cs.overflowX,
      maxH: Math.round(parseFloat(cs.maxHeight)),
      scrollH: Math.round(box.scrollHeight), clientH: Math.round(box.clientHeight),
      scrollW: box.scrollWidth, clientW: box.clientWidth,
      shortMaxH: shortMaxH,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth
    };
  })()`);
  need(seriesScroll.count >= 1, '标签页有系列行', String(seriesScroll.count));
  need(seriesScroll.chapters > 8, '选中的最大系列超过 8 章', seriesScroll.chapters + ' 章');
  eq2(seriesScroll.overflowY, 'auto', '展开后 overflow-y: auto（可滚动）');
  eq2(seriesScroll.overflowX, 'hidden', 'overflow-x: hidden（只纵滚）');
  need(seriesScroll.maxH >= 384 && seriesScroll.maxH <= 448,
    'max-height 在 24–28rem', seriesScroll.maxH + 'px');
  need(seriesScroll.scrollH > seriesScroll.clientH, '20 章展开真的可滚动',
    seriesScroll.scrollH + ' > ' + seriesScroll.clientH);
  need(seriesScroll.scrollW <= seriesScroll.clientW, '滚动框自身不横向溢出',
    seriesScroll.scrollW + ' / ' + seriesScroll.clientW);
  need(seriesScroll.docScrollW <= seriesScroll.docClientW, '1280px 无横向滚动');
  eq2(seriesScroll.shortMaxH, 'none', '5 章系列不加高度限制');

  await metrics(375, 812, true);
  await go('#/library?tag=rust', 'library');
  const seriesMob = await cdp.eval(`(() => {
    const row = document.querySelector('#view li.row-series');
    if (!row) return { count: 0 };
    const sum = row.querySelector('.series-sum');
    const details = row.querySelector('details');
    if (details && !details.open) sum.click();
    const box = row.querySelector('.series-posts');
    return { count: 1, scrollW: box.scrollWidth, clientW: box.clientWidth,
             docScrollW: document.documentElement.scrollWidth,
             docClientW: document.documentElement.clientWidth };
  })()`);
  need(seriesMob.count === 1, '375px 有系列行');
  need(seriesMob.scrollW <= seriesMob.clientW, '375px 滚动框不横向溢出',
    seriesMob.scrollW + ' / ' + seriesMob.clientW);
  need(seriesMob.docScrollW <= seriesMob.docClientW, '375px 无横向滚动',
    seriesMob.docScrollW + ' / ' + seriesMob.docClientW);

  /* ---------- 正文字号 ---------- */
  console.log('== 正文字号：默认 / 极值 / 刷新保持 / 重置 ==');
  await metrics(1280, 900, false);
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  const size0 = await cdp.eval(`(() => ({
    varSize: getComputedStyle(document.documentElement).getPropertyValue('--reading-size').trim(),
    mainFs: getComputedStyle(document.querySelector('.col-main')).fontSize,
    leftW: Math.round(document.querySelector('#col-left').getBoundingClientRect().width)
  }))()`);
  eq2(size0.varSize, '100%', '默认 --reading-size = 100%');
  eq2(size0.mainFs, '17px', '默认正文字号 17px');
  const size1 = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    const r = document.getElementById('settings-size');
    r.value = '120';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { mainFs: getComputedStyle(document.querySelector('.col-main')).fontSize,
             stored: localStorage.getItem('rec-blog:reading-size'),
             val: document.getElementById('settings-size-val').textContent,
             leftW: Math.round(document.querySelector('#col-left').getBoundingClientRect().width) };
  })()`);
  eq2(size1.mainFs, '20.4px', '调到 120% → 正文 20.4px');
  eq2(size1.stored, '120', '写 localStorage');
  includes2(size1.val, '120%', '面板显示当前值');
  eq2(size1.leftW, size0.leftW, '左栏宽度不受字号影响');
  const size2 = await cdp.eval(`(() => {
    const r = document.getElementById('settings-size');
    r.value = '90';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { mainFs: getComputedStyle(document.querySelector('.col-main')).fontSize,
             stored: localStorage.getItem('rec-blog:reading-size') };
  })()`);
  eq2(size2.mainFs, '15.3px', '调到 90% → 正文 15.3px');
  eq2(size2.stored, '90', '最小也写库');
  /* 真刷新：localStorage 保持 */
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(
    'document.body.getAttribute("data-page") === "post" && document.getElementById("view").children.length > 0'));
  const size3 = await cdp.eval(`(() => ({
    stored: localStorage.getItem('rec-blog:reading-size'),
    mainFs: getComputedStyle(document.querySelector('.col-main')).fontSize
  }))()`);
  eq2(size3.stored, '90', '刷新后 localStorage 保持');
  eq2(size3.mainFs, '15.3px', '刷新后字号保持');
  const size4 = await cdp.eval(`(() => {
    document.getElementById('settings-size-reset').click();
    return { mainFs: getComputedStyle(document.querySelector('.col-main')).fontSize,
             stored: localStorage.getItem('rec-blog:reading-size') };
  })()`);
  eq2(size4.mainFs, '17px', '重置回 17px');
  eq2(size4.stored, '100', '重置写回 100');
  const size5 = await cdp.eval(`(() => {
    const r = document.getElementById('settings-size');
    r.value = '120';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return { codeFs: getComputedStyle(document.querySelector('.code pre')).fontSize };
  })()`);
  eq2(size5.codeFs, '13.2px', '代码块字号固定，不随正文变化');
  await cdp.eval(`document.getElementById('settings-size-reset').click();`);

  /* ---------- 摘要折叠 ---------- */
  console.log('== 摘要折叠：点击 / 刷新保持 / 正文不丢 ==');
  await go('#/post/hello-rec', 'post', { toc: 'yes' });
  const sum0 = await cdp.eval(`(() => {
    const card = document.querySelector('.ai-summary');
    return { open: card.hasAttribute('open'),
             points: card.querySelectorAll('.ai-points li').length,
             sumVisible: card.querySelector('summary').checkVisibility() };
  })()`);
  eq2(sum0.open, true, '摘要卡默认展开');
  need(sum0.points >= 1, '摘要卡有要点列表', String(sum0.points));
  /* details 的 toggle 事件在浏览器里是排队派发的：click 后要等一拍再读库 */
  const sum1 = await cdp.eval(`(async () => {
    document.querySelector('.ai-summary > summary').click();
    await new Promise((r) => setTimeout(r, 60));
    const card = document.querySelector('.ai-summary');
    const pts = card.querySelector('.ai-points');
    return { open: card.hasAttribute('open'),
             stored: localStorage.getItem('rec-blog:summary-collapsed'),
             pointsHidden: pts ? !pts.checkVisibility() : true,
             stillInDom: !!pts,
             sumVisible: card.querySelector('summary').checkVisibility() };
  })()`);
  eq2(sum1.open, false, '点击后折叠');
  eq2(sum1.stored, '1', '折叠写库');
  eq2(sum1.pointsHidden, true, '折叠后要点隐藏');
  eq2(sum1.stillInDom, true, '折叠后摘要文本仍在 DOM（不误删正文）');
  eq2(sum1.sumVisible, true, '只剩一行标题仍可见');
  const sum2 = await cdp.eval(`(async () => {
    const sum = document.querySelector('.ai-summary > summary');
    sum.focus();
    const focused = document.activeElement === sum;
    sum.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    sum.click();
    await new Promise((r) => setTimeout(r, 60));
    return { focused: focused,
             open: document.querySelector('.ai-summary').hasAttribute('open'),
             stored: localStorage.getItem('rec-blog:summary-collapsed') };
  })()`);
  eq2(sum2.focused, true, 'summary 可获得焦点（键盘可达）');
  eq2(sum2.open, true, '键盘 Enter 可再次展开');
  eq2(sum2.stored, '0', '展开状态写库');
  await cdp.eval(`document.querySelector('.ai-summary > summary').click();`);
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(
    'document.body.getAttribute("data-page") === "post" && document.getElementById("view").children.length > 0'));
  const sum3 = await cdp.eval(`(() => ({
    open: document.querySelector('.ai-summary').hasAttribute('open'),
    stored: localStorage.getItem('rec-blog:summary-collapsed')
  }))()`);
  eq2(sum3.stored, '1', '刷新后库中仍是折叠');
  eq2(sum3.open, false, '刷新后摘要卡保持折叠');
  await cdp.eval(`localStorage.removeItem('rec-blog:summary-collapsed');`);

  /* ---------- 目录收起：设置开关与顶栏按钮双向同步 ---------- */
  console.log('== 目录收起：开关与按钮双向同步 ==');
  await go('#/post/md-writing', 'post', { toc: 'yes' });
  const toc0 = await cdp.eval(`(() => ({
    mainW: Math.round(document.querySelector('#main').getBoundingClientRect().width),
    leftW: Math.round(document.querySelector('#col-left').getBoundingClientRect().width)
  }))()`);
  const toc1 = await cdp.eval(`(() => {
    document.getElementById('settings-toc').click();
    return { cls: document.body.classList.contains('toc-collapsed'),
             leftDisplay: getComputedStyle(document.querySelector('#col-left')).display,
             mainW: Math.round(document.querySelector('#main').getBoundingClientRect().width),
             pressed: document.getElementById('toc-toggle').getAttribute('aria-pressed'),
             stored: localStorage.getItem('recblog-toc-collapsed'),
             docScrollW: document.documentElement.scrollWidth,
             docClientW: document.documentElement.clientWidth };
  })()`);
  eq2(toc1.cls, true, '开关打开 → body.toc-collapsed');
  eq2(toc1.leftDisplay, 'none', '左栏收起');
  need(toc1.mainW > toc0.mainW, '正文变宽（不跳动）', toc0.mainW + ' → ' + toc1.mainW);
  eq2(toc1.pressed, 'true', '顶栏按钮同步为按下');
  eq2(toc1.stored, '1', '写库');
  need(toc1.docScrollW <= toc1.docClientW, '收起后无横向滚动',
    toc1.docScrollW + ' / ' + toc1.docClientW);
  const toc2 = await cdp.eval(`(() => {
    document.getElementById('toc-toggle').click();
    return { cls: document.body.classList.contains('toc-collapsed'),
             sw: document.getElementById('settings-toc').checked,
             stored: localStorage.getItem('recblog-toc-collapsed'),
             mainW: Math.round(document.querySelector('#main').getBoundingClientRect().width) };
  })()`);
  eq2(toc2.cls, false, '按钮点回 → 展开');
  eq2(toc2.sw, false, '开关同步回来');
  eq2(toc2.stored, '0', '写库');
  eq2(toc2.mainW, toc0.mainW, '正文宽度恢复原值');

  /* ---------- 设置面板入口：三角 / Esc / 点外部 / tab / 375 ---------- */
  console.log('== 设置面板：三角入口 / Esc / 点外部 / 窄屏抽屉 ==');
  const fab0 = await cdp.eval(`(() => {
    const fab = document.getElementById('settings-fab');
    const r = fab.getBoundingClientRect();
    return { label: fab.getAttribute('aria-label'),
             expanded: fab.getAttribute('aria-expanded'),
             controls: fab.getAttribute('aria-controls'),
             w: Math.round(r.width), h: Math.round(r.height),
             rightGap: Math.round(window.innerWidth - r.right),
             hidden: document.getElementById('settings-panel').hasAttribute('hidden'),
             icon: !!fab.querySelector('svg') };
  })()`);
  eq2(fab0.label, '打开设置', '三角 aria-label=打开设置');
  eq2(fab0.expanded, 'false', '初始 aria-expanded=false');
  eq2(fab0.controls, 'settings-panel', 'aria-controls 指向面板');
  need(fab0.icon, '三角是内联 SVG');
  need(fab0.hidden, '面板默认隐藏');
  need(fab0.w <= 20 && fab0.h <= 48, '三角形细长、不遮挡正文', fab0.w + '×' + fab0.h);
  need(fab0.rightGap >= 8 && fab0.rightGap <= 20,
    '三角与滚动条留出间距，不贴边', fab0.rightGap + 'px');
  const fab1 = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    const panel = document.getElementById('settings-panel');
    const r = panel.getBoundingClientRect();
    return { hidden: panel.hasAttribute('hidden'),
             expanded: document.getElementById('settings-fab').getAttribute('aria-expanded'),
             w: Math.round(r.width),
             rightGap: Math.round(window.innerWidth - r.right),
             docScrollW: document.documentElement.scrollWidth,
             docClientW: document.documentElement.clientWidth };
  })()`);
  need(!fab1.hidden, '点三角打开面板');
  eq2(fab1.expanded, 'true', '打开后 aria-expanded=true');
  need(fab1.w >= 288 && fab1.w <= 352, '面板宽 18–22rem', fab1.w + 'px');
  eq2(fab1.rightGap, 0, '面板贴右');
  need(fab1.docScrollW <= fab1.docClientW, '打开面板不撑出横向滚动',
    fab1.docScrollW + ' / ' + fab1.docClientW);
  const fab2 = await cdp.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { hidden: document.getElementById('settings-panel').hasAttribute('hidden') };
  })()`);
  need(fab2.hidden, 'Esc 关闭面板');
  const fab3 = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    document.querySelector('.col-main h1').click();
    return { hidden: document.getElementById('settings-panel').hasAttribute('hidden') };
  })()`);
  need(fab3.hidden, '点面板外关闭');
  const fab4 = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    document.getElementById('settings-tab-site').click();
    return { siteShown: !document.getElementById('settings-pane-site').hasAttribute('hidden'),
             readHidden: document.getElementById('settings-pane-reading').hasAttribute('hidden'),
             sel: document.getElementById('settings-tab-site').getAttribute('aria-selected'),
             recentMax: document.getElementById('settings-recent').getAttribute('max') };
  })()`);
  need(fab4.siteShown && fab4.readHidden, 'tab 切换阅读/站点');
  eq2(fab4.sel, 'true', '站点 tab aria-selected=true');
  eq2(fab4.recentMax, '15', '站点 tab 的最近条数复用同一范围（1–15）');
  await cdp.eval(`document.getElementById('settings-tab-reading').click();`);

  await metrics(375, 812, true);
  await go('#/post/md-writing', 'post');
  const fabMob = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    const p = document.getElementById('settings-panel');
    const r = p.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
             vh: window.innerHeight, vw: window.innerWidth,
             docScrollW: document.documentElement.scrollWidth,
             docClientW: document.documentElement.clientWidth };
  })()`);
  need(fabMob.left >= 0 && fabMob.right <= fabMob.vw, '375px 面板不出屏',
    fabMob.left + '–' + fabMob.right + ' / ' + fabMob.vw);
  need(fabMob.top >= 0 && fabMob.top < fabMob.vh, '375px 面板在视口内（底部抽屉）');
  need(fabMob.docScrollW <= fabMob.docClientW, '375px 打开面板无横向滚动',
    fabMob.docScrollW + ' / ' + fabMob.docClientW);

  /* ---------- 首页扳手：只在首页、打开同一面板 ---------- */
  console.log('== 首页扳手：只在首页显示 ==');
  await metrics(1280, 900, false);
  await go('#/home', 'home');
  const wrench = await cdp.eval(`(() => {
    const w = document.getElementById('settings-wrench');
    const q = document.getElementById('quote-btn');
    const fabCS = getComputedStyle(document.getElementById('settings-fab'));
    if (!w) return { has: false, fabDisplay: fabCS.display };
    const wr = w.getBoundingClientRect();
    const qr = q ? q.getBoundingClientRect() : null;
    w.click();
    return { has: true, label: w.getAttribute('aria-label'),
             radius: getComputedStyle(w).borderRadius,
             w: Math.round(wr.width), h: Math.round(wr.height),
             noOverlap: qr ? wr.bottom <= qr.top + 1 : true,
             opens: !document.getElementById('settings-panel').hasAttribute('hidden'),
             fabDisplay: fabCS.display };
  })()`);
  need(wrench.has, '首页有扳手按钮');
  eq2(wrench.label, '打开设置', '扳手有 aria-label');
  need(wrench.radius === '50%', '扳手是正圆', wrench.radius);
  need(wrench.w >= 52 && wrench.w <= 56, '扳手与一言按钮同尺寸', wrench.w + 'px');
  need(wrench.noOverlap, '扳手与「一言」按钮不重叠');
  need(wrench.opens, '扳手打开同一个设置面板');
  eq2(wrench.fabDisplay, 'none', '首页不显示三角入口');
  await go('#/post/md-writing', 'post');
  const wrenchGone = await cdp.eval(`(() => ({
    has: !!document.getElementById('settings-wrench'),
    fabDisplay: getComputedStyle(document.getElementById('settings-fab')).display
  }))()`);
  need(!wrenchGone.has, '离开首页：扳手卸载干净');
  eq2(wrenchGone.fabDisplay, 'grid', '其它页：三角入口恢复显示');

  /* ---------- 主题：跟随系统 / 手动覆盖 ---------- */
  console.log('== 主题：跟随系统与手动覆盖 ==');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await go('#/library', 'library');
  const theme0 = await cdp.eval(`(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    attr: document.documentElement.getAttribute('data-theme')
  }))()`);
  need(theme0.bg !== 'rgb(250, 248, 245)', '系统暗色 → 暗色令牌生效', theme0.bg);
  eq2(theme0.attr, null, '无 data-theme（跟随系统）');
  const theme1 = await cdp.eval(`(() => {
    document.getElementById('settings-fab').click();
    document.getElementById('settings-tab-site').click();
    const sel = document.getElementById('settings-theme');
    sel.value = 'light';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { bg: getComputedStyle(document.body).backgroundColor,
             attr: document.documentElement.getAttribute('data-theme'),
             stored: localStorage.getItem('rec-blog:theme') };
  })()`);
  eq2(theme1.bg, 'rgb(250, 248, 245)', '手动浅色覆盖系统暗色', theme1.bg);
  eq2(theme1.attr, 'light', 'data-theme=light');
  eq2(theme1.stored, 'light', '写 localStorage');
  const theme2 = await cdp.eval(`(() => {
    const sel = document.getElementById('settings-theme');
    sel.value = 'dark';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { bg: getComputedStyle(document.body).backgroundColor };
  })()`);
  eq2(theme2.bg, 'rgb(22, 20, 15)', '手动深色', theme2.bg);
  await cdp.eval(`localStorage.removeItem('rec-blog:theme');
    const s = document.getElementById('settings-theme');
    s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* ---------- 文章图片：本地图真的加载出来了（不是裂图） ----------
   * 哪些文章含图从 dist 推导，不写死：以后谁加了图，这条断言自动覆盖到。
   * DOM 桩与结构断言都量不到「浏览器能不能把图解码出来」，只有这里能。 */
  console.log('== 文章图片：本地图真加载 ==');
  const imgPosts = fs.readdirSync(path.join(ROOT, 'dist', 'p'))
    .filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(ROOT, 'dist', 'p', f), 'utf8').indexOf('<img ') >= 0)
    .map((f) => f.replace(/\.html$/, ''))
    .slice(0, 8);
  need(imgPosts.length >= 1, '至少有一篇文章带图（否则这条断言是空的）', imgPosts.join(','));
  await metrics(1280, 900, false);
  for (const slug of imgPosts) {
    await go('#/post/' + slug, 'post', { toc: 'yes' });
    const imgs = await cdp.eval(`(async () => {
      const list = Array.from(document.querySelectorAll('#view img'));
      const settled = list.map((img) => img.complete ? Promise.resolve() :
        new Promise((r) => {
          img.addEventListener('load', r, { once: true });
          img.addEventListener('error', r, { once: true });
        }));
      await Promise.all(settled);
      return {
        list: list.map((img) => ({
          src: img.getAttribute('src'),
          w: img.naturalWidth, h: img.naturalHeight,
          alt: img.getAttribute('alt') || '',
          cssW: Math.round(img.getBoundingClientRect().width)
        })),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      };
    })()`);
    need(imgs.list.length >= 1, slug + '：文章里有 <img>', String(imgs.list.length));
    const broken = imgs.list.filter((i) => !(i.w > 0 && i.h > 0));
    eq2(broken.length, 0, slug + '：每张图都解码出来了（naturalWidth > 0）',
        broken.map((i) => i.src).join(','));
    const noAlt = imgs.list.filter((i) => !i.alt.trim());
    eq2(noAlt.length, 0, slug + '：每张图都有 alt 文本', noAlt.map((i) => i.src).join(','));
    const ext = imgs.list.filter((i) => /^(https?:)?\/\//.test(i.src || ''));
    eq2(ext.length, 0, slug + '：图片全是本地路径（运行时零外部请求）',
        ext.map((i) => i.src).join(','));
    need(imgs.scrollW <= imgs.clientW + 1, slug + '：1280px 含图文章无横向滚动',
        imgs.scrollW + ' ≤ ' + imgs.clientW);
    // 375px：图不撑破页面
    await metrics(375, 812, true);
    await go('#/post/' + slug, 'post', { toc: 'yes' });
    const mob = await cdp.eval(`(() => {
      const list = Array.from(document.querySelectorAll('#view img'));
      const vw = document.documentElement.clientWidth;
      return {
        over: list.filter((i) => i.getBoundingClientRect().width > vw + 1).length,
        scrollW: document.documentElement.scrollWidth, clientW: vw
      };
    })()`);
    eq2(mob.over, 0, slug + '：375px 图片不超出视口');
    need(mob.scrollW <= mob.clientW + 1, slug + '：375px 含图文章无横向滚动',
        mob.scrollW + ' ≤ ' + mob.clientW);
    await cdp.shot(path.join(SHOTS, 'post-images-375-' + slug + '.png'));
    console.log('       %s：%d 张图全部加载', slug, imgs.list.length);
  }

  cdp.close();
  cleanup();

  console.log('');
  console.log('截图目录：%s', path.relative(ROOT, SHOTS));
  if (fails.length) {
    console.log('BROWSER FAIL（%d/%d）', fails.length, checks);
    fails.forEach((f) => console.log('  - %s', f));
    process.exit(1);
  }
  console.log('BROWSER PASS（%d 项）', checks);
}

main().catch((e) => { console.error(e); process.exit(1); });
