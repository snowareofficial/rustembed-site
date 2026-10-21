'use strict';
/* browser_checks：正文字号 / 摘要折叠 / 目录收起 / 设置面板 / 首页扳手 / 主题 / 文章图片（2026-10-21 自 browser-check.js 按字节拆出，原 L1008-1365）。
 * 导出 async function check(H)：H 由 browser_lib.start() 装配（cdp / go / metrics /
 * need / eq2 / includes2 / SHOTS…）。本节顺序即原文件的执行顺序。 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function check(H) {
  const { cdp, go, metrics, waitFor, need, eq2, includes2, SHOTS, ROOT } = H;

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
  /* 三个宽度下都不能压住正文：桌面的右侧空白列、单列时停进顶栏。
     正文右缘并排着代码块的「复制 / 展开」两个按钮，压上去既挡字也吃点击。 */
  const fabGutter = await cdp.eval(`(() => {
    const fab = document.getElementById('settings-fab').getBoundingClientRect();
    const main = document.getElementById('main').getBoundingClientRect();
    return { fabLeft: Math.round(fab.left), mainRight: Math.round(main.right) };
  })()`);
  need(fabGutter.fabLeft > fabGutter.mainRight,
    '桌面端三角落在正文右侧的空白列里（不压正文 / 代码块按钮）',
    fabGutter.fabLeft + ' > ' + fabGutter.mainRight);
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
  /* 单列布局下正文铺满宽度、右缘就是代码块头的「复制 / 展开」两个按钮：
     三角必须停进顶栏，否则滚到视口中线时会正好压在这两个按钮上（z-index 81 还会吃掉点击）。 */
  const fabDock = await cdp.eval(`(() => {
    const fab = document.getElementById('settings-fab');
    const fr = fab.getBoundingClientRect();
    const br = document.querySelector('.topbar').getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round((fr.left + fr.right) / 2),
                                          Math.round((fr.top + fr.bottom) / 2));
    return { docked: fr.top >= br.top - 1 && fr.bottom <= br.bottom + 1,
             fabBottom: Math.round(fr.bottom), barBottom: Math.round(br.bottom),
             hitFab: !!(hit && hit.closest && hit.closest('#settings-fab')) };
  })()`);
  need(fabDock.docked, '375px：三角停进顶栏，不垂直居中压正文',
    fabDock.fabBottom + ' ≤ ' + fabDock.barBottom);
  need(fabDock.hitFab, '375px：三角自身可点到（没有元素盖住）');
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
};
