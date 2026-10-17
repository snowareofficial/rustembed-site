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
const PORT = 9222 + (process.pid % 200);

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
