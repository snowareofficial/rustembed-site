'use strict';
/* browser_checks：首页 / 标签页系列合并 / 成员页滚动区 / 页脚声明（2026-10-21 自 browser-check.js 按字节拆出，原 L450-643）。
 * 导出 async function check(H)：H 由 browser_lib.start() 装配（cdp / go / metrics /
 * need / eq2 / includes2 / SHOTS…）。本节顺序即原文件的执行顺序。 */
const path = require('node:path');

module.exports = async function check(H) {
  const { cdp, go, metrics, need, eq2, includes2, SHOTS } = H;

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

};
