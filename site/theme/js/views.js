'use strict';
/* js/views.js —— 真实数据才画的图 / 通用小件 / 页面通用零件 / viewHome / 索引类视图 / langSwitchScroll。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

  /* ---------- 真实数据才画的图 ---------- */

  /* 语言占比条：meta.languages_pct 来自构建期抓取的 /languages；没有就不画 */
  function langBar(pct, max) {
    if (!pct) return null;
    var keys = Object.keys(pct);
    if (!keys.length) return null;
    keys.sort(function (a, b) { return pct[b] - pct[a]; });
    var shown = keys.slice(0, max || 4);
    var wrap = R.el('div');
    var bar = R.el('div', 'langbar');
    var legend = R.el('ul', 'lang-legend');
    var i;
    for (i = 0; i < shown.length; i++) {
      var seg = R.el('i', 'l' + (i % 4));
      seg.setAttribute('style', 'width:' + pct[shown[i]] + '%');
      seg.setAttribute('title', shown[i] + ' ' + pct[shown[i]] + '%');
      bar.appendChild(seg);
      var li = R.el('li');
      var sw = R.el('i', 'l' + (i % 4));
      sw.setAttribute('style', 'display:inline-block;width:7px;height:7px;border-radius:2px;background:currentColor');
      li.appendChild(R.el('span', '', shown[i] + ' ' + pct[shown[i]] + '%'));
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
    for (i = 0; i < slugs.length; i++) { var p = R.bySlug(posts, slugs[i]); if (p) arts.push(p); }
    var rels = [];
    for (i = 0; i < relIds.length; i++) { var t = R.byId(topics, relIds[i]); if (t) rels.push(t); }
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
        tx.appendChild(document.createTextNode(R.cut(getText(nodes[i3]), 9)));
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
    rootT.appendChild(document.createTextNode(R.cut(topic.title, 12)));

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

    var wrap = R.el('div', 'relgraph');
    wrap.appendChild(svg);
    return wrap;
  }

  /* ---------- 通用小件 ---------- */

  function crumb(items) {
    var n = R.el('nav', 'crumb');
    for (var i = 0; i < items.length; i++) {
      if (i) n.appendChild(R.el('span', 'sep', '›'));
      if (items[i][1]) n.appendChild(R.lnk(items[i][1], items[i][0]));
      else n.appendChild(R.el('span', '', items[i][0]));
    }
    return n;
  }

  function tagLine(tags, cls) {
    var p = R.el('p', cls || 'row-tags');
    for (var i = 0; i < (tags || []).length; i++) {
      if (i) p.appendChild(document.createTextNode(' '));
      p.appendChild(R.lnk('#/library?tag=' + encodeURIComponent(tags[i]), tags[i], 'tag'));
    }
    return p;
  }

  function statusBadge(v, map) {
    var M = map || R.STATUS_LABEL;
    return R.el('span', 'status ' + String(v || ''), M[v] || String(v || '—'));
  }

  /* 项目标签 chip：纯展示（不可点）；「活跃开发」由构建期按 status 自动带上 */
  function projectTagChips(p) {
    var wrap = R.el('p', 'chips tag-chips');
    for (var i = 0; i < (p.tags || []).length; i++) {
      wrap.appendChild(R.el('span', 'tag-chip', p.tags[i]));
    }
    return wrap;
  }

  function kv(pairs) {
    var dl = R.el('dl', 'kv');
    var n = 0;
    for (var i = 0; i < (pairs || []).length; i++) {
      var row = pairs[i];
      if (!row || row[1] === '' || row[1] === null || row[1] === undefined) continue;
      dl.appendChild(R.el('dt', '', row[0]));
      var dd = R.el('dd');
      if (row[2]) dd.appendChild(R.lnk(row[2], row[1]));
      else dd.appendChild(document.createTextNode(String(row[1])));
      dl.appendChild(dd);
      n++;
    }
    return n ? dl : null;
  }

  function metric(n, label) {
    var d = R.el('div', 'metric');
    d.appendChild(R.el('span', 'm-num', typeof n === 'number' ? R.num(n) : String(n)));
    d.appendChild(R.el('span', 'm-label', label));
    return d;
  }

  function avatarOf(mem, cls) {
    if (!mem || !mem.avatar) return null;
    var src = R.safeUrl(mem.avatar);
    if (!src) return null;
    var img = R.el('img', cls || 'avatar');
    img.setAttribute('src', src);
    img.setAttribute('alt', mem.name || '');
    img.setAttribute('loading', 'lazy');
    return img;
  }

  function personCard(m, posts, projects, services) {
    var c = R.el('article', 'person');
    var av = avatarOf(m);
    c.appendChild(av || R.el('div', 'avatar'));
    /* 文本集中在一个 flex 列里：卡片等高时数字行可以贴底对齐 */
    var body = R.el('div', 'p-body');
    var name = R.el('div', 'p-name');
    name.appendChild(R.lnk('#/member/' + m.id, m.name));
    body.appendChild(name);
    body.appendChild(R.el('div', 'p-role', m.role || '群友'));
    if (m.signature) body.appendChild(R.el('p', 'p-sig', m.signature));
    if ((m.skills || []).length) {
      var skills = R.el('p', 'chips');
      for (var i = 0; i < m.skills.length; i++) skills.appendChild(R.el('span', 'chip', m.skills[i]));
      body.appendChild(skills);
    }
    var np = 0, npr = 0, ns = 0, i2;
    for (i2 = 0; i2 < (posts || []).length; i2++) { if (posts[i2].author === m.id) np++; }
    for (i2 = 0; i2 < (projects || []).length; i2++) {
      var pr = projects[i2];
      if (pr.owner === m.id || (pr.contributors || []).indexOf(m.id) >= 0) npr++;
    }
    for (i2 = 0; i2 < (services || []).length; i2++) { if (services[i2].owner === m.id) ns++; }
    body.appendChild(R.el('p', 'p-nums', '文章 ' + np + ' · 项目 ' + npr + ' · 互助 ' + ns +
      (m.joined ? ' · 加入 ' + m.joined : '')));
    c.appendChild(body);
    return c;
  }

  function postRow(p, members) {
    var li = R.el('li', 'row');
    li.appendChild(R.el('span', 'row-date', String(p.date || '').slice(0, 10)));
    li.appendChild(R.lnk('#/post/' + p.slug, p.title, 'row-title'));
    li.appendChild(R.el('span', 'row-words', R.num(p.words) + ' 字'));
    li.appendChild(R.el('p', 'row-sum', p.summary || ''));
    var tags = R.el('p', 'row-tags');
    for (var i = 0; i < (p.tags || []).length; i++) {
      if (i) tags.appendChild(document.createTextNode(' '));
      tags.appendChild(R.el('span', 'tag', p.tags[i]));
    }
    var mem = R.byId(members || [], p.author);
    if (mem) {
      tags.appendChild(document.createTextNode(' · '));
      tags.appendChild(R.lnk('#/member/' + mem.id, mem.name));
    }
    li.appendChild(tags);
    return li;
  }

  /* 系列最新一章的日期（YYYY-MM-DD）。系列的摘要与标签页年份分组共用它 ——
     两处各算一次会打架（一个按全组、一个按命中标签的章节），年份就飘了。 */
  function seriesLatestDate(s) {
    var dates = [];
    for (var i = 0; i < (s.posts || []).length; i++) {
      var full = R.bySlug(R.S.man.posts, s.posts[i].slug);
      if (full && full.date) dates.push(String(full.date).slice(0, 10));
    }
    dates.sort();
    return dates.length ? dates[dates.length - 1] : '';
  }

  /* 系列目录页：#/series/<id>。书库 / 标签页 / 日期页 / 首页的系列行都指向它 ——
     要看全部章节就进这一页，索引页本身不被 20 章铺满。 */
  function seriesHref(s) {
    return '#/series/' + encodeURIComponent(String((s && s.id) || ''));
  }

  /* 链接长在 <summary> 里：点它要跳页，不能顺带把 <details> 撑开 ——
     summary 的默认行为是切换展开，所以这里拦掉冒泡。展开本身保留，仍是就地快速预览。 */
  function seriesLink(s, text, cls) {
    var a = R.lnk(seriesHref(s), text, cls);
    if (a && a.addEventListener) {
      a.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
      });
    }
    return a;
  }

  /* 系列简介：纯文本（构建期已从 SML str 取值并转义），前端用文本节点渲染，不开放任意 HTML。
     没写 description 的系列返回 null，调用方据此整块不渲染（旧系列产物零变化）。 */
  function seriesDesc(s) {
    if (s && s.description) return R.el('p', 'series-desc', s.description);
    return null;
  }

  /* hits：当前标签下命中了该系列的章节数（不传 = 全命中，如无标签的书库页）。
     系列的章数与命中数不是一回事，徽章要分开说，否则“3 章”会让人以为 3 章都讲这个标签。 */
  function seriesRow(s, members, hits, opts) {
    var chapters = s.posts || [];
    var li = R.el('li', 'row-series');
    var box = R.el('details', 'series-box');
    var sum = R.el('summary', 'row series-sum');
    sum.appendChild(R.el('span', 'row-date', seriesLatestDate(s)));
    sum.appendChild(seriesLink(s, s.title, 'row-title'));
    var badge = '系列 · ' + chapters.length + ' 章';
    /* 命中数说明：日期页要「本日 N 章」——那天只发了其中几章时必须说清楚，
       否则读者会以为整组都是这天发的；书库只在部分命中标签时补「命中 N」。 */
    if (opts && opts.hitText) badge += opts.hitText(hits, chapters.length);
    else if (hits && hits < chapters.length) badge += '（命中 ' + hits + '）';
    sum.appendChild(seriesLink(s, badge, 'row-words series-badge'));
    box.appendChild(sum);
    /* 目录卡里的系列简介：纯文本、文本节点渲染（安全）；没写就不出现 */
    var sd = R.seriesDesc(s);
    if (sd) box.appendChild(sd);
    /* 章节 > 8 才套滚动框（.series-posts-scroll，CSS max-height 26rem）：
       20 章展开不再把整页拉长；≤ 8 章的短系列不限制高度，不添滚动条。
       只加类、不改 DOM 顺序，章节跳转与每章的日期/标题/字数/摘要/标签不变。 */
    var ol = R.el('ol', 'rows series-posts' + (chapters.length > R.SERIES_SCROLL_AFTER ? ' series-posts-scroll' : ''));
    for (var j = 0; j < chapters.length; j++) {
      var p = R.bySlug(R.S.man.posts, chapters[j].slug);
      if (p) ol.appendChild(postRow(p, members));
    }
    box.appendChild(ol);
    li.appendChild(box);
    return li;
  }


  function proseFragment(path) {
    return R.fragment(path).then(function (html) {
      var d = R.el('div', 'prose');
      d.appendChild(R.frag(html || '<p>（空）</p>'));
      return d;
    });
  }

  /* ---------- 视图：索引类 ---------- */


  /* ---------- 通用零件：页面头 / 过滤框 / 可过滤列表 / 内联 SVG 图标 ---------- */

  function pageHead(kicker, title, lede) {
    var h = R.el('header', 'page-head');
    if (kicker) h.appendChild(R.el('p', 'kicker', kicker));
    h.appendChild(R.el('h1', '', title));
    if (lede) h.appendChild(R.el('p', 'lede', lede));
    return h;
  }

  function filterBox(placeholder, onChange) {
    var box = R.el('div', 'filters');
    var input = R.el('input', 'filter-input');
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
    var list = R.el(cfg.tag || 'div', cfg.cls || '');
    function draw(q) {
      R.clear(list);
      var n = 0;
      for (var i = 0; i < items.length; i++) {
        if (q && !cfg.match(items[i], q)) continue;
        list.appendChild(cfg.render(items[i]));
        n++;
      }
      if (!n) list.appendChild(R.el('p', 'muted', cfg.empty || '没有匹配项。'));
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
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : R.el('svg');
    s.setAttribute('class', 'nav-ico');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : R.el('path');
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
    var m = R.S.man;
    var f = document.createDocumentFragment();

    var hero = R.el('section', 'home-hero');
    if (m.site.avatar) {
      var logo = R.el('img', 'home-logo');
      logo.src = m.site.avatar;
      logo.alt = m.site.title || '';
      logo.setAttribute('width', '56');
      logo.setAttribute('height', '56');
      hero.appendChild(logo);
    }
    hero.appendChild(R.el('h1', 'home-title', m.site.title || ''));
    if (m.site.tagline) hero.appendChild(R.el('p', 'home-tagline', m.site.tagline));

    var form = R.el('form', 'home-search');
    form.setAttribute('role', 'search');
    form.setAttribute('action', '#/search/');
    var input = R.el('input', 'home-input');
    input.setAttribute('type', 'search');
    input.setAttribute('name', 'q');
    input.setAttribute('placeholder', '全站搜索：文章 / 项目 / 成员 / 资源（回车）');
    input.setAttribute('aria-label', '全站搜索');
    input.id = 'home-q';
    var btn = R.el('button', 'home-btn', '搜索');
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
    var cards = R.el('div', 'nav-cards');
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      var a = R.lnk('#/' + k, '', 'nav-card');
      a.appendChild(svgIcon(k));
      a.appendChild(R.el('b', '', R.NAV_LABEL[k] || k));
      a.appendChild(R.el('span', '', DESC[k] || ''));
      var c = navCount(m, k);
      if (c !== undefined) a.appendChild(R.el('em', '', c + ' 项'));
      cards.appendChild(a);
    }
    f.appendChild(cards);

    /* 最近更新：**先收拢系列，再取前 N 条** —— 条数是条目数（系列算一条）。
       20 章的系列在首页只占一行，否则「最近更新」会变成某一篇的目录。 */
    var recentEntriesAll = R.collectEntries(m.posts || []);
    if (recentEntriesAll.length) {
      var built = R.entryList(recentEntriesAll, {
        idPrefix: 'recent', title: '最近更新',
        key: R.RECENT_KEY, min: R.RECENT_MIN, max: R.RECENT_MAX, def: R.RECENT_DEFAULT,
        searchAfter: R.BROWSE_AFTER, limitAfter: 0, scrollAfter: R.BROWSE_AFTER,
        placeholder: '在最近更新里搜：标题 / 章节 / 标签',
        ariaLabel: '在最近更新里搜索',
        limitLabel: '最近更新显示条数',
        buttonLabel: '调整最近更新条数',
        empty: '没有匹配的最近更新。',
        render: function (entry) { return R.entryRow(entry, { compact: true }); }
      });
      R.S.recent = built.api;
      f.appendChild(built.frag);
    }
    R.setToc([], '', '');
    return Promise.resolve(f);
  }


  function viewByDate(day) {
    var m = R.S.man;
    var f = document.createDocumentFragment();
    var dayStr = String(day || '');
    var dayPosts = [];
    for (var i = 0; i < (m.posts || []).length; i++) {
      if (String(m.posts[i].date || '').slice(0, 10) === dayStr) dayPosts.push(m.posts[i]);
    }
    /* 先按日期过滤，再收拢系列：同一天发完 20 章也只占一条，和书库、首页一个口径 */
    var entries = R.collectEntries(dayPosts);
    var seriesCount = 0;
    for (var j = 0; j < entries.length; j++) { if (entries[j].kind === 'series') seriesCount++; }
    var lede = dayPosts.length
      ? '这一天发了 ' + dayPosts.length + ' 篇，归为 ' + entries.length + ' 项（'
        + seriesCount + ' 个系列 + ' + (entries.length - seriesCount) + ' 篇单篇）。'
      : '这一天没有文章（日期来自 front matter 的 date 字段）。';
    f.appendChild(pageHead('日期', dayStr, lede));

    if (entries.length) {
      var built = R.entryList(entries, {
        idPrefix: 'date',
        key: R.DATE_KEY, min: R.DATE_MIN, max: R.DATE_MAX, def: R.DATE_DEFAULT,
        searchAfter: R.BROWSE_AFTER, limitAfter: R.BROWSE_AFTER, scrollAfter: R.BROWSE_AFTER,
        placeholder: '在这一天里搜：标题 / 章节 / 标签',
        ariaLabel: '在这一天的条目里搜索',
        limitLabel: '本页显示条数',
        buttonLabel: '调整本页显示条数',
        empty: '没有匹配的条目。',
        render: function (entry) {
          return R.entryRow(entry, {
            hitText: function (h) { return '（本日 ' + h + ' 章）'; }
          });
        }
      });
      R.S.dateList = built.api;
      f.appendChild(built.frag);
    }
    R.setToc([], '', '');
    return Promise.resolve(f);
  }


  /* 摘要卡：<details>/<summary> 可折叠结构，默认展开；折叠状态与文章 lede
     摘要共用 SUMMARY_KEY（设置面板「折叠文章摘要」一个开关管两者）。
     折叠只改 open 属性，卡内文本始终在 DOM 里（不误删正文）。 */
  function summaryCard(s) {
    var box = R.el('details', 'ai-summary');
    var h = R.el('summary', 'ai-head');
    h.appendChild(R.el('b', '', '摘要'));
    h.appendChild(R.el('span', 'ai-src', s.source === 'ai' ? 'AI · 构建期' : '构建期抽取'));
    box.appendChild(h);
    if (s.one_line) box.appendChild(R.el('p', 'ai-line', s.one_line));
    if ((s.points || []).length) {
      var ul = R.el('ul', 'ai-points');
      for (var i = 0; i < s.points.length; i++) ul.appendChild(R.el('li', '', s.points[i]));
      box.appendChild(ul);
    }
    if ((s.keywords || []).length) {
      var tg = R.el('p', 'row-tags');
      for (var j = 0; j < s.keywords.length; j++) {
        if (j) tg.appendChild(document.createTextNode(' '));
        tg.appendChild(R.el('span', 'tag', s.keywords[j]));
      }
      box.appendChild(tg);
    }
    if (!R.readSummaryCollapsed()) box.setAttribute('open', 'open');
    rememberFold(box);
    return box;
  }

  /* 文章合集：一个系列一个目录页（#/series/<id>），按 order 列出全部章节。
     索引页只给「组」（一行 + 可展开的章节预览），完整目录集中在这一页 ——
     否则一条 20 章的系列能把书库和首页同时铺满。 */
  function viewSeries(id) {
    var m = R.S.man;
    var s = R.byId(m.series || [], id);
    var f = document.createDocumentFragment();
    if (!s) {
      f.appendChild(R.el('h1', '', '没有这个系列'));
      f.appendChild(R.el('p', 'muted', '系列 id：' + String(id === undefined || id === null ? '' : id)));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['文章库', '#/library'], [s.title, '']]));
    f.appendChild(R.el('h1', '', s.title));
    var sdHead = R.seriesDesc(s);
    if (sdHead) f.appendChild(sdHead);
    /* 标签页写系列名，而不是通用的「系列」 */
    if (document && document.title !== undefined) {
      document.title = (m.site.title || '') + ' · ' + s.title;
    }
    /* order 缺失或相同的章排在后面而不是乱序：999 兜底只为不抛，不为编造次序 */
    var chapters = (s.posts || []).slice().sort(function (a, b) {
      var oa = isFinite(a.order) ? a.order : 999;
      var ob = isFinite(b.order) ? b.order : 999;
      return oa - ob;
    });
    f.appendChild(R.el('p', 'lede', '共 ' + chapters.length + ' 章 · 系列'));

    var first = R.seriesFirstSlug(s);
    if (first) {
      var start = R.el('p', 'chips');
      start.appendChild(R.lnk('#/post/' + first, '从第一章开始阅读 →', 'chip'));
      f.appendChild(start);
    }

    f.appendChild(R.el('p', 'section-h', '目录'));
    var ol = R.el('ol', 'rows');
    var n = 0;
    for (var i = 0; i < chapters.length; i++) {
      var p = R.bySlug(m.posts, chapters[i].slug);
      if (!p) continue;                 /* 章节在 manifest 里查不到就跳过，绝不编一行 */
      ol.appendChild(postRow(p, m.members));
      n++;
    }
    f.appendChild(ol);
    if (!n) f.appendChild(R.el('p', 'muted', '这个系列还没有可显示的章节。'));
    R.setToc([], '', '');
    return Promise.resolve(f);
  }

  /* 折叠状态写库：浏览器原生 toggle 事件；桩环境没有 toggle 派发也不报错。
     summary 的 click 兜底一层（toggle 事件在个别旧内核上不触发）。 */
  function rememberFold(details) {
    if (!details || !details.addEventListener) return;
    var save = function () {
      R.writeSummaryCollapsed(!details.hasAttribute('open'));
      R.syncSummarySwitch();
    };
    details.addEventListener('toggle', save);
    var sum = details.querySelector ? details.querySelector('summary') : null;
    if (sum && sum.addEventListener) {
      sum.addEventListener('click', function () {
        /* click 时 open 还没翻：下一帧再读，读到的就是翻转后的状态 */
        if (typeof setTimeout === 'function') setTimeout(save, 0);
      });
    }
  }

  function viewLibrary(query) {
    var m = R.S.man;
    var f = document.createDocumentFragment();
    var head = R.el('header', 'page-head');
    head.appendChild(R.el('p', 'kicker', '共建博客'));
    head.appendChild(R.el('h1', '', '文章库'));
    var grouped = 0;
    for (var gsi = 0; gsi < (m.series || []).length; gsi++) {
      if (((m.series[gsi].posts || []).length) > 1) grouped++;
    }
    var lede = '共 ' + m.posts.length + ' 篇，按年份分组。' +
      (grouped ? ' 多章系列折叠为 ' + grouped + ' 条。' : '') +
      (query && query.tag ? '当前筛选标签：#' + query.tag : '');
    head.appendChild(R.el('p', 'lede', lede));
    f.appendChild(head);

    var filters = R.el('div', 'filters');
    var input = R.el('input', 'filter-input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', '按标题 / 摘要 / 标签过滤（即时）');
    input.setAttribute('aria-label', '过滤文章');
    if (query && query.tag) input.setAttribute('value', '#' + query.tag);
    filters.appendChild(input);
    f.appendChild(filters);

    var chips = R.el('div', 'chips');
    var tagCount = 0;
    for (var i = 0; i < (m.tags || []).length && tagCount < 24; i++) {
      var tg = m.tags[i];
      var on = query && query.tag && query.tag === tg.tag;
      var chip = R.el('span', on ? 'chip on' : 'chip', tg.tag + ' (' + tg.count + ')');
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
        libQ = was ? '' : tag;
        input.setAttribute('value', was ? '' : '#' + tag);
        applyFilter(was ? '' : tag);
      });
    }
    f.appendChild(chips);

    var posts = m.posts;
    if (query && query.tag) {
      posts = [];
      for (var k = 0; k < m.posts.length; k++) {
        if ((m.posts[k].tags || []).indexOf(query.tag) >= 0) posts.push(m.posts[k]);
      }
    }

    /* 收拢口径与首页、日期页同源（collectEntries）：系列总章数 > 1 才合并，
     * 单章系列退化成普通文章行。这里不再自己写一遍 —— 三处各写一遍迟早漂移成
     * 「书库里是一条系列，首页却摊成 20 章」。 */
    var entries = R.collectEntries(posts);

    /* 过滤用的行登记表：显式保存「节点 + 可搜索文本」，不发任何请求。
     * 可搜索文本与搜索框共用 entryText()，免得过滤和搜索两套口径。 */
    var rowNodes = [];
    var libQ = String(query && query.tag ? query.tag : '');
    /* 首次绘制不再叠一次过滤：标签筛选已经在 posts 那一步做过了，
       这里再跑一遍会把系列行的类名改成「row row-series」，多出一条 li.row。
       只有重绘（改条数）后才需要把当前过滤词重新落到新节点上。 */
    var builtOnce = false;

    function buildYears(host, shown) {
      rowNodes.length = 0;
      var years = {}, order = [];
      for (var i = 0; i < shown.length; i++) {
        var y = String(shown[i].date || '').slice(0, 4)
          || String((shown[i].post && shown[i].post.year) || '');
        if (!years[y]) { years[y] = []; order.push(y); }
        years[y].push(shown[i]);
      }
      for (var yi = 0; yi < order.length; yi++) {
        var yr = order[yi];
        var d = R.el('details');
        if (yi === 0) d.setAttribute('open', 'open');
        d.appendChild(R.el('summary', '', yr + ' 年（' + years[yr].length + ' 项）'));
        var ol = R.el('ol', 'rows');
        for (var ri = 0; ri < years[yr].length; ri++) {
          var entry = years[yr][ri];
          var li = R.entryRow(entry);
          li.setAttribute('data-rowclass', entry.kind === 'series' ? 'row row-series' : 'row');
          li.setAttribute('data-filter', R.entryText(entry));
          ol.appendChild(li);
          rowNodes.push(li);
        }
        d.appendChild(ol);
        host.appendChild(d);
      }
      if (builtOnce) applyFilter(libQ);
      builtOnce = true;
    }

    function applyFilter(q) {
      q = String(q || '').toLowerCase().replace(/^#/, '');
      for (var i2 = 0; i2 < rowNodes.length; i2++) {
        var node = rowNodes[i2];
        var txt = String(node.getAttribute('data-filter') || '').toLowerCase();
        var base = node.getAttribute('data-rowclass') || 'row';
        node.className = (!q || txt.indexOf(q) >= 0) ? base : base + ' hide';
      }
    }
    if (input.addEventListener) {
      input.addEventListener('input', function () {
        var v = input.value !== undefined ? input.value : input.getAttribute('value');
        libQ = String(v || '');
        applyFilter(libQ);
      });
    }

    /* 条目多到一屏读不完才有必要上滑块和滚动区；书库的条数自己存，不与首页共用。 */
    if (entries.length > R.LIBRARY_LIST_AFTER) {
      var built = R.entryList(entries, {
        idPrefix: 'library', tag: 'div', listClass: 'library-groups',
        key: R.LIBRARY_KEY, min: R.LIBRARY_MIN, max: R.LIBRARY_MAX, def: R.LIBRARY_DEFAULT,
        searchAfter: false, limitAfter: 0, scrollAfter: R.LIBRARY_LIST_AFTER,
        buttonLabel: '调整书库显示条数', limitLabel: '书库显示条数',
        empty: '没有匹配的文章。',
        build: buildYears
      });
      R.S.libraryList = built.api;
      f.appendChild(built.frag);
    } else {
      var host = R.el('div', 'library-groups');
      buildYears(host, entries);
      if (!rowNodes.length) host.appendChild(R.el('p', 'muted', '没有匹配的文章。'));
      f.appendChild(host);
    }
    return Promise.resolve(f);
  }

  function viewKnowledge() {
    var m = R.S.man;
    var f = document.createDocumentFragment();
    var head = R.el('header', 'page-head');
    head.appendChild(R.el('p', 'kicker', '知识'));
    head.appendChild(R.el('h1', '', '文章知识'));
    head.appendChild(R.el('p', 'lede', '主题词条、标签与系列的入口。正文仍在文章库。'));
    f.appendChild(head);

    if ((m.topics || []).length) {
      f.appendChild(R.el('p', 'section-h', '主题词条'));
      var g1 = R.el('div', 'grid');
      for (var i = 0; i < m.topics.length; i++) {
        var t = m.topics[i];
        var c = R.el('article', 'card');
        c.appendChild(R.lnk('#/topic/' + t.id, t.title, 'card-title'));
        c.appendChild(R.el('p', 'card-note', t.summary || ''));
        var meta = R.el('p', 'row-tags');
        meta.appendChild(R.el('span', 'badge', (t.resolved || []).length + ' 篇'));
        c.appendChild(meta);
        g1.appendChild(c);
      }
      f.appendChild(g1);
    }

    if ((m.tags || []).length) {
      f.appendChild(R.el('p', 'section-h', '标签'));
      var p = R.el('p', 'chips');
      for (var j = 0; j < m.tags.length; j++) {
        p.appendChild(R.lnk('#/library?tag=' + encodeURIComponent(m.tags[j].tag),
          m.tags[j].tag + ' (' + m.tags[j].count + ')', 'chip'));
      }
      f.appendChild(p);
    }

    if ((m.series || []).length) {
      f.appendChild(R.el('p', 'section-h', '系列'));
      for (var k = 0; k < m.series.length; k++) {
        var s = m.series[k];
        var box = R.el('details');
        box.appendChild(R.el('summary', '', s.title + '（' + s.posts.length + ' 篇）'));
        var ol = R.el('ol', 'rows');
        for (var pi = 0; pi < s.posts.length; pi++) {
          var post = R.bySlug(m.posts, s.posts[pi].slug);
          if (post) ol.appendChild(postRow(post, m.members));
        }
        box.appendChild(ol);
        f.appendChild(box);
      }
    }
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }


  function topicCard(t) {
    var c = R.el('article', 'card');
    c.appendChild(R.lnk('#/topic/' + t.id, t.title, 'card-title'));
    var meta = R.el('p', 'row-tags');
    meta.appendChild(R.el('span', 'badge', (t.resolved || []).length + ' 篇文章'));
    for (var ti = 0; ti < (t.tags || []).length; ti++) {
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(R.el('span', 'tag', t.tags[ti]));
    }
    c.appendChild(meta);
    c.appendChild(R.el('p', 'card-note', t.summary || ''));
    return c;
  }

  function viewTopics() {
    var m = R.S.man;
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
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function projectRow(p, m) {
    var art = R.el('article', 'proj');
    var left = R.el('div');
    var h = R.el('h2');
    h.appendChild(R.lnk('#/project/' + p.id, p.name));
    left.appendChild(h);
    left.appendChild(R.el('p', '', p.one_liner));
    var line = R.el('p', 'row-tags');
    line.appendChild(statusBadge(p.status));
    if (p.license) { line.appendChild(document.createTextNode(' ')); line.appendChild(R.el('span', 'lang', p.license)); }
    var mem = R.byId(m.members, p.owner);
    if (mem) { line.appendChild(document.createTextNode(' · ')); line.appendChild(R.lnk('#/member/' + mem.id, mem.name)); }
    left.appendChild(line);
    if ((p.tags || []).length) left.appendChild(projectTagChips(p));
    var btns = R.el('p', 'chips');
    btns.appendChild(R.outLink(p.repo, '仓库', 'chip'));
    if (p.homepage) btns.appendChild(R.outLink(p.homepage, '主页', 'chip'));
    left.appendChild(btns);
    art.appendChild(left);

    var right = R.el('aside', 'proj-data');
    var meta = p.meta || {};
    var metrics = R.el('div', 'metrics');
    if (meta.stars !== null && meta.stars !== undefined) metrics.appendChild(metric(meta.stars, 'stars'));
    if (meta.forks !== null && meta.forks !== undefined) metrics.appendChild(metric(meta.forks, 'forks'));
    if (meta.updated_at) metrics.appendChild(metric(String(meta.updated_at).slice(0, 10), '最近提交'));
    right.appendChild(metrics);
    var bar = meta.languages_pct ? langBar(meta.languages_pct, 4) : null;
    if (bar) right.appendChild(bar);
    else right.appendChild(R.el('p', 'muted', '语言占比：构建期未取到，故不画。'));
    if (meta.stale) right.appendChild(R.el('p', 'muted', '（缓存数据）'));
    art.appendChild(right);
    return art;
  }

  function viewProjects() {
    var m = R.S.man;
    var head = pageHead('比较', '项目', '左简介、右数据。数据来自构建期抓取的仓库元数据，抓不到就不显示。');
    var f = filterable(head, m.projects || [], {
      placeholder: '按项目名 / 简介 / 标签 / 语言 / 状态过滤',
      empty: '没有匹配的项目。',
      match: function (p, q) {
        return (p.name + ' ' + (p.one_liner || '') + ' ' + (p.tags || []).join(' ') + ' ' +
          (p.languages || []).join(' ') + ' ' +
          (p.status || '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (p) { return projectRow(p, m); }
    });
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewMembers() {
    var m = R.S.man;
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
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function serviceRow(s, m) {
    var mem = R.byId(m.members, s.owner);
    var d = R.el('article', 'svc ' + (s.status || ''));
    var h = R.el('h3', 'svc-h');
    h.appendChild(R.lnk('#/service/' + s.id, s.name));
    d.appendChild(h);
    var l1 = R.el('p', 'svc-line');
    l1.appendChild(R.el('b', '', '能帮上什么'));
    l1.appendChild(document.createTextNode((s.skills || []).join('、')));
    d.appendChild(l1);
    var l2 = R.el('p', 'svc-line');
    l2.appendChild(R.el('b', '', '想一起做什么'));
    l2.appendChild(document.createTextNode((s.wants || []).join('、') || '（未填写）'));
    d.appendChild(l2);
    var l3 = R.el('p', 'svc-line');
    l3.appendChild(R.el('b', '', '怎么联系'));
    var ways = [];
    for (var ci = 0; ci < (s.contact || []).length; ci++) {
      var key = s.contact[ci];
      var val = mem && mem.links ? mem.links[key] : '';
      if (val) ways.push(R.CONTACT_LABEL[key] || key);
    }
    l3.appendChild(document.createTextNode(ways.length ? ways.join(' / ') : '见条目内页'));
    d.appendChild(l3);
    var meta = R.el('p', 'row-tags');
    meta.appendChild(statusBadge(s.status, R.SERVICE_STATUS_LABEL));
    meta.appendChild(document.createTextNode(' · '));
    if (mem) meta.appendChild(R.lnk('#/member/' + mem.id, mem.name));
    meta.appendChild(document.createTextNode(' · 更新 ' + (s.updated || '—')));
    d.appendChild(meta);
    return d;
  }

  function viewServices() {
    var m = R.S.man;
    var head = pageHead('扫读', '技术互助',
      '这里只做技术互助与能力互补，不涉及设备买卖、报价与商务对接。');
    var f = filterable(head, m.services || [], {
      placeholder: '按名称 / 技能 / 想一起做的内容 / 登记人过滤',
      empty: '没有匹配的条目。',
      match: function (s, q) {
        var mem = R.byId(m.members, s.owner);
        return (s.name + ' ' + (s.skills || []).join(' ') + ' ' + (s.wants || []).join(' ') + ' ' +
          (mem ? mem.name : '')).toLowerCase().indexOf(q) >= 0;
      },
      render: function (s) { return serviceRow(s, m); }
    });
    f.appendChild(R.el('p', 'disc',
      '技术互助只展示信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷；条目由本人提供并自负其责。'));
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function resourceRow(r, api) {
    var li = R.el('li', 'row');
    li.appendChild(R.el('span', 'row-date', R.KIND_LABEL[r.kind] || r.kind || '资源'));
    li.appendChild(R.outLink(r.url, r.title, 'row-title'));
    li.appendChild(R.el('span', 'row-words', ''));
    li.appendChild(R.el('p', 'row-sum', r.note || ''));
    var tags = R.el('p', 'row-tags');
    for (var ti = 0; ti < (r.tags || []).length; ti++) {
      if (ti) tags.appendChild(document.createTextNode(' '));
      var tag = r.tags[ti];
      var a = R.el('a', 'tag', tag);
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
      tags.appendChild(document.createTextNode(' · ★' + R.num(meta.stars)));
    }
    var chip = R.codeChip(r.code);
    if (chip) tags.appendChild(chip);
    li.appendChild(tags);
    return li;
  }

  function viewResources() {
    var m = R.S.man;
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
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewWeekly(id) {
    var m = R.S.man;
    if (id) return R.viewWeeklyItem(id);
    var f = document.createDocumentFragment();
    f.appendChild(pageHead('时间', '周报', '按 ISO 周归档；可以多选周，只看关心的期次。'));

    var items = m.weekly || [];
    var byPeriod = {};
    for (var i = 0; i < items.length; i++) byPeriod[items[i].period || items[i].id] = items[i];

    var sel = {};
    var cellRefs = [];
    var list = R.el('div', '');
    var allBtn = R.el('button', 'page-btn', '全部');
    allBtn.setAttribute('type', 'button');

    function renderList() {
      R.clear(list);
      var picked = Object.keys(sel);
      var shown = 0;
      var ol = R.el('ol', 'rows');
      for (var j = 0; j < items.length; j++) {
        var w = items[j];
        var key = w.period || w.id;
        if (picked.length && !sel[key]) continue;
        var li = R.el('li', 'row');
        li.appendChild(R.el('span', 'row-date', w.period || ''));
        li.appendChild(R.lnk('#/weekly/' + w.id, w.title, 'row-title'));
        li.appendChild(R.el('span', 'row-words', (w.merged || []).length + ' 篇'));
        li.appendChild(R.el('p', 'row-sum', (w.highlights || []).join(' · ')));
        ol.appendChild(li);
        shown++;
      }
      if (shown) list.appendChild(ol);
      else list.appendChild(R.el('p', 'muted', '没有选中任何一期（点上面的周格子多选）。'));
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
      list.appendChild(R.el('p', 'muted', '还没有周报。'));
    }
    for (var yi = 0; yi < ykeys.length; yi++) {
      var year = ykeys[yi];
      var grid = R.el('div', 'week-grid');
      var total = 0;
      for (var wk = 1; wk <= 53; wk++) {
        var wItem = years[year][wk];
        var key2 = year + '-W' + (wk < 10 ? '0' + wk : wk);
        var cell = R.el('button', 'week-cell' + (wItem ? ' has' : ''), String(wk));
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
      f.appendChild(R.el('p', 'section-h', year + ' 年（点有数据的周，多选）'));
      f.appendChild(grid);
    }

    allBtn.addEventListener && allBtn.addEventListener('click', function () {
      sel = {};
      for (var c = 0; c < cellRefs.length; c++) {
        if (String(cellRefs[c].className).indexOf(' on') >= 0) cellRefs[c].className = 'week-cell has';
      }
      renderList();
    });
    var bar = R.el('div', 'filters');
    bar.appendChild(allBtn);
    f.appendChild(bar);
    f.appendChild(list);
    renderList();
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }
  function viewPages() {
    var m = R.S.man;
    var f = document.createDocumentFragment();
    var head = R.el('header', 'page-head');
    head.appendChild(R.el('p', 'kicker', '制度'));
    head.appendChild(R.el('h1', '', '站文档'));
    head.appendChild(R.el('p', 'lede', '规则、流程与写作规范。'));
    f.appendChild(head);
    var groups = {}, order = [];
    for (var i = 0; i < (m.pages || []).length; i++) {
      var d = m.pages[i];
      var g = d.group || '其它';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(d);
    }
    for (var gi = 0; gi < order.length; gi++) {
      f.appendChild(R.el('p', 'section-h', order[gi]));
      var grid = R.el('div', 'grid');
      for (var di = 0; di < groups[order[gi]].length; di++) {
        var p = groups[order[gi]][di];
        var c = R.el('article', 'card');
        c.appendChild(R.lnk('#/page/' + p.id, p.title, 'card-title'));
        c.appendChild(R.el('p', 'card-note', String(p.text || '').slice(0, 80)));
        grid.appendChild(c);
      }
      f.appendChild(grid);
    }
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewJoin() {
    var m = R.S.man, g = (m.site && m.site.group) || {};
    var f = document.createDocumentFragment();
    var head = R.el('header', 'page-head');
    head.appendChild(R.el('p', 'kicker', '加入'));
    head.appendChild(R.el('h1', '', '加入我们'));
    head.appendChild(R.el('p', 'lede', g.intro || m.site.tagline || ''));
    f.appendChild(head);

    var info = kv([
      ['群名', g.name],
      ['QQ 群', g.qq],
      ['验证', g.join]
    ]);
    if (info) f.appendChild(info);
    var btns = R.el('p', 'chips');
    if (g.join_url) btns.appendChild(R.outLink(g.join_url, '申请加群', 'chip'));
    if (m.site.repo_url) btns.appendChild(R.outLink(m.site.repo_url, '投稿仓库', 'chip'));
    f.appendChild(btns);

    if ((g.rules || []).length) {
      f.appendChild(R.el('h2', '', '群规'));
      var ol = R.el('ol');
      for (var i = 0; i < g.rules.length; i++) ol.appendChild(R.el('li', '', g.rules[i]));
      f.appendChild(ol);
    }
    if ((g.features || []).length) {
      f.appendChild(R.el('h2', '', '这里有什么'));
      var ul = R.el('ul');
      for (var j = 0; j < g.features.length; j++) ul.appendChild(R.el('li', '', g.features[j]));
      f.appendChild(ul);
    }
    if ((g.timeline || []).length) {
      f.appendChild(R.el('h2', '', '站点时间线'));
      var tl = R.el('ul', 'timeline');
      for (var k = 0; k < g.timeline.length; k++) {
        var li = R.el('li');
        li.appendChild(R.el('span', 't-date', g.timeline[k].date));
        li.appendChild(document.createTextNode(g.timeline[k].text));
        tl.appendChild(li);
      }
      f.appendChild(tl);
    }
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }


  function viewSearch(q) {
    var f = document.createDocumentFragment();
    var needle = String(q || '').trim();
    f.appendChild(pageHead('辅助', '搜索：' + (needle || '（空）'), '结果按类型分组，可筛选、可分页。'));
    return R.fragment('search-index.json').then(function (raw) {
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
      var chips = R.el('div', 'chips');
      var list = R.el('div', 'search-list');
      var pager = R.el('nav', 'pager');

      function row(it) {
        var li = R.el('li', 'row search-row');
        li.appendChild(R.el('span', 'row-type', it.type || '其他'));
        var url = String(it.url || '');
        var a;
        if (/^https?:/i.test(url)) {
          a = R.outLink(url, it.title || url, 'row-title');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        } else {
          a = R.lnk(url || '#/library', it.title || '', 'row-title');
        }
        li.appendChild(a);
        li.appendChild(R.el('span', 'row-words', ''));
        li.appendChild(R.el('p', 'row-sum', it.summary || ''));
        var tg = R.el('p', 'row-tags');
        for (var ti = 0; ti < (it.tags || []).length; ti++) {
          if (ti) tg.appendChild(document.createTextNode(' '));
          tg.appendChild(R.el('span', 'tag', it.tags[ti]));
        }
        li.appendChild(tg);
        return li;
      }

      function chip(label, value, n, on) {
        var c = R.el('span', on ? 'chip on' : 'chip', label + ' (' + n + ')');
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
        R.clear(chips);
        chips.appendChild(chip('全部', '', hits.length, active === ''));
        for (var k = 0; k < TYPES.length; k++) {
          if (!counts[TYPES[k]]) continue;
          chips.appendChild(chip(TYPES[k], TYPES[k], counts[TYPES[k]], active === TYPES[k]));
        }
        var filtered = active ? hits.filter(function (it) { return (it.type || '其他') === active; }) : hits;
        var pages = Math.max(1, Math.ceil(filtered.length / PER));
        if (page > pages - 1) page = pages - 1;

        R.clear(list);
        if (!filtered.length) {
          list.appendChild(R.el('p', 'muted', '没有结果。'));
        } else {
          var ol = R.el('ol', 'rows');
          var from = page * PER;
          var to = Math.min(filtered.length, from + PER);
          for (var j = from; j < to; j++) ol.appendChild(row(filtered[j]));
          list.appendChild(ol);
        }

        R.clear(pager);
        if (pages > 1) {
          var prev = R.el('button', 'page-btn', '← 上一页');
          prev.setAttribute('type', 'button');
          var next = R.el('button', 'page-btn', '下一页 →');
          next.setAttribute('type', 'button');
          if (prev.addEventListener) {
            prev.addEventListener('click', function () { if (page > 0) { page--; render(); } });
          }
          if (next.addEventListener) {
            next.addEventListener('click', function () { if (page < pages - 1) { page++; render(); } });
          }
          pager.appendChild(prev);
          pager.appendChild(R.el('span', 'muted', '第 ' + (page + 1) + ' / ' + pages + ' 页 · 共 ' + filtered.length + ' 条'));
          pager.appendChild(next);
        }
      }

      render();
      f.appendChild(chips);
      f.appendChild(list);
      f.appendChild(pager);
      R.setToc([], '', 'map.svg');
      return f;
    });
  }
  /* 语言切换只改 query，保持当前滚动位置（切换前记下，渲染后再恢复） */
  function langSwitchScroll() {
    R.S._langScroll = (typeof window !== 'undefined' && window.scrollY) ? window.scrollY : null;
  }


  /* ---- 本模块导出到 REC ---- */
  R.langBar = langBar;
  R.relGraph = relGraph;
  R.crumb = crumb;
  R.tagLine = tagLine;
  R.statusBadge = statusBadge;
  R.kv = kv;
  R.metric = metric;
  R.avatarOf = avatarOf;
  R.personCard = personCard;
  R.postRow = postRow;
  R.seriesLatestDate = seriesLatestDate;
  R.seriesHref = seriesHref;
  R.seriesLink = seriesLink;
  R.seriesRow = seriesRow;
  R.seriesDesc = seriesDesc;
  R.proseFragment = proseFragment;
  R.pageHead = pageHead;
  R.filterBox = filterBox;
  R.filterable = filterable;
  R.ICON_PATHS = ICON_PATHS;
  R.svgIcon = svgIcon;
  R.navCount = navCount;
  R.viewHome = viewHome;
  R.viewByDate = viewByDate;
  R.summaryCard = summaryCard;
  R.viewSeries = viewSeries;
  R.rememberFold = rememberFold;
  R.viewLibrary = viewLibrary;
  R.viewKnowledge = viewKnowledge;
  R.topicCard = topicCard;
  R.viewTopics = viewTopics;
  R.projectRow = projectRow;
  R.projectTagChips = projectTagChips;
  R.viewProjects = viewProjects;
  R.viewMembers = viewMembers;
  R.serviceRow = serviceRow;
  R.viewServices = viewServices;
  R.resourceRow = resourceRow;
  R.viewResources = viewResources;
  R.viewWeekly = viewWeekly;
  R.viewPages = viewPages;
  R.viewJoin = viewJoin;
  R.viewSearch = viewSearch;
  R.langSwitchScroll = langSwitchScroll;
})();
