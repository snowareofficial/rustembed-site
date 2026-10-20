'use strict';
/* 阅读控制回归：node tests/reading_controls_test.js
 *
 * 覆盖四项阅读体验改动，全部用「DOM 桩 + 假 manifest」驱动 site/theme/app.js：
 *   [1] 成员头像与联系链接（两个 Gitee 都得露出来）
 *   [2] 最近更新条数：默认 3、上限 15、持久化、按 date 倒序、超出显示全部
 *   [3] 首页一言：只在首页、8 秒自动消失、任意点击 / Esc 关闭、空数据隐藏
 *   [4] 长代码块折叠：阈值取 site.code_collapse_lines、展开/收起、复制取全文
 *   [5] 语法高亮：本地 vendor 的 Prism（MIT），语言齐全，产物里没有外部 CDN
 *
 * 与另外三个 Node 脚本同样零依赖；真实尺寸 / 真实 CSS 交给 tests/browser-check.js。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStub } = require('./dom-stub.js');

const ROOT = path.resolve(__dirname, '..');
const THEME = path.join(ROOT, 'site', 'theme');
const DIST = path.join(ROOT, 'dist');

const fails = [];
let checks = 0;
function need(cond, msg) {
  checks++;
  if (!cond) fails.push(msg);
  return !!cond;
}
function eq(got, want, msg) {
  return need(got === want, msg + '（得到 ' + JSON.stringify(got) + '，要 ' + JSON.stringify(want) + '）');
}
function has(text, part, msg) { return need(String(text).indexOf(part) >= 0, msg + '（缺 ' + part + '）'); }
function no(text, part, msg) { return need(String(text).indexOf(part) < 0, msg + '（不该出现 ' + part + '）'); }
function kids(node) { let n = 0; if (node) { for (let i = 0; node.childNodes[i] !== undefined; i++) n++; } return n; }
function readMaybe(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

/* ---------- 测试数据 ---------- */

const FULL_CODE = 'fn main() {\n'
  + Array.from({ length: 24 }, (_, i) => '    let x' + i + ' = ' + i + ';').join('\n') + '\n}';   // 26 行
const SHORT_CODE = 'fn main() {\n    println!("hi");\n}';                                        // 3 行

function codeHtml(code, lang) {
  lang = lang || 'rust';
  return '<div class="code">\n<div class="code-head"><span>' + lang + '</span>'
    + '<button class="copy" type="button" aria-label="复制代码">复制</button></div>\n'
    + '<pre><code class="language-' + lang + '">' + code + '</code></pre>\n</div>\n';
}

function post(slug, a, b, c, d, e) {
  /* 这个夹具历史上混用过两种参数顺序：
   *   post(slug, date, title, tags, series)
   *   post(slug, title, date, tags, series, extra)
   * 用日期形状自动判别，避免测试数据本身写错日期。 */
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const date = isDate(a) ? a : b;
  const title = isDate(a) ? b : a;
  let tags = isDate(a) ? c : c;
  let series = isDate(a) ? d : d;
  let extra = isDate(a) ? e : e;
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    extra = series;
    series = '';
  }
  return Object.assign({
    slug: slug, title: title || slug, date: date, tags: Array.isArray(tags) ? tags : ['rust'],
    words: 120, author: 'sal', summary: '摘要', license: 'CC BY-NC-SA 4.0', toc: [],
    html: 'p/' + slug + '.html', map: 'p/' + slug + '.map.svg',
    series: typeof series === 'string' ? series : '', attachments: []
  }, extra || {});
}

function manifest(over) {
  const m = {
    site: {
      title: '测试站', tagline: '一句话', url: 'https://example.org',
      domains: ['example.org'], repo_url: 'https://example.org/repo',
      license: 'CC BY-NC-SA 4.0', nav: ['library', 'members'], avatar: '',
      code_collapse_lines: 20,
      group: { name: '测试群', join_url: 'https://example.org/join' }
    },
    posts: [
      post('old', '2026-01-01', '一月'),
      post('new', '2026-09-09', '九月'),
      post('mid', '2026-05-05', '五月'),
      post('older', '2025-12-31', '去年底'),
      post('latest', '2026-10-10', '十月')
    ],
    quotes: [{ member: 'cxi', name: 'CXi', text: '大道所至之处天下安。', source: '《群语录》' }],
    members: [{
      id: 'sal', name: 'Sal', role: '管理员', signature: '写格式、写工具', skills: ['rust'],
      avatar: 'assets/members/sal.jpg',
      links: {
        blog: 'https://sml.swebase.cn',
        github: 'https://github.com/example',
        gitee: 'https://gitee.com/Ironbayberry',
        gitee_org: 'https://gitee.com/snoware/',
        email: 'sal@mail.swebase.cn'
      },
      file: 'site/content/members/sal.sml'
    }],
    projects: [], services: [], resources: [], weekly: [], topics: [], pages: [], series: [], tags: [],
    built_at: '2026-10-20T00:00:00+00:00'
  };
  Object.keys(over || {}).forEach((k) => { m[k] = over[k]; });
  return m;
}

/* 大列表数据：一条 20 章的系列（全部同一天）+ 若干单篇，用来验「系列只占一条」 */
const BIG_DAY = '2026-10-20';

function bigManifest(over) {
  const posts = [];
  for (let i = 1; i <= 20; i++) {
    posts.push(post('cxi-' + i, BIG_DAY, 'CXi 第 ' + i + ' 章：' + (i % 2 ? '所有权' : '生命周期'),
      ['rust', 'cxi'], 'cxi-series'));
  }
  /* 10 篇单篇，集中在另一天：那天条目数 = 10 > 6，会出搜索框 / 滑块 / 滚动区 */
  for (let i = 1; i <= 10; i++) {
    posts.push(post('solo-' + i, '2026-10-15', '单篇 ' + i + '：' + (i % 2 ? '调试笔记' : '点亮 LED'),
      ['embedded']));
  }
  const series = [{
    id: 'cxi-series', title: 'CXi 的 Rust 学习笔记',
    posts: posts.filter((p) => p.series === 'cxi-series')
      .map((p, i) => ({ slug: p.slug, title: p.title, order: i + 1 }))
  }];
  const m = manifest({ posts: posts, series: series });
  return Object.assign(m, over || {});
}

/* ---------- 沙箱：可控定时器 + localStorage + 可选 Prism / matchMedia ----------

   定时器是可控的（记下来不自动跑）：「8 秒后消失」这类行为要能确定地驱动，
   不能靠真等 8 秒，也不能因为桩把 setTimeout 当空操作就假装测过了。 */
function makeApp(man, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(THEME, 'index.html'), 'utf8');
  const { document, window, location } = createStub(html);
  const store = {};
  const timers = [];
  const requested = [];
  const bodies = opts.bodies || {};        // 假预渲染片段：'p/slug.html' → HTML
  const sandbox = {
    window, document, location, console, navigator: {},
    IntersectionObserver: undefined,
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms, id: timers.length + 1 }); return timers.length; },
    clearTimeout: () => { },
    fetch: (u) => {
      const key = String(u).split('?')[0];
      requested.push(key);
      const mk = (txt) => Promise.resolve({
        ok: true, json: () => Promise.resolve(JSON.parse(txt)), text: () => Promise.resolve(txt)
      });
      if (key === 'manifest.json') return mk(JSON.stringify(man));
      if (bodies[key] !== undefined) return mk(bodies[key]);
      if (/\.html$/.test(key)) return mk('<p>桩片段</p>');
      return Promise.resolve({
        ok: false, json: () => Promise.reject(new Error('404 ' + u)),
        text: () => Promise.reject(new Error('404 ' + u))
      });
    }
  };
  if (opts.localStorage !== false) {
    sandbox.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
  }
  if (opts.matchMedia) sandbox.matchMedia = opts.matchMedia;
  if (opts.prism) window.Prism = opts.prism;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(THEME, 'app.js'), 'utf8'), sandbox, { filename: 'site/theme/app.js' });
  return { rec: window.__rec, document, window, location, store, timers, requested };
}

function fireTimers(app, ms) {
  const hit = app.timers.filter((t) => ms === undefined ? true : t.ms === ms);
  hit.forEach((t) => t.fn());
  return hit.length;
}
async function main() {
  console.log('== [1] 成员：头像与两个 Gitee 链接 ==');
  {
    const app = makeApp(manifest());
    await app.rec.started;
    const frag = await app.rec.VIEWS.member({ seg: [null, 'sal'] });
    const box = app.document.createElement('div');
    box.appendChild(frag);
    const dts = box.querySelectorAll('dt').map((n) => n.textContent);
    const dds = box.querySelectorAll('dd').map((n) => n.textContent);
    eq(dds.length, 5, '5 个链接一个都不能少（未知 / 同键都不许吞）');
    has(dts.join('|'), 'Gitee', '链接表里要有「Gitee」（个人空间）');
    has(dts.join('|'), 'Gitee 空间', '链接表里要有「Gitee 空间」（第二个号）');
    has(dds.join('|'), 'https://gitee.com/Ironbayberry', '个人 Gitee 链接要显示');
    has(dds.join('|'), 'https://gitee.com/snoware/', '组织 Gitee 链接要显示');
    no(dts.join('|'), 'undefined', '没有标签掉成 undefined');
    const img = box.querySelector('img');
    need(!!img, '成员页要有头像 img');
    if (img) eq(img.getAttribute('src'), 'assets/members/sal.jpg', '头像取 manifest 的本地路径');
    console.log('  头像 + 联系方式 %d 条：%s', dds.length, dts.join(' / '));
  }
  {
    /* 真产物上的断言：三个成员的头像都在 dist 里，sal 的两个 Gitee 都进了 manifest */
    const raw = readMaybe(path.join(DIST, 'manifest.json'));
    need(!!raw, 'dist/manifest.json 不存在（先跑 python engine/build.py）');
    if (raw) {
      const m = JSON.parse(raw);
      const mems = m.members || [];
      for (const id of ['sal', 'cxi', 'cshonor']) {
        const mem = mems.find((x) => x.id === id);
        need(!!mem, 'manifest 缺少成员 ' + id);
        if (mem) {
          need(!!mem.avatar, '成员 ' + id + ' 的 avatar 为空（头像丢回占位）');
          need(!!mem.avatar && fs.existsSync(path.join(DIST, mem.avatar)),
            '成员 ' + id + ' 的头像文件不在产物里：' + mem.avatar);
        }
      }
      const sal = mems.find((x) => x.id === 'sal');
      if (sal) {
        const keys = Object.keys(sal.links || {});
        need(keys.indexOf('gitee') >= 0 && keys.indexOf('gitee_org') >= 0,
          'sal 的 links 里两个 Gitee 键都在（对象键不能互相覆盖）：' + keys.join(','));
        need(sal.links.gitee !== sal.links.gitee_org, '两个 Gitee 的值不能相同');
      }
      eq(m.site.code_collapse_lines, 20, 'manifest.site.code_collapse_lines 默认 20');
      need(Array.isArray(m.quotes), 'manifest.quotes 必须是数组（空数组 = 不显示按钮）');
      console.log('  产物：成员头像 3/3 在位，sal 两个 Gitee 键不同值');
    }
  }
  console.log('== [2] 最近更新：条数可调 1–15 ==');
  async function home(over) {
    const app = makeApp(manifest(over));
    await app.rec.started;
    app.location.hash = '#/';
    await app.rec.render();
    return app;
  }
  {
    const app = await home();
    const list = app.document.querySelector('#recent-list');
    need(!!list, '首页要有 #recent-list');
    eq(kids(list), 3, '默认显示 3 条');
    eq(list.childNodes.map((li) => li.textContent.slice(0, 10)).join(','),
      '2026-10-10,2026-09-09,2026-05-05', '三条按 date 倒序（不是 manifest 顺序）');
    console.log('  默认 3 条，倒序：%s', list.childNodes.map((li) => li.textContent.slice(0, 10)).join(' > '));
  }
  {
    const app = await home();
    eq(app.rec.recent.max, 15, '上限 15');
    eq(app.rec.recent.min, 1, '下限 1');
    eq(app.rec.recent.key, 'rec-blog:recent-limit', 'localStorage 键名');
    eq(app.rec.recent.clamp(99), 15, '超过 15 一律压到 15');
    eq(app.rec.recent.clamp(0), 1, '低于 1 一律抬到 1');
    eq(app.rec.recent.clamp('x'), 3, '非法值退回默认 3');
    app.rec.recent.write(7);
    eq(app.store['rec-blog:recent-limit'], '7', '写入 localStorage');
    eq(app.rec.recent.read(), 7, '再读仍是 7');
    const list = app.document.querySelector('#recent-list');
    const range = app.document.querySelector('#recent-range');
    range.value = '5';
    range.dispatch('input');
    eq(app.rec.recent.read(), 5, '滑条改动即持久化');
    eq(kids(list), 5, '滑条改动后立即重绘（不刷新整页）');
    console.log('  1–15 夹紧 + 持久化 + 即时重绘都成立');
  }
  {
    /* 条数多于文章数：显示全部，不编造占位 */
    const app = await home();
    const list = app.document.querySelector('#recent-list');
    const range = app.document.querySelector('#recent-range');
    range.value = '15';
    range.dispatch('input');
    eq(kids(list), 5, '只要 5 篇文章，要 15 条也只显示 5 条');
    console.log('  条数超过实际文章数 → 显示全部（5 篇）');
  }
  {
    /* 无障碍：label 关联、滑条范围与 aria、按钮展开态 */
    const app = await home();
    const lab = app.document.querySelector('label');
    eq(lab && lab.getAttribute('for'), 'recent-range', 'label 关联到滑条');
    const range = app.document.querySelector('#recent-range');
    eq(range.getAttribute('type'), 'range', '面板里要有 range 控件');
    eq(range.getAttribute('min'), '1', 'range 最小值 1');
    eq(range.getAttribute('max'), '15', 'range 最大值 15');
    need(!!range.getAttribute('aria-label'), 'range 要有 aria-label');
    const btn = app.document.querySelector('#recent-btn');
    eq(btn.getAttribute('aria-expanded'), 'false', '按钮初始为收起态');
    need(!!btn.querySelector('svg'), '按钮图标是 SVG');
    eq(btn.querySelectorAll('line').length, 3, 'SVG 里三条滑杆');
    const panel = app.document.querySelector('#recent-panel');
    need(panel.hasAttribute('hidden'), '面板默认收起');
    btn.dispatch('click', { target: btn, stopPropagation: () => {} });
    need(!panel.hasAttribute('hidden'), '点按钮展开面板');
    eq(btn.getAttribute('aria-expanded'), 'true', '展开后 aria-expanded=true');
    app.document.dispatch('keydown', { key: 'Escape' });
    need(panel.hasAttribute('hidden'), 'Esc 关闭面板');
    console.log('  面板：range + label + aria-expanded + Esc 关闭');
  }
  console.log('== [3] 首页「一言」 ==');
  /* 桩的 querySelector 会按选择器缓存结果，节点被移除后还能拿到旧的；
     判断「页面上有 / 没有」必须自己扫 body 的子节点。 */
  function bodyHasNode(doc, id) {
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          if (c.getAttribute('id') === id) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(doc.body);
  }
  {
    const app = await home();
    need(!!bodyHasNode(app.document, 'quote-btn'), '首页要有「一言」按钮');
    const veil = bodyHasNode(app.document, 'quote-veil');
    need(!!veil, '首页要有浮层节点（默认隐藏）');
    need(veil.hasAttribute('hidden'), '浮层默认不显示');
    app.rec.quotes.open();
    need(!veil.hasAttribute('hidden'), '点按钮后出现浮层');
    has(app.document.body.textContent, '大道所至之处天下安。', '浮层里是 manifest 里的句子');
    eq(app.timers.filter((t) => t.ms === 8000).length, 1, '出现时挂了唯一的 8 秒定时器');
    fireTimers(app, 8000);
    need(veil.hasAttribute('hidden'), '8 秒后自动消失');
    console.log('  首页有按钮 → 出现一句 → 8 秒自动收');
  }
  {
    const app = await home();
    const veil = bodyHasNode(app.document, 'quote-veil');
    app.rec.quotes.open();
    need(!veil.hasAttribute('hidden'), '浮层已出现');
    app.document.dispatch('click', { target: app.document.body });
    need(veil.hasAttribute('hidden'), '点页面任何位置立刻消失');
    app.rec.quotes.open();
    need(!veil.hasAttribute('hidden'), '可以再次打开');
    app.document.dispatch('keydown', { key: 'Escape' });
    need(veil.hasAttribute('hidden'), 'Esc 也能关');
    console.log('  任意点击 / Esc 关闭');
  }
  {
    const app = await home();
    app.location.hash = '#/library';
    await app.rec.render();
    need(!bodyHasNode(app.document, 'quote-btn'), '离开首页后按钮要拆掉');
    need(!bodyHasNode(app.document, 'quote-veil'), '离开首页后浮层要拆掉');
    console.log('  路由切换：按钮与浮层一起移除');
  }
  {
    const app = await home({ quotes: [] });
    need(!bodyHasNode(app.document, 'quote-btn'), '没有句子时不显示按钮（不编造，不给空弹层）');
    console.log('  无句子 → 按钮不出现');
  }
  {
    const app = makeApp(manifest(), { matchMedia: () => ({ matches: true }) });
    await app.rec.started;
    app.location.hash = '#/';
    await app.rec.render();
    need(!app.document.body.classList.contains('quote-anim'), 'prefers-reduced-motion 下不加动画类');
    console.log('  prefers-reduced-motion：不做动画');
  }
  console.log('== [4] 长代码块折叠 ==');
  const codeMan = manifest({ posts: [post('long', '2026-08-08', '长代码'), post('short', '2026-07-07', '短代码')] });
  const codeBodies = { 'p/long.html': codeHtml(FULL_CODE), 'p/short.html': codeHtml(SHORT_CODE) };
  async function renderPost(app, slug) {
    app.location.hash = '#/post/' + slug;
    await app.rec.render();
    return app.document.getElementById('view');
  }
  {
    const app = makeApp(codeMan, { bodies: codeBodies });
    await app.rec.started;
    eq(app.rec.code.threshold(), 20, '阈值取 manifest.site.code_collapse_lines');
    eq(app.rec.code.countLines(FULL_CODE), 26, '长代码块 26 行');
    const view = await renderPost(app, 'long');
    const box = view.querySelectorAll('.code')[0];
    need(!!box, '文章里有代码块');
    has(box.className, 'code-long', '超过阈值 → 标记 code-long');
    has(box.className, 'is-collapsed', '默认折叠');
    const more = box.querySelector('.code-more');
    need(!!more, 'code-head 里要有「展开全部」按钮');
    eq(more.textContent, '展开全部（26 行）', '按钮写明行数');
    eq(more.getAttribute('aria-expanded'), 'false', '折叠态 aria-expanded=false');
    const pre = box.querySelector('pre');
    need(!!pre.getAttribute('id'), 'pre 有 id（aria-controls 才有指向）');
    eq(more.getAttribute('aria-controls'), pre.getAttribute('id'), '按钮 aria-controls 指向 pre');
    eq(box.querySelector('code').textContent, FULL_CODE, '折叠后 textContent 仍是完整代码（复制取全文）');
    more.dispatch('click', { target: more });
    no(box.className, 'is-collapsed', '点开后不再折叠');
    eq(more.getAttribute('aria-expanded'), 'true', '展开态 aria-expanded=true');
    eq(more.textContent, '收起', '展开后按钮变「收起」');
    more.dispatch('click', { target: more });
    has(box.className, 'is-collapsed', '再点一次收回去');
    console.log('  26 行 → 折叠 + 「展开全部（26 行）」+ 展开/收起 + 复制全文');
  }
  {
    const app = makeApp(codeMan, { bodies: codeBodies });
    await app.rec.started;
    const view = await renderPost(app, 'short');
    const box = view.querySelectorAll('.code')[0];
    no(box.className, 'code-long', '3 行代码不折叠');
    need(!box.querySelector('.code-more'), '短代码不给展开按钮');
    console.log('  3 行 → 什么都不加');
  }
  {
    const man = manifest({ posts: [post('long', '2026-08-08', '长代码')] });
    man.site.code_collapse_lines = 5;
    const app = makeApp(man, { bodies: { 'p/long.html': codeHtml(FULL_CODE) } });
    await app.rec.started;
    eq(app.rec.code.threshold(), 5, '阈值随 site.sml 改');
    const view = await renderPost(app, 'long');
    has(view.querySelectorAll('.code')[0].className, 'is-collapsed', '阈值下调后同一段代码也折叠');
    console.log('  阈值改 5 → 折叠判定跟着变');
  }
  console.log('== [5] 语法高亮：本地 Prism，无 CDN ==');
  {
    const jsPath = path.join(THEME, 'vendor', 'prism', 'prism.js');
    const cssPath = path.join(THEME, 'vendor', 'prism', 'prism.css');
    const licPath = path.join(THEME, 'vendor', 'prism', 'LICENSE');
    need(fs.existsSync(jsPath), '缺少 site/theme/vendor/prism/prism.js');
    need(fs.existsSync(cssPath), '缺少 site/theme/vendor/prism/prism.css');
    need(fs.existsSync(licPath), '缺少 site/theme/vendor/prism/LICENSE（MIT 必须随副本发布）');
    has(readMaybe(licPath) || '', 'MIT', 'LICENSE 里要有 MIT 原文');

    /* 真跑一遍 bundle：语言齐全 + rust / sml 都能出 token */
    const { document, window } = createStub('<html><body></body></html>');
    const sb = { window, document, self: window, navigator: {}, console, setTimeout, clearTimeout };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(readMaybe(jsPath) || '', sb, { filename: 'prism.js' });
    const P = sb.Prism;
    need(!!P, 'Prism 没导出全局');
    const want = ['rust', 'c', 'cpp', 'bash', 'python', 'json', 'toml', 'markdown', 'sml'];
    const missing = want.filter((k) => !P.languages[k]);
    eq(missing.join(','), '', '九种语言组件齐全（缺：' + missing.join(',') + '）');
    has(P.highlight('fn main() { let x = 1; }', P.languages.rust, 'rust'), 'token', 'rust 能出 token');
    has(P.highlight('# c\n@contract BlogPost loose {\n  title: str\n}', P.languages.sml, 'sml'),
      'token', 'sml 也能出 token（本站自写语法）');

    /* 成功失败都要可控：假 Prism 接到的是 #view 容器 */
    const fake = { calls: [], highlightAllUnder: function (c) { fake.calls.push(c); } };
    const app = makeApp(codeMan, { bodies: codeBodies, prism: fake });
    await app.rec.started;
    fake.calls.length = 0;                    /* 启动时的首屏渲染也算一次，这里只数「换页」 */
    await renderPost(app, 'long');
    eq(fake.calls.length, 1, '每次渲染都高亮一次');
    eq(fake.calls[0].getAttribute('id'), 'view', '只高亮 #view 容器内部');
    const bare = makeApp(codeMan, { bodies: codeBodies });
    await bare.rec.started;
    await renderPost(bare, 'long');
    eq(bare.rec.code.highlight(bare.document.getElementById('view')), false,
      'Prism 没加载时退回纯文本（不抛、不影响正文）');
    const boom = { highlightAllUnder: function () { throw new Error('boom'); } };
    const badApp = makeApp(codeMan, { bodies: codeBodies, prism: boom });
    await badApp.rec.started;
    await renderPost(badApp, 'long');
    eq(badApp.rec.code.highlight(badApp.document.getElementById('view')), false,
      'Prism 抛异常也只是不高亮');
    console.log('  9 种语言在位；失败/异常都退回纯文本');
  }
  {
    /* 产物：只有本地 vendor 路径，没有 CDN —— 运行时零外部请求是硬约束 */
    const idx = readMaybe(path.join(DIST, 'index.html'));
    need(!!idx, 'dist/index.html 不存在（先跑 python engine/build.py）');
    if (idx) {
      has(idx, 'vendor/prism/prism.css', '产物引用本地 prism.css');
      has(idx, 'vendor/prism/prism.js', '产物引用本地 prism.js');
      has(idx, 'Prism.manual = true', '加载前先设 manual，避免 core 自己全页扫描');
      need(fs.existsSync(path.join(DIST, 'vendor', 'prism', 'prism.js')), '产物里有 prism.js');
      need(fs.existsSync(path.join(DIST, 'vendor', 'prism', 'prism.css')), '产物里有 prism.css');
      need(fs.existsSync(path.join(DIST, 'vendor', 'prism', 'LICENSE')), '产物里带了 LICENSE');
      /* 外链约束只针对我们自己写的产物：vendor/prism.js 头注释里出现 unpkg 是
         记录下载来源（溯源），不是加载 —— 那不会发请求。 */
      const cdn = /(cdn\.jsdelivr|unpkg\.com|cdnjs\.|ajax\.googleapis)/i;
      for (const f of ['index.html', 'app.js', 'style.css']) {
        const t = readMaybe(path.join(DIST, f));
        if (t === null) continue;
        need(!cdn.test(t), f + ' 里出现了 CDN 链接（运行时禁止外部请求）');
      }
      const refs = idx.match(/(?:src|href)="(?:https?:)?\/\/[^"]+"/g) || [];
      eq(refs.length, 0, 'index.html 没有任何跨站资源引用（' + refs.join(',') + '）');
      console.log('  产物无外部请求：全部本地 vendor');
    }
  }
  console.log('== [6] 最近更新：系列收拢 / 搜索 / 滚动区 ==');
  async function bigHome(over) {
    const app = makeApp(bigManifest(over));
    await app.rec.started;
    app.location.hash = '#/';
    await app.rec.render();
    return app;
  }
  async function goDate(app, day) {
    app.location.hash = '#/date/' + day;
    await app.rec.render();
    return app.document.getElementById('view');
  }
  {
    const app = await bigHome();
    const list = app.document.querySelector('#recent-list');
    eq(kids(list), 3, '默认 3 条（条数指条目数，不是章节数）');
    const rows = list.childNodes;
    has(rows[0].textContent, 'CXi 的 Rust 学习笔记', '最新一条是系列本身，不是某一章');
    has(rows[0].textContent, '系列 · 20 章', '系列行有「系列 · N 章」徽章');
    eq(list.querySelectorAll('.row-series-flat').length, 1, '首页三条里系列只占一条');
    need(!list.querySelector('.series-posts'), '首页不铺开章节（保持紧凑）');
    const link = rows[0].querySelector('a');
    eq(link && link.getAttribute('href'), '#/series/cxi-series', '首页紧凑系列行点进去是系列目录页');

    const seriesView = await app.rec.viewSeries('cxi-series');
    const sr = seriesView.querySelectorAll('.rows li.row');
    eq(sr.length, 20, '系列目录页列出全部 20 章');
    eq(sr.map((n) => n.querySelector('.row-title').textContent)[0], 'CXi 第 1 章：所有权',
      '目录按 order 排序：第一章在最前');
    eq(sr.map((n) => n.querySelector('.row-title').textContent)[19], 'CXi 第 20 章：生命周期',
      '最后一章排最后');
    eq(sr[0].querySelector('a.row-title').getAttribute('href'), '#/post/cxi-1',
      '目录里的章节仍回 #/post/<slug>');
    has(seriesView.textContent, '共 20 章 · 系列', '系列页写明「共 N 章 · 系列」');
    has(seriesView.textContent, '目录', '系列页有「目录」段');
    const chip = seriesView.querySelector('.chips a.chip');
    eq(chip && chip.getAttribute('href'), '#/post/cxi-1', '「从第一章开始阅读」指向第一章');
    const crumbBack = seriesView.querySelector('.crumb a');
    eq(crumbBack && crumbBack.getAttribute('href'), '#/library', '面包屑能回文章库');

    const none = await app.rec.viewSeries('一定没有这个系列');
    has(none.textContent, '没有这个系列', '无效系列 id 显示空态（不抛、不崩）');
    eq(none.querySelectorAll('.rows li.row').length, 0, '空态不编造章节');
    const all = app.rec.recent.list(15);
    eq(all.length, 11, '全站 30 篇 → 11 条条目（1 系列 + 10 单篇）');
    eq(all.filter((e) => e.kind === 'series').length, 1, '20 章只算 1 条');
    console.log('  20 章 → 1 条；默认 3 条；点进去是系列目录页（20 章按 order 列出）');
  }
  {
    /* 条目数 11 > 6：搜索框与滚动区都该出现 */
    const app = await bigHome();
    const list = app.document.querySelector('#recent-list');
    need(!!(list.parentNode && list.parentNode.classList.contains('rows-scroll')),
      '条目数 > 6 时列表套 .rows-scroll');
    const css = readMaybe(path.join(THEME, 'style.css')) || '';
    has(css, '.rows-scroll', '滚动区样式在 style.css 里');
    has(css, 'max-height', '滚动区有最大高度（不会无限拉长）');
    const input = app.document.querySelector('#view input.filter-input');
    need(!!input, '条目数 > 6 时出现搜索框');
    need(!!input.getAttribute('aria-label'), '搜索框有 aria-label');
    input.value = '所有权';
    input.dispatch('input');
    eq(kids(list), 1, '按章节标题搜 → 命中那条系列（章节内容也算搜索范围）');
    input.value = 'embedded';
    input.dispatch('input');
    eq(kids(list), 10, '按标签搜 → 10 篇单篇（搜索时不砍条数）');
    input.value = 'zzz-一定不存在';
    input.dispatch('input');
    need(!!list.querySelector('p.muted'), '没有结果时给空态');
    input.value = '';
    input.dispatch('input');
    eq(kids(list), 3, '清空查询恢复全部（回到条数上限）');
    console.log('  搜索：章节标题 / 标签 / 空态 / 清空恢复');
  }
  {
    const app = await home();
    const list = app.document.querySelector('#recent-list');
    need(!(list.parentNode && list.parentNode.classList.contains('rows-scroll')),
      '条目 ≤ 6 时不加滚动区（别给短列表添乱）');
    need(!app.document.querySelector('#view input.filter-input'), '条目 ≤ 6 时不加搜索框');
    console.log('  条目 ≤ 6：不加搜索框与滚动区');
  }
  console.log('== [7] 排序：不依赖 manifest 原始顺序 ==');
  {
    const app = makeApp(bigManifest());
    await app.rec.started;
    const man = bigManifest();
    const keys = (posts) => app.rec.entries
      .collect(posts, { series: man.series }).map(app.rec.entries.key).join(',');
    eq(keys(man.posts), keys(man.posts.slice().reverse()),
      '输入顺序倒过来，条目顺序不变（排序不靠 manifest 顺序）');

    const tie = manifest({ posts: [
      post('p-c', 'C 篇', '2026-10-20', []),
      post('p-a', 'A 篇', '2026-10-20', []),
      post('p-b', 'B 篇', '2026-10-20', [])
    ] });
    const app2 = makeApp(tie);
    await app2.rec.started;
    eq(app2.rec.entries.collect(tie.posts).map(app2.rec.entries.title).join(','),
      'A 篇,B 篇,C 篇', '同一天并列时按标题稳定排序');

    const tieUpdated = manifest({ posts: [
      post('u1', '同名', '2026-10-20', [], null, { updated: '2026-10-01' }),
      post('u2', '同名', '2026-10-20', [], null, { updated: '2026-10-25' })
    ] });
    const app3 = makeApp(tieUpdated);
    await app3.rec.started;
    eq(app3.rec.entries.collect(tieUpdated.posts).map(app3.rec.entries.key).join(','),
      'p:u2,p:u1', '同标题时按 updated 倒序');
    console.log('  同级判据：updated → 标题 → slug，结果确定');
  }

  console.log('== [8] 日期页：先按日期过滤，再收拢系列 ==');
  {
    const app = makeApp(bigManifest());
    await app.rec.started;
    const view = await goDate(app, BIG_DAY);
    has(view.querySelector('.lede').textContent, '这一天发了 20 篇', '页头说明当天篇数');
    has(view.querySelector('.lede').textContent, '归为 1 项', '页头说明归为几项');
    has(view.querySelector('.lede').textContent, '1 个系列 + 0 篇单篇', '页头把系列与单篇分开说');
    const list = app.document.querySelector('#date-list');
    eq(kids(list), 1, '同一天 20 章只占 1 条');
    const row = list.childNodes[0];
    has(row.textContent, '系列 · 20 章（本日 20 章）', '系列行写明本日章数');
    eq(row.querySelectorAll('.series-posts li.row').length, 20, '展开后 20 章都在（详情没被破坏）');
    const dTitle = row.querySelector('.series-sum a.row-title');
    eq(dTitle && dTitle.getAttribute('href'), '#/series/cxi-series', '日期页系列标题指向系列目录页');
    const dBadge = row.querySelector('.series-sum a.series-badge');
    eq(dBadge && dBadge.getAttribute('href'), '#/series/cxi-series', '日期页「系列 · N 章」徽章也指向目录页');
    let stopped = false;
    if (dTitle) dTitle.dispatch('click', { stopPropagation: () => { stopped = true; } });
    need(stopped, '点系列链接拦住冒泡（不会顺手把 <details> 撑开）');
    need(!!row.querySelector('details.series-box'), '原有 <details> 快速预览保留');
    console.log('  20 章 → 页头 1 项；行内仍可展开看全部章节；标题/徽章另开目录页');
  }
  {
    const app = makeApp(bigManifest());
    await app.rec.started;
    await goDate(app, '2026-10-15');
    const list = app.document.querySelector('#date-list');
    eq(kids(list), 6, '日期页默认 6 条（自己的默认，不看首页）');
    need(!!app.document.querySelector('#date-btn'), '条目 > 6 时日期页有滑块');
    need(!!(list.parentNode && list.parentNode.classList.contains('rows-scroll')),
      '条目 > 6 时日期页有滚动区');
    const search = app.document.querySelector('#view input.filter-input');
    need(!!search, '条目 > 6 时日期页有搜索框');
    search.value = '调试';
    search.dispatch('input');
    eq(kids(list), 5, '搜索过滤后只剩匹配项');
    search.value = '';
    search.dispatch('input');
    eq(kids(list), 6, '清空查询回到条数上限');
    const range = app.document.querySelector('#date-range');
    eq(range.getAttribute('min'), '1', '日期页滑条下限 1');
    eq(range.getAttribute('max'), '30', '日期页滑条上限 30');
    range.value = '9';
    range.dispatch('input');
    eq(kids(list), 9, '拖到 9 → 立刻重绘成 9 条');
    eq(app.store['rec-blog:date-limit'], '9', '日期页条数写自己的 key');
    eq(app.store['rec-blog:recent-limit'], undefined, '日期页条数不影响首页条数');
    console.log('  日期页：搜索 / 滑块 / 滚动区，条数独立于首页');
  }
  {
    const app = makeApp(bigManifest());
    await app.rec.started;
    const view = await goDate(app, '1999-01-01');
    has(view.textContent, '这一天没有文章', '无文章时空态不变');
    need(!app.document.querySelector('#date-list'), '无文章时不渲染列表');
    console.log('  无文章：空态不变');
  }
  console.log('== [9] 文章库：共用同一份收拢逻辑（不回归） ==');
  {
    const app = makeApp(bigManifest());
    await app.rec.started;
    const frag = await app.rec.VIEWS.library({ q: {} });
    eq(frag.querySelectorAll('li.row-series').length, 1, '书库里 20 章仍是 1 条系列行');
    const seriesRow = frag.querySelector('li.row-series');
    eq(seriesRow.querySelectorAll('.series-posts li.row').length, 20, '章节列表完整');
    const plain = frag.querySelectorAll('li.row').filter((n) => !n.closest('.row-series'));
    eq(plain.length, 10, '10 篇单篇照常显示');
    has(frag.textContent, 'CXi 的 Rust 学习笔记', '系列行保留系列标题');
    const lTitle = seriesRow.querySelector('.series-sum a.row-title');
    eq(lTitle && lTitle.getAttribute('href'), '#/series/cxi-series', '书库系列标题指向系列目录页');
    const lBadge = seriesRow.querySelector('.series-sum a.series-badge');
    eq(lBadge && lBadge.getAttribute('href'), '#/series/cxi-series', '书库徽章也指向系列目录页');
    console.log('  书库：20 章 1 条 + 10 单篇，章节完整，标题/徽章可进目录页');
  }
  {
    /* 条目 > 12：书库补上滑块与滚动区，同时保留自己的搜索框与 data-filter 过滤 */
    const posts = [];
    for (let i = 1; i <= 20; i++) {
      posts.push(post('lp-' + i, '第 ' + i + ' 篇', '2026-0' + ((i % 9) + 1) + '-01', ['rust']));
    }
    const app = makeApp(manifest({ posts: posts, series: [] }));
    await app.rec.started;
    const frag = await app.rec.VIEWS.library({ q: {} });
    const list = frag.querySelector('#library-list');
    need(!!list, '条目 > 12 时书库用共享列表容器');
    need(!!(list.parentNode && list.parentNode.classList.contains('rows-scroll')),
      '条目 > 12 时书库有滚动区');
    need(!!frag.querySelector('#library-btn'), '条目 > 12 时书库有滑块');
    eq(frag.querySelector('#library-range').getAttribute('max'), '60', '书库滑条上限 60');
    eq(list.querySelectorAll('li.row').length, 12, '书库默认显示 12 条');

    const input = frag.querySelector('input.filter-input');
    need(!!input, '书库保留自己的搜索框（第一个 filter-input 仍是它）');
    const rows = list.querySelectorAll('li.row');
    need(rows.length > 0 && !!rows[0].getAttribute('data-filter'), '行上仍有 data-filter');
    input.value = '第 3 篇';
    input.dispatch('input');
    const left = list.querySelectorAll('li.row').filter((n) => !n.classList.contains('hide'));
    eq(left.length, 1, '书库过滤仍按 data-filter 整行隐藏');

    const range = frag.querySelector('#library-range');
    range.value = '20';
    range.dispatch('input');
    eq(app.store['rec-blog:library-limit'], '20', '书库条数写自己的 key');
    eq(app.store['rec-blog:recent-limit'], undefined, '书库条数不影响首页条数');
    console.log('  书库：滑块 / 滚动区 / 过滤都不回归');
  }
}

main().then(function () {
  console.log('');
  if (fails.length) {
    console.log('READING FAIL（%d/%d）', fails.length, checks);
    fails.forEach((f, i) => console.log('  %d. %s', i + 1, f));
    process.exit(1);
  }
  console.log('READING PASS（%d 项）', checks);
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });