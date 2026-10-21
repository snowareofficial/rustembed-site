'use strict';
/* browser_checks：桌面 / 对比度 / 文章页 / 900×900 / 375×812 / 视频附件 / 摘要导图 / 暗色（2026-10-21 自 browser-check.js 按字节拆出，原 L211-449）。
 * 导出 async function check(H)：H 由 browser_lib.start() 装配（cdp / go / metrics /
 * need / eq2 / includes2 / SHOTS…）。本节顺序即原文件的执行顺序。 */
const path = require('node:path');

module.exports = async function check(H) {
  const { cdp, go, metrics, measureContrast, need, eq2, includes2, SHOTS } = H;

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

};
