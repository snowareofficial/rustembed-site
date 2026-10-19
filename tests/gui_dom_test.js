#!/usr/bin/env node
/* 写作台前端 DOM 冒烟（资源弹层筛选 / 提取码复制 toast / 附件写入 / 站点附件卡）。
 *
 * 跑法：node tests/gui_dom_test.js
 * 用的还是 tests/dom-stub.js（无浏览器、无 npm 依赖）；fetch 用假数据，不联网。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createStub } = require('./dom-stub.js');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
function need(cond, msg) {
  if (cond) { console.log('  ok   ' + msg); } else { console.log('  FAIL ' + msg); fails.push(msg); }
}
function report() {
  if (fails.length) {
    console.log('\nGUI DOM FAIL（' + fails.length + ' 项）');
    process.exit(1);
  }
  console.log('\nGUI DOM PASS');
  process.exit(0);
}

/* ---------------- 假数据 ---------------- */
const RESOURCES = [
  { id: 'book-a', title: '嵌入式 Rust 书', kind: 'book', folder: '入门',
    url: 'https://docs.rust-embedded.org/book/', code: 'abcd', tags: ['rust'] },
  { id: 'tool-b', title: 'probe-rs', kind: 'tool', folder: '调试',
    url: 'https://github.com/probe-rs/probe-rs', code: '', tags: ['debug'] }
];
const CANNED = {
  '/api/types': [{ type: 'post', dir: 'posts', contract: 'BlogPost', loose: false, fields: [
    { name: 'title', type: 'str', required: true, options: null, default: null, doc: '' },
    { name: 'author', type: 'str', required: true, options: null, default: null, doc: '' },
    { name: 'summary', type: 'str', required: true, options: null, default: null, doc: '' },
    { name: 'tags', type: '[str]', required: true, options: null, default: null, doc: '' }] }],
  '/api/tree': [{ type: 'post', id: 'demo', title: '示例', path: 'content/posts/2026/demo/index.md',
    draft: false, ext: 'md', mtime: 1 }],
  '/api/status': { branch: 'master', dirty: [] },
  '/api/resources': RESOURCES,
  '/api/validate': { ok: true, errors: [] },
  '/api/preview': { ok: true, html: '<p>hi</p>', toc: [], words: 2 }
};

function fakeFetch(url) {
  const key = String(url).split('?')[0];
  const data = CANNED[key];
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data === undefined ? {} : data))
  });
}

/* ---------------- 起桩 ---------------- */
const html = fs.readFileSync(path.join(ROOT, 'gui', 'assets', 'index.html'), 'utf8');
const { document, window, location } = createStub(html);
const clipboard = [];
const navigatorStub = {
  clipboard: {
    writeText: function (t) { clipboard.push(t); return Promise.resolve(); }
  }
};
const sandbox = {
  window, document, location, navigator: navigatorStub,
  fetch: fakeFetch, console,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise, JSON, FileReader: function () {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'gui', 'assets', 'api.js'), 'utf8'),
  sandbox, { filename: 'gui/assets/api.js' });
// 浏览器里 window.api 就是全局变量；桩里 window 与沙箱全局不是同一个对象，手动接一下
sandbox.api = window.api;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'gui', 'assets', 'app.js'), 'utf8'),
  sandbox, { filename: 'gui/assets/app.js' });

const gui = window.__gui;
const $ = (id) => document.getElementById(id);

function tick() { return new Promise((r) => setTimeout(r, 0)); }
function click(el) {
  if (!el) { return; }
  if (typeof el.dispatch === 'function') { el.dispatch('click', { target: el }); }
  if (typeof el.onclick === 'function') { el.onclick({ target: el }); }
}

/* ---------------- 用例 ---------------- */
async function main() {
  need(!!gui, '写作台 app.js 暴露了 __gui 出口');

  // 打开一篇 markdown 文档（后面插入附件要用）
  gui.S.doc = {
    path: 'content/posts/2026/demo/index.md', type: 'post', contract: 'BlogPost',
    ext: 'md', front_matter: { title: '示例', author: 'sal' }, body: 'x', raw: '', hash: ''
  };

  // 1) 插入菜单覆盖结构化块，且 .md/.sml 两套语法都有
  const labels = gui.INSERTS.map((i) => i.label).join(',');
  need(['标题', '代码块', '附件', '分割线', '面板', '步骤', '图集', '终端输出', '时间线 when']
    .every((l) => labels.indexOf(l) >= 0), '插入菜单覆盖结构化块：' + labels);
  need(gui.INSERTS.every((i) => i.act || (i.md && i.sml)),
    '每个插入项都有 .md 与 .sml 两套语法');
  const panel = gui.INSERTS.find((i) => i.label === '面板');
  need(panel.md.indexOf(':::panel') === 1 || panel.md.indexOf(':::panel') >= 0,
    '.md 的面板写 :::panel');
  need(panel.sml.indexOf('panel {') >= 0 && panel.sml.indexOf(':::') < 0,
    '.sml 的面板写裸块 panel { } 且不带 :::');

  // 2) 资源弹层：打开 → 两行；按关键字筛选 → 一行
  gui.openResources();
  await tick();
  const rows = $('res-list').children;
  need(rows.length === 2, '资源弹层列出 2 条资源（实际 ' + rows.length + '）');
  $('res-q').value = 'probe';
  gui.renderResList();
  need($('res-list').children.length === 1, '按关键字筛选后只剩 1 条');
  $('res-q').value = '';
  gui.renderResList();

  // 3) 提取码 chip：点一下 → 写剪贴板 + toast
  const chip = gui.codeChip('abcd');
  need(!!chip && chip.getAttribute('data-code') === 'abcd', '提取码 chip 带 data-code');
  need((chip.textContent || '').indexOf('提取码') >= 0, '提取码 chip 文案含「提取码」');
  click(chip);
  await tick();
  need(clipboard.indexOf('abcd') >= 0, '点提取码写入剪贴板（' + JSON.stringify(clipboard) + '）');
  const toasts = document.body.querySelectorAll('.toast');
  need(toasts.length >= 1, '点提取码后出现 toast');

  // 4) 选资源 → 写入前确认 → 全部写入 → attachments 里是引用 id
  gui.S.picked = RESOURCES[0];
  gui.insertAttachment();
  need($('confirm-modal').hidden === false, '插入附件会先弹写入前确认');
  need($('confirm-rows').children.length === 1, '确认弹层只列 1 项真实来源');
  click($('confirm-all'));
  const atts = gui.S.doc.front_matter.attachments || [];
  need(atts.length === 1 && atts[0].resource === 'book-a',
    '默认插入为引用资源 id（' + JSON.stringify(atts) + '）');
  need(atts[0].kind === 'link', '附件带 kind（契约必填）');
  gui.renderAttachments();
  need($('attach-list').children.length === 1, '附件区渲染出 1 张卡');

  // 5) 复制为独立附件 → 写 url/code，不写 resource
  gui.S.doc.front_matter.attachments = [];
  $('res-copy').checked = true;
  gui.S.picked = RESOURCES[0];
  gui.insertAttachment();
  click($('confirm-all'));
  const atts2 = gui.S.doc.front_matter.attachments || [];
  need(atts2.length === 1 && atts2[0].url === RESOURCES[0].url && atts2[0].code === 'abcd'
    && !atts2[0].resource, '复制独立附件写入 url/提取码且不带 resource');

  // 6) 资源里的 javascript: 链接不进附件（前端只引用 id，url 由后端解析）
  gui.S.doc.front_matter.attachments = [];
  gui.S.picked = { id: 'bad', title: '坏链接', kind: 'tool', url: '', code: 'x' };
  gui.insertAttachment();
  click($('confirm-all'));
  const atts3 = gui.S.doc.front_matter.attachments || [];
  need(JSON.stringify(atts3).indexOf('javascript') < 0, '附件里不出现 javascript: 链接');

  report();
}

main().catch((e) => {
  console.log('  FAIL 未捕获异常：' + (e && e.stack || e));
  fails.push(String(e));
  report();
});
