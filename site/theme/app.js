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

  var S = { man: null, frags: {}, toc: [], tocBase: '', tocLinks: [], mapHref: '', page: '',
            quote: { timer: 0, idx: 0 }, recent: null };

  var NAV_LABEL = {
    home: '首页',
    library: '文章库', knowledge: '文章知识', topics: '主题词条', projects: '项目',
    resources: '资源', members: '成员', services: '技术互助', weekly: '周报',
    pages: '站文档', join: '加入我们',
    /* 系列目录页不是导航入口，只用来给标签页兜个中文名（真实标题在 viewSeries 里覆盖） */
    series: '系列'
  };
  /* 联系键 → 中文标签。未知键不会被丢掉（下面统一回落到键名），
   * 所以往 contracts/blog.sml 的 MemberLinks 加字段时必须同步这张表 ——
   * 一人两个 Gitee（个人空间 / 组织空间）就是为这种情形准备的：
   * gitee 是个人号，gitee_org 是第二个空间，写成两个同名 gitee 会互相覆盖。 */
  var CONTACT_LABEL = {
    blog: '博客', homepage: '个人主页', github: 'GitHub',
    gitee: 'Gitee', gitee_org: 'Gitee 空间', email: '邮箱'
  };
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
        a.setAttribute('data-level', String(t.level || 2));
        nav.appendChild(a);
        /* 桌面左栏与窄屏抽屉是同一份目录的两份 DOM：两份都要跟着滚动标当前项，
           否则抽屉里永远看不到「读到哪儿」。 */
        S.tocLinks.push(a);
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
      /* 层级从节点自带属性取：S.tocLinks 现在装了左栏 + 抽屉两份，不能再用下标对 S.toc */
      a.className = 'lv' + (a.getAttribute('data-level') || 2) + (on ? ' cur' : '');
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

  /* 系列最新一章的日期（YYYY-MM-DD）。系列的摘要与标签页年份分组共用它 ——
     两处各算一次会打架（一个按全组、一个按命中标签的章节），年份就飘了。 */
  function seriesLatestDate(s) {
    var dates = [];
    for (var i = 0; i < (s.posts || []).length; i++) {
      var full = bySlug(S.man.posts, s.posts[i].slug);
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
    var a = lnk(seriesHref(s), text, cls);
    if (a && a.addEventListener) {
      a.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
      });
    }
    return a;
  }

  /* hits：当前标签下命中了该系列的章节数（不传 = 全命中，如无标签的书库页）。
     系列的章数与命中数不是一回事，徽章要分开说，否则“3 章”会让人以为 3 章都讲这个标签。 */
  function seriesRow(s, members, hits, opts) {
    var chapters = s.posts || [];
    var li = el('li', 'row-series');
    var box = el('details', 'series-box');
    var sum = el('summary', 'row series-sum');
    sum.appendChild(el('span', 'row-date', seriesLatestDate(s)));
    sum.appendChild(seriesLink(s, s.title, 'row-title'));
    var badge = '系列 · ' + chapters.length + ' 章';
    /* 命中数说明：日期页要「本日 N 章」——那天只发了其中几章时必须说清楚，
       否则读者会以为整组都是这天发的；书库只在部分命中标签时补「命中 N」。 */
    if (opts && opts.hitText) badge += opts.hitText(hits, chapters.length);
    else if (hits && hits < chapters.length) badge += '（命中 ' + hits + '）';
    sum.appendChild(seriesLink(s, badge, 'row-words series-badge'));
    box.appendChild(sum);
    /* 章节 > 8 才套滚动框（.series-posts-scroll，CSS max-height 26rem）：
       20 章展开不再把整页拉长；≤ 8 章的短系列不限制高度，不添滚动条。
       只加类、不改 DOM 顺序，章节跳转与每章的日期/标题/字数/摘要/标签不变。 */
    var ol = el('ol', 'rows series-posts' + (chapters.length > SERIES_SCROLL_AFTER ? ' series-posts-scroll' : ''));
    for (var j = 0; j < chapters.length; j++) {
      var p = bySlug(S.man.posts, chapters[j].slug);
      if (p) ol.appendChild(postRow(p, members));
    }
    box.appendChild(ol);
    li.appendChild(box);
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

    /* 最近更新：**先收拢系列，再取前 N 条** —— 条数是条目数（系列算一条）。
       20 章的系列在首页只占一行，否则「最近更新」会变成某一篇的目录。 */
    var recentEntriesAll = collectEntries(m.posts || []);
    if (recentEntriesAll.length) {
      var built = entryList(recentEntriesAll, {
        idPrefix: 'recent', title: '最近更新',
        key: RECENT_KEY, min: RECENT_MIN, max: RECENT_MAX, def: RECENT_DEFAULT,
        searchAfter: BROWSE_AFTER, limitAfter: 0, scrollAfter: BROWSE_AFTER,
        placeholder: '在最近更新里搜：标题 / 章节 / 标签',
        ariaLabel: '在最近更新里搜索',
        limitLabel: '最近更新显示条数',
        buttonLabel: '调整最近更新条数',
        empty: '没有匹配的最近更新。',
        render: function (entry) { return entryRow(entry, { compact: true }); }
      });
      S.recent = built.api;
      f.appendChild(built.frag);
    }
    setToc([], '', '');
    return Promise.resolve(f);
  }


  /* ---------- 本地存储：隐私模式 / 禁用存储时一律安静降级 ---------- */

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (e) {}
  }

  function reducedMotion() {
    try {
      return !!(typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* ---------- 条目收集：系列收拢的唯一实现 ----------
   *
   * 首页最近更新、日期页、文章库三处都用同一份口径。只要有一处自己再写一遍，
   * 三处的收拢规则迟早漂移（「书库里是一条系列，首页却摊成 20 章」这种不一致最伤信任）。
   *
   * 规则（与文章库既有行为一致，只是搬到了这里）：
   *  · **系列总章数 > 1** 才收拢 —— 单章系列没有「组」的意义，退化成普通文章行；
   *  · 一个系列只出一条，日期取 seriesLatestDate()（系列最新一章）；
   *  · 只按 series id 归组：不看标签、不看日期相邻，绝不把不相干的文章并到一起；
   *  · 数据缺失（series 空表 / id 查不到 / 条目缺 posts）时安全退化成普通文章，不抛异常。
   *
   * 条目形状：
   *  { kind: 'series', s: 系列对象, date, hits }   hits = 传入 posts 里属于该系列的章数
   *  { kind: 'post',   post: 文章对象, date }
   */
  function collectEntries(posts, opts) {
    opts = opts || {};
    var series = opts.series || ((S.man && S.man.series) || []);
    var groups = {};
    var out = [];
    for (var i = 0; i < (posts || []).length; i++) {
      var p = posts[i];
      if (!p) continue;
      var s = p.series ? byId(series, p.series) : null;
      if (s && (s.posts || []).length > 1) {
        var g = groups[s.id];
        if (!g) {
          g = { kind: 'series', s: s, hits: 0,
                date: seriesLatestDate(s) || String(p.date || '') };
          groups[s.id] = g;
          out.push(g);
        }
        g.hits++;
      } else {
        out.push({ kind: 'post', post: p, date: String(p.date || '') });
      }
    }
    return sortEntries(out);
  }

  /* 排序：日期倒序 → updated 倒序 → 标题 → slug / 系列 id。
   *
   * 最后两级是「稳定排序」的关键：同一天发布的条目在 manifest 里的先后由构建期决定
   * （build.py 按 (date, slug) 排），前端不该依赖它 —— 否则同一批内容换一次构建就可能
   * 换一次顺序，读者以为文章被撤了。这里给出确定的次序。 */
  function sortEntries(entries) {
    entries.sort(function (a, b) {
      var da = String((a && a.date) || ''), db = String((b && b.date) || '');
      if (da !== db) return da < db ? 1 : -1;
      var ua = String(entryUpdated(a)), ub = String(entryUpdated(b));
      if (ua !== ub) return ua < ub ? 1 : -1;
      var ta = entryTitle(a), tb = entryTitle(b);
      if (ta !== tb) return ta < tb ? -1 : 1;
      var ka = entryKey(a), kb = entryKey(b);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    return entries;
  }

  function entryTitle(e) {
    return e.kind === 'series' ? String((e.s && e.s.title) || '') : String((e.post && e.post.title) || '');
  }
  function entryKey(e) {
    return e.kind === 'series' ? 's:' + String((e.s && e.s.id) || '') : 'p:' + String((e.post && e.post.slug) || '');
  }
  function entryUpdated(e) {
    return (e.kind === 'post' && e.post && e.post.updated) ? String(e.post.updated) : '';
  }

  /* 一条条目能被搜到的全部文本：系列 = 系列名 + 每章标题 + 每章标签；单篇 = 标题 / 摘要 / 标签 / 作者。
   * 过滤用的可搜索文本也走这里（data-filter），免得搜索与过滤两套口径。 */
  function entryText(e) {
    var names = [];
    if (e.kind === 'series') {
      names.push(entryTitle(e));
      var chapters = (e.s && e.s.posts) || [];
      for (var i = 0; i < chapters.length; i++) {
        names.push(String(chapters[i].title || ''));
        var sp = bySlug((S.man && S.man.posts) || [], chapters[i].slug);
        if (sp) names.push((sp.tags || []).join(' '));
      }
      names.push('系列');
      return names.join(' ');
    }
    var p = e.post || {};
    var mem = byId((S.man && S.man.members) || [], p.author);
    return [p.title, p.summary, p.date, (p.tags || []).join(' '), mem ? mem.name : p.author].join(' ');
  }

  /* 系列的入口：第一章（按 order 最小，manifest 已排好序，这里再稳一次） */
  function seriesFirstSlug(s) {
    var posts = (s && s.posts) || [];
    if (!posts.length) return '';
    var best = posts[0];
    var bestOrder = isFinite(posts[0].order) ? posts[0].order : 999;
    for (var i = 1; i < posts.length; i++) {
      var o = isFinite(posts[i].order) ? posts[i].order : 999;
      if (o < bestOrder) { best = posts[i]; bestOrder = o; }
    }
    return best ? String(best.slug || '') : '';
  }
  /* 三滑条图标：与「更多/设置」区分开 —— 它就是「调参数」的意思 */
  function slidersIcon() {
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : el('svg');
    s.setAttribute('class', 'ico');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var bars = [6, 12, 18];
    for (var i = 0; i < bars.length; i++) {
      var y = bars[i];
      var line = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'line') : el('line');
      line.setAttribute('x1', '3'); line.setAttribute('x2', '21');
      line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1.6');
      line.setAttribute('stroke-linecap', 'round');
      s.appendChild(line);
      var knob = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'circle') : el('circle');
      knob.setAttribute('cx', i === 1 ? '15' : '9');
      knob.setAttribute('cy', String(y));
      knob.setAttribute('r', '2');
      knob.setAttribute('fill', 'currentColor');
      s.appendChild(knob);
    }
    return s;
  }

  /* ---------- 大列表三件套：条数滑块 / 搜索 / 滚动区 ----------
   *
   * 首页最近更新、日期页、文章库共用，避免三处各写一遍。阈值决定要不要上控件 ——
   * 条目少的时候不该凭空多出一排控件：
   *  · 搜索框：条目数 > cfg.searchAfter（默认 6）；
   *  · 条数滑块：条目数 > cfg.limitAfter（首页 0 = 总给，其它页按需设）；
   *  · 滚动区：条目数 > cfg.scrollAfter（默认 6），套 .rows-scroll（max-height 24rem）。
   *
   * 条数说的是**条目数**（系列算一条），不是章节数 —— 否则一条 20 章的系列能把首页填满，
   * 「最近更新」也就不再「最近」。搜索时不砍条数：搜索本来就是要跨越时间找，
   * 按条数截断会让人以为站里根本没有那篇。改条数/搜索都只重绘列表，不重新渲染整页。 */
  function clampLimit(n, min, max, def) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return def;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function entryList(entries, cfg) {
    var idp = cfg.idPrefix || 'list';
    var min = cfg.min || 1, max = cfg.max || 15, def = cfg.def || 3;
    var f = document.createDocumentFragment();
    var state = { limit: def, q: '', shown: 0 };
    state.limit = cfg.key ? clampLimit(storeGet(cfg.key), min, max, def) : def;

    var wantSearch = cfg.searchAfter !== false && entries.length > (cfg.searchAfter || 6);
    var wantLimit = cfg.limitAfter !== false && entries.length > (cfg.limitAfter || 0);
    var wantScroll = cfg.scrollAfter !== false && entries.length > (cfg.scrollAfter || 6);

    var bar = el('div', 'list-bar');
    if (cfg.title) bar.appendChild(el('p', 'section-h', cfg.title));
    var tools = el('div', 'list-tools');

    var input = null;
    if (wantSearch) {
      input = el('input', 'filter-input list-search');
      input.setAttribute('type', 'search');
      input.setAttribute('placeholder', cfg.placeholder || '搜索标题 / 章节 / 标签');
      input.setAttribute('aria-label', cfg.ariaLabel || '搜索条目');
      tools.appendChild(input);
    }

    var btn = null, panel = null, range = null, val = null;
    if (wantLimit) {
      btn = el('button', 'recent-btn');
      btn.setAttribute('type', 'button');
      btn.id = idp + '-btn';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', idp + '-panel');
      btn.setAttribute('aria-label', cfg.buttonLabel || '调整显示条数');
      btn.setAttribute('title', cfg.buttonLabel || '调整显示条数');
      btn.appendChild(slidersIcon());

      panel = el('div', 'recent-panel list-panel');
      panel.id = idp + '-panel';
      panel.setAttribute('hidden', '');
      var lab = el('label', 'recent-label', '显示条数');
      lab.setAttribute('for', idp + '-range');
      val = el('span', 'recent-val', '');
      var phead = el('div', 'recent-panel-head');
      phead.appendChild(lab);
      phead.appendChild(val);
      panel.appendChild(phead);

      range = el('input', 'recent-range');
      range.setAttribute('type', 'range');
      range.id = idp + '-range';
      range.setAttribute('min', String(min));
      range.setAttribute('max', String(max));
      range.setAttribute('step', '1');
      range.setAttribute('value', String(state.limit));
      range.setAttribute('aria-label', cfg.limitLabel || '显示条数');
      panel.appendChild(range);
      panel.appendChild(el('p', 'recent-hint',
        cfg.hint || (min + '–' + max + ' 项 · 记住的选择存在本机浏览器里')));
      tools.appendChild(btn);
    }
    if (kidCount(tools)) bar.appendChild(tools);
    if (panel) bar.appendChild(panel);
    if (kidCount(bar)) f.appendChild(bar);

    var list = el(cfg.tag || 'ol', cfg.listClass || 'rows');
    list.id = idp + '-list';
    if (wantScroll) {
      var box = el('div', 'rows-scroll');
      box.appendChild(list);
      f.appendChild(box);
    } else {
      f.appendChild(list);
    }

    /* 命中判据走 entryText()：系列必须能被「章节标题 / 章节标签」搜到 ——
       否则 20 章的系列只剩系列名可搜，等于内容搜不到。 */
    function visible() {
      var q = state.q.toLowerCase();
      var out = [];
      for (var i = 0; i < entries.length; i++) {
        if (!q || entryText(entries[i]).toLowerCase().indexOf(q) >= 0) out.push(entries[i]);
      }
      if (!q) out = out.slice(0, Math.min(state.limit, out.length));
      return out;
    }

    function draw() {
      clear(list);
      var shown = visible();
      state.shown = shown.length;
      if (!shown.length) list.appendChild(el('p', 'muted', cfg.empty || '没有匹配项。'));
      else if (cfg.build) cfg.build(list, shown);
      else {
        for (var i = 0; i < shown.length; i++) list.appendChild(cfg.render(shown[i]));
      }
      if (val) {
        clear(val);
        val.appendChild(document.createTextNode(shown.length + ' 项 · 共 ' + entries.length + ' 项'));
      }
    }

    function setPanel(open) {
      if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function setLimit(n) {
      state.limit = clampLimit(n, min, max, def);
      if (cfg.key) storeSet(cfg.key, state.limit);
      if (range) range.setAttribute('value', String(state.limit));
      if (api) api.limit = state.limit;
      draw();
    }

    if (input && input.addEventListener) {
      input.addEventListener('input', function () {
        state.q = String(input.value !== undefined ? input.value : (input.getAttribute('value') || '')).trim();
        draw();
      });
    }
    if (btn && range && btn.addEventListener && range.addEventListener) {
      btn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        setPanel(panel.hasAttribute('hidden'));
      });
      /* input 事件：拖动过程中就重绘；Esc 由全局 keydown 收口 */
      range.addEventListener('input', function () { setLimit(range.value); });
    }
    draw();

    var api = {
      limit: state.limit, entries: entries, state: state, list: list, panel: panel,
      hasSearch: !!input, hasLimit: !!btn, hasScroll: wantScroll,
      setLimit: setLimit, draw: draw, setPanel: setPanel,
      close: function () { if (panel) setPanel(false); },
      setQuery: function (q) {
        if (!input) return;
        input.setAttribute('value', String(q || ''));
        state.q = String(q || '').trim();
        draw();
      }
    };
    return { frag: f, api: api };
  }

  /* 显式计数：无浏览器 DOM 的环境里 childNodes.length 会抛错（§2 硬约束） */
  function kidCount(n) {
    var c = 0;
    if (n) { for (var i = 0; n.childNodes[i] !== undefined; i++) c++; }
    return c;
  }

  /* 面板跟各自的小节走：换页时上一页的面板自己消失（节点被换掉），
     这里只负责「点面板外 / 按 Esc」时收起当前页的面板。 */
  function closeListPanels() {
    if (S.recent && S.recent.close) S.recent.close();
    if (S.dateList && S.dateList.close) S.dateList.close();
    if (S.libraryList && S.libraryList.close) S.libraryList.close();
  }
  /* ---------- 首页「最近更新」 / 日期页 / 文章库：共用的条数配置 ----------
   *
   * 条数默认 3 **条条目**（系列算一条，不是章节）；
   * 再多人眼也读不过来，太多了「最近更新」就稀释成「全部文章」。
   * 每处一个 key：首页的偏好不该连带把日期页和书库也改了。 */
  var RECENT_MIN = 1, RECENT_MAX = 15, RECENT_DEFAULT = 3;
  var RECENT_KEY = 'rec-blog:recent-limit';
  var DATE_MIN = 1, DATE_MAX = 30, DATE_DEFAULT = 6;
  var DATE_KEY = 'rec-blog:date-limit';
  var LIBRARY_MIN = 3, LIBRARY_MAX = 60, LIBRARY_DEFAULT = 12;
  var LIBRARY_KEY = 'rec-blog:library-limit';
  var LIBRARY_LIST_AFTER = 12;      /* 书库条目超过这么多才加滑块与滚动区 */
  var BROWSE_AFTER = 6;             /* 首页 / 日期页：超过这么多条目才给搜索框与滚动区 */

  /* ---------- 阅读设置（右侧设置面板；全部 localStorage，不发请求） ----------
   *
   *  · 正文字号：90–120%，只作用于 .col-main（CSS 变量 --reading-size）；
   *    代码块字号固定（.code pre），不随正文变化 —— 长代码折叠高度按行数算，
   *    跟着变会出现「显示 20 行」其实不止 20 行；
   *  · 摘要折叠：文章页摘要卡与 lede 摘要共用同一状态（默认展开）；
   *  · 目录收起：与顶栏 #toc-toggle 共用同一 key，双向同步；
   *  · 主题：空 = 跟随系统，light / dark 为手动覆盖。 */
  var READING_SIZE_MIN = 90, READING_SIZE_MAX = 120, READING_SIZE_STEP = 5, READING_SIZE_DEFAULT = 100;
  var READING_SIZE_KEY = 'rec-blog:reading-size';
  var SUMMARY_KEY = 'rec-blog:summary-collapsed';
  var TOC_KEY = 'recblog-toc-collapsed';
  var THEME_KEY = 'rec-blog:theme';
  /* 系列展开后章节超过这么多才套滚动框：短列表不添滚动条 */
  var SERIES_SCROLL_AFTER = 8;

  function clampReadingSize(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return READING_SIZE_DEFAULT;
    if (n < READING_SIZE_MIN) return READING_SIZE_MIN;
    if (n > READING_SIZE_MAX) return READING_SIZE_MAX;
    /* 只认步进的整数：手滑条之外没有别的入口，非法值一律回默认 */
    return n;
  }
  function readReadingSize() { return clampReadingSize(storeGet(READING_SIZE_KEY)); }

  /* 字号写在 documentElement 上（:root 的 --reading-size 有 CSS 默认值，
     这里覆盖它）；没有 DOM 的环境（测试桩）安静跳过。 */
  function applyReadingSize(pct) {
    var n = clampReadingSize(pct);
    storeSet(READING_SIZE_KEY, n);
    if (document.documentElement && document.documentElement.style &&
        typeof document.documentElement.style.setProperty === 'function') {
      document.documentElement.style.setProperty('--reading-size', n + '%');
    }
    return n;
  }

  var READING_LINE_MIN = 1.5, READING_LINE_MAX = 2.1, READING_LINE_DEFAULT = 1.8;
  var READING_LINE_KEY = 'rec-blog:reading-line';

  function clampReadingLine(n) {
    n = parseFloat(n);
    if (!isFinite(n)) return READING_LINE_DEFAULT;
    n = Math.round(n * 10) / 10;
    if (n < READING_LINE_MIN) return READING_LINE_MIN;
    if (n > READING_LINE_MAX) return READING_LINE_MAX;
    return n;
  }
  function readReadingLine() { return clampReadingLine(storeGet(READING_LINE_KEY)); }
  function applyReadingLine(line) {
    var n = clampReadingLine(line);
    storeSet(READING_LINE_KEY, n);
    if (document.documentElement && document.documentElement.style &&
        typeof document.documentElement.style.setProperty === 'function') {
      document.documentElement.style.setProperty('--reading-line', String(n));
    }
    return n;
  }

  function readSummaryCollapsed() { return storeGet(SUMMARY_KEY) === '1'; }
  function writeSummaryCollapsed(on) {
    storeSet(SUMMARY_KEY, on ? '1' : '0');
    syncSummarySwitch();   /* 面板开关与存储始终一致（渲染期调用也无害） */
  }

  function readTocCollapsed() { return storeGet(TOC_KEY) === '1'; }
  function writeTocCollapsed(on) { storeSet(TOC_KEY, on ? '1' : '0'); }

  /* 主题：空值 = 跟随系统（移除 data-theme，交给 prefers-color-scheme） */
  function readTheme() {
    var t = storeGet(THEME_KEY);
    return (t === 'light' || t === 'dark') ? t : '';
  }
  function applyTheme(t) {
    var v = (t === 'light' || t === 'dark') ? t : '';
    storeSet(THEME_KEY, v);
    if (document.documentElement && document.documentElement.setAttribute) {
      if (v) document.documentElement.setAttribute('data-theme', v);
      else document.documentElement.removeAttribute('data-theme');
    }
    syncThemeUI();
    return v;
  }

  function syncThemeUI() {
    var th = $('#settings-theme');
    if (th) th.value = readTheme();
  }

  function clampRecent(n) { return clampLimit(n, RECENT_MIN, RECENT_MAX, RECENT_DEFAULT); }
  function readRecent() { return clampRecent(storeGet(RECENT_KEY)); }
  function writeRecent(n) {
    n = clampRecent(n);
    storeSet(RECENT_KEY, n);
    if (S.recent && typeof S.recent.setLimit === 'function' && S.recent.limit !== n) S.recent.setLimit(n);
    return n;
  }

  /* 首页的条目：全站文章 → 收拢系列 → 取前 N 条（N 是条目数） */
  function recentEntries(limit) {
    var entries = collectEntries((S.man && S.man.posts) || []);
    return entries.slice(0, Math.min(clampRecent(limit), entries.length));
  }

  /* 首页的系列行：紧凑版 —— 日期 + 系列名 + 徽章，**不铺开章节**。
     铺开就是把 20 章从书库搬到首页，首页就不再是「最近」而是「目录」。 */
  function compactSeriesRow(s) {
    /* 不用 .row-series：那条规则是给「可展开的系列行」用的（display:block），
       首页要的是一行（.row 的网格），所以单独一个 row-series-flat。 */
    var li = el('li', 'row row-series-flat');
    li.appendChild(el('span', 'row-date', seriesLatestDate(s)));
    /* 首页的系列行 = 一条「组」，点进去是系列目录页，不是直接跳第一章 */
    if (s && s.id) li.appendChild(seriesLink(s, s.title || '系列', 'row-title'));
    else li.appendChild(el('span', 'row-title', (s && s.title) || '系列'));
    li.appendChild(el('span', 'row-words series-badge', '系列 · ' + ((s && s.posts) || []).length + ' 章'));
    return li;
  }

  /* 条目 → 行。书库与日期页用可展开的 seriesRow（章节完整、可逐章跳），
     首页用紧凑行（不铺章节）。两者只在「要不要铺章节」上不同，收拢口径是同一个。 */
  function entryRow(entry, opts) {
    opts = opts || {};
    if (entry.kind === 'series') {
      if (opts.compact) return compactSeriesRow(entry.s);
      return seriesRow(entry.s, (S.man && S.man.members) || [], entry.hits, opts);
    }
    return postRow(entry.post, (S.man && S.man.members) || []);
  }


  /* ---------- 首页「一言」 ----------
   *
   * 句子来自构建期写进 manifest 的 quotes（里人录：site/content/quotes/<成员>/quotes.sml）。
   * 前端只读本地数组、不发请求；没有句子就不显示按钮（不编造、不用占位鸡汤）。
   * 点击 → 全屏变暗 + 中间一句；8 秒自动消失，期间点页面任何位置立刻消失。
   * 关闭一定清定时器：否则看不见的计时器会在你跳到别的页面后还把浮层拉回来。 */
  var QUOTE_MS = 8000;

  function quoteList() {
    return (S.man && S.man.quotes) || [];
  }

  function quoteVisible() {
    var v = quoteVeil();
    return !!(v && !v.hasAttribute('hidden'));
  }

  /* 浮层 / 按钮是自己插到 body 上的：句柄记在 S.quote 里，不用每次 $() 再查一遍
     （既省一次查询，也免得依赖「移除后还查得到」这种用法） */
  function quoteBtn() {
    if (S.quote && S.quote.btn && S.quote.btn.parentNode) return S.quote.btn;
    return $('#quote-btn');
  }

  function quoteVeil() {
    if (S.quote && S.quote.veil && S.quote.veil.parentNode) return S.quote.veil;
    return $('#quote-veil');
  }

  function clearQuoteTimer() {
    if (S.quote && S.quote.timer) {
      if (typeof clearTimeout === 'function') clearTimeout(S.quote.timer);
      S.quote.timer = 0;
    }
  }

  function closeQuote() {
    clearQuoteTimer();
    var v = quoteVeil();
    if (v) v.setAttribute('hidden', '');
  }

  function openQuote() {
    var qs = quoteList();
    var v = quoteVeil();
    if (!qs.length || !v) return;
    clearQuoteTimer();
    var idx = Math.floor(Math.random() * qs.length);
    if (idx >= qs.length) idx = qs.length - 1;
    if (S.quote) S.quote.idx = idx;
    var q = qs[idx] || {};
    var t = (S.quote && S.quote.textEl) || $('#quote-text');
    var s = (S.quote && S.quote.srcEl) || $('#quote-source');
    if (t) { clear(t); t.appendChild(document.createTextNode(String(q.text || ''))); }
    if (s) {
      clear(s);
      var src = String(q.source || '');
      if (src) s.appendChild(document.createTextNode('— ' + src));
    }
    v.removeAttribute('hidden');
    S.quote.timer = (typeof setTimeout === 'function') ? setTimeout(closeQuote, QUOTE_MS) : 0;
  }

  /* 浮层与按钮都在 body 上（不在 #view 里）：换路由时显式拆掉，避免「上一页的浮层」 */
  function unmountQuote() {
    closeQuote();
    var b = quoteBtn();
    if (b && b.parentNode) b.parentNode.removeChild(b);
    var v = quoteVeil();
    if (v && v.parentNode) v.parentNode.removeChild(v);
    if (S.quote) { S.quote.btn = null; S.quote.veil = null; S.quote.textEl = null; S.quote.srcEl = null; }
    if (document.body && document.body.classList) document.body.classList.remove('quote-anim');
  }

  function mountQuote() {
    unmountQuote();
    if (!quoteList().length || !document.body) return;
    if (!reducedMotion()) document.body.classList.add('quote-anim');
    var btn = el('button', 'quote-btn');
    btn.setAttribute('type', 'button');
    btn.setAttribute('id', 'quote-btn');
    btn.setAttribute('aria-label', '读一句');
    btn.setAttribute('title', '读一句');
    /* 用给定的右引号 SVG path，不依赖字体字形。 */
    var mark = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : el('svg');
    mark.setAttribute('class', 'quote-btn-svg');
    mark.setAttribute('viewBox', '0 0 1300 1300');
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('fill', 'currentColor');
    var glyph = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : el('path');
    glyph.setAttribute('d', 'M1022.476 0v439.434c1.869 63.227-7.249 122.599-27.345 178.114s-48.267 104.363-84.73 146.559c-36.345 42.070-79.822 77.018-130.664 104.835-50.725 27.699-105.769 45.463-165.141 53.057v-189.564c72.809-24.895 122.599-61.704 149.363-110.56 26.882-48.856 40.201-108.692 40.201-179.512h-189.557v-442.356h407.872zM410.66 0v439.434c1.987 63.227-7.131 122.599-27.228 178.115-20.104 55.515-48.385 104.363-84.73 146.559-36.345 42.070-79.938 77.018-130.664 104.835-50.725 27.699-105.887 45.463-165.258 53.057v-189.564c72.809-24.895 122.599-61.704 149.363-110.56 26.882-48.856 40.201-108.692 40.201-179.512h-189.564v-442.356h407.88z');
    /* path bbox 约 x:2.78–1022.7（中心 512.7），y:0–922（中心 461）；
       viewBox 1300 的中心是 650，故平移 (137.25, 189) 让引号视觉居中。
       同时 1300 的视框让引号在 30px 图标里比 1024 时略小，和扳手观感一致。 */
    glyph.setAttribute('transform', 'translate(137.25 189)');
    mark.appendChild(glyph);
    btn.appendChild(mark);
    if (btn.addEventListener) {
      btn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (quoteVisible()) closeQuote(); else openQuote();
      });
    }
    var veil = el('div', 'quote-veil');
    veil.setAttribute('id', 'quote-veil');
    veil.setAttribute('hidden', '');
    veil.setAttribute('role', 'presentation');
    var card = el('div', 'quote-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '一言');
    var p = el('p', 'quote-text');
    p.id = 'quote-text';
    var s = el('p', 'quote-source');
    s.id = 'quote-source';
    card.appendChild(p);
    card.appendChild(s);
    veil.appendChild(card);
    document.body.appendChild(btn);
    document.body.appendChild(veil);
    S.quote.btn = btn;
    S.quote.veil = veil;
    S.quote.textEl = p;
    S.quote.srcEl = s;
  }

  /* ---------- 右侧设置面板（静态节点在 index.html，这里只接线） ---------- */

  function settingsPanel() {
    if (S.settings && S.settings.panel && S.settings.panel.parentNode) return S.settings.panel;
    return $('#settings-panel');
  }

  function settingsOpen() {
    var p = settingsPanel();
    return !!(p && !p.hasAttribute('hidden'));
  }

  function openSettings() {
    var p = settingsPanel();
    if (!p) return;
    p.removeAttribute('hidden');
    var fab = $('#settings-fab');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    var tab = $('#settings-tab-reading');
    if (tab && tab.focus) tab.focus();
  }

  function closeSettings() {
    var p = settingsPanel();
    if (!p) return;
    p.setAttribute('hidden', '');
    var fab = $('#settings-fab');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  }

  function toggleSettings() {
    if (settingsOpen()) closeSettings(); else openSettings();
  }

  /* 目录收起：顶栏按钮与设置面板开关的唯一实现，两边都调它 */
  function applyTocCollapsed(on) {
    if (document.body && document.body.classList) {
      if (on) document.body.classList.add('toc-collapsed');
      else document.body.classList.remove('toc-collapsed');
    }
    writeTocCollapsed(on);
    var tt = $('#toc-toggle');
    if (tt) {
      tt.setAttribute('aria-pressed', on ? 'true' : 'false');
      tt.setAttribute('aria-label', on ? '展开目录' : '收起目录');
      tt.setAttribute('title', on ? '展开目录' : '收起目录');
    }
    syncTocSwitch();
  }

  function syncTocSwitch() {
    var sw = $('#settings-toc');
    if (sw) sw.checked = readTocCollapsed();
  }

  function syncSummarySwitch() {
    var sw = $('#settings-summary');
    if (sw) sw.checked = readSummaryCollapsed();
  }

  function syncSizeUI() {
    var n = readReadingSize();
    var range = $('#settings-size');
    if (range) range.value = String(n);
    var val = $('#settings-size-val');
    if (val) { clear(val); val.appendChild(document.createTextNode(n + '%')); }
  }

  function syncLineUI() {
    var n = readReadingLine();
    var range = $('#settings-line');
    if (range) range.value = String(n);
    var val = $('#settings-line-val');
    if (val) { clear(val); val.appendChild(document.createTextNode(n.toFixed(1))); }
  }

  function syncRecentUI() {
    var n = readRecent();
    var range = $('#settings-recent');
    if (range) range.value = String(n);
    var val = $('#settings-recent-val');
    if (val) { clear(val); val.appendChild(document.createTextNode(String(n))); }
  }

  /* tab 切换：segmented 两个按钮，aria-selected 与面板 hidden 联动 */
  function selectSettingsTab(which) {
    var panes = { reading: $('#settings-pane-reading'), site: $('#settings-pane-site') };
    var tabs = { reading: $('#settings-tab-reading'), site: $('#settings-tab-site') };
    var keys = ['reading', 'site'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var on = k === which;
      var tab = tabs[k];
      if (tab) tab.setAttribute('aria-selected', on ? 'true' : 'false');
      var pane = panes[k];
      if (pane) {
        if (on) pane.removeAttribute('hidden'); else pane.setAttribute('hidden', '');
      }
    }
  }

  /* 站点 tab 的链接区：仓库 + 许可，只读展示（不造第二套设置） */
  function buildSettingsLinks() {
    var box = $('#settings-links');
    if (!box || !S.man) return;
    clear(box);
    var m = S.man;
    if (m.site && m.site.repo_url) {
      var row = el('p');
      row.appendChild(el('span', '', '仓库：'));
      row.appendChild(outLink(m.site.repo_url, m.site.repo_url));
      box.appendChild(row);
    }
    if (m.site && m.site.license) box.appendChild(el('p', '', '默认许可：' + m.site.license));
    box.appendChild(el('p', '', '许可细节见页脚声明。'));
  }

  /* 首页扳手：只在首页挂载，位置在「一言」按钮上方（CSS bottom 4.7rem，不重叠）。
     换页卸载，避免别的页面冒出不该有的入口。 */
  function unmountWrench() {
    if (S.settings && S.settings.wrench && S.settings.wrench.parentNode) {
      S.settings.wrench.parentNode.removeChild(S.settings.wrench);
    }
    if (S.settings) S.settings.wrench = null;
  }

  function mountWrench() {
    unmountWrench();
    if (!document.body) return;
    var b = el('button', 'settings-wrench');
    b.setAttribute('type', 'button');
    b.setAttribute('id', 'settings-wrench');
    b.setAttribute('aria-label', '打开设置');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'settings-panel');
    b.setAttribute('title', '设置');
    var svg = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : el('svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    var path = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : el('path');
    path.setAttribute('d', 'M 737.099 331.708 c 10.6803 10.6906 28.0228 10.6906 38.7236 0 l 151.646 -119.387 C 966.755 332.021 901.57 460.912 781.86 500.197 c -42.4714 13.9489 -88.106 15.104 -131.243 3.32083 l -147.098 147.098 c 33.2165 121.542 -38.4 246.956 -159.922 280.162 c -43.1473 11.8047 -88.8033 10.6394 -131.295 -3.30957 l 119.387 -151.646 c 10.6906 -10.7008 10.6906 -28.0443 0 -38.7236 l -44.7713 -44.7816 c -10.6906 -10.7008 -28.0433 -10.7223 -38.7441 -0.02048 c 0 0 -0.01024 0 -0.01024 0.02048 l -151.646 119.398 C 57.2518 692.004 122.456 563.134 242.156 523.848 c 42.5021 -13.9377 88.1695 -15.0835 131.317 -3.27885 l 147.098 -147.097 C 487.311 251.961 558.867 126.495 680.388 93.2362 c 43.137 -11.8149 88.8136 -10.6691 131.327 3.27885 L 692.338 248.161 c -10.7008 10.6803 -10.7008 28.0115 -0.021504 38.7133 c 0 0 0.021504 0.01024 0.021504 0.021504 L 737.099 331.708 Z');
    svg.appendChild(path);
    b.appendChild(svg);
    if (b.addEventListener) {
      b.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        toggleSettings();
        b.setAttribute('aria-expanded', settingsOpen() ? 'true' : 'false');
      });
    }
    document.body.appendChild(b);
    if (S.settings) S.settings.wrench = b;
  }

  /* 启动时接线一次：静态面板 + 右缘三角 + 全局 Esc / 点外部关闭 */
  function mountSettings() {
    if (S.settings && S.settings.done) return;
    S.settings = S.settings || {};
    var panel = $('#settings-panel');
    if (panel) S.settings.panel = panel;

    var fab = $('#settings-fab');
    if (fab && fab.addEventListener) {
      fab.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        toggleSettings();
      });
    }
    var tRead = $('#settings-tab-reading');
    var tSite = $('#settings-tab-site');
    if (tRead && tRead.addEventListener) tRead.addEventListener('click', function () { selectSettingsTab('reading'); });
    if (tSite && tSite.addEventListener) tSite.addEventListener('click', function () { selectSettingsTab('site'); });

    /* 阅读 tab */
    var size = $('#settings-size');
    if (size && size.addEventListener) {
      size.addEventListener('input', function () {
        var n = applyReadingSize(size.value);
        syncSizeUI();
      });
    }
    var sizeReset = $('#settings-size-reset');
    if (sizeReset && sizeReset.addEventListener) {
      sizeReset.addEventListener('click', function () {
        applyReadingSize(READING_SIZE_DEFAULT);
        syncSizeUI();
      });
    }
    var line = $('#settings-line');
    if (line && line.addEventListener) {
      line.addEventListener('input', function () {
        applyReadingLine(line.value);
        syncLineUI();
      });
    }
    var sumSw = $('#settings-summary');
    if (sumSw && sumSw.addEventListener) {
      sumSw.addEventListener('change', function () {
        writeSummaryCollapsed(!!sumSw.checked);
        /* 当前页已渲染的摘要卡不会自动跟进：重画一次路由即可 */
        if (typeof render === 'function') render();
      });
    }
    var tocSw = $('#settings-toc');
    if (tocSw && tocSw.addEventListener) {
      tocSw.addEventListener('change', function () {
        applyTocCollapsed(!!tocSw.checked);
      });
    }
    var resetAll = $('#settings-reset-all');
    if (resetAll && resetAll.addEventListener) {
      resetAll.addEventListener('click', function () {
        applyReadingSize(READING_SIZE_DEFAULT);
        applyReadingLine(READING_LINE_DEFAULT);
        writeSummaryCollapsed(false);
        applyTocCollapsed(false);
        syncSizeUI(); syncLineUI(); syncSummarySwitch();
        if (typeof render === 'function') render();
      });
    }

    /* 站点 tab */
    var theme = $('#settings-theme');
    if (theme && theme.addEventListener) {
      theme.addEventListener('change', function () { applyTheme(theme.value); });
    }
    var recent = $('#settings-recent');
    if (recent && recent.addEventListener) {
      recent.addEventListener('input', function () {
        var n = writeRecent(recent.value);
        syncRecentUI();
      });
    }
    /* 初值：面板控件的显示状态与存储一致 */
    applyReadingSize(readReadingSize());
    applyReadingLine(readReadingLine());
    syncSizeUI(); syncLineUI(); syncSummarySwitch(); syncTocSwitch(); syncRecentUI(); syncThemeUI();
    S.settings.done = true;
  }

  /* ---------- 代码块：长代码折叠 + 语法高亮 ----------
   *
   * 折叠阈值来自 site.sml 的 code_collapse_lines（默认 20 行）：
   *  · 折叠只加 CSS 类 + max-height，**不改动 DOM 里的代码文本** —— 复制按钮取的是
   *    textContent，折叠状态下复制到的仍然是完整代码；
   *  · 所有改动都在运行时做：禁用 JS 时代码块保持原样全展开；
   *  · 高亮交给本地 vendor 的 Prism（MIT），失败就退回纯文本。 */
  var CODE_COLLAPSE_DEFAULT = 20;

  function codeCollapseLines() {
    var n = parseInt((S.man && S.man.site && S.man.site.code_collapse_lines), 10);
    return (isFinite(n) && n > 0) ? n : CODE_COLLAPSE_DEFAULT;
  }

  function countLines(text) {
    var s = String(text || '');
    if (!s) return 0;
    var n = 1;
    for (var i = 0; i < s.length; i++) { if (s.charAt(i) === '\n') n++; }
    return s.charAt(s.length - 1) === '\n' ? n - 1 : n;
  }

  function setupCodeBlocks(viewEl) {
    if (!viewEl || typeof viewEl.querySelectorAll !== 'function') return;
    var boxes = viewEl.querySelectorAll('.code');
    var limit = codeCollapseLines();
    for (var i = 0; i < boxes.length; i++) setupOneCodeBox(boxes[i], limit);
  }

  function setupOneCodeBox(box, limit) {
    var code = box.getElementsByTagName ? box.getElementsByTagName('code')[0] : null;
    if (!code) return;
    var lines = countLines(code.textContent);
    if (lines <= limit) return;                       /* 短代码：一个按钮都不给 */
    var head = null;
    var kids = box.childNodes;
    for (var k = 0; k < kids.length; k++) {
      if (kids[k] && kids[k].className && String(kids[k].className).indexOf('code-head') >= 0) head = kids[k];
    }
    if (!head) return;
    box.className = String(box.className || '') + ' code-long';
    if (box.style && box.style.setProperty) box.style.setProperty('--code-lines', String(limit));

    var pre = null;
    for (var j = 0; j < kids.length; j++) {
      if (kids[j] && kids[j].tagName && String(kids[j].tagName).toLowerCase() === 'pre') pre = kids[j];
    }
    if (pre && !pre.id) pre.id = 'code-pre-' + nextCodeId();

    var btn = el('button', 'code-more');
    btn.setAttribute('type', 'button');
    if (pre) btn.setAttribute('aria-controls', pre.id);

    var apply = function (collapsed) {
      /* 折叠态给「展开全部（N 行）」，展开态给「收起」：按钮说的是「点了会发生什么」 */
      clear(btn);
      btn.appendChild(document.createTextNode(collapsed ? '展开全部（' + lines + ' 行）' : '收起'));
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('title', collapsed ? '展开全部 ' + lines + ' 行' : '收起这段代码');
      var cls = String(box.className || '').replace(' is-collapsed', '').replace('is-collapsed', '').trim();
      box.className = (collapsed ? cls + ' is-collapsed' : cls).trim();
    };
    apply(true);
    if (btn.addEventListener) {
      btn.addEventListener('click', function () {
        apply(String(box.className || '').indexOf('is-collapsed') < 0);
      });
    }
    head.appendChild(btn);
  }

  var CODE_SEQ = 0;
  function nextCodeId() { CODE_SEQ++; return String(CODE_SEQ); }

  function highlightCode(viewEl) {
    if (!viewEl) return false;
    var P = (typeof window !== 'undefined') ? window.Prism : null;
    if (!P || typeof P.highlightAllUnder !== 'function') return false;
    try {
      P.highlightAllUnder(viewEl);
      return true;
    } catch (e) {
      return false;                                  /* 高亮失败：正文原样是纯文本，够读 */
    }
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
    var dayStr = String(day || '');
    var dayPosts = [];
    for (var i = 0; i < (m.posts || []).length; i++) {
      if (String(m.posts[i].date || '').slice(0, 10) === dayStr) dayPosts.push(m.posts[i]);
    }
    /* 先按日期过滤，再收拢系列：同一天发完 20 章也只占一条，和书库、首页一个口径 */
    var entries = collectEntries(dayPosts);
    var seriesCount = 0;
    for (var j = 0; j < entries.length; j++) { if (entries[j].kind === 'series') seriesCount++; }
    var lede = dayPosts.length
      ? '这一天发了 ' + dayPosts.length + ' 篇，归为 ' + entries.length + ' 项（'
        + seriesCount + ' 个系列 + ' + (entries.length - seriesCount) + ' 篇单篇）。'
      : '这一天没有文章（日期来自 front matter 的 date 字段）。';
    f.appendChild(pageHead('日期', dayStr, lede));

    if (entries.length) {
      var built = entryList(entries, {
        idPrefix: 'date',
        key: DATE_KEY, min: DATE_MIN, max: DATE_MAX, def: DATE_DEFAULT,
        searchAfter: BROWSE_AFTER, limitAfter: BROWSE_AFTER, scrollAfter: BROWSE_AFTER,
        placeholder: '在这一天里搜：标题 / 章节 / 标签',
        ariaLabel: '在这一天的条目里搜索',
        limitLabel: '本页显示条数',
        buttonLabel: '调整本页显示条数',
        empty: '没有匹配的条目。',
        render: function (entry) {
          return entryRow(entry, {
            hitText: function (h) { return '（本日 ' + h + ' 章）'; }
          });
        }
      });
      S.dateList = built.api;
      f.appendChild(built.frag);
    }
    setToc([], '', '');
    return Promise.resolve(f);
  }


  /* 摘要卡：<details>/<summary> 可折叠结构，默认展开；折叠状态与文章 lede
     摘要共用 SUMMARY_KEY（设置面板「折叠文章摘要」一个开关管两者）。
     折叠只改 open 属性，卡内文本始终在 DOM 里（不误删正文）。 */
  function summaryCard(s) {
    var box = el('details', 'ai-summary');
    var h = el('summary', 'ai-head');
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
    if (!readSummaryCollapsed()) box.setAttribute('open', 'open');
    rememberFold(box);
    return box;
  }

  /* 文章合集：一个系列一个目录页（#/series/<id>），按 order 列出全部章节。
     索引页只给「组」（一行 + 可展开的章节预览），完整目录集中在这一页 ——
     否则一条 20 章的系列能把书库和首页同时铺满。 */
  function viewSeries(id) {
    var m = S.man;
    var s = byId(m.series || [], id);
    var f = document.createDocumentFragment();
    if (!s) {
      f.appendChild(el('h1', '', '没有这个系列'));
      f.appendChild(el('p', 'muted', '系列 id：' + String(id === undefined || id === null ? '' : id)));
      setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(crumb([['文章库', '#/library'], [s.title, '']]));
    f.appendChild(el('h1', '', s.title));
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
    f.appendChild(el('p', 'lede', '共 ' + chapters.length + ' 章 · 系列'));

    var first = seriesFirstSlug(s);
    if (first) {
      var start = el('p', 'chips');
      start.appendChild(lnk('#/post/' + first, '从第一章开始阅读 →', 'chip'));
      f.appendChild(start);
    }

    f.appendChild(el('p', 'section-h', '目录'));
    var ol = el('ol', 'rows');
    var n = 0;
    for (var i = 0; i < chapters.length; i++) {
      var p = bySlug(m.posts, chapters[i].slug);
      if (!p) continue;                 /* 章节在 manifest 里查不到就跳过，绝不编一行 */
      ol.appendChild(postRow(p, m.members));
      n++;
    }
    f.appendChild(ol);
    if (!n) f.appendChild(el('p', 'muted', '这个系列还没有可显示的章节。'));
    setToc([], '', '');
    return Promise.resolve(f);
  }

  /* 折叠状态写库：浏览器原生 toggle 事件；桩环境没有 toggle 派发也不报错。
     summary 的 click 兜底一层（toggle 事件在个别旧内核上不触发）。 */
  function rememberFold(details) {
    if (!details || !details.addEventListener) return;
    var save = function () {
      writeSummaryCollapsed(!details.hasAttribute('open'));
      syncSummarySwitch();
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
    var m = S.man;
    var f = document.createDocumentFragment();
    var head = el('header', 'page-head');
    head.appendChild(el('p', 'kicker', '共建博客'));
    head.appendChild(el('h1', '', '文章库'));
    var grouped = 0;
    for (var gsi = 0; gsi < (m.series || []).length; gsi++) {
      if (((m.series[gsi].posts || []).length) > 1) grouped++;
    }
    var lede = '共 ' + m.posts.length + ' 篇，按年份分组。' +
      (grouped ? ' 多章系列折叠为 ' + grouped + ' 条。' : '') +
      (query && query.tag ? '当前筛选标签：#' + query.tag : '');
    head.appendChild(el('p', 'lede', lede));
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
    var entries = collectEntries(posts);

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
        var d = el('details');
        if (yi === 0) d.setAttribute('open', 'open');
        d.appendChild(el('summary', '', yr + ' 年（' + years[yr].length + ' 项）'));
        var ol = el('ol', 'rows');
        for (var ri = 0; ri < years[yr].length; ri++) {
          var entry = years[yr][ri];
          var li = entryRow(entry);
          li.setAttribute('data-rowclass', entry.kind === 'series' ? 'row row-series' : 'row');
          li.setAttribute('data-filter', entryText(entry));
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
    if (entries.length > LIBRARY_LIST_AFTER) {
      var built = entryList(entries, {
        idPrefix: 'library', tag: 'div', listClass: 'library-groups',
        key: LIBRARY_KEY, min: LIBRARY_MIN, max: LIBRARY_MAX, def: LIBRARY_DEFAULT,
        searchAfter: false, limitAfter: 0, scrollAfter: LIBRARY_LIST_AFTER,
        buttonLabel: '调整书库显示条数', limitLabel: '书库显示条数',
        empty: '没有匹配的文章。',
        build: buildYears
      });
      S.libraryList = built.api;
      f.appendChild(built.frag);
    } else {
      var host = el('div', 'library-groups');
      buildYears(host, entries);
      if (!rowNodes.length) host.appendChild(el('p', 'muted', '没有匹配的文章。'));
      f.appendChild(host);
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

    /* 有构建期摘要卡时，不再渲染一份同样的 lede，避免两段摘要重复。
       没有摘要卡时，lede 仍可单独折叠；两者共用同一折叠状态。 */
    if (p.ai_summary) {
      f.appendChild(summaryCard(p.ai_summary));
    } else if (shownSummary) {
      var ledeBox = el('details', 'lede-box');
      ledeBox.appendChild(el('summary', 'lede-sum', '文章摘要'));
      ledeBox.appendChild(el('p', 'lede', shownSummary));
      if (!readSummaryCollapsed()) ledeBox.setAttribute('open', 'open');
      rememberFold(ledeBox);
      f.appendChild(ledeBox);
    } else {
      f.appendChild(el('p', 'lede', ''));
    }

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
    series: function (r) { return viewSeries(r.seg[1]); },
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
    /* 兼容首次渲染（直接子节点）和二次渲染（已嵌套在 .footer-legal 内）。 */
    var nodes = foot.querySelectorAll
      ? foot.querySelectorAll('span')
      : (foot.children || []);
    for (var ki = 0; ki < nodes.length; ki++) {
      var c = nodes[ki];
      if (c && c.id && c.id.indexOf('license-notice') === 0) keep.push(c);
    }
    clear(foot);
    function builtAtText(v) {
      var s = String(v || '');
      if (!s) return '';
      var d = new Date(s);
      if (isNaN(d.getTime())) return s.slice(0, 16).replace('T', ' ');
      function p2(n) { return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
        ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    var meta = el('div', 'footer-meta');
    meta.appendChild(el('span', '', '构建于 ' + builtAtText(m.built_at)));
    meta.appendChild(lnk('feed.xml', 'RSS'));
    meta.appendChild(lnk('sitemap.xml', 'Sitemap'));
    meta.appendChild(lnk('llms.txt', 'llms.txt'));
    if (m.site.repo_url) meta.appendChild(outLink(m.site.repo_url, '仓库'));
    if (m.site.license) meta.appendChild(el('span', '', '默认许可 ' + m.site.license));
    var credit = el('span', '', 'Powered by ');
    credit.appendChild(outLink('https://gitee.com/snoware', 'snoware'));
    credit.appendChild(el('span', '', ' & '));
    credit.appendChild(outLink('https://sml.swebase.cn', 'SML'));
    meta.appendChild(credit);
    var fontCredit = el('span', '', '字体：');
    fontCredit.appendChild(outLink('https://hyperos.mi.com/font/', 'MiSans'));
    fontCredit.appendChild(el('span', '', '（小米）'));
    meta.appendChild(fontCredit);
    foot.appendChild(meta);
    if (keep.length) {
      var legal = el('div', 'footer-legal');
      for (var kj = 0; kj < keep.length; kj++) legal.appendChild(keep[kj]);
      foot.appendChild(legal);
    }
  }

  function render() {
    return loadManifest().then(function (m) {
      S.man = m;
      var r = route();
      var key = r.seg[0] || 'home';
      S.page = key;
      /* 条数面板的句柄只属于当前页：换页先清空，别让上一页的句柄留在这儿被 Esc 摸到 */
      S.recent = null; S.dateList = null; S.libraryList = null;
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
        /* 正文落地后的三步加工：长代码折叠 → 高亮 → 首页「一言」浮层。
           顺序有意义：折叠先给 <pre> 建好 id 与类，高亮只改 <code> 内部。 */
        setupCodeBlocks(viewEl);
        highlightCode(viewEl);
        if (key === 'home') { mountQuote(); mountWrench(); } else { unmountQuote(); unmountWrench(); }
        buildToc();
        buildFooter();
        buildSettingsLinks();
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
    /* 主题与正文字号：先应用存储里的状态，再画页面（避免明暗跳变） */
    applyTheme(readTheme());
    applyReadingSize(readReadingSize());
    mountSettings();
    /* 桌面端左侧目录收起；状态存 localStorage，与设置面板开关共用 TOC_KEY */
    var tt = $('#toc-toggle');
    if (tt && tt.addEventListener) {
      applyTocCollapsed(readTocCollapsed());
      tt.addEventListener('click', function () {
        applyTocCollapsed(!readTocCollapsed());
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
        /* 一言浮层：出现期间点页面任何位置都立刻消失（包括点浮层自己） */
        if (quoteVisible()) closeQuote();
        /* 面板外的点击收起「显示条数」面板（按钮自己会 stopPropagation） */
        if (t && typeof t.closest === 'function' && !t.closest('.list-panel')) closeListPanels();
        /* 设置面板：点面板外 / 入口三角外关闭（入口与面板自己会 stopPropagation） */
        if (t && typeof t.closest === 'function' &&
            !t.closest('#settings-panel') && !t.closest('#settings-fab') && !t.closest('#settings-wrench')) {
          closeSettings();
        }
        if (t && typeof t.closest === 'function' && t.closest('[data-close]')) {
          if (ev.preventDefault) ev.preventDefault();
          hideModal();
        }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev && ev.key === 'Escape') {
          hideModal();
          closeQuote();
          closeListPanels();
          closeSettings();
        }
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
      /* 阅读控制三项（最近条数 / 一言 / 代码块），测试直接驱动这几个钩子 */
      recent: {
        key: RECENT_KEY, min: RECENT_MIN, max: RECENT_MAX, def: RECENT_DEFAULT,
        read: readRecent, write: writeRecent, clamp: clampRecent, list: recentEntries,
        closePanel: closeListPanels
      },
      date: {
        key: DATE_KEY, min: DATE_MIN, max: DATE_MAX, def: DATE_DEFAULT
      },
      library: {
        key: LIBRARY_KEY, min: LIBRARY_MIN, max: LIBRARY_MAX, def: LIBRARY_DEFAULT,
        after: LIBRARY_LIST_AFTER
      },
      browseAfter: BROWSE_AFTER,
      /* 条目收集：三处（首页 / 日期页 / 书库）共用同一份口径，测试直接打这些钩子 */
      entries: {
        collect: collectEntries, sort: sortEntries, text: entryText,
        title: entryTitle, key: entryKey, updated: entryUpdated,
        list: entryList, row: entryRow, clampLimit: clampLimit,
        seriesFirst: seriesFirstSlug, closePanels: closeListPanels
      },
      quotes: {
        autoMs: QUOTE_MS, list: quoteList, open: openQuote, close: closeQuote,
        mount: mountQuote, unmount: unmountQuote, visible: quoteVisible
      },
      /* 设置面板与阅读设置（字号 / 摘要折叠 / 目录收起 / 主题） */
      settings: {
        key: {
          size: READING_SIZE_KEY, line: READING_LINE_KEY,
          summary: SUMMARY_KEY, toc: TOC_KEY, theme: THEME_KEY
        },
        size: {
          min: READING_SIZE_MIN, max: READING_SIZE_MAX, step: READING_SIZE_STEP, def: READING_SIZE_DEFAULT,
          read: readReadingSize, write: applyReadingSize, clamp: clampReadingSize
        },
        line: {
          min: READING_LINE_MIN, max: READING_LINE_MAX, def: READING_LINE_DEFAULT,
          read: readReadingLine, write: applyReadingLine, clamp: clampReadingLine
        },

        summary: { read: readSummaryCollapsed, write: writeSummaryCollapsed },
        toc: { read: readTocCollapsed, write: writeTocCollapsed, apply: applyTocCollapsed },
        theme: { read: readTheme, write: applyTheme },
        panel: { open: openSettings, close: closeSettings, toggle: toggleSettings, isOpen: settingsOpen },
        tab: selectSettingsTab,
        wrench: { mount: mountWrench, unmount: unmountWrench },
        seriesScrollAfter: SERIES_SCROLL_AFTER
      },
      code: {
        threshold: codeCollapseLines, setup: setupCodeBlocks,
        highlight: highlightCode, countLines: countLines
      },
      buildSiteNav: buildSiteNav, buildToc: buildToc, route: route,
      viewLibrary: viewLibrary, viewSeries: viewSeries, viewPost: viewPost, viewTopic: viewTopic,
      viewProject: viewProject, viewMember: viewMember, viewService: viewService,
      viewWeeklyItem: viewWeeklyItem, viewPage: viewPage, viewJoin: viewJoin,
      viewSearch: viewSearch, viewMembers: viewMembers, viewServices: viewServices,
      viewProjects: viewProjects, viewTopics: viewTopics, viewKnowledge: viewKnowledge,
      viewResources: viewResources, viewPages: viewPages, viewWeekly: viewWeekly
    };
  }
})();
