'use strict';
/* rec-blog 前端壳：三栏（左=本文目录 / 中=正文 / 右=站点导航）。
 *
 * 硬约束（与 docs 的设计文档一致）：
 *  1. 运行时只有两个数据来源：manifest.json 与构建期预渲染的 HTML 片段（p/*.html 等）。
 *  2. 零第三方依赖、零外部请求：不引框架/CDN/图表库/Web 字体/统计。
 *  3. 投稿文本一律走文本节点；只有预渲染片段允许 innerHTML 注入（见 frag()）。
 *  4. 任何拼 href/src 的地方都过 safeUrl() 协议白名单。
 *  5. 数据不足就不画图：语言占比条只在有真实 languages_pct 时才出现；
 *     趋势线没有真实历史数据，因此根本不实现。
 *  6. 不用 childNodes.length（无浏览器 DOM 的环境里会抛错），一律显式计数。
 */
(function () {

  var S = { man: null, frags: {}, toc: [], tocBase: '', tocLinks: [], mapHref: '', page: '' };

  var NAV_LABEL = {
    home: '首页',
    library: '文章库', knowledge: '文章知识', topics: '主题词条', projects: '项目',
    resources: '资源', members: '成员', services: '技术互助', weekly: '周报',
    pages: '站文档', join: '加入我们'
  };
  var CONTACT_LABEL = { blog: '博客', homepage: '主页', github: 'GitHub', gitee: 'Gitee', email: '邮箱' };
  var STATUS_LABEL = { active: '进行中', wip: '开发中', archived: '已归档', paused: '暂停' };
  /* 技术互助条目的状态词：与项目那套（进行中/开发中…）不是一回事，单独一张表 */
  var SERVICE_STATUS_LABEL = { active: '可协作', paused: '暂缓' };
  var KIND_LABEL = { book: '书', tutorial: '教程', tool: '工具', video: '视频', course: '课程', route: '路线' };
  /* 文章形态：只由真实内容（标签 / 是否有图集）决定，推断不出就是阅读型 */
  var FORM_BY_TAG = {
    '教程': 'tutorial', tutorial: 'tutorial',
    '代码': 'code', code: 'code',
    '图文': 'photo', '图集': 'photo', photo: 'photo'
  };

  /* ---------- 基础工具 ---------- */

  function $(sel) { return document.querySelector(sel); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') {
      n.appendChild(document.createTextNode(String(text)));
    }
    return n;
  }

  function lnk(href, text, cls) {
    var a = el('a', cls, text);
    a.setAttribute('href', href);
    return a;
  }

  function clear(n) { if (n) n.textContent = ''; }

  /* 只有构建期预渲染的片段允许走 innerHTML */
  function frag(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var f = document.createDocumentFragment();
    while (box.firstChild) f.appendChild(box.firstChild);
    return f;
  }

  /* 协议白名单：http/https/mailto 与站内相对路径，其余一律不拼进 href/src */
  function safeUrl(u) {
    u = String(u === undefined || u === null ? '' : u).trim();
    if (!u) return '';
    if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
    if (u.charAt(0) === '#' || u.charAt(0) === '/') return u;
    if (u.split(/[/?#]/)[0].indexOf(':') === -1) return u;   // 无协议的相对路径
    return '';
  }

  function outLink(url, text, cls) {
    var href = safeUrl(url);
    if (!href) return el('span', cls || 'muted', text || String(url || ''));
    var a = lnk(href, text || href, cls);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'nofollow noopener');
    return a;
  }

  function num(n) { return String(n === undefined || n === null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function minutes(words) { return Math.max(1, Math.round((words || 0) / 300)); }
  function cut(s, n) { s = String(s === undefined || s === null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function byId(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) { if (arr[i] && arr[i].id === id) return arr[i]; }
    return null;
  }
  function bySlug(arr, slug) {
    for (var i = 0; i < (arr || []).length; i++) { if (arr[i] && arr[i].slug === slug) return arr[i]; }
    return null;
  }
  function uniq(a) {
    var out = [], seen = {};
    for (var i = 0; i < (a || []).length; i++) {
      var v = a[i];
      if (!v || seen[v]) continue;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  /* ---------- 数据装载（两个 fetch 中的全部） ---------- */

  function loadManifest() {
    if (S.man) return Promise.resolve(S.man);
    return fetch('manifest.json').then(function (r) { return r.json(); }).then(function (m) {
      S.man = m; return m;
    });
  }

  function fragment(path) {
    if (!path) return Promise.resolve('');
    if (Object.prototype.hasOwnProperty.call(S.frags, path)) return Promise.resolve(S.frags[path]);
    return fetch(path).then(function (r) { return r.text(); }).then(function (t) {
      S.frags[path] = t; return t;
    });
  }

  /* ---------- 右栏：站点导航（10 个入口，当前项弱左边框） ---------- */

  function buildSiteNav(cur) {
    var nav = $('#site-nav');
    if (!nav) return 0;
    clear(nav);
    var keys = (S.man.site && S.man.site.nav) || [];
    var n = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = lnk('#/' + k, NAV_LABEL[k] || k, k === cur ? 'cur' : '');
      nav.appendChild(a);
      n++;
    }
    return n;
  }

  /* ---------- 左栏：本文目录（只放当前页的章节） ---------- */

  function setToc(toc, base, mapHref) {
    S.toc = toc || [];
    S.tocBase = base || '';
    S.mapHref = mapHref || '';
  }

  function buildToc() {
    var navs = [$('#toc-nav'), $('#toc-nav-m')];
    S.tocLinks = [];
    for (var k = 0; k < navs.length; k++) {
      var nav = navs[k];
      if (!nav) continue;
      clear(nav);
      var count = 0;
      for (var i = 0; i < S.toc.length; i++) {
        var t = S.toc[i];
        if (!t || !t.id) continue;
        var a = lnk('#/' + S.tocBase + '/' + t.id, t.text, 'lv' + (t.level || 2));
        a.setAttribute('data-anchor', t.id);
        nav.appendChild(a);
        if (k === 0) S.tocLinks.push(a);
        count++;
      }
      if (count === 0) nav.appendChild(el('p', 'muted', '本页没有分节标题。'));
    }
    /* 没有分节标题的页面（项目/成员/互助/索引…）：告诉 CSS 左栏不必占位 */
    if (document.body && document.body.setAttribute) {
      document.body.setAttribute('data-toc', (S.toc && S.toc.length) ? 'yes' : 'none');
    }
    var ml = $('#map-link');
    if (ml) {
      /* 有目录就保留入口；导图是可选开启的，所以文案随是否生成而变 */
      var hasToc = (S.toc || []).length > 0;
      if (ml.parentNode && ml.parentNode.style) {
        ml.parentNode.style.display = (hasToc || S.mapHref) ? '' : 'none';
      }
      if (ml.textContent !== undefined) {
        ml.textContent = S.mapHref ? '章节结构与导图 →' : '章节结构 →';
      }
    }
    spyToc();
    return count;
  }

  function markToc(id) {
    for (var i = 0; i < S.tocLinks.length; i++) {
      var a = S.tocLinks[i];
      var on = a.getAttribute('data-anchor') === id;
      a.className = 'lv' + ((S.toc[i] && S.toc[i].level) || 2) + (on ? ' cur' : '');
    }
  }

  function spyToc() {
    if (!S.tocLinks.length) return;
    markToc(S.tocLinks[0].getAttribute('data-anchor'));
    if (typeof window.addEventListener !== 'function') return;
    window.addEventListener('scroll', function () {
      var cur = S.tocLinks[0].getAttribute('data-anchor');
      for (var i = 0; i < S.tocLinks.length; i++) {
        var id = S.tocLinks[i].getAttribute('data-anchor');
        var node = document.getElementById ? document.getElementById(id) : null;
        if (node && typeof node.getBoundingClientRect === 'function') {
          var r = node.getBoundingClientRect();
          if (r && r.top <= 120) cur = id;
        }
      }
      markToc(cur);
    });
  }

  /* ---------- 真实数据才画的图 ---------- */

  /* 语言占比条：meta.languages_pct 来自构建期抓取的 /languages；没有就不画 */
  function langBar(pct, max) {
    if (!pct) return null;
    var keys = Object.keys(pct);
    if (!keys.length) return null;
    keys.sort(function (a, b) { return pct[b] - pct[a]; });
    var shown = keys.slice(0, max || 4);
    var wrap = el('div');
    var bar = el('div', 'langbar');
    var legend = el('ul', 'lang-legend');
    var i;
    for (i = 0; i < shown.length; i++) {
      var seg = el('i', 'l' + (i % 4));
      seg.setAttribute('style', 'width:' + pct[shown[i]] + '%');
      seg.setAttribute('title', shown[i] + ' ' + pct[shown[i]] + '%');
      bar.appendChild(seg);
      var li = el('li');
      var sw = el('i', 'l' + (i % 4));
      sw.setAttribute('style', 'display:inline-block;width:7px;height:7px;border-radius:2px;background:currentColor');
      li.appendChild(el('span', '', shown[i] + ' ' + pct[shown[i]] + '%'));
      legend.appendChild(li);
    }
    wrap.appendChild(bar);
    wrap.appendChild(legend);
    return wrap;
  }

  /* 词条关系图：只画真实关系；每个方向最多 2 个节点，其余 +N；没数据的方向不画 */
  function relGraph(topic, posts, projects, topics) {
    var tags = (topic.tags || []).slice();
    var relIds = (topic.related || []).slice();
    var slugs = (topic.resolved || []).slice();
    var tagSet = {};
    var i;
    for (i = 0; i < tags.length; i++) tagSet[tags[i]] = 1;

    var arts = [];
    for (i = 0; i < slugs.length; i++) { var p = bySlug(posts, slugs[i]); if (p) arts.push(p); }
    var rels = [];
    for (i = 0; i < relIds.length; i++) { var t = byId(topics, relIds[i]); if (t) rels.push(t); }
    var projs = [];
    for (i = 0; i < (projects || []).length; i++) {
      var pr = projects[i];
      var hit = false;
      var langs = (pr.languages || []).concat(pr.platforms || []);
      for (var j = 0; j < langs.length; j++) { if (tagSet[langs[j]]) hit = true; }
      if (hit) projs.push(pr);
    }
    var total = tags.length + arts.length + rels.length + projs.length;
    if (!total) return null;

    var W = 640, H = 360, CX = 320, CY = 180;
    var NS = 'http://www.w3.org/2000/svg';
    function sv(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== undefined && attrs[k] !== null) {
          n.setAttribute(k, String(attrs[k]));
        }
      }
      return n;
    }
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label',
      '关系图：' + topic.title + '；标签 ' + tags.length + ' 个、关联文章 ' + arts.length +
      ' 篇、相关词条 ' + rels.length + ' 条、相关项目 ' + projs.length + ' 个');
    var g = sv('g', {});
    svg.appendChild(g);

    var NW = 130, NH = 28;
    var placed = [];
    function group(list, pos, dirLabel, getText, getHref) {
      if (!list || !list.length) return;
      var nodes = list.slice(0, 2);
      for (var i2 = 0; i2 < nodes.length; i2++) {
        var c = pos(i2, nodes.length);
        placed.push({ x: c.x, y: c.y });
        g.appendChild(sv('line', { class: 'rg-link', x1: CX, y1: CY, x2: c.x, y2: c.y }));
      }
      for (var i3 = 0; i3 < nodes.length; i3++) {
        var cc = pos(i3, nodes.length);
        var a = sv('a', { href: getHref(nodes[i3]) });
        a.appendChild(sv('rect', {
          class: 'rg-node', x: cc.x - NW / 2, y: cc.y - NH / 2,
          width: NW, height: NH, rx: 4
        }));
        var tx = sv('text', { class: 'rg-t', x: cc.x, y: cc.y + 4 });
        tx.appendChild(document.createTextNode(cut(getText(nodes[i3]), 9)));
        a.appendChild(tx);
        g.appendChild(a);
      }
      if (list.length > 2) {
        var cm = pos(2, 3);
        var more = sv('text', { class: 'rg-more', x: cm.x, y: cm.y + 4 });
        more.appendChild(document.createTextNode('+' + (list.length - 2) + ' 个'));
        g.appendChild(more);
      }
      var d = sv('text', { class: 'rg-dir', x: dirLabel.x, y: dirLabel.y });
      d.appendChild(document.createTextNode(dirLabel.t));
      g.appendChild(d);
    }

    var box = sv('rect', { class: 'rg-root', x: CX - 90, y: CY - 19, width: 180, height: 38, rx: 5 });
    var rootT = sv('text', { class: 'rg-root-t', x: CX, y: CY + 5 });
    rootT.appendChild(document.createTextNode(cut(topic.title, 12)));

    /* 连线先画（在节点下层），再画节点 */
    g.appendChild(box);
    g.appendChild(rootT);

    group(tags, function (i2, n) {
      var xs = n === 1 ? [CX] : [CX - 100, CX + 100];
      return { x: xs[i2 < xs.length ? i2 : xs.length - 1], y: 40 };
    }, { x: CX, y: 18, t: '标签' }, function (v) { return v; }, function (v) { return '#/library'; });

    group(rels, function (i2, n) {
      var xs = n === 1 ? [CX] : [CX - 100, CX + 100];
      return { x: xs[i2 < xs.length ? i2 : xs.length - 1], y: H - 40 };
    }, { x: CX, y: H - 10, t: '相关词条' }, function (v) { return v.title; }, function (v) { return '#/topic/' + v.id; });

    group(arts, function (i2, n) {
      var ys = n === 1 ? [CY] : [CY - 50, CY + 50];
      return { x: 80, y: ys[i2 < ys.length ? i2 : ys.length - 1] };
    }, { x: 80, y: CY - 84, t: '关联文章' }, function (v) { return v.title; }, function (v) { return '#/post/' + v.slug; });

    group(projs, function (i2, n) {
      var ys = n === 1 ? [CY] : [CY - 50, CY + 50];
      return { x: W - 80, y: ys[i2 < ys.length ? i2 : ys.length - 1] };
    }, { x: W - 80, y: CY - 84, t: '相关项目' }, function (v) { return v.name; }, function (v) { return '#/projects'; });

    var wrap = el('div', 'relgraph');
    wrap.appendChild(svg);
    return wrap;
  }

  /* ---------- 通用小件 ---------- */

  function crumb(items) {
    var n = el('nav', 'crumb');
    for (var i = 0; i < items.length; i++) {
      if (i) n.appendChild(el('span', 'sep', '›'));
      if (items[i][1]) n.appendChild(lnk(items[i][1], items[i][0]));
      else n.appendChild(el('span', '', items[i][0]));
    }
    return n;
  }

  function tagLine(tags, cls) {
    var p = el('p', cls || 'row-tags');
    for (var i = 0; i < (tags || []).length; i++) {
      if (i) p.appendChild(document.createTextNode(' '));
      p.appendChild(lnk('#/library?tag=' + encodeURIComponent(tags[i]), tags[i], 'tag'));
    }
    return p;
  }

  function statusBadge(v, map) {
    var M = map || STATUS_LABEL;
    return el('span', 'status ' + String(v || ''), M[v] || String(v || '—'));
  }

  function kv(pairs) {
    var dl = el('dl', 'kv');
    var n = 0;
    for (var i = 0; i < (pairs || []).length; i++) {
      var row = pairs[i];
      if (!row || row[1] === '' || row[1] === null || row[1] === undefined) continue;
      dl.appendChild(el('dt', '', row[0]));
      var dd = el('dd');
      if (row[2]) dd.appendChild(lnk(row[2], row[1]));
      else dd.appendChild(document.createTextNode(String(row[1])));
      dl.appendChild(dd);
      n++;
    }
    return n ? dl : null;
  }

  function metric(n, label) {
    var d = el('div', 'metric');
    d.appendChild(el('span', 'm-num', typeof n === 'number' ? num(n) : String(n)));
    d.appendChild(el('span', 'm-label', label));
    return d;
  }

  function avatarOf(mem, cls) {
    if (!mem || !mem.avatar) return null;
    var src = safeUrl(mem.avatar);
    if (!src) return null;
    var img = el('img', cls || 'avatar');
    img.setAttribute('src', src);
    img.setAttribute('alt', mem.name || '');
    img.setAttribute('loading', 'lazy');
    return img;
  }

  function personCard(m, posts, projects, services) {
    var c = el('article', 'person');
    var av = avatarOf(m);
    c.appendChild(av || el('div', 'avatar'));
    /* 文本集中在一个 flex 列里：卡片等高时数字行可以贴底对齐 */
    var body = el('div', 'p-body');
    var name = el('div', 'p-name');
    name.appendChild(lnk('#/member/' + m.id, m.name));
    body.appendChild(name);
    body.appendChild(el('div', 'p-role', m.role || '群友'));
    if (m.signature) body.appendChild(el('p', 'p-sig', m.signature));
    if ((m.skills || []).length) {
      var skills = el('p', 'chips');
      for (var i = 0; i < m.skills.length; i++) skills.appendChild(el('span', 'chip', m.skills[i]));
      body.appendChild(skills);
    }
    var np = 0, npr = 0, ns = 0, i2;
    for (i2 = 0; i2 < (posts || []).length; i2++) { if (posts[i2].author === m.id) np++; }
    for (i2 = 0; i2 < (projects || []).length; i2++) {
      var pr = projects[i2];
      if (pr.owner === m.id || (pr.contributors || []).indexOf(m.id) >= 0) npr++;
    }
    for (i2 = 0; i2 < (services || []).length; i2++) { if (services[i2].owner === m.id) ns++; }
    body.appendChild(el('p', 'p-nums', '文章 ' + np + ' · 项目 ' + npr + ' · 互助 ' + ns +
      (m.joined ? ' · 加入 ' + m.joined : '')));
    c.appendChild(body);
    return c;
  }

  function postRow(p, members) {
    var li = el('li', 'row');
    li.appendChild(el('span', 'row-date', String(p.date || '').slice(0, 10)));
    li.appendChild(lnk('#/post/' + p.slug, p.title, 'row-title'));
    li.appendChild(el('span', 'row-words', num(p.words) + ' 字'));
    li.appendChild(el('p', 'row-sum', p.summary || ''));
    var tags = el('p', 'row-tags');
    for (var i = 0; i < (p.tags || []).length; i++) {
      if (i) tags.appendChild(document.createTextNode(' '));
      tags.appendChild(el('span', 'tag', p.tags[i]));
    }
    var mem = byId(members || [], p.author);
    if (mem) {
      tags.appendChild(document.createTextNode(' · '));
      tags.appendChild(lnk('#/member/' + mem.id, mem.name));
    }
    li.appendChild(tags);
    return li;
  }

  function proseFragment(path) {
    return fragment(path).then(function (html) {
      var d = el('div', 'prose');
      d.appendChild(frag(html || '<p>（空）</p>'));
      return d;
    });
  }

  /* ---------- 视图：索引类 ---------- */


  /* ---------- 通用零件：页面头 / 过滤框 / 可过滤列表 / 内联 SVG 图标 ---------- */

  function pageHead(kicker, title, lede) {
    var h = el('header', 'page-head');
    if (kicker) h.appendChild(el('p', 'kicker', kicker));
    h.appendChild(el('h1', '', title));
    if (lede) h.appendChild(el('p', 'lede', lede));
    return h;
  }

  function filterBox(placeholder, onChange) {
    var box = el('div', 'filters');
    var input = el('input', 'filter-input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', placeholder);
    input.setAttribute('aria-label', placeholder);
    if (input.addEventListener) {
      input.addEventListener('input', function () {
        onChange(String(input.value || '').trim().toLowerCase());
      });
    }
    box.appendChild(input);
    return box;
  }

  /* 数据多起来也不慌：列表上方固定搜索框，按 q 过滤（空 q 全量） */
  function filterable(head, items, cfg) {
    var f = document.createDocumentFragment();
    f.appendChild(head);
    var api = cfg.api || (cfg.api = {});
    var list = el(cfg.tag || 'div', cfg.cls || '');
    function draw(q) {
      clear(list);
      var n = 0;
      for (var i = 0; i < items.length; i++) {
        if (q && !cfg.match(items[i], q)) continue;
        list.appendChild(cfg.render(items[i]));
        n++;
      }
      if (!n) list.appendChild(el('p', 'muted', cfg.empty || '没有匹配项。'));
    }
    var box = filterBox(cfg.placeholder, draw);
    var input = box.firstChild;
    api.setFilter = function (q) {
      if (input && input.setAttribute) input.setAttribute('value', String(q || ''));
      draw(String(q || '').toLowerCase());
    };
    f.appendChild(box);
    f.appendChild(list);
    draw('');
    return f;
  }

  /* 内联 SVG 图标：不用图标字体、不发请求 */
  var ICON_PATHS = {
    library: 'M3 5h18M3 10h18M3 15h12',
    knowledge: 'M4 3h9l3 3v13H4zM8 9h5M8 12h5M8 15h3',
    topics: 'M3 5h7v6H3zM10 5h7v6h-7zM3 11h7v6H3zM10 11h7v6h-7z',
    projects: 'M3 6h6l2 2h7v9H3z',
    resources: 'M4 4h7v13H4zM13 4h7v13h-7z',
    members: 'M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 18c0-3 3-5 6-5s6 2 6 5M16 8h6M19 5v6',
    services: 'M3 7h18v11H3zM3 11h18M9 7v11',
    weekly: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16',
    pages: 'M5 3h9l4 4v14H5zM14 3v5h5',
    join: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6M17 9v6M14 12h6'
  };

  function svgIcon(key) {
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : el('svg');
    s.setAttribute('class', 'nav-ico');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : el('path');
    p.setAttribute('d', ICON_PATHS[key] || ICON_PATHS.library);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    s.appendChild(p);
    return s;
  }

  /* 首页：logo + 全站搜索 + 站点导航卡片（含 SVG 图标与条目数） */
  function navCount(m, key) {
    var map = {
      library: (m.posts || []).length, topics: (m.topics || []).length,
      projects: (m.projects || []).length, resources: (m.resources || []).length,
      members: (m.members || []).length, services: (m.services || []).length,
      weekly: (m.weekly || []).length, pages: (m.pages || []).length
    };
    return map[key];
  }

  function viewHome() {
    var m = S.man;
    var f = document.createDocumentFragment();

    var hero = el('section', 'home-hero');
    if (m.site.avatar) {
      var logo = el('img', 'home-logo');
      logo.src = m.site.avatar;
      logo.alt = m.site.title || '';
      logo.setAttribute('width', '56');
      logo.setAttribute('height', '56');
      hero.appendChild(logo);
    }
    hero.appendChild(el('h1', 'home-title', m.site.title || ''));
    if (m.site.tagline) hero.appendChild(el('p', 'home-tagline', m.site.tagline));

    var form = el('form', 'home-search');
    form.setAttribute('role', 'search');
    form.setAttribute('action', '#/search/');
    var input = el('input', 'home-input');
    input.setAttribute('type', 'search');
    input.setAttribute('name', 'q');
    input.setAttribute('placeholder', '全站搜索：文章 / 项目 / 成员 / 资源（回车）');
    input.setAttribute('aria-label', '全站搜索');
    input.id = 'home-q';
    var btn = el('button', 'home-btn', '搜索');
    btn.setAttribute('type', 'submit');
    form.appendChild(input);
    form.appendChild(btn);
    if (form.addEventListener) {
      form.addEventListener('submit', function (ev) {
        if (ev.preventDefault) ev.preventDefault();
        var q = String(input.value || '').trim();
        if (q) location.hash = '#/search/' + encodeURIComponent(q);
      });
    }
    hero.appendChild(form);
    f.appendChild(hero);

    var KEYS = ['library', 'knowledge', 'topics', 'projects', 'resources',
                'members', 'services', 'weekly', 'pages', 'join'];
    var DESC = {
      library: '按年份浏览全部文章', knowledge: '系列 / 标签 / 作者索引',
      topics: '主题词条与关系图', projects: '仓库元数据与活跃度比较',
      resources: '书 / 教程 / 工具 / 视频', members: '成员档案与作品',
      services: '技术互助', weekly: '周报 / 月刊',
      pages: '制度与写作文档', join: '加入 QQ 群'
    };
    var cards = el('div', 'nav-cards');
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      var a = lnk('#/' + k, '', 'nav-card');
      a.appendChild(svgIcon(k));
      a.appendChild(el('b', '', NAV_LABEL[k] || k));
      a.appendChild(el('span', '', DESC[k] || ''));
      var c = navCount(m, k);
      if (c !== undefined) a.appendChild(el('em', '', c + ' 项'));
      cards.appendChild(a);
    }
    f.appendChild(cards);

    var latest = (m.posts || []).slice(0, 3);
    if (latest.length) {
      f.appendChild(el('p', 'section-h', '最近更新'));
      var ol = el('ol', 'rows');
      for (var j = 0; j < latest.length; j++) {
        var p = latest[j];
        var li = el('li', 'row');
        li.appendChild(el('span', 'row-date', String(p.date || '').slice(0, 10)));
        li.appendChild(lnk('#/post/' + p.slug, p.title, 'row-title'));
        li.appendChild(el('span', 'row-words', num(p.words) + ' 字'));
        ol.appendChild(li);
      }
      f.appendChild(ol);
    }
    setToc([], '', '');
    return Promise.resolve(f);
  }


  /* ---------- 附件：统一文件图标 + 下载渠道 ---------- */
  var DL_CHANNELS = [
    ['lanzou', '蓝奏云'], ['lanzn', '蓝奏云'], ['lanrar', '蓝奏云'],
    ['aliyundrive', '阿里云盘'], ['alipan', '阿里云盘'], ['quark', '夸克'],
    ['123pan', '123 云盘'], ['pan.baidu', '百度网盘'], ['gitee', 'Gitee'], ['github', 'GitHub']
  ];

  function dlChannel(url) {
    var s = String(url || '').toLowerCase();
    for (var i = 0; i < DL_CHANNELS.length; i++) {
      if (s.indexOf(DL_CHANNELS[i][0]) >= 0) return DL_CHANNELS[i][1];
    }
    return '外链';
  }

  function extOf(url) {
    var m = String(url || '').split('?')[0].match(/\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  /* 统一文件标志：按扩展名给一个内联 SVG（不引图标字体） */
  /* 统一文件标志：按扩展名画三种（文档 / 图片 / 压缩包），外链用链环 */
  var FILE_PATHS = {
    doc: ['M7 3h7l4 4v14H7z', 'M14 3v5h5', 'M10 13h5', 'M10 16h5'],
    image: ['M4 5h16v14H4z', 'M8 12l3 3 4-4 3 3', 'M9 8.6a.6.6 0 1 0 0-.01'],
    archive: ['M4 7h16v12H4z', 'M6 7l2-4h8l2 4', 'M12 7v5', 'M10.4 10h3.2'],
    link: ['M10 14l4-4', 'M8.5 12.5l-2 2a3 3 0 1 0 4.2 4.2l2-2',
           'M15.5 11.5l2-2a3 3 0 1 0-4.2-4.2l-2 2']
  };

  function fileIcon(url, kind) {
    var ext = extOf(url);
    var shape = kind === 'image' ? 'image'
      : (ext === 'zip' || ext === '7z' || ext === 'rar' || ext === 'tar' || ext === 'gz') ? 'archive'
      : /^https?:/i.test(String(url || '')) && !ext ? 'link'
      : 'doc';
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : el('svg');
    s.setAttribute('class', 'file-ico file-' + shape);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var paths = FILE_PATHS[shape] || FILE_PATHS.doc;
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : el('path');
      p.setAttribute('d', paths[i]);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1.6');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      s.appendChild(p);
    }
    return s;
  }

  /* 提取码：只当文本展示，点一下写剪贴板 + toast（不拼进 href/src） */
  function copyText(text) {
    var okMsg = '已复制提取码：' + text;
    var failMsg = '复制失败，提取码：' + text;
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); },
        function () { toast(failMsg); });
    } else {
      toast(failMsg);
    }
  }

  function toast(msg) {
    if (!document.body) return;
    var box = el('div', 'toast', msg);
    document.body.appendChild(box);
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 2200);
  }

  function codeChip(code) {
    code = String(code === undefined || code === null ? '' : code).trim();
    if (!code) return null;
    var btn = el('button', 'code-chip', '提取码 ' + code + ' · 复制');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-code', code);
    btn.setAttribute('title', '复制提取码');
    if (btn.addEventListener) {
      btn.addEventListener('click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        copyText(this.getAttribute('data-code'));
      });
    }
    return btn;
  }

  function attachCard(at) {
    var li = el('li', 'attach-card');
    li.appendChild(fileIcon(at.url, at.kind));
    var meta = el('div', 'file-meta');
    meta.appendChild(el('b', '', at.name || '附件'));
    var sub = [];
    var ext = extOf(at.url);
    if (ext) sub.push(ext.toUpperCase());
    else if (at.kind === 'link') sub.push('外链');
    if (at.size && at.size !== '—') sub.push(at.size);
    meta.appendChild(el('span', '', sub.join(' · ') || '文件'));
    li.appendChild(meta);
    var href = safeUrl(at.url);
    if (href) {
      var a = lnk(href, '下载 · ' + dlChannel(at.url), 'dl-btn');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      li.appendChild(a);
    } else {
      li.appendChild(el('span', 'muted', '链接无效'));
    }
    var chip = codeChip(at.code);
    if (chip) li.appendChild(chip);
    return li;
  }

  /* ---------- 章节结构弹层（内联，不跳页） ---------- */
  function showModal(title) {
    var m = $('#modal'), t = $('#modal-title');
    if (!m) return;
    if (t) { clear(t); t.appendChild(document.createTextNode(title || '章节结构')); }
    m.removeAttribute('hidden');
  }

  function hideModal() {
    var m = $('#modal');
    if (m) m.setAttribute('hidden', '');
  }

  function openStructure() {
    var body = $('#modal-body');
    if (!body) return;
    clear(body);
    body.appendChild(el('p', 'section-h', '结构清单'));
    var ol = el('ol', 'struct-list');
    if ((S.toc || []).length) {
      for (var i = 0; i < S.toc.length; i++) {
        var t = S.toc[i];
        if (!t || !t.id) continue;
        var li = el('li', 'lv' + (t.level || 2));
        li.appendChild(lnk('#/' + S.tocBase + '/' + t.id, t.text));
        ol.appendChild(li);
      }
    } else {
      ol.appendChild(el('li', 'muted', '本文没有分节标题'));
    }
    body.appendChild(ol);

    if (S.mapHref) {
      body.appendChild(el('p', 'section-h', '章节导图'));
      body.appendChild(el('p', 'muted', '拖动平移 · 滚轮缩放 · 双击复位'));
      var view = el('div', 'map-view');
      var img = el('img', 'map-img');
      img.src = S.mapHref;
      img.alt = '章节导图';
      img.setAttribute('draggable', 'false');
      var tx = 0, ty = 0, scale = 1;
      function apply() {
        if (img.style) img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      }
      var drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
      if (view.addEventListener) {
        view.addEventListener('pointerdown', function (ev) {
          drag = true; sx = ev.clientX; sy = ev.clientY; ox = tx; oy = ty;
          if (view.setPointerCapture && ev.pointerId !== undefined) {
            try { view.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
          }
        });
        view.addEventListener('pointermove', function (ev) {
          if (!drag) return;
          tx = ox + (ev.clientX - sx);
          ty = oy + (ev.clientY - sy);
          apply();
        });
        view.addEventListener('pointerup', function () { drag = false; });
        view.addEventListener('pointercancel', function () { drag = false; });
        view.addEventListener('wheel', function (ev) {
          if (ev.preventDefault) ev.preventDefault();
          scale = Math.min(3, Math.max(0.4, scale + (ev.deltaY < 0 ? 0.12 : -0.12)));
          apply();
        }, { passive: false });
        view.addEventListener('dblclick', function () { tx = 0; ty = 0; scale = 1; apply(); });
      }
      view.appendChild(img);
      body.appendChild(view);
      apply();
    }
    body.appendChild(el('p', 'muted',
      'AI 摘要：预留接口。构建期可生成提示词（结构清单 + 正文），输出格式待约定后再接。'));
    showModal('章节结构');
  }

  /* ---------- 按日期看文章 ---------- */
  function viewByDate(day) {
    var m = S.man;
    var f = document.createDocumentFragment();
    var list = (m.posts || []).filter(function (p) {
      return String(p.date || '').slice(0, 10) === String(day);
    });
    var head = pageHead('日期', String(day), list.length
      ? '这一天发了 ' + list.length + ' 篇。'
      : '这一天没有文章（日期来自 front matter 的 date 字段）。');
    f.appendChild(head);
    if (list.length) {
      var ol = el('ol', 'rows');
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var li = el('li', 'row');
        li.appendChild(el('span', 'row-date', String(p.date).slice(0, 10)));
        li.appendChild(lnk('#/post/' + p.slug, p.title, 'row-title'));
        li.appendChild(el('span', 'row-words', num(p.words) + ' 字'));
        li.appendChild(el('p', 'row-sum', p.summary || ''));
        ol.appendChild(li);
      }
      f.appendChild(ol);
    }
    setToc([], '', '');
    return Promise.resolve(f);
  }


  function summaryCard(s) {
    var box = el('aside', 'ai-summary');
    var h = el('p', 'ai-head');
    h.appendChild(el('b', '', '摘要'));
    h.appendChild(el('span', 'ai-src', s.source === 'ai' ? 'AI · 构建期' : '构建期抽取'));
    box.appendChild(h);
    if (s.one_line) box.appendChild(el('p', 'ai-line', s.one_line));
    if ((s.points || []).length) {
      var ul = el('ul', 'ai-points');
      for (var i = 0; i < s.points.length; i++) ul.appendChild(el('li', '', s.points[i]));
      box.appendChild(ul);
    }
    if ((s.keywords || []).length) {
      var tg = el('p', 'row-tags');
      for (var j = 0; j < s.keywords.length; j++) {
        if (j) tg.appendChild(document.createTextNode(' '));
        tg.appendChild(el('span', 'tag', s.keywords[j]));
      }
      box.appendChild(tg);
    }
    return box;
  }

  function viewLibrary(query) {
    var m = S.man;
    var f = document.createDocumentFragment();
    var head = el('header', 'page-head');
    head.appendChild(el('p', 'kicker', '共建博客'));
    head.appendChild(el('h1', '', '文章库'));
    head.appendChild(el('p', 'lede', '共 ' + m.posts.length + ' 篇，按年份分组。' +
      (query && query.tag ? '当前筛选标签：#' + query.tag : '')));
    f.appendChild(head);

    var filters = el('div', 'filters');
    var input = el('input', 'filter-input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', '按标题 / 摘要 / 标签过滤（即时）');
    input.setAttribute('aria-label', '过滤文章');
    if (query && query.tag) input.setAttribute('value', '#' + query.tag);
    filters.appendChild(input);
    f.appendChild(filters);

    var chips = el('div', 'chips');
    var tagCount = 0;
    for (var i = 0; i < (m.tags || []).length && tagCount < 24; i++) {
      var tg = m.tags[i];
      var on = query && query.tag && query.tag === tg.tag;
      var chip = el('span', on ? 'chip on' : 'chip', tg.tag + ' (' + tg.count + ')');
      chip.setAttribute('data-tag', tg.tag);
      chips.appendChild(chip);
      tagCount++;
    }
    if (chips.addEventListener) {
      chips.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        if (!t || typeof t.getAttribute !== 'function' || t.getAttribute('data-tag') === null) return;
        var tag = t.getAttribute('data-tag');
        var was = t.classList.contains('on');
        var list = chips.getElementsByTagName ? chips.getElementsByTagName('span') : [];
        for (var ci = 0; ci < list.length; ci++) list[ci].classList.remove('on');
        if (!was) t.classList.add('on');
        input.setAttribute('value', was ? '' : '#' + tag);
        applyFilter(was ? '' : tag);
      });
    }
    f.appendChild(chips);

    var years = {}, order = [];
    var posts = m.posts;
    if (query && query.tag) {
      posts = [];
      for (var k = 0; k < m.posts.length; k++) {
        if ((m.posts[k].tags || []).indexOf(query.tag) >= 0) posts.push(m.posts[k]);
      }
    }
    for (var j = 0; j < posts.length; j++) {
      var y = String(posts[j].year || String(posts[j].date || '').slice(0, 4));
      if (!years[y]) { years[y] = []; order.push(y); }
      years[y].push(posts[j]);
    }

    /* 过滤用的行登记表：显式保存「节点 + 可搜索文本」，不发任何请求 */
    var rowNodes = [];
    var rows = 0;
    for (var yi = 0; yi < order.length; yi++) {
      var yr = order[yi];
      var d = el('details');
      if (yi === 0) d.setAttribute('open', 'open');
      d.appendChild(el('summary', '', yr + ' 年（' + years[yr].length + ' 篇）'));
      var ol = el('ol', 'rows');
      for (var ri = 0; ri < years[yr].length; ri++) {
        var post = years[yr][ri];
        var li = postRow(post, m.members);
        var mem = byId(m.members, post.author);
        li.setAttribute('data-filter', [
          post.title, post.summary, post.date,
          (post.tags || []).join(' '), mem ? mem.name : post.author
        ].join(' '));
        ol.appendChild(li);
        rowNodes.push(li);
        rows++;
      }
      d.appendChild(ol);
      f.appendChild(d);
    }
    if (!rows) f.appendChild(el('p', 'muted', '没有匹配的文章。'));

    function applyFilter(q) {
      q = String(q || '').toLowerCase().replace(/^#/, '');
      for (var i2 = 0; i2 < rowNodes.length; i2++) {
        var node = rowNodes[i2];
        var txt = String(node.getAttribute('data-filter') || '').toLowerCase();
        node.className = (!q || txt.indexOf(q) >= 0) ? 'row' : 'row hide';
      }
    }
    if (input.addEventListener) {
      input.addEventListener('input', function () {
        var v = input.value !== undefined ? input.value : input.getAttribute('value');
        applyFilter(v);
      });
    }
    return Promise.resolve(f);
  }

  function viewKnowledge() {
    var m = S.man;
    var f = document.createDocumentFragment();
    var head = el('header', 'page-head');
    head.appendChild(el('p', 'kicker', '知识'));
    head.appendChild(el('h1', '', '文章知识'));
    head.appendChild(el('p', 'lede', '主题词条、标签与系列的入口。正文仍在文章库。'));
    f.appendChild(head);

    if ((m.topics || []).length) {
      f.appendChild(el('p', 'section-h', '主题词条'));
      var g1 = el('div', 'grid');
      for (var i = 0; i < m.topics.length; i++) {
        var t = m.topics[i];
        var c = el('article', 'card');
        c.appendChild(lnk('#/topic/' + t.id, t.title, 'card-title'));
        c.appendChild(el('p', 'card-note', t.summary || ''));
        var meta = el('p', 'row-tags');
        meta.appendChild(el('span', 'badge', (t.resolved || []).length + ' 篇'));
        c.appendChild(meta);
        g1.appendChild(c);
      }
      f.appendChild(g1);
    }

    if ((m.tags || []).length) {
      f.appendChild(el('p', 'section-h', '标签'));
      var p = el('p', 'chips');
      for (var j = 0; j < m.tags.length; j++) {
        p.appendChild(lnk('#/library?tag=' + encodeURIComponent(m.tags[j].tag),
          m.tags[j].tag + ' (' + m.tags[j].count + ')', 'chip'));
      }
      f.appendChild(p);
    }

    if ((m.series || []).length) {
      f.appendChild(el('p', 'section-h', '系列'));
      for (var k = 0; k < m.series.length; k++) {
        var s = m.series[k];
        var box = el('details');
        box.appendChild(el('summary', '', s.title + '（' + s.posts.length + ' 篇）'));
        var ol = el('ol', 'rows');
        for (var pi = 0; pi < s.posts.length; pi++) {
          var post = bySlug(m.posts, s.posts[pi].slug);
          if (post) ol.appendChild(postRow(post, m.members));
        }
        box.appendChild(ol);
        f.appendChild(box);
      }
    }
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }


  function topicCard(t) {
    var c = el('article', 'card');
    c.appendChild(lnk('#/topic/' + t.id, t.title, 'card-title'));
    var meta = el('p', 'row-tags');
    meta.appendChild(el('span', 'badge', (t.resolved || []).length + ' 篇文章'));
    for (var ti = 0; ti < (t.tags || []).length; ti++) {
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(el('span', 'tag', t.tags[ti]));
    }
    c.appendChild(meta);
    c.appendChild(el('p', 'card-note', t.summary || ''));
    return c;
  }

  function viewTopics() {
    var m = S.man;
    var head = pageHead('定义', '主题词条', '一个词条聚合若干文章；同标签文章会自动归入。');
    var f = filterable(head, m.topics || [], {
      cls: 'grid',
      placeholder: '按词条名 / 定义 / 标签过滤',
      empty: '没有匹配的词条。',
      match: function (t, q) {
        return (t.title + ' ' + (t.summary || '') + ' ' + (t.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
      },
      render: topicCard
    });
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function projectRow(p, m) {
    var art = el('article', 'proj');
    var left = el('div');
    var h = el('h2');
    h.appendChild(lnk('#/project/' + p.id, p.name));
    left.appendChild(h);
    left.appendChild(el('p', '', p.one_liner));
    var line = el('p', 'row-tags');
    line.appendChild(statusBadge(p.status));
    if (p.license) { line.appendChild(document.createTextNode(' ')); line.appendChild(el('span', 'lang', p.license)); }
    var mem = byId(m.members, p.owner);
    if (mem) { line.appendChild(document.createTextNode(' · ')); line.appendChild(lnk('#/member/' + mem.id, mem.name)); }
    left.appendChild(line);
    var btns = el('p', 'chips');
    btns.appendChild(outLink(p.repo, '仓库', 'chip'));
    if (p.homepage) btns.appendChild(outLink(p.homepage, '主页', 'chip'));
    left.appendChild(btns);
    art.appendChild(left);

    var right = el('aside', 'proj-data');
    var meta = p.meta || {};
    var metrics = el('div', 'metrics');
    if (meta.stars !== null && meta.stars !== undefined) metrics.appendChild(metric(meta.stars, 'stars'));
    if (meta.forks !== null && meta.forks !== undefined) metrics.appendChild(metric(meta.forks, 'forks'));
    if (meta.updated_at) metrics.appendChild(metric(String(meta.updated_at).slice(0, 10), '最近提交'));
    right.appendChild(metrics);
    var bar = meta.languages_pct ? langBar(meta.languages_pct, 4) : null;
    if (bar) right.appendChild(bar);
    else right.appendChild(el('p', 'muted', '语言占比：构建期未取到，故不画。'));
    if (meta.stale) right.appendChild(el('p', 'muted', '（缓存数据）'));
    art.appendChild(right);
    return art;
  }

  function viewProjects() {
    var m = S.man;
    var head = pageHead('比较', '项目', '左简介、右数据。数据来自构建期抓取的仓库元数据，抓不到就不显示。');
    var f = filterable(head, m.projects || [], {
      placeholder: '按项目名 / 简介 / 语言 / 状态过滤',
      empty: '没有匹配的项目。',
      match: function (p, q) {
        return (p.name + ' ' + (p.one_liner || '') + ' ' + (p.languages || []).join(' ') + ' ' +
          (p.status || '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (p) { return projectRow(p, m); }
    });
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewMembers() {
    var m = S.man;
    var head = pageHead('人', '成员', '档案自愿建立；数字贡献由构建期统计，不是估算。');
    var f = filterable(head, m.members || [], {
      cls: 'grid',
      placeholder: '按昵称 / 签名 / 技能 / 角色过滤',
      empty: '没有匹配的成员。',
      match: function (x, q) {
        return (x.name + ' ' + (x.signature || '') + ' ' + (x.skills || []).join(' ') + ' ' +
          (x.role || '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (x) { return personCard(x, m.posts, m.projects, m.services); }
    });
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function serviceRow(s, m) {
    var mem = byId(m.members, s.owner);
    var d = el('article', 'svc ' + (s.status || ''));
    var h = el('h3', 'svc-h');
    h.appendChild(lnk('#/service/' + s.id, s.name));
    d.appendChild(h);
    var l1 = el('p', 'svc-line');
    l1.appendChild(el('b', '', '能帮上什么'));
    l1.appendChild(document.createTextNode((s.skills || []).join('、')));
    d.appendChild(l1);
    var l2 = el('p', 'svc-line');
    l2.appendChild(el('b', '', '想一起做什么'));
    l2.appendChild(document.createTextNode((s.wants || []).join('、') || '（未填写）'));
    d.appendChild(l2);
    var l3 = el('p', 'svc-line');
    l3.appendChild(el('b', '', '怎么联系'));
    var ways = [];
    for (var ci = 0; ci < (s.contact || []).length; ci++) {
      var key = s.contact[ci];
      var val = mem && mem.links ? mem.links[key] : '';
      if (val) ways.push(CONTACT_LABEL[key] || key);
    }
    l3.appendChild(document.createTextNode(ways.length ? ways.join(' / ') : '见条目内页'));
    d.appendChild(l3);
    var meta = el('p', 'row-tags');
    meta.appendChild(statusBadge(s.status, SERVICE_STATUS_LABEL));
    meta.appendChild(document.createTextNode(' · '));
    if (mem) meta.appendChild(lnk('#/member/' + mem.id, mem.name));
    meta.appendChild(document.createTextNode(' · 更新 ' + (s.updated || '—')));
    d.appendChild(meta);
    return d;
  }

  function viewServices() {
    var m = S.man;
    var head = pageHead('扫读', '技术互助',
      '这里只做技术互助与能力互补，不涉及设备买卖、报价与商务对接。');
    var f = filterable(head, m.services || [], {
      placeholder: '按名称 / 技能 / 想一起做的内容 / 登记人过滤',
      empty: '没有匹配的条目。',
      match: function (s, q) {
        var mem = byId(m.members, s.owner);
        return (s.name + ' ' + (s.skills || []).join(' ') + ' ' + (s.wants || []).join(' ') + ' ' +
          (mem ? mem.name : '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (s) { return serviceRow(s, m); }
    });
    f.appendChild(el('p', 'disc',
      '技术互助只展示信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷；条目由本人提供并自负其责。'));
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function resourceRow(r, api) {
    var li = el('li', 'row');
    li.appendChild(el('span', 'row-date', KIND_LABEL[r.kind] || r.kind || '资源'));
    li.appendChild(outLink(r.url, r.title, 'row-title'));
    li.appendChild(el('span', 'row-words', ''));
    li.appendChild(el('p', 'row-sum', r.note || ''));
    var tags = el('p', 'row-tags');
    for (var ti = 0; ti < (r.tags || []).length; ti++) {
      if (ti) tags.appendChild(document.createTextNode(' '));
      var tag = r.tags[ti];
      var a = el('a', 'tag', tag);
      /* 可点：JS 在时按标签过滤本页；无 JS 时退化为全站搜索（# 前缀由 CSS ::before 提供） */
      a.setAttribute('href', '#/search/' + encodeURIComponent(tag));
      a.setAttribute('data-tag', tag);
      if (a.addEventListener) {
        a.addEventListener('click', function (ev) {
          if (!api || !api.setFilter || !this.getAttribute) return;
          if (ev.preventDefault) ev.preventDefault();
          api.setFilter(this.getAttribute('data-tag'));
        });
      }
      tags.appendChild(a);
    }
    var meta = r.meta || {};
    if (meta.stars !== null && meta.stars !== undefined) {
      tags.appendChild(document.createTextNode(' · ★' + num(meta.stars)));
    }
    var chip = codeChip(r.code);
    if (chip) tags.appendChild(chip);
    li.appendChild(tags);
    return li;
  }

  function viewResources() {
    var m = S.man;
    var head = pageHead('资源', '资源', '书 / 教程 / 工具 / 视频 / 课程 / 路线。点标签可就地过滤。');
    var api = {};
    var f = filterable(head, m.resources || [], {
      tag: 'ol', cls: 'rows', api: api,
      placeholder: '按标题 / 说明 / 标签过滤',
      empty: '没有匹配的资源。',
      match: function (r, q) {
        return (r.title + ' ' + (r.note || '') + ' ' + (r.tags || []).join(' ') + ' ' +
          (r.kind || '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (r) { return resourceRow(r, api); }
    });
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewWeekly(id) {
    var m = S.man;
    if (id) return viewWeeklyItem(id);
    var f = document.createDocumentFragment();
    f.appendChild(pageHead('时间', '周报', '按 ISO 周归档；可以多选周，只看关心的期次。'));

    var items = m.weekly || [];
    var byPeriod = {};
    for (var i = 0; i < items.length; i++) byPeriod[items[i].period || items[i].id] = items[i];

    var sel = {};
    var cellRefs = [];
    var list = el('div', '');
    var allBtn = el('button', 'page-btn', '全部');
    allBtn.setAttribute('type', 'button');

    function renderList() {
      clear(list);
      var picked = Object.keys(sel);
      var shown = 0;
      var ol = el('ol', 'rows');
      for (var j = 0; j < items.length; j++) {
        var w = items[j];
        var key = w.period || w.id;
        if (picked.length && !sel[key]) continue;
        var li = el('li', 'row');
        li.appendChild(el('span', 'row-date', w.period || ''));
        li.appendChild(lnk('#/weekly/' + w.id, w.title, 'row-title'));
        li.appendChild(el('span', 'row-words', (w.merged || []).length + ' 篇'));
        li.appendChild(el('p', 'row-sum', (w.highlights || []).join(' · ')));
        ol.appendChild(li);
        shown++;
      }
      if (shown) list.appendChild(ol);
      else list.appendChild(el('p', 'muted', '没有选中任何一期（点上面的周格子多选）。'));
    }

    /* 周历：按年份铺 1–53 周；有内容的周高亮，可多选 */
    var years = {};
    for (var k = 0; k < items.length; k++) {
      var mm = String(items[k].period || '').match(/^(\d{4})-W(\d{1,2})/);
      if (mm) {
        var y = mm[1];
        (years[y] = years[y] || {})[parseInt(mm[2], 10)] = items[k];
      }
    }
    var ykeys = Object.keys(years).sort();
    if (!ykeys.length) {
      list.appendChild(el('p', 'muted', '还没有周报。'));
    }
    for (var yi = 0; yi < ykeys.length; yi++) {
      var year = ykeys[yi];
      var grid = el('div', 'week-grid');
      var total = 0;
      for (var wk = 1; wk <= 53; wk++) {
        var wItem = years[year][wk];
        var key2 = year + '-W' + (wk < 10 ? '0' + wk : wk);
        var cell = el('button', 'week-cell' + (wItem ? ' has' : ''), String(wk));
        cell.setAttribute('type', 'button');
        cell.setAttribute('data-week', key2);
        if (!wItem) cell.setAttribute('disabled', 'disabled');
        if (wItem && cell.addEventListener) {
          cell.addEventListener('click', (function (kk) {
            return function () {
              if (sel[kk]) delete sel[kk]; else sel[kk] = true;
              this.className = 'week-cell has' + (sel[kk] ? ' on' : '');
              renderList();
            };
          })(key2));
        }
        grid.appendChild(cell);
        cellRefs.push(cell);
        total++;
      }
      f.appendChild(el('p', 'section-h', year + ' 年（点有数据的周，多选）'));
      f.appendChild(grid);
    }

    allBtn.addEventListener && allBtn.addEventListener('click', function () {
      sel = {};
      for (var c = 0; c < cellRefs.length; c++) {
        if (String(cellRefs[c].className).indexOf(' on') >= 0) cellRefs[c].className = 'week-cell has';
      }
      renderList();
    });
    var bar = el('div', 'filters');
    bar.appendChild(allBtn);
    f.appendChild(bar);
    f.appendChild(list);
    renderList();
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }
  function viewPages() {
    var m = S.man;
    var f = document.createDocumentFragment();
    var head = el('header', 'page-head');
    head.appendChild(el('p', 'kicker', '制度'));
    head.appendChild(el('h1', '', '站文档'));
    head.appendChild(el('p', 'lede', '规则、流程与写作规范。'));
    f.appendChild(head);
    var groups = {}, order = [];
    for (var i = 0; i < (m.pages || []).length; i++) {
      var d = m.pages[i];
      var g = d.group || '其它';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(d);
    }
    for (var gi = 0; gi < order.length; gi++) {
      f.appendChild(el('p', 'section-h', order[gi]));
      var grid = el('div', 'grid');
      for (var di = 0; di < groups[order[gi]].length; di++) {
        var p = groups[order[gi]][di];
        var c = el('article', 'card');
        c.appendChild(lnk('#/page/' + p.id, p.title, 'card-title'));
        c.appendChild(el('p', 'card-note', String(p.text || '').slice(0, 80)));
        grid.appendChild(c);
      }
      f.appendChild(grid);
    }
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewJoin() {
    var m = S.man, g = (m.site && m.site.group) || {};
    var f = document.createDocumentFragment();
    var head = el('header', 'page-head');
    head.appendChild(el('p', 'kicker', '加入'));
    head.appendChild(el('h1', '', '加入我们'));
    head.appendChild(el('p', 'lede', g.intro || m.site.tagline || ''));
    f.appendChild(head);

    var info = kv([
      ['群名', g.name],
      ['QQ 群', g.qq],
      ['验证', g.join]
    ]);
    if (info) f.appendChild(info);
    var btns = el('p', 'chips');
    if (g.join_url) btns.appendChild(outLink(g.join_url, '申请加群', 'chip'));
    if (m.site.repo_url) btns.appendChild(outLink(m.site.repo_url, '投稿仓库', 'chip'));
    f.appendChild(btns);

    if ((g.rules || []).length) {
      f.appendChild(el('h2', '', '群规'));
      var ol = el('ol');
      for (var i = 0; i < g.rules.length; i++) ol.appendChild(el('li', '', g.rules[i]));
      f.appendChild(ol);
    }
    if ((g.features || []).length) {
      f.appendChild(el('h2', '', '这里有什么'));
      var ul = el('ul');
      for (var j = 0; j < g.features.length; j++) ul.appendChild(el('li', '', g.features[j]));
      f.appendChild(ul);
    }
    if ((g.timeline || []).length) {
      f.appendChild(el('h2', '', '站点时间线'));
      var tl = el('ul', 'timeline');
      for (var k = 0; k < g.timeline.length; k++) {
        var li = el('li');
        li.appendChild(el('span', 't-date', g.timeline[k].date));
        li.appendChild(document.createTextNode(g.timeline[k].text));
        tl.appendChild(li);
      }
      f.appendChild(tl);
    }
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }


  function viewSearch(q) {
    var f = document.createDocumentFragment();
    var needle = String(q || '').trim();
    f.appendChild(pageHead('辅助', '搜索：' + (needle || '（空）'), '结果按类型分组，可筛选、可分页。'));
    return fragment('search-index.json').then(function (raw) {
      var idx = [];
      try { idx = JSON.parse(raw) || []; } catch (e) { idx = []; }
      var low = needle.toLowerCase();
      var hits = [];
      for (var i = 0; i < idx.length; i++) {
        var it = idx[i] || {};
        var hay = (String(it.title || '') + ' ' + String(it.summary || '') + ' ' +
          String(it.text || '') + ' ' + ((it.tags || []).join(' ')) + ' ' +
          String(it.type || '')).toLowerCase();
        if (!low || hay.indexOf(low) >= 0) hits.push(it);
      }

      var TYPES = ['文章', '项目', '成员', '词条', '互助', '资源', '周报', '文档'];
      var counts = {};
      for (var hi = 0; hi < hits.length; hi++) {
        var ty = hits[hi].type || '其他';
        counts[ty] = (counts[ty] || 0) + 1;
      }

      var active = '';
      var page = 0;
      var PER = 10;
      var chips = el('div', 'chips');
      var list = el('div', 'search-list');
      var pager = el('nav', 'pager');

      function row(it) {
        var li = el('li', 'row search-row');
        li.appendChild(el('span', 'row-type', it.type || '其他'));
        var url = String(it.url || '');
        var a;
        if (/^https?:/i.test(url)) {
          a = outLink(url, it.title || url, 'row-title');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        } else {
          a = lnk(url || '#/library', it.title || '', 'row-title');
        }
        li.appendChild(a);
        li.appendChild(el('span', 'row-words', ''));
        li.appendChild(el('p', 'row-sum', it.summary || ''));
        var tg = el('p', 'row-tags');
        for (var ti = 0; ti < (it.tags || []).length; ti++) {
          if (ti) tg.appendChild(document.createTextNode(' '));
          tg.appendChild(el('span', 'tag', it.tags[ti]));
        }
        li.appendChild(tg);
        return li;
      }

      function chip(label, value, n, on) {
        var c = el('span', on ? 'chip on' : 'chip', label + ' (' + n + ')');
        c.setAttribute('data-type', value);
        if (c.addEventListener) {
          c.addEventListener('click', function () {
            active = (active === value) ? '' : value;
            page = 0;
            render();
          });
        }
        return c;
      }

      function render() {
        clear(chips);
        chips.appendChild(chip('全部', '', hits.length, active === ''));
        for (var k = 0; k < TYPES.length; k++) {
          if (!counts[TYPES[k]]) continue;
          chips.appendChild(chip(TYPES[k], TYPES[k], counts[TYPES[k]], active === TYPES[k]));
        }
        var filtered = active ? hits.filter(function (it) { return (it.type || '其他') === active; }) : hits;
        var pages = Math.max(1, Math.ceil(filtered.length / PER));
        if (page > pages - 1) page = pages - 1;

        clear(list);
        if (!filtered.length) {
          list.appendChild(el('p', 'muted', '没有结果。'));
        } else {
          var ol = el('ol', 'rows');
          var from = page * PER;
          var to = Math.min(filtered.length, from + PER);
          for (var j = from; j < to; j++) ol.appendChild(row(filtered[j]));
          list.appendChild(ol);
        }

        clear(pager);
        if (pages > 1) {
          var prev = el('button', 'page-btn', '← 上一页');
          prev.setAttribute('type', 'button');
          var next = el('button', 'page-btn', '下一页 →');
          next.setAttribute('type', 'button');
          if (prev.addEventListener) {
            prev.addEventListener('click', function () { if (page > 0) { page--; render(); } });
          }
          if (next.addEventListener) {
            next.addEventListener('click', function () { if (page < pages - 1) { page++; render(); } });
          }
          pager.appendChild(prev);
          pager.appendChild(el('span', 'muted', '第 ' + (page + 1) + ' / ' + pages + ' 页 · 共 ' + filtered.length + ' 条'));
          pager.appendChild(next);
        }
      }

      render();
      f.appendChild(chips);
      f.appendChild(list);
      f.appendChild(pager);
      setToc([], '', 'map.svg');
      return f;
    });
  }
  /* 语言切换只改 query，保持当前滚动位置（切换前记下，渲染后再恢复） */
  function langSwitchScroll() {
    S._langScroll = (typeof window !== 'undefined' && window.scrollY) ? window.scrollY : null;
  }

  function viewPost(slug, anchor, q) {
    var m = S.man;
    var p = bySlug(m.posts, slug);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(el('h1', '', '没有这篇文章'));
      f.appendChild(el('p', 'muted', 'slug：' + String(slug)));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    /* 多语言（phase 1：仅 posts，白名单 zh/en）。
       lang 只来自白名单：非法值（fr / ../x / javascript: 等）或不在 langs 里 → 回落 default_lang，
       不做跳转、不接受任意 query 影响文件路径。 */
    var reqLang = (q && q.lang) ? String(q.lang) : '';
    var defaultLang = p.default_lang || 'zh';
    var useLang = defaultLang;
    if (reqLang && (reqLang === 'zh' || reqLang === 'en') && p.langs && p.langs[reqLang]) {
      useLang = reqLang;
    }
    document.documentElement.setAttribute('lang', useLang);

    /* 选 variant 字段（无 langs 时用顶层 zh 字段，保证旧前端零影响） */
    var variant = (p.langs && p.langs[useLang]) ? p.langs[useLang] : null;
    var htmlPath = variant ? variant.html : p.html;
    var shownTitle = variant ? variant.title : p.title;
    var shownSummary = variant ? variant.summary : p.summary;
    var shownTags = variant ? variant.tags : p.tags;
    var shownWords = variant ? variant.words : p.words;

    var mem = byId(m.members, p.author);
    f.appendChild(crumb([['文章库', '#/library'], [shownTitle, '']]));
    f.appendChild(el('h1', '', shownTitle));

    /* 语言切换：仅当存在多于一种语言时显示在标题下方 */
    if (p.langs && Object.keys(p.langs).length > 1) {
      var sw = el('div', 'lang-switch');
      ['zh', 'en'].forEach(function (ln) {
        if (!p.langs[ln]) return;
        var label = ln === 'zh' ? '中文' : 'English';
        if (ln === useLang) {
          sw.appendChild(el('span', 'lang-opt on', label));
        } else {
          var a = lnk('#/post/' + slug + '?lang=' + ln, label, 'lang-opt');
          if (a.addEventListener) a.addEventListener('click', langSwitchScroll);
          sw.appendChild(a);
        }
      });
      f.appendChild(sw);
    }

    var by = el('div', 'byline');
    if (mem) {
      var who = lnk('#/member/' + mem.id, '', '');
      var av = avatarOf(mem);
      if (av) who.appendChild(av);
      who.appendChild(document.createTextNode(mem.name));
      by.appendChild(who);
    } else if (p.author) {
      by.appendChild(el('span', '', p.author));
    }
    by.appendChild(lnk('#/date/' + encodeURIComponent(String(p.date).slice(0, 10)),
      String(p.date).slice(0, 10), 'date-link'));
    by.appendChild(el('span', '', num(shownWords) + ' 字'));
    by.appendChild(el('span', '', '约 ' + minutes(shownWords) + ' 分钟'));
    if (p.updated && p.updated !== p.date) by.appendChild(el('span', '', '更新于 ' + p.updated));
    f.appendChild(by);

    f.appendChild(el('p', 'lede', shownSummary || ''));
    if (p.ai_summary) f.appendChild(summaryCard(p.ai_summary));

    /* 文章形态：只由真实内容决定（标签 / 是否有图集块） */
    var form = 'reading';
    for (var ti = 0; ti < (shownTags || []).length; ti++) {
      if (FORM_BY_TAG[shownTags[ti]]) { form = FORM_BY_TAG[shownTags[ti]]; break; }
    }
    setForm(form);

    return proseFragment(htmlPath).then(function (prose) {
      f.appendChild(prose);
      var tail = el('div', 'post-tail');
      if ((shownTags || []).length) tail.appendChild(tagLine(shownTags));
      tail.appendChild(el('p', 'license', '许可：' + (p.license || m.site.license || '见站点默认许可')));
      if ((p.attachments || []).length) {
        tail.appendChild(el('p', 'section-h', '附件'));
        var ul = el('ul', 'attach-list');
        for (var ai = 0; ai < p.attachments.length; ai++) {
          ul.appendChild(attachCard(p.attachments[ai]));
        }
        tail.appendChild(ul);
      }
      f.appendChild(tail);

      /* 系列上/下章 */
      if (p.series) {
        var s = byId(m.series, p.series);
        if (s) {
          var idx = -1;
          for (var si = 0; si < s.posts.length; si++) { if (s.posts[si].slug === p.slug) idx = si; }
          var pager = el('nav', 'pager');
          if (idx > 0) pager.appendChild(lnk('#/post/' + s.posts[idx - 1].slug, '← ' + s.posts[idx - 1].title));
          else pager.appendChild(el('span', 'muted', ''));
          if (idx >= 0 && idx < s.posts.length - 1) {
            pager.appendChild(lnk('#/post/' + s.posts[idx + 1].slug, s.posts[idx + 1].title + ' →'));
          }
          f.appendChild(pager);
        }
      }

      setToc(p.toc, 'post/' + p.slug, p.map);
      if (anchor) scrollToId(anchor);
      /* 语言切换后恢复滚动位置（仅切换时 S._langScroll 非 null） */
      if (S._langScroll !== null && S._langScroll !== undefined) {
        window.scrollTo(0, S._langScroll);
        S._langScroll = null;
      }
      return f;
    });
  }

  function viewProject(id) {
    var m = S.man;
    var p = byId(m.projects, id);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(el('h1', '', '没有这个项目'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['项目', '#/projects'], [p.name, '']]));
    var h = el('h1');
    h.appendChild(document.createTextNode(p.name + ' '));
    h.appendChild(statusBadge(p.status));
    f.appendChild(h);
    f.appendChild(el('p', 'lede', p.one_liner));

    var btns = el('p', 'chips');
    if (p.repo) btns.appendChild(outLink(p.repo, '仓库', 'chip'));
    if (p.homepage) btns.appendChild(outLink(p.homepage, '文档 / 主页', 'chip'));
    f.appendChild(btns);

    var meta = p.meta || {};
    var metrics = el('div', 'metrics');
    var has = 0;
    if (meta.stars !== null && meta.stars !== undefined) { metrics.appendChild(metric(meta.stars, 'stars')); has++; }
    if (meta.forks !== null && meta.forks !== undefined) { metrics.appendChild(metric(meta.forks, 'forks')); has++; }
    if (meta.updated_at) { metrics.appendChild(metric(String(meta.updated_at).slice(0, 10), '最近提交')); has++; }
    if (has) f.appendChild(metrics);

    var bar = meta.languages_pct ? langBar(meta.languages_pct, 4) : null;
    if (bar) { f.appendChild(el('p', 'section-h', '语言占比（构建期抓取）')); f.appendChild(bar); }

    var mem = byId(m.members, p.owner);
    var info = kv([
      ['仓库', p.repo, p.repo],
      ['主页', p.homepage, p.homepage],
      ['主语言', meta.language],
      ['许可', p.license || meta.license],
      ['维护者', mem ? mem.name : p.owner, mem ? '#/member/' + mem.id : ''],
      ['平台', (p.platforms || []).join('、')],
      ['最近提交', meta.updated_at ? String(meta.updated_at).slice(0, 10) : '']
    ]);
    if (info) { f.appendChild(el('p', 'section-h', '仓库信息')); f.appendChild(info); }

    /* 里程碑时间线：有真实 milestones 才画 */
    if ((p.milestones || []).length) {
      f.appendChild(el('p', 'section-h', '里程碑'));
      var tl = el('ul', 'timeline');
      for (var mi = 0; mi < p.milestones.length; mi++) {
        var ms = p.milestones[mi];
        var li = el('li');
        li.appendChild(el('span', 't-date', ms.date || ''));
        li.appendChild(document.createTextNode(ms.text || ''));
        if (ms.why) li.appendChild(el('span', 'muted', '（' + ms.why + '）'));
        tl.appendChild(li);
      }
      f.appendChild(tl);
    }

    /* 相关文章：按标签（语言/平台）真实相交，取不到就留空，不编造 */
    var keys = {};
    var langs = (p.languages || []).concat(p.platforms || []);
    var li2;
    for (li2 = 0; li2 < langs.length; li2++) keys[langs[li2]] = 1;
    var rel = [];
    for (var pi = 0; pi < m.posts.length; pi++) {
      var post = m.posts[pi];
      for (var tj = 0; tj < (post.tags || []).length; tj++) {
        if (keys[post.tags[tj]]) { rel.push(post); break; }
      }
    }
    if (rel.length) {
      f.appendChild(el('p', 'section-h', '相关文章'));
      var ol = el('ol', 'rows');
      for (var ri = 0; ri < rel.length && ri < 6; ri++) ol.appendChild(postRow(rel[ri], m.members));
      f.appendChild(ol);
    }

    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewMember(id) {
    var m = S.man;
    var mem = byId(m.members, id);
    var f = document.createDocumentFragment();
    if (!mem) {
      f.appendChild(el('h1', '', '没有这位成员'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['成员', '#/members'], [mem.name, '']]));
    var hero = el('div', 'member-hero');
    var av = avatarOf(mem);
    if (av) hero.appendChild(av); else hero.appendChild(el('div', 'avatar'));
    var right = el('div');
    var h = el('h1');
    h.appendChild(document.createTextNode(mem.name));
    right.appendChild(h);
    right.appendChild(el('p', 'p-role', mem.role || '群友'));
    if (mem.signature) right.appendChild(el('p', 'card-note', mem.signature));
    var chips = el('p', 'chips');
    for (var si = 0; si < (mem.skills || []).length; si++) chips.appendChild(el('span', 'chip', mem.skills[si]));
    right.appendChild(chips);
    hero.appendChild(right);

    var np = 0, npr = 0;
    for (var i = 0; i < m.posts.length; i++) if (m.posts[i].author === mem.id) np++;
    for (var j = 0; j < (m.projects || []).length; j++) {
      var pr = m.projects[j];
      if (pr.owner === mem.id || (pr.contributors || []).indexOf(mem.id) >= 0) npr++;
    }
    var bigs = el('div', 'mh-nums');
    bigs.appendChild(el('div', 'big-num', num(np) + '篇文章'));
    bigs.appendChild(el('div', 'big-num', num(npr) + '个项目'));
    if (mem.joined) bigs.appendChild(el('div', 'big-num', '加入 ' + mem.joined));
    hero.appendChild(bigs);
    f.appendChild(hero);

    var ownPosts = [];
    for (var k = 0; k < m.posts.length; k++) {
      if (m.posts[k].author === mem.id || (m.posts[k].co_authors || []).indexOf(mem.id) >= 0) {
        ownPosts.push(m.posts[k]);
      }
    }
    if (!ownPosts.length) {
      f.appendChild(el('p', 'section-h', '文章'));
      f.appendChild(el('p', 'muted', '还没有文章。'));
    } else if (ownPosts.length > 6) {
      /* 文章多时自动加“本页搜索 + 滚动区”，少时不占空间 */
      f.appendChild(filterable(el('p', 'section-h', '文章'), ownPosts, {
        tag: 'ol',
        cls: 'rows rows-scroll',
        placeholder: '在这位成员的文章中搜索标题 / 摘要 / 标签',
        empty: '没有匹配的文章。',
        match: function (x, q) {
          return (x.title + ' ' + (x.summary || '') + ' ' + (x.tags || []).join(' '))
            .toLowerCase().indexOf(q) >= 0;
        },
        render: function (x) { return postRow(x, m.members); }
      }));
    } else {
      f.appendChild(el('p', 'section-h', '文章'));
      var ol = el('ol', 'rows');
      for (var k2 = 0; k2 < ownPosts.length; k2++) {
        ol.appendChild(postRow(ownPosts[k2], m.members));
      }
      f.appendChild(ol);
    }

    var mine = [];
    for (var pj = 0; pj < (m.projects || []).length; pj++) {
      var p = m.projects[pj];
      if (p.owner === mem.id || (p.contributors || []).indexOf(mem.id) >= 0) mine.push(p);
    }
    if (mine.length) {
      f.appendChild(el('p', 'section-h', '参与项目'));
      var ul2 = el('ul');
      for (var pi2 = 0; pi2 < mine.length; pi2++) {
        var lix = el('li');
        lix.appendChild(lnk('#/project/' + mine[pi2].id, mine[pi2].name));
        lix.appendChild(document.createTextNode(' — ' + mine[pi2].one_liner));
        ul2.appendChild(lix);
      }
      f.appendChild(ul2);
    }

    var svcs = [];
    for (var si2 = 0; si2 < (m.services || []).length; si2++) {
      if (m.services[si2].owner === mem.id) svcs.push(m.services[si2]);
    }
    if (svcs.length) {
      f.appendChild(el('p', 'section-h', '技术互助'));
      var ul3 = el('ul');
      for (var si3 = 0; si3 < svcs.length; si3++) {
        var li3 = el('li');
        li3.appendChild(lnk('#/service/' + svcs[si3].id, svcs[si3].name));
        li3.appendChild(document.createTextNode(' — ' + (svcs[si3].skills || []).join('、')));
        ul3.appendChild(li3);
      }
      f.appendChild(ul3);
    }

    /* 联系方式放最后，并注明「本人授权公开」 */
    var links = mem.links || {};
    var keys = Object.keys(links);
    if (keys.length) {
      f.appendChild(el('p', 'section-h', '联系方式（本人授权公开）'));
      var dl = el('dl', 'kv');
      for (var ki = 0; ki < keys.length; ki++) {
        dl.appendChild(el('dt', '', CONTACT_LABEL[keys[ki]] || keys[ki]));
        var dd = el('dd');
        var v = links[keys[ki]];
        if (keys[ki] === 'email') dd.appendChild(outLink('mailto:' + v, v));
        else dd.appendChild(outLink(v, v));
        dl.appendChild(dd);
      }
      f.appendChild(dl);
    }
    setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewService(id, anchor) {
    var m = S.man;
    var s = byId(m.services, id);
    var f = document.createDocumentFragment();
    if (!s) {
      f.appendChild(el('h1', '', '没有这条互助'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    var mem = byId(m.members, s.owner);
    f.appendChild(crumb([['技术互助', '#/services'], [s.name, '']]));
    var h = el('h1');
    h.appendChild(document.createTextNode(s.name + ' '));
    h.appendChild(statusBadge(s.status, SERVICE_STATUS_LABEL));
    f.appendChild(h);

    var who = el('p', 'row-tags');
    who.appendChild(el('b', '', '登记人'));
    if (mem) who.appendChild(lnk('#/member/' + mem.id, mem.name));
    else who.appendChild(document.createTextNode(s.owner));
    who.appendChild(document.createTextNode(' · 更新 ' + (s.updated || '—')));
    f.appendChild(who);

    f.appendChild(el('p', 'section-h', '能帮上什么'));
    f.appendChild(el('p', 'lede', (s.skills || []).join('、') || '（未填写）'));
    if ((s.wants || []).length) {
      f.appendChild(el('p', 'section-h', '想一起做什么'));
      f.appendChild(el('p', '', (s.wants || []).join('、')));
    }

    return proseFragment(s.html).then(function (prose) {
      f.appendChild(prose);

      /* 「怎么联系」面板：右栏被站点导航占用（§2 硬约束），这里放在正文之后 */
      f.appendChild(el('p', 'section-h', '怎么联系'));
      var pairs = [['登记人', mem ? mem.name : s.owner, mem ? '#/member/' + mem.id : '']];
      if (s.rate) pairs.push(['协作方式（不谈价格）', s.rate]);
      for (var ci = 0; ci < (s.contact || []).length; ci++) {
        var key = s.contact[ci];
        var val = mem && mem.links ? mem.links[key] : '';
        if (val) pairs.push([CONTACT_LABEL[key] || key, val, key === 'email' ? 'mailto:' + val : val]);
      }
      var info = kv(pairs);
      if (info) f.appendChild(info);
      f.appendChild(el('p', 'disc',
        '本站只展示这条信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。'));

      setToc(s.toc, 'service/' + s.id, s.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }


  function viewTopic(id, anchor) {
    var m = S.man;
    var t = byId(m.topics, id);
    var f = document.createDocumentFragment();
    if (!t) {
      f.appendChild(el('h1', '', '没有这个词条'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['主题词条', '#/topics'], [t.title, '']]));
    var h = el('h1');
    h.appendChild(document.createTextNode(t.title + ' '));
    h.appendChild(el('span', 'badge', (t.resolved || []).length + ' 篇'));
    f.appendChild(h);
    f.appendChild(el('p', 'define', t.summary || ''));

    var meta = el('p', 'row-tags');
    for (var mi = 0; mi < (t.tags || []).length; mi++) {
      meta.appendChild(el('span', 'tag', t.tags[mi]));
      meta.appendChild(document.createTextNode(' '));
    }
    if (t.file) meta.appendChild(el('span', 'muted', '来源 ' + t.file));
    f.appendChild(meta);

    /* 本词条要点：直接可跳，不用先读全文 */
    if ((t.toc || []).length) {
      f.appendChild(el('p', 'section-h', '要点'));
      var pts = el('div', 'topic-points');
      for (var pi = 0; pi < t.toc.length; pi++) {
        var pt = t.toc[pi];
        if (!pt || !pt.id) continue;
        var pa = lnk('#/topic/' + t.id + '/' + pt.id, pt.text, 'topic-point');
        pts.appendChild(pa);
      }
      f.appendChild(pts);
    }

    var g = relGraph(t, m.posts, m.projects, m.topics);
    if (g) { f.appendChild(el('p', 'section-h', '关系图')); f.appendChild(g); }

    return proseFragment(t.html).then(function (prose) {
      f.appendChild(prose);

      var resolved = [];
      for (var ri = 0; ri < (t.resolved || []).length; ri++) {
        var rp = bySlug(m.posts, t.resolved[ri]);
        if (rp) resolved.push(rp);
      }
      /* 同标签文章：词条没显式挂文章时也能自动聚合（实用性的关键） */
      var byTag = [];
      for (var qi = 0; qi < (m.posts || []).length; qi++) {
        var qp = m.posts[qi];
        var shared = false;
        for (var ti = 0; ti < (t.tags || []).length; ti++) {
          if ((qp.tags || []).indexOf(t.tags[ti]) >= 0) shared = true;
        }
        if (shared && resolved.indexOf(qp) < 0) byTag.push(qp);
      }

      if (resolved.length) {
        f.appendChild(el('p', 'section-h', '相关文章'));
        var ol = el('ol', 'rows');
        for (var i = 0; i < resolved.length; i++) ol.appendChild(postRow(resolved[i], m.members));
        f.appendChild(ol);
      }
      if (byTag.length) {
        f.appendChild(el('p', 'section-h', '同标签文章'));
        var ol2 = el('ol', 'rows');
        for (var j = 0; j < byTag.length; j++) ol2.appendChild(postRow(byTag[j], m.members));
        f.appendChild(ol2);
      }
      if (!resolved.length && !byTag.length) {
        f.appendChild(el('p', 'muted',
          '这个词条还没有文章归入：写文章时在 front matter 里加上 '
          + (t.tags || []).map(function (x) { return '#' + x; }).join(' / ')
          + ' 就会自动出现。'));
      }

      /* 相关词条：带一句摘要，而不只是一串名字 */
      var rel = t.related || [];
      if (rel.length) {
        f.appendChild(el('p', 'section-h', '相关词条'));
        var g2 = el('div', 'grid');
        for (var k = 0; k < rel.length; k++) {
          var rt = byId(m.topics, rel[k]);
          if (!rt) continue;
          var card = el('article', 'card');
          card.appendChild(lnk('#/topic/' + rt.id, rt.title, 'card-title'));
          card.appendChild(el('p', 'card-note', rt.summary || ''));
          g2.appendChild(card);
        }
        f.appendChild(g2);
      }

      /* 编辑入口：直接给仓库编辑链接，作者知道去哪儿补 */
      var repo = m.site.repo_url || '';
      if (repo && t.file) {
        var edit = outLink(repo.replace(/\/$/, '') + '/edit/master/site/' + t.file.replace(/^\/+/, ''),
          '在仓库里编辑这个词条', 'disc-link');
        edit.setAttribute('target', '_blank');
        edit.setAttribute('rel', 'noopener');
        f.appendChild(el('p', 'disc', '')).appendChild(edit);
      } else {
        f.appendChild(el('p', 'disc', '觉得缺了什么？提 PR 补词条，或把稿子交给群管理代投。'));
      }

      setToc(t.toc, 'topic/' + t.id, t.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }
  function viewWeeklyItem(id, anchor) {
    var m = S.man;
    var w = byId(m.weekly, id);
    var f = document.createDocumentFragment();
    if (!w) {
      f.appendChild(el('h1', '', '没有这一期'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['周报', '#/weekly'], [w.period || w.title, '']]));
    f.appendChild(el('h1', '', w.title));
    f.appendChild(el('p', 'lede', w.period || ''));

    var grid = el('div', 'metrics');
    grid.appendChild(metric((w.merged || []).length, '合并文章'));
    grid.appendChild(metric((w.highlights || []).length, '要点'));
    grid.appendChild(metric((w.contributors || []).length, '参与成员'));
    f.appendChild(grid);

    if ((w.highlights || []).length) {
      f.appendChild(el('p', 'section-h', '本期时间线'));
      var tl = el('ul', 'timeline');
      for (var i = 0; i < w.highlights.length; i++) tl.appendChild(el('li', '', w.highlights[i]));
      f.appendChild(tl);
    }

    if ((w.merged || []).length) {
      f.appendChild(el('p', 'section-h', '合并的文章'));
      var ol = el('ol', 'rows');
      for (var j = 0; j < w.merged.length; j++) {
        var p = bySlug(m.posts, w.merged[j]);
        if (p) ol.appendChild(postRow(p, m.members));
      }
      f.appendChild(ol);
    }

    if ((w.contributors || []).length) {
      f.appendChild(el('p', 'section-h', '参与成员'));
      var ul = el('ul');
      for (var k = 0; k < w.contributors.length; k++) {
        var mem = byId(m.members, w.contributors[k]);
        var li = el('li');
        if (mem) li.appendChild(lnk('#/member/' + mem.id, mem.name));
        else li.appendChild(document.createTextNode(w.contributors[k]));
        ul.appendChild(li);
      }
      f.appendChild(ul);
    }

    return proseFragment(w.html).then(function (prose) {
      f.appendChild(prose);
      var idx = -1;
      for (var i2 = 0; i2 < m.weekly.length; i2++) { if (m.weekly[i2].id === w.id) idx = i2; }
      var pager = el('nav', 'pager');
      if (idx > 0) pager.appendChild(lnk('#/weekly/' + m.weekly[idx - 1].id, '← ' + m.weekly[idx - 1].period));
      else pager.appendChild(el('span', 'muted', ''));
      if (idx >= 0 && idx < m.weekly.length - 1) {
        pager.appendChild(lnk('#/weekly/' + m.weekly[idx + 1].id, m.weekly[idx + 1].period + ' →'));
      }
      f.appendChild(pager);
      setToc(w.toc, 'weekly/' + w.id, w.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }

  function docTree(curId) {
    var m = S.man;
    var d = el('details', 'doc-tree');
    d.setAttribute('open', 'open');
    d.appendChild(el('summary', '', '站文档目录'));
    var groups = {}, order = [];
    for (var i = 0; i < (m.pages || []).length; i++) {
      var p = m.pages[i];
      var g = p.group || '其它';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(p);
    }
    for (var gi = 0; gi < order.length; gi++) {
      d.appendChild(el('p', 'dt-group', order[gi]));
      for (var pi = 0; pi < groups[order[gi]].length; pi++) {
        var pg = groups[order[gi]][pi];
        d.appendChild(lnk('#/page/' + pg.id, pg.title, pg.id === curId ? 'cur' : ''));
      }
    }
    return d;
  }

  function viewPage(id, anchor) {
    var m = S.man;
    var p = byId(m.pages, id);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(el('h1', '', '没有这个文档页'));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['站文档', '#/pages'], [p.title, '']]));
    f.appendChild(el('h1', '', p.title));
    /* 左栏必须是本文目录（§2），文档树因此放在正文顶部 */
    f.appendChild(docTree(p.id));
    return proseFragment(p.html).then(function (prose) {
      f.appendChild(prose);
      if (p.group_link) {
        var btns = el('p', 'chips');
        btns.appendChild(outLink(p.group_link, '相关行动', 'chip'));
        f.appendChild(btns);
      }
      setToc(p.toc, 'page/' + p.id, p.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }

  function scrollToId(id, tries) {
    tries = tries || 0;
    var t = document.getElementById ? document.getElementById(id) : null;
    if (!t) {
      /* 视图函数在 fragment 被 append 之前就调用了这里；等下一轮再找 */
      if (tries < 5 && typeof setTimeout === 'function') {
        setTimeout(function () { scrollToId(id, tries + 1); }, 0);
      }
      return;
    }
    /* sticky 顶栏会盖住标题：用顶栏实际高度做偏移，而不是裸 scrollIntoView() */
    var bar = document.querySelector ? document.querySelector('.topbar') : null;
    var offset = (bar && bar.offsetHeight ? bar.offsetHeight : 48) + 12;
    var y = t.getBoundingClientRect().top + (window.pageYOffset || 0) - offset;
    if (window.scrollTo) window.scrollTo(0, y > 0 ? y : 0);
  }

  function setForm(form) {
    if (!form) return;
    if (document.body && document.body.setAttribute) document.body.setAttribute('data-form', form);
  }

  /* ---------- 路由 ---------- */

  function route() {
    var h = String((typeof location !== 'undefined' && location.hash) || '');
    h = h.replace(/^#\/?/, '');
    var q = {}, qi = h.indexOf('?');
    if (qi >= 0) {
      var qs = h.slice(qi + 1);
      h = h.slice(0, qi);
      var parts = qs.split('&');
      for (var i = 0; i < parts.length; i++) {
        var kvp = parts[i].split('=');
        if (kvp[0]) q[decodeURIComponent(kvp[0])] = decodeURIComponent(kvp[1] || '');
      }
    }
    var seg = [];
    var raw = h.split('/');
    for (var j = 0; j < raw.length; j++) { if (raw[j] !== '') seg.push(decodeURIComponent(raw[j])); }
    return { seg: seg, q: q };
  }

  function goto(h) { if (typeof location !== 'undefined') location.hash = h; }

  var VIEWS = {
    home: function () { return viewHome(); },
    date: function (r) { return viewByDate(r.seg[1] || ''); },
    library: function (r) { return viewLibrary(r.q); },
    posts: function () { return viewLibrary({}); },
    knowledge: function () { return viewKnowledge(); },
    topics: function () { return viewTopics(); },
    topic: function (r) { return viewTopic(r.seg[1], r.seg[2]); },
    post: function (r) { return viewPost(r.seg[1], r.seg[2], r.q); },
    projects: function () { return viewProjects(); },
    project: function (r) { return viewProject(r.seg[1]); },
    resources: function () { return viewResources(); },
    members: function () { return viewMembers(); },
    member: function (r) { return viewMember(r.seg[1]); },
    services: function () { return viewServices(); },
    service: function (r) { return viewService(r.seg[1], r.seg[2]); },
    weekly: function (r) { return viewWeekly(r.seg[1]); },
    pages: function () { return viewPages(); },
    page: function (r) { return viewPage(r.seg[1], r.seg[2]); },
    join: function () { return viewJoin(); },
    search: function (r) { return viewSearch(r.seg[1] || ''); }
  };

  function buildFooter() {
    var foot = $('#footer');
    if (!foot) return;
    var m = S.man;
    /* 授权分层声明是构建期注入的静态 span（id 以 license-notice 开头），
     * JS 只重画链接行，不清它——否则干净构建里这三行会被 clear() 抹掉。 */
    var keep = [];
    var kids = foot.children || [];
    for (var ki = 0; ki < kids.length; ki++) {
      var c = kids[ki];
      if (c && c.id && c.id.indexOf('license-notice') === 0) keep.push(c);
    }
    clear(foot);
    foot.appendChild(el('span', '', '构建于 ' + String(m.built_at || '').slice(0, 10)));
    var rss = lnk('feed.xml', 'RSS'); foot.appendChild(rss);
    foot.appendChild(lnk('sitemap.xml', 'Sitemap'));
    foot.appendChild(lnk('llms.txt', 'llms.txt'));
    if (m.site.repo_url) foot.appendChild(outLink(m.site.repo_url, '仓库'));
    if (m.site.license) foot.appendChild(el('span', '', '默认许可 ' + m.site.license));
    var credit = el('span', '', 'Powered by ');
    credit.appendChild(outLink('https://gitee.com/snoware', 'snoware'));
    credit.appendChild(el('span', '', ' & '));
    credit.appendChild(outLink('https://sml.swebase.cn', 'SML'));
    foot.appendChild(credit);
    for (var kj = 0; kj < keep.length; kj++) foot.appendChild(keep[kj]);
  }

  function render() {
    return loadManifest().then(function (m) {
      S.man = m;
      var r = route();
      var key = r.seg[0] || 'home';
      S.page = key;
      document.title = (m.site.title || '') + ((key === 'library' || key === 'home') ? '' : ' · ' + (NAV_LABEL[key] || key));
      if (document.body && document.body.setAttribute) document.body.setAttribute('data-page', key);
      buildSiteNav(key);
      setForm('reading');
      /* 每次换页先清空上一页的目录，避免「文章 → 索引」时左栏残留旧章节 */
      setToc([], '', '');
      var fn = VIEWS[key];
      var view = fn ? fn(r) : null;
      if (!view) {
        var f0 = document.createDocumentFragment();
        f0.appendChild(el('h1', '', '页面不存在'));
        f0.appendChild(el('p', 'muted', String(key)));
        setToc([], '', '');
        view = Promise.resolve(f0);
      }
      return view.then(function (fr) {
        var viewEl = $('#view');
        if (viewEl) { clear(viewEl); viewEl.appendChild(fr); }
        buildToc();
        buildFooter();
        var brand = $('#brand-title');
        if (brand) {
          clear(brand);
          brand.appendChild(document.createTextNode(m.site.title || ''));
        }
        var av = $('#brand-avatar');
        if (av) {
          var src = safeUrl(m.site.avatar);
          if (src) av.setAttribute('src', src); else av.setAttribute('src', '');
        }
        return true;
      });
    });
  }

  /* ---------- 启动 ---------- */

  function boot() {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('hashchange', function () { render(); });
    }
    /* 桌面端左侧目录收起；状态存 localStorage，不依赖构建 */
    var tt = $('#toc-toggle');
    if (tt && tt.addEventListener) {
      var tocKey = 'recblog-toc-collapsed';
      function applyTocCollapsed(on) {
        if (document.body && document.body.classList) {
          if (on) document.body.classList.add('toc-collapsed');
          else document.body.classList.remove('toc-collapsed');
        }
        tt.setAttribute('aria-pressed', on ? 'true' : 'false');
        tt.setAttribute('aria-label', on ? '展开目录' : '收起目录');
        tt.setAttribute('title', on ? '展开目录' : '收起目录');
      }
      var tocOn = false;
      try { tocOn = localStorage.getItem(tocKey) === '1'; } catch (e) { tocOn = false; }
      applyTocCollapsed(tocOn);
      tt.addEventListener('click', function () {
        tocOn = !tocOn;
        applyTocCollapsed(tocOn);
        try { localStorage.setItem(tocKey, tocOn ? '1' : '0'); } catch (e) {}
      });
    }
    var sf = $('#search-form');
    if (sf && sf.addEventListener) {
      sf.addEventListener('submit', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        var q = $('#q');
        var val = String((q && q.value) || '').trim();
        if (val) goto('#/search/' + encodeURIComponent(val));
      });
    }
    var ml = $('#map-link');
    if (ml && ml.addEventListener) {
      ml.addEventListener('click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        openStructure();
      });
    }
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        if (t && typeof t.closest === 'function' && t.closest('[data-close]')) {
          if (ev.preventDefault) ev.preventDefault();
          hideModal();
        }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev && ev.key === 'Escape') hideModal();
      });
    }
    /* 代码块复制：事件委托，只写这一处 */
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        if (!t || typeof t.closest !== 'function') return;
        var face = t.closest('.video-face');
        if (face) {
          if (ev.preventDefault) ev.preventDefault();
          var wrap = face.closest('.video');
          var src = wrap && wrap.getAttribute ? wrap.getAttribute('data-embed') : '';
          var safe = safeUrl(src);
          if (wrap && safe) {
            wrap.__face = face;           /* 收起时把门面卡原样放回 */
            clear(wrap);
            var bar = el('div', 'video-bar');
            var close = el('button', 'video-collapse', '收起视频');
            close.setAttribute('type', 'button');
            bar.appendChild(close);
            wrap.appendChild(bar);
            var ifr = el('iframe', 'video-frame');
            ifr.setAttribute('src', safe);
            ifr.setAttribute('allowfullscreen', '');
            ifr.setAttribute('loading', 'lazy');
            ifr.setAttribute('title', 'B 站视频');
            wrap.appendChild(ifr);
          }
          return;
        }
        var col = t.closest('.video-collapse');
        if (col) {
          if (ev.preventDefault) ev.preventDefault();
          var box = col.closest('.video');
          if (box && box.__face) {
            clear(box);
            box.appendChild(box.__face);   /* 移除 iframe：回到零请求的静态门面 */
            box.__face = null;
          }
          return;
        }
        var btn = t.closest('.copy');
        if (!btn) return;
        var box = btn.closest('.code');
        var code = null;
        if (box && typeof box.getElementsByTagName === 'function') {
          var list = box.getElementsByTagName('code');
          code = list && list[0] ? list[0] : null;
        }
        var text = code ? code.textContent : '';
        var old = btn.textContent || '复制';
        var swap = function (label) {
          clear(btn);
          btn.appendChild(document.createTextNode(label));
          if (typeof setTimeout === 'function') {
            setTimeout(function () {
              clear(btn);
              btn.appendChild(document.createTextNode('复制'));
            }, 1400);
          }
        };
        var done = function () { swap('已复制'); };
        var fail = function () { swap('复制失败'); };
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fail);
        } else {
          fail();
        }
      });
    }
    return render();
  }

  var started = boot();

  if (typeof window !== 'undefined') {
    window.__rec = {
      S: S, VIEWS: VIEWS, render: render, boot: boot, started: started,
      relGraph: relGraph, langBar: langBar, safeUrl: safeUrl,
      attachCard: attachCard, resourceRow: resourceRow, codeChip: codeChip,
      copyText: copyText, toast: toast,
      buildSiteNav: buildSiteNav, buildToc: buildToc, route: route,
      viewLibrary: viewLibrary, viewPost: viewPost, viewTopic: viewTopic,
      viewProject: viewProject, viewMember: viewMember, viewService: viewService,
      viewWeeklyItem: viewWeeklyItem, viewPage: viewPage, viewJoin: viewJoin,
      viewSearch: viewSearch, viewMembers: viewMembers, viewServices: viewServices,
      viewProjects: viewProjects, viewTopics: viewTopics, viewKnowledge: viewKnowledge,
      viewResources: viewResources, viewPages: viewPages, viewWeekly: viewWeekly
    };
  }
})();
