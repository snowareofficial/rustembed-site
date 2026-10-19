'use strict';
/* 无头浏览器验收 + 截图：node tests/browser-check.js
 *
 * 只依赖 Node 内置能力（fetch + 全局 WebSocket）+ 本机 Edge/Chrome 的 CDP，
 * 不给站点引任何第三方东西。真实测量：
 *   - 三栏是否真的存在、中栏是否 ≤ 38rem
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
  need(r.main && r.main.w <= 608.5, '中栏宽度 ≤ 38rem（608px）', r.main && Math.round(r.main.w) + 'px');
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
   * 真实站点里 `rust-embedded-101` 是 2 章系列，两章都带 rust/embedded 标签，
   * 因此 #/library?tag=rust 上应该正好出现 1 条系列行（部分命中 ⇒ 徽章带命中数）。
   */
  console.log('== 标签页系列合并（真实样式 + 键盘可用） ==');
  await metrics(1280, 900, false);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('#/library?tag=rust', 'library');
  const series = await cdp.eval(`(() => {
    const rows = document.querySelectorAll('#view li.row-series');
    const row = rows[0];
    if (!row) return { count: rows.length };
    const sum = row.querySelector('.series-sum');
    const badge = row.querySelector('.series-badge');
    const details = row.querySelector('details');
    sum.focus();
    const focused = document.activeElement === sum;
    sum.click();
    const opened = !!details.open;
    const chapters = row.querySelectorAll('.series-posts li.row');
    const hidden = Array.from(chapters).filter((li) =>
      getComputedStyle(li).display === 'none' || !li.checkVisibility());
    return {
      count: rows.length,
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
  eq2(series.count, 1, '标签页 #rust 上只有 1 条系列行');
  includes2(series.badge, '系列', '徽章写着「系列」');
  includes2(series.badge, '2 章', '徽章写着系列章数');
  includes2(series.badge, '命中', '只部分章节命中时徽章带命中数');
  eq2(series.focused, true, 'summary 可获得焦点（键盘可达）');
  eq2(series.opened, true, '回车/点击能展开 series details');
  eq2(series.chapters, 2, '展开后列出全部章节');
  eq2(series.visibleChapters, 2, '展开后章节真的可见');
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
