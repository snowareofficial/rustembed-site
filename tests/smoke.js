'use strict';
/* 真实 DOM 冒烟：node tests/smoke.js
 *
 * 不是语法检查 —— 用 tests/dom-stub.js 提供的 DOM 桩把 dist/js/ 下的脚本按 index.html 顺序真正跑一遍：
 * 每个视图函数都执行、结构都打印，并断言三栏、左栏无站点链接、右栏默认收起等硬约束。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStub } = require('./dom-stub.js');
const { jsFiles } = require('./theme-files.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const fails = [];
function need(cond, msg) {
  if (!cond) fails.push(msg);
  return !!cond;
}
function count(list) { let n = 0; for (let i = 0; list[i] !== undefined; i++) n++; return n; }
function nodeCount(node) { return count(node.childNodes); }

function read(p) { return fs.readFileSync(path.join(DIST, p), 'utf8'); }
function readMaybe(p) {
  try { return read(p); } catch (e) { return null; }
}

const html = read('index.html');
/* 主题 JS 按职责拆成 js/ 多文件（2026-10-21）：按 index.html 的引用顺序拼接，
   等价于拆分前的 app.js —— 工程纪律断言对全量 JS 生效。 */
const appSrc = jsFiles(DIST).map((f) => read(f)).join('\n');
const manifest = JSON.parse(read('manifest.json'));
const NAV = manifest.site.nav || [];

const { document, window, location } = createStub(html);

const requested = [];
function fakeFetch(u) {
  requested.push(String(u));
  const rel = String(u).split('?')[0].replace(/^\.\//, '');
  const txt = readMaybe(rel);
  if (txt === null) {
    return Promise.resolve({
      ok: false,
      json: () => Promise.reject(new Error('404 ' + u)),
      text: () => Promise.reject(new Error('404 ' + u))
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(JSON.parse(txt)),
    text: () => Promise.resolve(txt)
  });
}

const sandbox = {
  window, document, location,
  fetch: fakeFetch,
  navigator: {},
  setTimeout: (fn) => { void fn; return 0; },
  clearTimeout: () => {},
  console,
  IntersectionObserver: undefined
};
vm.createContext(sandbox);
const loaded = jsFiles(DIST);
for (const f of loaded) {
  vm.runInContext(read(f), sandbox, { filename: 'dist/' + f });
}

const rec = window.__rec;
need(!!rec, '主题 JS 没有导出 window.__rec（无法驱动视图）');
if (!rec) { report(); }

async function main() {
  await rec.started;

  console.log('== 骨架 ==');
  const left = document.getElementById('col-left');
  const main = document.getElementById('main');

  need(!!left, '缺少 #col-left（左栏）');
  need(!!main, '缺少 #main（中栏）');
  need(!!left && left.classList.contains('col-left'), '#col-left 类名不对');
  need(!!main && main.classList.contains('col-main'), '#main 缺少 col-main 类');
  console.log('  两栏：col-left / col-main 存在，站点导航在顶栏');

  // 左栏：必须有「本文目录」，且不含任何站点级入口
  need(!!left && left.textContent.indexOf('本文目录') >= 0, '左栏缺少「本文目录」');
  const siteHrefs = NAV.map((k) => '#/' + k);
  let badLeft = 0;
  if (left) {
    const links = left.querySelectorAll('a');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (siteHrefs.indexOf(href) >= 0) { badLeft++; console.log('    ! 左栏出现站点入口 ' + href); }
    }
  }
  need(badLeft === 0, '左栏出现了 ' + badLeft + ' 个站点级入口');
  console.log('  左栏「本文目录」存在，站点级入口 0 个');

  // 右栏：details 默认收起，且含 10 个站点入口
  const drawer = document.getElementById('nav-drawer');
  need(!!drawer, '缺少 #nav-drawer');
  need(!!drawer && !drawer.hasAttribute('open'), '#nav-drawer 默认不是收起状态');
  const siteNav = document.getElementById('site-nav');
  let navCount = 0;
  const hrefs = [];
  if (siteNav) {
    for (const a of siteNav.querySelectorAll('a')) {
      navCount++;
      hrefs.push(a.getAttribute('href'));
    }
  }
  need(navCount === NAV.length, '右栏站点入口 ' + navCount + ' 个，应为 ' + NAV.length + ' 个');
  for (const k of NAV) need(hrefs.indexOf('#/' + k) >= 0, '右栏缺少入口 #/' + k);
  console.log('  右栏默认收起（details 无 open），站点入口 ' + navCount + ' 个：' + hrefs.join(' '));

  // 视图逐个执行
  console.log('== 视图 ==');
  const routes = [
    '#/library', '#/knowledge', '#/topics', '#/topic/probe-rs',
    '#/post/hello-rec', '#/post/md-writing',
    '#/projects', '#/project/rec-blog', '#/project/sml-sitegen',
    '#/resources', '#/members', '#/member/sal', '#/member/cxi',
    '#/services', '#/service/pcb-emc-review',
    '#/weekly', '#/weekly/2026-W38',
    '#/pages', '#/page/contribute', '#/page/contracts',
    '#/join', '#/search/rust', '#/nope'
  ];
  for (const r of routes) {
    location.hash = r;
    await rec.render();
    const view = document.getElementById('view');
    const kids = nodeCount(view);
    const links = count(view.querySelectorAll('a'));
    const len = view.textContent.length;
    need(kids > 0, '视图 ' + r + ' 渲染为空');
    console.log('  %s → 顶层节点 %d / 链接 %d / 文本 %d 字 / data-page=%s',
      r, kids, links, len, document.body.getAttribute('data-page'));
  }

  console.log('== 数据不足就不画图 ==');
  const emptyTopic = { id: 'x', title: '空词条', tags: [], related: [], resolved: [] };
  need(rec.relGraph(emptyTopic, manifest.posts, manifest.projects, manifest.topics) === null,
    '没有关系数据时不该画关系图');
  const realTopic = (manifest.topics || [])[0];
  if (realTopic) {
    const g = rec.relGraph(realTopic, manifest.posts, manifest.projects, manifest.topics);
    need(!!g, '有真实关系的词条应该画出关系图');
    if (g) {
      const svg = g.querySelector('svg');
      need(!!svg, '关系图缺少 svg');
      need(!!svg && (svg.getAttribute('role') === 'img'), 'svg 缺少 role="img"');
      need(!!svg && !!(svg.getAttribute('aria-label') || ''), 'svg 缺少 aria-label');
      console.log('  关系图：role=%s，aria-label=“%s”', svg.getAttribute('role'), svg.getAttribute('aria-label'));
    }
  }
  need(rec.langBar(null) === null, '没有 languages_pct 时不该画语言占比条');
  need(rec.langBar({}) === null, 'languages_pct 为空时不该画语言占比条');
  need(!!rec.langBar({ Rust: 70.5, Python: 29.5 }), '有真实 languages_pct 时应该画占比条');
  console.log('  语言占比条：无数据 null / 有数据 一条（宽度即真实百分比）');

  console.log('== 协议白名单 ==');
  need(rec.safeUrl('javascript:alert(1)') === '', 'javascript: 未被拦截');
  need(rec.safeUrl('data:text/html,<script>') === '', 'data: 未被拦截');
  need(rec.safeUrl('https://example.com') !== '', 'https 被误拦');
  need(rec.safeUrl('mailto:a@b.c') !== '', 'mailto 被误拦');
  console.log('  javascript: / data: 被拦截；https / mailto 放行');

  console.log('== 附件卡与提取码 ==');
  if (typeof rec.attachCard === 'function') {
    const card = rec.attachCard({ name: '资料包', kind: 'link',
      url: 'https://example.com/a.zip', code: 'abcd' });
    const html = card.innerHTML || '';
    need(html.indexOf('提取码') >= 0, '附件卡缺少「提取码」按钮');
    need(html.indexOf('abcd') >= 0, '附件卡没有显示提取码值');
    need(html.indexOf('javascript') < 0, '附件卡出现了非法链接');
    // 点一下：写剪贴板 + toast（toast 挂在 body 上）
    const chip = card.querySelector('.code-chip');
    need(!!chip, '附件卡里找不到 .code-chip');
    if (chip && typeof rec.toast === 'function') {
      rec.toast('已复制提取码：abcd');
      const toasts = document.body.querySelectorAll('.toast');
      need(toasts.length >= 1, '点击后没有 toast');
    }
    const noCode = rec.attachCard({ name: '无码', kind: 'link', url: 'https://example.com/b' });
    need((noCode.innerHTML || '').indexOf('提取码') < 0, '没有提取码时不该出现提取码按钮');
    console.log('  附件卡：有码出按钮 / 无码不出；点击复制并 toast');
  } else {
    need(false, '主题 JS 没有导出 attachCard');
  }

  console.log('== 工程纪律 ==');
  // 只统计代码里的用法：先剥掉块注释与行注释（保留 https:// 之类字符串里的 //）
  const code = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
  need(code.indexOf('childNodes.length') < 0, '主题 JS 代码里出现了 childNodes.length');
  const inner = (code.match(/\.innerHTML\s*=/g) || []).length;
  need(inner === 1, '主题 JS 里 innerHTML 赋值 ' + inner + ' 处（只允许 frag() 一处）');
  console.log('  无 childNodes.length；innerHTML 赋值仅 %d 处（frag()）', inner);
  need(requested.indexOf('manifest.json') >= 0, '没有请求 manifest.json');
  const others = requested.filter((u) => u !== 'manifest.json' && u !== 'search-index.json' && !/\.html$/.test(u));
  need(others.length === 0, '出现了计划外的请求：' + others.join(', '));
  console.log('  运行时请求：manifest.json + 片段共 ' + requested.length + ' 次（无第三方）');

  report();
}

function report() {
  console.log('');
  if (fails.length) {
    console.log('SMOKE FAIL（%d 项）', fails.length);
    fails.forEach((f, i) => console.log('  %d. %s', i + 1, f));
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

if (rec) main().catch((e) => { console.error(e); process.exit(1); });
