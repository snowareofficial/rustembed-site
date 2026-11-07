'use strict';
/* js/entries.js —— 条目收集（系列收拢的唯一实现）/ 大列表三件套（滑块 + 搜索 + 滚动区）/ 各列表条数配置 / 最近条数持久化 / entryRow。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

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
    var series = opts.series || ((R.S.man && R.S.man.series) || []);
    var groups = {};
    var out = [];
    for (var i = 0; i < (posts || []).length; i++) {
      var p = posts[i];
      if (!p) continue;
      var s = p.series ? R.byId(series, p.series) : null;
      if (s && (s.posts || []).length > 1) {
        var g = groups[s.id];
        if (!g) {
          g = { kind: 'series', s: s, hits: 0,
                date: R.seriesLatestDate(s) || String(p.date || '') };
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
        var sp = R.bySlug((R.S.man && R.S.man.posts) || [], chapters[i].slug);
        if (sp) names.push((sp.tags || []).join(' '));
      }
      names.push('系列');
      return names.join(' ');
    }
    var p = e.post || {};
    var mem = R.byId((R.S.man && R.S.man.members) || [], p.author);
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
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : R.el('svg');
    s.setAttribute('class', 'ico');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var bars = [6, 12, 18];
    for (var i = 0; i < bars.length; i++) {
      var y = bars[i];
      var line = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'line') : R.el('line');
      line.setAttribute('x1', '3'); line.setAttribute('x2', '21');
      line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1.6');
      line.setAttribute('stroke-linecap', 'round');
      s.appendChild(line);
      var knob = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'circle') : R.el('circle');
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
    state.limit = cfg.key ? clampLimit(R.storeGet(cfg.key), min, max, def) : def;

    var wantSearch = cfg.searchAfter !== false && entries.length > (cfg.searchAfter || 6);
    var wantLimit = cfg.limitAfter !== false && entries.length > (cfg.limitAfter || 0);
    var wantScroll = cfg.scrollAfter !== false && entries.length > (cfg.scrollAfter || 6);

    var bar = R.el('div', 'list-bar');
    if (cfg.title) bar.appendChild(R.el('p', 'section-h', cfg.title));
    var tools = R.el('div', 'list-tools');

    var input = null;
    if (wantSearch) {
      input = R.el('input', 'filter-input list-search');
      input.setAttribute('type', 'search');
      input.setAttribute('placeholder', cfg.placeholder || '搜索标题 / 章节 / 标签');
      input.setAttribute('aria-label', cfg.ariaLabel || '搜索条目');
      tools.appendChild(input);
    }

    var btn = null, panel = null, range = null, val = null;
    if (wantLimit) {
      btn = R.el('button', 'recent-btn');
      btn.setAttribute('type', 'button');
      btn.id = idp + '-btn';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', idp + '-panel');
      btn.setAttribute('aria-label', cfg.buttonLabel || '调整显示条数');
      btn.setAttribute('title', cfg.buttonLabel || '调整显示条数');
      btn.appendChild(slidersIcon());

      panel = R.el('div', 'recent-panel list-panel');
      panel.id = idp + '-panel';
      panel.setAttribute('hidden', '');
      var lab = R.el('label', 'recent-label', '显示条数');
      lab.setAttribute('for', idp + '-range');
      val = R.el('span', 'recent-val', '');
      var phead = R.el('div', 'recent-panel-head');
      phead.appendChild(lab);
      phead.appendChild(val);
      panel.appendChild(phead);

      range = R.el('input', 'recent-range');
      range.setAttribute('type', 'range');
      range.id = idp + '-range';
      range.setAttribute('min', String(min));
      range.setAttribute('max', String(max));
      range.setAttribute('step', '1');
      range.setAttribute('value', String(state.limit));
      range.setAttribute('aria-label', cfg.limitLabel || '显示条数');
      panel.appendChild(range);
      panel.appendChild(R.el('p', 'recent-hint',
        cfg.hint || (min + '–' + max + ' 项 · 记住的选择存在本机浏览器里')));
      tools.appendChild(btn);
    }
    if (kidCount(tools)) bar.appendChild(tools);
    if (panel) bar.appendChild(panel);
    if (kidCount(bar)) f.appendChild(bar);

    var list = R.el(cfg.tag || 'ol', cfg.listClass || 'rows');
    list.id = idp + '-list';
    if (wantScroll) {
      var box = R.el('div', 'rows-scroll');
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
      R.clear(list);
      var shown = visible();
      state.shown = shown.length;
      if (!shown.length) list.appendChild(R.el('p', 'muted', cfg.empty || '没有匹配项。'));
      else if (cfg.build) cfg.build(list, shown);
      else {
        for (var i = 0; i < shown.length; i++) list.appendChild(cfg.render(shown[i]));
      }
      if (val) {
        R.clear(val);
        val.appendChild(document.createTextNode(shown.length + ' 项 · 共 ' + entries.length + ' 项'));
      }
    }

    function setPanel(open) {
      if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function setLimit(n) {
      state.limit = clampLimit(n, min, max, def);
      if (cfg.key) R.storeSet(cfg.key, state.limit);
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
    if (R.S.recent && R.S.recent.close) R.S.recent.close();
    if (R.S.dateList && R.S.dateList.close) R.S.dateList.close();
    if (R.S.libraryList && R.S.libraryList.close) R.S.libraryList.close();
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

  function clampRecent(n) { return clampLimit(n, RECENT_MIN, RECENT_MAX, RECENT_DEFAULT); }
  function readRecent() { return clampRecent(R.storeGet(RECENT_KEY)); }
  function writeRecent(n) {
    n = clampRecent(n);
    R.storeSet(RECENT_KEY, n);
    if (R.S.recent && typeof R.S.recent.setLimit === 'function' && R.S.recent.limit !== n) R.S.recent.setLimit(n);
    return n;
  }

  /* 首页的条目：全站文章 → 收拢系列 → 取前 N 条（N 是条目数） */
  function recentEntries(limit) {
    var entries = collectEntries((R.S.man && R.S.man.posts) || []);
    return entries.slice(0, Math.min(clampRecent(limit), entries.length));
  }

  /* 首页的系列行：紧凑版 —— 日期 + 系列名 + 徽章，**不铺开章节**。
     铺开就是把 20 章从书库搬到首页，首页就不再是「最近」而是「目录」。 */
  function compactSeriesRow(s) {
    /* 不用 .row-series：那条规则是给「可展开的系列行」用的（display:block），
       首页要的是一行（.row 的网格），所以单独一个 row-series-flat。 */
    var li = R.el('li', 'row row-series-flat');
    li.appendChild(R.el('span', 'row-date', R.seriesLatestDate(s)));
    /* 首页的系列行 = 一条「组」，点进去是系列目录页，不是直接跳第一章 */
    if (s && s.id) li.appendChild(R.seriesLink(s, s.title || '系列', 'row-title'));
    else li.appendChild(R.el('span', 'row-title', (s && s.title) || '系列'));
    li.appendChild(R.el('span', 'row-words series-badge', '系列 · ' + ((s && s.posts) || []).length + ' 章'));
    return li;
  }

  /* 条目 → 行。书库与日期页用可展开的 seriesRow（章节完整、可逐章跳），
     首页用紧凑行（不铺章节）。两者只在「要不要铺章节」上不同，收拢口径是同一个。 */
  function entryRow(entry, opts) {
    opts = opts || {};
    if (entry.kind === 'series') {
      if (opts.compact) return compactSeriesRow(entry.s);
      return R.seriesRow(entry.s, (R.S.man && R.S.man.members) || [], entry.hits, opts);
    }
    return R.postRow(entry.post, (R.S.man && R.S.man.members) || []);
  }



  /* ---- 本模块导出到 REC ---- */
  R.collectEntries = collectEntries;
  R.sortEntries = sortEntries;
  R.entryTitle = entryTitle;
  R.entryKey = entryKey;
  R.entryUpdated = entryUpdated;
  R.entryText = entryText;
  R.seriesFirstSlug = seriesFirstSlug;
  R.slidersIcon = slidersIcon;
  R.clampLimit = clampLimit;
  R.entryList = entryList;
  R.compactSeriesRow = compactSeriesRow;
  R.kidCount = kidCount;
  R.closeListPanels = closeListPanels;
  R.RECENT_MIN = RECENT_MIN;
  R.RECENT_MAX = RECENT_MAX;
  R.RECENT_DEFAULT = RECENT_DEFAULT;
  R.RECENT_KEY = RECENT_KEY;
  R.DATE_MIN = DATE_MIN;
  R.DATE_MAX = DATE_MAX;
  R.DATE_DEFAULT = DATE_DEFAULT;
  R.DATE_KEY = DATE_KEY;
  R.LIBRARY_MIN = LIBRARY_MIN;
  R.LIBRARY_MAX = LIBRARY_MAX;
  R.LIBRARY_DEFAULT = LIBRARY_DEFAULT;
  R.LIBRARY_KEY = LIBRARY_KEY;
  R.LIBRARY_LIST_AFTER = LIBRARY_LIST_AFTER;
  R.BROWSE_AFTER = BROWSE_AFTER;
  R.clampRecent = clampRecent;
  R.readRecent = readRecent;
  R.writeRecent = writeRecent;
  R.recentEntries = recentEntries;
  R.compactSeriesRow = compactSeriesRow;
  R.entryRow = entryRow;
})();
