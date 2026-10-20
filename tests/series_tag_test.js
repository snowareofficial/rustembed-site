#!/usr/bin/env node
'use strict';
/* 标签页「系列合并」+ 成员页列表增强 + 页脚授权声明 的 DOM 回归。
 *
 *   node tests/series_tag_test.js
 *
 * 用 tests/dom-stub.js 把**主题源码** site/theme/app.js 真跑一遍（不是语法检查，
 * 也不依赖 dist），fetch 只喂 manifest.json 假数据：不联网、无 npm 依赖。
 *
 * 覆盖：
 *   [1] 标签页系列合并：多章合并 / 单章退化 / 徽章章数与命中数 / 章节列表完整 /
 *       跨年份分组 / 过滤整行隐藏 / data-filter 内容 / 系列数据异常不崩
 *   [2] 成员页：>6 篇才出搜索框 + 滚动区，搜索真的能过滤
 *   [3] 页脚：三行授权声明不被 JS 抹掉；#license-notice-site 的显隐由 CSS 规则 +
 *       body[data-page] 决定（桩不算 CSS ⇒ 规则走文本断言，真实样式见 browser-check）
 *   [4] 可访问性：details/summary 结构、summary 有文本、搜索框有 aria-label
 *   [5] 性能：100 篇 / 10 个系列的标签页渲染耗时
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStub } = require('./dom-stub.js');

const ROOT = path.resolve(__dirname, '..');
const THEME = path.join(ROOT, 'site', 'theme');

const fails = [];
let checks = 0;
function need(cond, msg, extra) {
  checks++;
  if (cond) { console.log('  ok   ' + msg); return true; }
  console.log('  FAIL ' + msg + (extra === undefined ? '' : ' → ' + extra));
  fails.push(msg);
  return false;
}
function eq(got, want, msg) { return need(got === want, msg, '期望 ' + want + '，实得 ' + got); }
function includes(hay, needle, msg) {
  return need(String(hay).indexOf(needle) >= 0, msg, '不含 ' + JSON.stringify(needle));
}

/* ---------------- 假 manifest ---------------- */

function post(slug, title, date, tags, series, extra) {
  const p = {
    slug, title, date, year: String(date).slice(0, 4),
    tags: tags || [], summary: title + ' 的摘要', author: 'sal', co_authors: [],
    words: 120, html: 'p/' + slug + '.html', url: '#/post/' + slug
  };
  if (series) p.series = series;
  return Object.assign(p, extra || {});
}

/* 2 篇普通文章 + 1 个 3 章系列（2 章 rust / 1 章 embedded）+ 1 个单章系列 */
const POSTS = [
  post('plain-1', '普通文章一', '2026-03-01', ['rust']),
  post('plain-2', '普通文章二', '2025-08-01', ['rust']),
  post('s1-c1', '第一章：搭环境', '2026-01-01', ['rust'], 'ser-a'),
  post('s1-c2', '第二章：点个灯', '2026-02-01', ['rust'], 'ser-a'),
  post('s1-c3', '第三章：上 RTIC', '2025-12-01', ['embedded'], 'ser-a'),
  post('s2-only', '单章系列的独苗', '2026-05-01', ['rust'], 'ser-b')
];

const SERIES = [
  { id: 'ser-a', title: 'Rust 嵌入式入门', posts: [
    { slug: 's1-c1', title: '第一章：搭环境', order: 1 },
    { slug: 's1-c2', title: '第二章：点个灯', order: 2 },
    { slug: 's1-c3', title: '第三章：上 RTIC', order: 3 }] },
  { id: 'ser-b', title: '单章系列', posts: [{ slug: 's2-only', title: '单章系列的独苗', order: 1 }] }
];

function manifest(over) {
  return Object.assign({
    site: { title: '探针站', tagline: 'tagline', url: 'https://example.com/',
      nav: ['library', 'members', 'services'] },
    built_at: '2026-10-20T00:00:00+00:00',
    posts: POSTS, series: SERIES,
    members: [{ id: 'sal', name: 'Sal', role: '维护者', skills: ['rust'] }],
    tags: [{ tag: 'rust', count: 4 }, { tag: 'embedded', count: 1 }],
    topics: [], projects: [], resources: [], services: [], weekly: [], pages: []
  }, over || {});
}

/* ---------------- 起桩 ---------------- */

/* 页脚三行授权声明：与 engine/build.py 的 LICENSE_NOTICE 同一套 id。
 * 主题源码 index.html 里只有一个空 <footer>，声明是构建期注入的。 */
const LICENSE_IDS = ['license-notice', 'license-notice-members', 'license-notice-site'];

function themeHtmlWithFooter() {
  const html = fs.readFileSync(path.join(THEME, 'index.html'), 'utf8');
  const empty = /<footer class="footer" id="footer">\s*<\/footer>/;
  const spans = LICENSE_IDS
    .map((id) => '  <span id="' + id + '">' + id + ' 的声明文本。</span>').join('\n');
  const filled = '<footer class="footer" id="footer">\n' + spans + '\n</footer>';
  return empty.test(html) ? html.replace(empty, filled) : html;
}

function makeApp(man) {
  const { document, window, location } = createStub(themeHtmlWithFooter());
  const sandbox = {
    window, document, location,
    fetch: function (u) {
      const key = String(u).split('?')[0];
      if (key === 'manifest.json') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(man),
          text: () => Promise.resolve(JSON.stringify(man)) });
      }
      /* 正文片段：给需要 p/*.html 的路由用（内容不重要，能解析即可） */
      if (/\.html$/.test(key)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(''),
          text: () => Promise.resolve('<p>桩片段</p>') });
      }
      return Promise.resolve({ ok: false, status: 404,
        json: () => Promise.reject(new Error('404 ' + u)),
        text: () => Promise.reject(new Error('404 ' + u)) });
    },
    navigator: {},
    setTimeout: (fn) => { void fn; return 0; },
    clearTimeout: () => {},
    console, IntersectionObserver: undefined
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(THEME, 'app.js'), 'utf8'),
    sandbox, { filename: 'site/theme/app.js' });
  return { rec: window.__rec, document, window, location };
}

/* ---------------- 断言小工具 ---------------- */

function textOf(node) { return node ? node.textContent : ''; }

function setFilter(frag, text) {
  const input = frag.querySelector('input.filter-input');
  if (!input) return false;
  if (input.value !== undefined) input.value = text;
  input.dispatch('input');
  return true;
}

/* 系列外的普通文章行（章节行在 .row-series 里面，要排除掉） */
function plainRows(frag) {
  return frag.querySelectorAll('li.row').filter((n) => !n.closest('.row-series'));
}

/* ---------------- [1] 标签页：同一系列合并成一条 ---------------- */

async function testLibraryTag() {
  console.log('== [1] 标签页：同一系列合并成一条 ==');
  const app = makeApp(manifest());
  await app.rec.started;
  const frag = await app.rec.VIEWS.library({ q: { tag: 'rust' } });

  const series = frag.querySelectorAll('li.row-series');
  eq(series.length, 1, '只出现 1 条系列行');

  const sum = series[0] ? series[0].querySelector('.series-sum') : null;
  const sumText = textOf(sum);
  includes(sumText, '系列', '系列行标记含「系列」');
  includes(sumText, '3 章', '系列行标记含章数「3 章」');
  includes(sumText, '命中 2', '只有部分章节命中标签时补一句命中数');
  includes(sumText, 'Rust 嵌入式入门', '摘要里有系列标题');
  includes(sumText, '2026-02-01', '摘要日期取系列最新一章');

  eq(series[0].querySelectorAll('li.row').length, 3, '展开后列出全部 3 个章节（含未命中标签那章）');
  eq(plainRows(frag).length, 3, '系列外的普通行 3 条（2 普通 + 单章系列退化）');
  eq(frag.querySelectorAll('li.row').length, 6, 'li.row 总数 = 3 普通 + 3 章节');
  includes(textOf(frag), '单章系列的独苗', '单章系列不合并，仍按普通文章行显示');

  /* 跨年份：系列按最新一章落在 2026 */
  const sums = frag.querySelectorAll('summary').map((s) => textOf(s));
  need(sums.some((t) => t.indexOf('2026 年') === 0), '存在 2026 年分组');
  need(sums.some((t) => t.indexOf('2025 年') === 0), '存在 2025 年分组');
  const y2026 = frag.querySelectorAll('details')
    .find((d) => textOf(d).indexOf('2026 年') === 0);
  need(!!y2026 && textOf(y2026).indexOf('Rust 嵌入式入门') >= 0,
    '系列落在最新一章所在年份（2026），章节列表仍完整');

  /* data-filter：系列标题 + 全部章节标题 + 标签 */
  const df = String(series[0].getAttribute('data-filter') || '');
  includes(df, 'Rust 嵌入式入门', 'data-filter 含系列标题');
  includes(df, '第一章：搭环境', 'data-filter 含章节标题一');
  includes(df, '第三章：上 RTIC', 'data-filter 含未命中标签的章节标题');
  includes(df, 'rust', 'data-filter 含标签');

  /* 过滤：整行隐藏、不残留章节；切回空查询恢复 */
  need(setFilter(frag, '这个词一定不存在'), '标签页有过滤输入框');
  need(series[0].classList.contains('hide'), '不匹配时整条系列行被隐藏');
  need(series[0].classList.contains('row-series'), '隐藏后仍保留 row-series 类');
  eq(series[0].querySelectorAll('li.row').filter((n) => n.classList.contains('hide')).length, 0,
    '章节行不单独隐藏（跟着整行走）');
  need(setFilter(frag, ''), '可以切回空查询');
  need(!series[0].classList.contains('hide'), '切回空查询后系列行恢复');
  need(setFilter(frag, 'RTIC'), '可以按章节标题搜索');
  need(!series[0].classList.contains('hide'), '按未命中标签的章节标题也能搜到该系列');
}

/* 无标签的书库页也合并多章系列，避免文章库变成流水账 */
async function testLibraryNoTag() {
  console.log('== [1b] 无标签的书库页：多章系列也合并 ==');
  const app = makeApp(manifest());
  await app.rec.started;
  const frag = await app.rec.VIEWS.library({ q: {} });
  eq(frag.querySelectorAll('li.row-series').length, 1, '书库页合并 1 个多章系列');
  eq(plainRows(frag).length, 3, '普通行 = 2 篇普通 + 1 个单章系列');
  includes(textOf(frag), 'Rust 嵌入式入门', '系列行保留系列标题');
  includes(textOf(frag), '多章系列折叠为 1 条', '页头说明折叠数量');
}

/* 系列数据异常：series id 不存在、series 缺 posts 字段 */
async function testLibraryBrokenSeries() {
  console.log('== [1c] 系列数据异常：不崩 ==');
  const broken = manifest({
    posts: [post('ghost', '引用了不存在的系列', '2026-01-01', ['rust'], 'ser-zzz'),
      post('noposts', '系列条目缺 posts 字段', '2026-01-02', ['rust'], 'ser-empty')],
    series: [{ id: 'ser-empty', title: '空系列' }]
  });
  let frag = null, threw = null;
  try {
    const app = makeApp(broken);
    await app.rec.started;
    frag = await app.rec.VIEWS.library({ q: { tag: 'rust' } });
  } catch (e) { threw = e; }
  need(!threw, 'series id 不存在 / 缺 posts 字段时不抛异常', threw && threw.message);
  if (frag) {
    eq(frag.querySelectorAll('li.row-series').length, 0, '异常系列不会被合并成系列行');
    includes(textOf(frag), '引用了不存在的系列', '异常系列的文章仍正常显示');
    includes(textOf(frag), '系列条目缺 posts 字段', '缺 posts 的系列按普通文章行显示');
  }
}

/* ---------------- [2] 成员页 ---------------- */

function memberPosts(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(post('mp-' + i, '第 ' + (i + 1) + ' 篇：' + (i % 2 ? '调试笔记' : '点亮 LED'),
      '2026-0' + ((i % 9) + 1) + '-01', ['rust', 'probe-rs']));
  }
  return out;
}

async function testMemberMany() {
  console.log('== [2a] 成员页：7 篇文章 → 搜索框 + 滚动区 ==');
  const app = makeApp(manifest({ posts: memberPosts(7) }));
  await app.rec.started;
  const frag = await app.rec.VIEWS.member({ seg: [null, 'sal'] });

  const input = frag.querySelector('input.filter-input');
  need(!!input, '7 篇文章时出现过滤输入框');
  need(!!input && !!input.getAttribute('aria-label'), '过滤框有 aria-label');
  need(!!frag.querySelector('.rows-scroll'), '7 篇文章时出现 .rows-scroll 滚动区');
  eq(frag.querySelectorAll('li.row').length, 7, '7 篇文章都渲染出来');

  need(setFilter(frag, '调试'), '成员页过滤框可用');
  const left = frag.querySelectorAll('li.row').length;
  need(left > 0 && left < 7, '按标题过滤后行数变少', left);
  need(textOf(frag).indexOf('点亮 LED') < 0, '不匹配的“点亮 LED”被过滤掉');
  need(setFilter(frag, 'probe-rs'), '按标签也能过滤');
  eq(frag.querySelectorAll('li.row').length, 7, '标签全命中时仍是 7 行');
  need(setFilter(frag, ''), '清掉过滤条件');
  eq(frag.querySelectorAll('li.row').length, 7, '清空后 7 篇恢复');
}

async function testMemberFew() {
  console.log('== [2b] 成员页：6 篇文章 → 原样 ==');
  const app = makeApp(manifest({ posts: memberPosts(6) }));
  await app.rec.started;
  const frag = await app.rec.VIEWS.member({ seg: [null, 'sal'] });
  need(!frag.querySelector('input.filter-input'), '6 篇文章时不出现过滤输入框');
  need(!frag.querySelector('.rows-scroll'), '6 篇文章时不出现滚动区');
  eq(frag.querySelectorAll('li.row').length, 6, '6 篇文章照常全部渲染');
}

/* ---------------- [3] 页脚 ---------------- */

async function testFooter(app) {
  console.log('== [3] 页脚：三行授权声明与互助免责声明的显隐 ==');
  for (const id of LICENSE_IDS) {
    need(!!app.document.getElementById(id), '页脚保留 #' + id + '（buildFooter 没抹掉）');
  }
  /* 桩不算 CSS：断言「规则存在 + 路由打 data-page」，真实显隐交给 browser-check */
  const css = fs.readFileSync(path.join(THEME, 'style.css'), 'utf8');
  includes(css, '#license-notice-site { display: none; }', '默认隐藏互助免责声明的规则存在');
  includes(css, 'body[data-page="services"] #license-notice-site',
    'services 页显示该声明的规则存在');
  includes(css, 'body[data-page="service"] #license-notice-site',
    'service 详情页显示该声明的规则存在');
  includes(css, 'max-width: 42rem', '页脚声明限宽 42rem');

  /* 路由切换真的会给 body 打 data-page（免责声明只在这两页显示） */
  for (const [hash, want] of [['#/', 'home'], ['#/library', 'library'], ['#/topics', 'topics'],
    ['#/members', 'members'], ['#/services', 'services'], ['#/service/x', 'service'],
    ['#/post/plain-1', 'post']]) {
    app.location.hash = hash;
    await app.rec.render();
    eq(app.document.body.getAttribute('data-page'), want, hash + ' → body[data-page]=' + want);
  }

  /* 反复渲染不能把已移入 .footer-legal 的声明清掉（回归：二次渲染清空页脚） */
  app.location.hash = '#/services';
  await app.rec.render();
  await app.rec.render();
  for (const id of LICENSE_IDS) {
    need(!!app.document.getElementById(id), '二次渲染后仍保留 #' + id);
  }
  const kept = Array.from(app.document.querySelectorAll('span'))
    .filter((s) => s.id && s.id.indexOf('license-notice') === 0);
  eq(kept.length, 3, '二次渲染后页脚仍有 3 行授权声明');

  /* 构建期注入：dist/index.html 里必须有三行声明（需要先 build） */
  const distHtml = path.join(ROOT, 'dist', 'index.html');
  if (fs.existsSync(distHtml)) {
    const built = fs.readFileSync(distHtml, 'utf8');
    for (const id of LICENSE_IDS) {
      includes(built, 'id="' + id + '"', 'dist/index.html 注入了 #' + id);
    }
  } else {
    console.log('  --   跳过 dist/index.html 检查（还没构建，先 build 再跑才有）');
  }
}

/* ---------------- [4] 可访问性 ---------------- */

async function testA11y() {
  console.log('== [4] 可访问性 ==');
  const app = makeApp(manifest());
  await app.rec.started;
  const frag = await app.rec.VIEWS.library({ q: { tag: 'rust' } });

  const series = frag.querySelectorAll('li.row-series')[0];
  const details = series ? series.querySelector('details') : null;
  const summary = series ? series.querySelector('summary') : null;
  need(!!details && details.localName === 'details', '系列用 <details> 承载（原生键盘可展开）');
  need(!!summary && summary.localName === 'summary', '系列有 <summary>（原生可聚焦、可回车展开）');
  need(!!summary && textOf(summary).trim().length > 0, 'summary 有可读文本（不只有图标）');
  includes(textOf(summary), 'Rust 嵌入式入门', 'summary 文本含系列标题');
  const libInput = frag.querySelector('input.filter-input');
  need(!!libInput && !!libInput.getAttribute('aria-label'), '标签页过滤框有 aria-label');

  /* 年份分组的 details/summary 同样要键盘可用 */
  const years = frag.querySelectorAll('details');
  need(years.length >= 2 && !!years[0].querySelector('summary'), '年份分组也是 details/summary');
  /* 计数单位是「项」不是「篇」：一条系列行算 1 项但含多章（83e67c3 起刻意改的） */
  includes(textOf(years[0].querySelector('summary')), '项', '年份分组摘要写明了条数');
  need(!/篇/.test(textOf(years[0].querySelector('summary'))), '年份分组不用「篇」计数（系列行会误导）');

  const mApp = makeApp(manifest({
    posts: [1, 2, 3, 4, 5, 6, 7].map((i) => post('mp-' + i, '文章 ' + i,
      '2026-01-0' + i, ['rust']))
  }));
  await mApp.rec.started;
  const mf = await mApp.rec.VIEWS.member({ seg: [null, 'sal'] });
  const mi = mf.querySelector('input.filter-input');
  need(!!mi && !!mi.getAttribute('aria-label'), '成员页过滤框有 aria-label');
}

/* ---------------- [5] 性能 ---------------- */

async function testPerf() {
  console.log('== [5] 性能：100 篇文章 / 10 个系列 ==');
  const posts = [], series = [];
  for (let s = 0; s < 10; s++) {
    const id = 'perf-ser-' + s;
    const chapters = [];
    for (let c = 0; c < 10; c++) {
      const slug = 'perf-' + s + '-' + c;
      posts.push(post(slug, '系列' + s + ' 第' + c + '章',
        '2025-0' + ((c % 9) + 1) + '-1' + (c % 9), [c % 2 ? 'embedded' : 'rust'], id));
      chapters.push({ slug, title: '系列' + s + ' 第' + c + '章', order: c + 1 });
    }
    series.push({ id, title: '性能系列 ' + s, posts: chapters });
  }
  const big = makeApp(manifest({ posts, series }));
  await big.rec.started;
  const t0 = Date.now();
  const frag = await big.rec.VIEWS.library({ q: { tag: 'rust' } });
  const ms = Date.now() - t0;
  eq(frag.querySelectorAll('li.row-series').length, 10, '10 个系列各合并成 1 行');
  need(ms < 400, '标签页渲染 ' + ms + ' ms（阈值 400ms）');
  console.log('       100 篇 / 10 系列 → ' + ms + ' ms；系列行 10 条，章节行 '
    + frag.querySelectorAll('li.row-series li.row').length + ' 行');
}

/* ---------------- 主流程 ---------------- */

async function main() {
  await testLibraryTag();
  await testLibraryNoTag();
  await testLibraryBrokenSeries();
  await testMemberMany();
  await testMemberFew();

  const footApp = makeApp(manifest());
  await footApp.rec.started;
  await testFooter(footApp);
  await testA11y();
  await testPerf();

  console.log('\n' + (fails.length
    ? 'SERIES/TAG FAIL（' + fails.length + '/' + checks + '）'
    : 'SERIES/TAG PASS（' + checks + ' 项）'));
  process.exit(fails.length ? 1 : 0);
}

main().catch(function (e) {
  console.error('测试自身抛异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
