#!/usr/bin/env node
/* 写作台前端 DOM 冒烟（资源弹层筛选 / 提取码复制 toast / 附件写入 / 站点附件卡 /
 * M3：登录态门禁 / PR 弹层 / 登录页 / 设置页 / safeUrl 白名单）。
 *
 * 跑法：node tests/gui_dom_test.js
 * 用的还是 tests/dom-stub.js（无浏览器、无 npm 依赖）；fetch 用假数据，不联网。
 * 注意：DOM 桩不把 hidden/disabled/checked 属性反射到 property，
 *       所以断言一律用 getAttribute（应用侧 setHidden/setDisabled 双写）。
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
  '/api/status': { branch: 'master', dirty: [
    { path: 'site/content/posts/2026/demo/index.md', status: 'M' },
    { path: 'site/content/topics/x.md', status: 'U' }] },
  '/api/resources': RESOURCES,
  '/api/validate': { ok: true, errors: [] },
  '/api/preview': { ok: true, html: '<p>hi</p>', toc: [], words: 2 },
  '/api/reviewers': ['sal'],
  '/api/pr': { ok: true, branch: 'post/demo-202610191600', commit: 'abc1234',
    pr_url: 'https://gitee.com/rustembed/site/pulls/7', reviewers: ['sal'], via: 'origin' },
  '/api/about': { ok: true, version: '0.1.0', engine_commit: '6809e3a', desktop_feature: false },
  '/api/session': { ok: true, login: 'sal', name: 'Sal', stored: 'memory',
    location: '仅本次会话（钥匙串不可用）' }
};

/* whoami 的假后端：登录/未登录可切换（默认未登录 → 401） */
let WHOAMI_OK = false;
function whoamiResponse() {
  return WHOAMI_OK
    ? { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(
        { ok: true, login: 'sal', name: 'Sal', remembered: false, location: '系统钥匙串' })) }
    : { ok: false, status: 401, text: () => Promise.resolve('{"ok":false,"error":"未登录"}') };
}

function fakeFetch(url, opts) {
  const key = String(url).split('?')[0];
  if (key === '/api/whoami') { return Promise.resolve(whoamiResponse()); }
  const data = CANNED[key];
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data === undefined ? {} : data))
  });
}

/* ---------------- 起桩 ---------------- */
/* 请求记录：M3 断言「点下去真的打了哪个接口」。var 提升，桩在加载时就能安全引用。 */
var CALLS = [];
function recordingFetch(url, opts) {
  CALLS.push({ url: String(url).split('?')[0], method: (opts && opts.method) || 'GET' });
  return fakeFetch(url, opts);
}

/* 每个页面一份独立沙箱；localStorage 用内存实现（桩里没有真的）。 */
function makeSandbox(htmlFile, fetchImpl) {
  const html = fs.readFileSync(path.join(ROOT, 'gui', 'assets', htmlFile), 'utf8');
  const { document, window, location } = createStub(html);
  const store = {};
  const sandbox = {
    window, document, location,
    navigator: {},
    fetch: fetchImpl || fakeFetch,
    console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise, JSON, FileReader: function () {},
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gui', 'assets', 'api.js'), 'utf8'),
    sandbox, { filename: 'gui/assets/api.js' });
  sandbox.api = window.api;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gui', 'assets', 'app.js'), 'utf8'),
    sandbox, { filename: 'gui/assets/app.js' });
  return { document, window, sandbox };
}

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
  fetch: recordingFetch, console,
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
}

/* ---------------- M3：登录态 / PR / 登录页 / 设置页 ---------------- */
async function m3() {
  console.log('— M3 写作台页（登录态门禁 / PR 弹层）—');
  await tick();
  need(!!gui && gui.PAGE === 'app', 'app.js 识别 data-page=app');

  // 未登录：提交 PR 置灰、右键删除/重命名置灰、顶栏显示「登录」
  need($('btn-pr').getAttribute('disabled') !== null, '未登录时「提交 PR」置灰');
  need($('btn-login').getAttribute('hidden') === null, '未登录时顶栏显示「登录」');
  need($('me-chip').getAttribute('hidden') !== null, '未登录时隐藏登录 chip');
  gui.S.ctxItem = { title: 'x', path: 'content/topics/x.md', type: 'topic', id: 'x' };
  gui.showCtx(gui.S.ctxItem, {});
  need($('ctx-delete').getAttribute('disabled') !== null, '未登录时右键「删除」置灰');
  need($('ctx-rename').getAttribute('disabled') !== null, '未登录时右键「重命名」置灰');
  need(($('ctx-delete').title || '').indexOf('登录') >= 0, '置灰项有「登录后可用」提示');
  gui.hideCtx();

  // 未登录点提交 PR → 不弹层，引导去登录页
  click($('btn-pr'));
  need($('pr-modal').getAttribute('hidden') !== null, '未登录点「提交 PR」不弹层');

  // staging：标题行 chip / PR 弹层说明 / PR body 默认值
  const chips = document.querySelectorAll('.chip');
  const chipText = Array.from(chips).map((c) => c.textContent || '').join(' | ');
  need(chipText.indexOf('→ staging') >= 0,
    '标题行 chip 显示「→ staging」（作者 PR 进 staging）：' + chipText);
  need(($('pr-sub').textContent || '').indexOf('staging') >= 0,
    'PR 弹层说明目标 base = staging');

  // 登录后：按钮启用、chip 显示、右键写操作可用
  WHOAMI_OK = true;
  await gui.loadAuth();
  need($('btn-pr').getAttribute('disabled') === null, '登录后「提交 PR」可用');
  need($('me-chip').getAttribute('hidden') === null, '登录后显示 chip');
  need(($('me-name').textContent || '').indexOf('Sal') >= 0, 'chip 显示登录名');
  gui.showCtx(gui.S.ctxItem, {});
  need($('ctx-delete').getAttribute('disabled') === null, '登录后「删除」可用');
  gui.hideCtx();

  // PR 弹层：改动文件多选 / 默认分支 / 审核人默认值 + 增删 + 提交成功展示链接
  gui.openPr();
  await tick();
  need($('pr-modal').hidden === false, '登录后「提交 PR」弹层打开');
  need($('pr-files').children.length === 2,
    '改动文件列出 2 项（实际 ' + $('pr-files').children.length + '）');
  need(($('pr-branch').value || '').indexOf('post/demo-') === 0,
    '默认分支 post/<slug>-<时间>：' + $('pr-branch').value);
  need(($('pr-body').value || '').indexOf('staging') >= 0, 'PR body 默认提到 staging');
  const revChips = $('pr-reviewers').children;
  need(revChips.length === 1 && (revChips[0].textContent || '').indexOf('sal') >= 0,
    '审核人默认带出站点配置的 reviewers');
  $('pr-rev-input').value = 'hy3';
  gui.addReviewer();
  need($('pr-reviewers').children.length === 2, '审核人可增删');
  gui.doPr();
  await tick(); await tick();
  need(CALLS.some((c) => c.url === '/api/pr' && c.method === 'POST'),
    '提交走了 POST /api/pr');
  const prResult = $('pr-result');
  need(prResult.hidden === false, 'PR 结果区显示');
  const prLink = prResult.querySelector('a');
  need(!!prLink && prLink.getAttribute('href') === 'https://gitee.com/rustembed/site/pulls/7',
    '成功时展示 PR 链接');

  // safeUrl 白名单（与 engine/lib/urls.py 同口径）
  console.log('— M3 safeUrl 协议白名单 —');
  need(gui.safeUrl('https://gitee.com/a/b') === 'https://gitee.com/a/b', '放行 https');
  need(gui.safeUrl('javascript:alert(1)') === '', '拒绝 javascript:');
  need(gui.safeUrl('JaVaScRiPt:alert(1)') === '', '拒绝大小写混淆的 javascript:');
  need(gui.safeUrl('data:text/html,x') === '', '拒绝 data:');
  need(gui.safeUrl('vbscript:x') === '', '拒绝 vbscript:');
  need(gui.safeUrl('file:///etc/passwd') === '', '拒绝 file:');
  need(gui.safeUrl('//evil.com/x') === '', '拒绝协议相对 //host');
  need(gui.safeUrl('#anchor') === '#anchor', '放行页内锚点');
  need(gui.safeUrl('assets/a.png') === 'assets/a.png', '放行相对路径');

  // ---- 登录页 ----
  console.log('— M3 登录页（login.html）—');
  WHOAMI_OK = false;
  const login = makeSandbox('login.html', recordingFetch);
  await tick();
  need(!!login.window.__gui && login.window.__gui.PAGE === 'login',
    'app.js 识别 data-page=login');
  const $l = (id) => login.document.getElementById(id);
  $l('login-token').value = '  ';
  click($l('login-go'));
  need(($l('login-error').textContent || '').indexOf('令牌') >= 0, '空令牌给错误');
  $l('login-token').value = 'fake-token';
  click($l('login-go'));
  await tick(); await tick();
  need(CALLS.some((c) => c.url === '/api/session' && c.method === 'POST'),
    '登录走 POST /api/session');

  // 令牌无效（401）→ 字段下方红字、按钮恢复
  const login2 = makeSandbox('login.html', (u, o) => {
    if (String(u).indexOf('/api/session') === 0) {
      return Promise.resolve({ ok: false, status: 401,
        text: () => Promise.resolve('{"ok":false,"error":"x"}') });
    }
    return fakeFetch(u, o);
  });
  await tick();
  const $l2 = (id) => login2.document.getElementById(id);
  $l2('login-token').value = 'bad';
  click($l2('login-go'));
  await tick(); await tick();
  need(($l2('login-error').textContent || '').indexOf('令牌无效') >= 0,
    '401 时提示「令牌无效或权限不足」');
  need($l2('login-go').getAttribute('disabled') === null, '失败后按钮恢复可点');

  // ---- 设置页 ----
  console.log('— M3 设置页（settings.html）—');
  const set = makeSandbox('settings.html', recordingFetch);
  await tick();
  need(!!set.window.__gui && set.window.__gui.PAGE === 'settings',
    'app.js 识别 data-page=settings');
  const $s = (id) => set.document.getElementById(id);
  need(($s('set-auth').textContent || '').indexOf('未登录') >= 0, '账户区显示未登录');
  need(($s('set-version').textContent || '').indexOf('0.1.0') >= 0, '关于区显示版本');
  need(($s('set-version').textContent || '').indexOf('6809e3a') >= 0, '关于区显示引擎 commit');

  // 主题分段开关：即时生效
  const themeBtns = $s('set-theme').getElementsByTagName('button');
  click(themeBtns[2]);
  await tick();
  need(set.document.body.classList.contains('dark'), '主题切暗色即时生效（body.dark）');
  need(themeBtns[2].classList.contains('on'), '分段按钮高亮跟随');
  // 顶部动作文字开关：即时生效
  const labels = $s('set-labels');
  labels.checked = true;
  labels.onchange();
  need(set.document.body.classList.contains('labels-off') === false, '顶部文字开关即时生效');

  // 清除痕迹：弹层 + 默认全勾 + 没勾不调用 + 逐项结果
  click($s('set-purge'));
  need($s('purge-modal').hidden === false, '清除痕迹弹层打开');
  need($s('pu-keyring').checked && $s('pu-memory').checked && $s('pu-cache').checked,
    '清除项默认全勾');
  $s('pu-keyring').checked = false;
  $s('pu-memory').checked = false;
  $s('pu-cache').checked = false;
  click($s('purge-go'));
  await tick();
  need(!CALLS.some((c) => c.url === '/api/purge'), '没勾选时不调用 purge');

  const purgeData = {
    ok: true,
    items: [
      { item: '钥匙串令牌', ok: true, detail: '已清除（系统钥匙串）' },
      { item: '登录态（内存）', ok: true, detail: '已退出登录' },
      { item: '最近文件', ok: true, detail: '已删除 3 条记录' },
      { item: '预览与构建缓存', ok: true, detail: '无缓存目录' },
      { item: '日志', ok: true, detail: '日志只进终端、不落盘' }],
    note: 'git 自身保存的凭证不在本 App 管辖范围。'
  };
  const set2 = makeSandbox('settings.html', (u, o) => {
    CALLS.push({ url: String(u).split('?')[0], method: (o && o.method) || 'GET' });
    if (String(u).indexOf('/api/purge') === 0) {
      return Promise.resolve({ ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify(purgeData)) });
    }
    return fakeFetch(u, o);
  });
  await tick();
  const $s2 = (id) => set2.document.getElementById(id);
  click($s2('purge-go'));
  await tick(); await tick();
  const purgeRows = $s2('purge-result').children;
  need(purgeRows.length === 6, 'purge 结果逐项列出（5 项 + 备注，实际 ' + purgeRows.length + '）');
  need(($s2('purge-result').textContent || '').indexOf('git 自身保存的凭证') >= 0,
    'purge 结果注明 git 凭证不在管辖范围');
  need(CALLS.filter((c) => c.url === '/api/purge').length === 1, '勾选后调用了一次 purge');
}

main()
  .then(m3)
  .catch((e) => {
    console.log('  FAIL 未捕获异常：' + (e && e.stack || e));
    fails.push(String(e));
  })
  .then(report);
