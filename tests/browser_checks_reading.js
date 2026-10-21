'use strict';
/* browser_checks：阅读控制（最近条数 / 长代码折叠 / 头像 / 高亮 / 一言 / 本页目录）+ 系列页与展开滚动框（2026-10-21 自 browser-check.js 按字节拆出，原 L644-1007）。
 * 导出 async function check(H)：H 由 browser_lib.start() 装配（cdp / go / metrics /
 * need / eq2 / includes2 / SHOTS…）。本节顺序即原文件的执行顺序。 */
const path = require('node:path');

module.exports = async function check(H) {
  const { cdp, go, metrics, need, eq2, includes2, SHOTS } = H;

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

};
