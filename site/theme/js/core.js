'use strict';
/* js/core.js —— 状态 / 标签表 / 基础工具 / 本地存储 / 数据装载 / 右栏站点导航 / 左栏本文目录 / setForm / goto / route / buildFooter / render / boot。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  /* 命名空间由本文件创建（core.js 必须第一个加载）；其余模块只往上挂导出 */
  window.REC = window.REC || {};
  var R = window.REC;

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

  function setForm(form) {
    if (!form) return;
    if (document.body && document.body.setAttribute) document.body.setAttribute('data-form', form);
  }

  /* ---------- 路由 ---------- */
  function goto(h) { if (typeof location !== 'undefined') location.hash = h; }

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
      var fn = R.VIEWS[key];
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
        R.setupCodeBlocks(viewEl);
        R.highlightCode(viewEl);
        if (key === 'home') { R.mountQuote(); R.mountWrench(); } else { R.unmountQuote(); R.unmountWrench(); }
        buildToc();
        buildFooter();
        R.buildSettingsLinks();
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
    R.applyTheme(R.readTheme());
    R.applyReadingSize(R.readReadingSize());
    R.mountSettings();
    /* 桌面端左侧目录收起；状态存 localStorage，与设置面板开关共用 TOC_KEY */
    var tt = $('#toc-toggle');
    if (tt && tt.addEventListener) {
      R.applyTocCollapsed(R.readTocCollapsed());
      tt.addEventListener('click', function () {
        R.applyTocCollapsed(!R.readTocCollapsed());
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
        R.openStructure();
      });
    }
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        /* 一言浮层：出现期间点页面任何位置都立刻消失（包括点浮层自己） */
        if (R.quoteVisible()) R.closeQuote();
        /* 面板外的点击收起「显示条数」面板（按钮自己会 stopPropagation） */
        if (t && typeof t.closest === 'function' && !t.closest('.list-panel')) R.closeListPanels();
        /* 设置面板：点面板外 / 入口三角外关闭（入口与面板自己会 stopPropagation） */
        if (t && typeof t.closest === 'function' &&
            !t.closest('#settings-panel') && !t.closest('#settings-fab') && !t.closest('#settings-wrench')) {
          R.closeSettings();
        }
        if (t && typeof t.closest === 'function' && t.closest('[data-close]')) {
          if (ev.preventDefault) ev.preventDefault();
          R.hideModal();
        }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev && ev.key === 'Escape') {
          R.hideModal();
          R.closeQuote();
          R.closeListPanels();
          R.closeSettings();
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

  /* ---- 本模块导出到 REC ---- */
  R.S = S;
  R.NAV_LABEL = NAV_LABEL;
  R.CONTACT_LABEL = CONTACT_LABEL;
  R.STATUS_LABEL = STATUS_LABEL;
  R.SERVICE_STATUS_LABEL = SERVICE_STATUS_LABEL;
  R.KIND_LABEL = KIND_LABEL;
  R.FORM_BY_TAG = FORM_BY_TAG;
  R.$ = $;
  R.el = el;
  R.lnk = lnk;
  R.clear = clear;
  R.frag = frag;
  R.safeUrl = safeUrl;
  R.outLink = outLink;
  R.num = num;
  R.minutes = minutes;
  R.cut = cut;
  R.byId = byId;
  R.bySlug = bySlug;
  R.uniq = uniq;
  R.loadManifest = loadManifest;
  R.fragment = fragment;
  R.buildSiteNav = buildSiteNav;
  R.setToc = setToc;
  R.buildToc = buildToc;
  R.markToc = markToc;
  R.spyToc = spyToc;
  R.storeGet = storeGet;
  R.storeSet = storeSet;
  R.reducedMotion = reducedMotion;
  R.setForm = setForm;
  R.route = route;
  R.goto = goto;
  R.buildFooter = buildFooter;
  R.render = render;
  R.boot = boot;
})();
