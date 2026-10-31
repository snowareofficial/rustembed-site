'use strict';
/* js/detail.js —— 详情视图（文章 / 项目 / 成员 / 互助 / 词条 / 周报项 / 文档页）+ 章节结构弹层。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

  /* ---------- 章节结构弹层（内联，不跳页） ---------- */
  function showModal(title) {
    var m = R.$('#modal'), t = R.$('#modal-title');
    if (!m) return;
    if (t) { R.clear(t); t.appendChild(document.createTextNode(title || '章节结构')); }
    m.removeAttribute('hidden');
  }

  function hideModal() {
    var m = R.$('#modal');
    if (m) m.setAttribute('hidden', '');
  }

  function openStructure() {
    var body = R.$('#modal-body');
    if (!body) return;
    R.clear(body);
    body.appendChild(R.el('p', 'section-h', '结构清单'));
    var ol = R.el('ol', 'struct-list');
    if ((R.S.toc || []).length) {
      for (var i = 0; i < R.S.toc.length; i++) {
        var t = R.S.toc[i];
        if (!t || !t.id) continue;
        var li = R.el('li', 'lv' + (t.level || 2));
        li.appendChild(R.lnk('#/' + R.S.tocBase + '/' + t.id, t.text));
        ol.appendChild(li);
      }
    } else {
      ol.appendChild(R.el('li', 'muted', '本文没有分节标题'));
    }
    body.appendChild(ol);

    if (R.S.mapHref) {
      body.appendChild(R.el('p', 'section-h', '章节导图'));
      body.appendChild(R.el('p', 'muted', '拖动平移 · 滚轮缩放 · 双击复位'));
      var view = R.el('div', 'map-view');
      var img = R.el('img', 'map-img');
      img.src = R.S.mapHref;
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
    body.appendChild(R.el('p', 'muted',
      'AI 摘要：预留接口。构建期可生成提示词（结构清单 + 正文），输出格式待约定后再接。'));
    showModal('章节结构');
  }

  /* ---------- 按日期看文章 ---------- */
  function viewPost(slug, anchor, q) {
    var m = R.S.man;
    var p = R.bySlug(m.posts, slug);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(R.el('h1', '', '没有这篇文章'));
      f.appendChild(R.el('p', 'muted', 'slug：' + String(slug)));
      R.setToc([], '', '');
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

    var mem = R.byId(m.members, p.author);
    f.appendChild(R.crumb([['文章库', '#/library'], [shownTitle, '']]));
    f.appendChild(R.el('h1', '', shownTitle));

    /* 语言切换：仅当存在多于一种语言时显示在标题下方 */
    if (p.langs && Object.keys(p.langs).length > 1) {
      var sw = R.el('div', 'lang-switch');
      ['zh', 'en'].forEach(function (ln) {
        if (!p.langs[ln]) return;
        var label = ln === 'zh' ? '中文' : 'English';
        if (ln === useLang) {
          sw.appendChild(R.el('span', 'lang-opt on', label));
        } else {
          var a = R.lnk('#/post/' + slug + '?lang=' + ln, label, 'lang-opt');
          if (a.addEventListener) a.addEventListener('click', R.langSwitchScroll);
          sw.appendChild(a);
        }
      });
      f.appendChild(sw);
    }

    var by = R.el('div', 'byline');
    if (mem) {
      var who = R.lnk('#/member/' + mem.id, '', '');
      var av = R.avatarOf(mem);
      if (av) who.appendChild(av);
      who.appendChild(document.createTextNode(mem.name));
      by.appendChild(who);
    } else if (p.author) {
      by.appendChild(R.el('span', '', p.author));
    }
    by.appendChild(R.lnk('#/date/' + encodeURIComponent(String(p.date).slice(0, 10)),
      String(p.date).slice(0, 10), 'date-link'));
    by.appendChild(R.el('span', '', R.num(shownWords) + ' 字'));
    by.appendChild(R.el('span', '', '约 ' + R.minutes(shownWords) + ' 分钟'));
    if (p.updated && p.updated !== p.date) by.appendChild(R.el('span', '', '更新于 ' + p.updated));
    f.appendChild(by);

    /* 有构建期摘要卡时，不再渲染一份同样的 lede，避免两段摘要重复。
       没有摘要卡时，lede 仍可单独折叠；两者共用同一折叠状态。 */
    if (p.ai_summary) {
      f.appendChild(R.summaryCard(p.ai_summary));
    } else if (shownSummary) {
      var ledeBox = R.el('details', 'lede-box');
      ledeBox.appendChild(R.el('summary', 'lede-sum', '文章摘要'));
      ledeBox.appendChild(R.el('p', 'lede', shownSummary));
      if (!R.readSummaryCollapsed()) ledeBox.setAttribute('open', 'open');
      R.rememberFold(ledeBox);
      f.appendChild(ledeBox);
    } else {
      f.appendChild(R.el('p', 'lede', ''));
    }

    /* 文章形态：只由真实内容决定（标签 / 是否有图集块） */
    var form = 'reading';
    for (var ti = 0; ti < (shownTags || []).length; ti++) {
      if (R.FORM_BY_TAG[shownTags[ti]]) { form = R.FORM_BY_TAG[shownTags[ti]]; break; }
    }
    R.setForm(form);

    return R.proseFragment(htmlPath).then(function (prose) {
      f.appendChild(prose);
      var tail = R.el('div', 'post-tail');
      if ((shownTags || []).length) tail.appendChild(R.tagLine(shownTags));
      tail.appendChild(R.el('p', 'license', '许可：' + (p.license || m.site.license || '见站点默认许可')));
      if ((p.attachments || []).length) {
        tail.appendChild(R.el('p', 'section-h', '附件'));
        var ul = R.el('ul', 'attach-list');
        for (var ai = 0; ai < p.attachments.length; ai++) {
          ul.appendChild(R.attachCard(p.attachments[ai]));
        }
        tail.appendChild(ul);
      }
      f.appendChild(tail);

      /* 系列上/下章 */
      if (p.series) {
        var s = R.byId(m.series, p.series);
        if (s) {
          /* 文章侧栏（系列上下文块）：有简介才显示，纯文本、文本节点渲染（安全） */
          var sdesc = R.seriesDesc(s);
          if (sdesc) f.appendChild(sdesc);
          var idx = -1;
          for (var si = 0; si < s.posts.length; si++) { if (s.posts[si].slug === p.slug) idx = si; }
          var pager = R.el('nav', 'pager');
          if (idx > 0) pager.appendChild(R.lnk('#/post/' + s.posts[idx - 1].slug, '← ' + s.posts[idx - 1].title));
          else pager.appendChild(R.el('span', 'muted', ''));
          if (idx >= 0 && idx < s.posts.length - 1) {
            pager.appendChild(R.lnk('#/post/' + s.posts[idx + 1].slug, s.posts[idx + 1].title + ' →'));
          }
          f.appendChild(pager);
        }
      }

      R.setToc(p.toc, 'post/' + p.slug, p.map);
      if (anchor) scrollToId(anchor);
      /* 语言切换后恢复滚动位置（仅切换时 S._langScroll 非 null） */
      if (R.S._langScroll !== null && R.S._langScroll !== undefined) {
        window.scrollTo(0, R.S._langScroll);
        R.S._langScroll = null;
      }
      return f;
    });
  }

  /* ---------- 项目页的「相关阅读」 ----------
     区块标题：相关阅读（全站只用这一个说法，不再叫「相关文章」）。 */
  var RELATED_HEAD = '相关阅读';

  /* 项目的相关阅读只有一个来源：项目文件里手写的 related_series / related_posts。
     没有自动匹配、没有弱回退 —— languages: [rust] 不该把 Rust 入门笔记挂到
     「Rust 并发」项目下面。返回 { series: [...], posts: [...] }，两者都空时
     调用方整块不渲染（不显示「暂无」）。 */
  function relatedReading(p, m) {
    m = m || R.S.man || {};
    var out = { series: [], posts: [] };
    var seenSeries = {};
    var rs = p.related_series || [];
    for (var i = 0; i < rs.length; i++) {
      var s = R.byId(m.series || [], rs[i]);
      if (!s || seenSeries[s.id]) continue;
      seenSeries[s.id] = 1;
      out.series.push(s);
    }
    var rp = p.related_posts || [];
    for (var j = 0; j < rp.length; j++) {
      var post = R.bySlug(m.posts || [], rp[j]);
      /* 该文章所属系列已作为「组」出现时不重复列一枚枚单篇 */
      if (!post || (post.series && seenSeries[post.series])) continue;
      out.posts.push(post);
    }
    return out;
  }

  function viewProject(id) {
    var m = R.S.man;
    var p = R.byId(m.projects, id);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(R.el('h1', '', '没有这个项目'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(R.crumb([['项目', '#/projects'], [p.name, '']]));
    var h = R.el('h1');
    h.appendChild(document.createTextNode(p.name + ' '));
    h.appendChild(R.statusBadge(p.status));
    f.appendChild(h);
    f.appendChild(R.el('p', 'lede', p.one_liner));

    var btns = R.el('p', 'chips');
    if (p.repo) btns.appendChild(R.outLink(p.repo, '仓库', 'chip'));
    if (p.homepage) btns.appendChild(R.outLink(p.homepage, '文档 / 主页', 'chip'));
    f.appendChild(btns);
    if ((p.tags || []).length) f.appendChild(R.projectTagChips(p));

    var meta = p.meta || {};
    var metrics = R.el('div', 'metrics');
    var has = 0;
    if (meta.stars !== null && meta.stars !== undefined) { metrics.appendChild(R.metric(meta.stars, 'stars')); has++; }
    if (meta.forks !== null && meta.forks !== undefined) { metrics.appendChild(R.metric(meta.forks, 'forks')); has++; }
    if (meta.updated_at) { metrics.appendChild(R.metric(String(meta.updated_at).slice(0, 10), '最近提交')); has++; }
    if (has) f.appendChild(metrics);

    var bar = meta.languages_pct ? R.langBar(meta.languages_pct, 4) : null;
    if (bar) { f.appendChild(R.el('p', 'section-h', '语言占比（构建期抓取）')); f.appendChild(bar); }

    var mem = R.byId(m.members, p.owner);
    var info = R.kv([
      ['仓库', p.repo, p.repo],
      ['主页', p.homepage, p.homepage],
      ['主语言', meta.language],
      ['许可', p.license || meta.license],
      ['维护者', mem ? mem.name : p.owner, mem ? '#/member/' + mem.id : ''],
      ['平台', (p.platforms || []).join('、')],
      ['最近提交', meta.updated_at ? String(meta.updated_at).slice(0, 10) : '']
    ]);
    if (info) { f.appendChild(R.el('p', 'section-h', '仓库信息')); f.appendChild(info); }

    /* 里程碑时间线：有真实 milestones 才画 */
    if ((p.milestones || []).length) {
      f.appendChild(R.el('p', 'section-h', '里程碑'));
      var tl = R.el('ul', 'timeline');
      for (var mi = 0; mi < p.milestones.length; mi++) {
        var ms = p.milestones[mi];
        var li = R.el('li');
        li.appendChild(R.el('span', 't-date', ms.date || ''));
        li.appendChild(document.createTextNode(ms.text || ''));
        if (ms.why) li.appendChild(R.el('span', 'muted', '（' + ms.why + '）'));
        tl.appendChild(li);
      }
      f.appendChild(tl);
    }

    /* 相关阅读：只认作者在项目里显式写的关联（related_series / related_posts）。
       以前这里是 languages + platforms 与文章 tags 相交 —— 那会把「Rust 并发」
       项目和 Rust 入门笔记连在一起。宁可整块不显示，也不用泛标签硬凑。 */
    var reading = relatedReading(p, m);
    if (reading.series.length || reading.posts.length) {
      f.appendChild(R.el('p', 'section-h', RELATED_HEAD));
      if (reading.series.length) {
        /* 系列按「组」渲染：标题 + N 章 + 最近更新，点进去才是 #/series/<id>。
           这里不铺章节 —— 铺了就又把一篇项目的相关区撑成半个书库。 */
        var sol = R.el('ol', 'rows');
        for (var si = 0; si < reading.series.length; si++) {
          sol.appendChild(R.compactSeriesRow(reading.series[si]));
        }
        f.appendChild(sol);
      }
      if (reading.posts.length) {
        var rol = R.el('ol', 'rows');
        for (var wi = 0; wi < reading.posts.length; wi++) {
          rol.appendChild(R.postRow(reading.posts[wi], m.members));
        }
        f.appendChild(rol);
      }
    }

    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewMember(id) {
    var m = R.S.man;
    var mem = R.byId(m.members, id);
    var f = document.createDocumentFragment();
    if (!mem) {
      f.appendChild(R.el('h1', '', '没有这位成员'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(R.crumb([['成员', '#/members'], [mem.name, '']]));
    var hero = R.el('div', 'member-hero');
    var av = R.avatarOf(mem);
    if (av) hero.appendChild(av); else hero.appendChild(R.el('div', 'avatar'));
    var right = R.el('div');
    var h = R.el('h1');
    h.appendChild(document.createTextNode(mem.name));
    right.appendChild(h);
    right.appendChild(R.el('p', 'p-role', mem.role || '群友'));
    if (mem.signature) right.appendChild(R.el('p', 'card-note', mem.signature));
    var chips = R.el('p', 'chips');
    for (var si = 0; si < (mem.skills || []).length; si++) chips.appendChild(R.el('span', 'chip', mem.skills[si]));
    right.appendChild(chips);
    hero.appendChild(right);

    var np = 0, npr = 0;
    for (var i = 0; i < m.posts.length; i++) if (m.posts[i].author === mem.id) np++;
    for (var j = 0; j < (m.projects || []).length; j++) {
      var pr = m.projects[j];
      if (pr.owner === mem.id || (pr.contributors || []).indexOf(mem.id) >= 0) npr++;
    }
    var bigs = R.el('div', 'mh-nums');
    bigs.appendChild(R.el('div', 'big-num', R.num(np) + '篇文章'));
    bigs.appendChild(R.el('div', 'big-num', R.num(npr) + '个项目'));
    if (mem.joined) bigs.appendChild(R.el('div', 'big-num', '加入 ' + mem.joined));
    hero.appendChild(bigs);
    f.appendChild(hero);

    var ownPosts = [];
    for (var k = 0; k < m.posts.length; k++) {
      if (m.posts[k].author === mem.id || (m.posts[k].co_authors || []).indexOf(mem.id) >= 0) {
        ownPosts.push(m.posts[k]);
      }
    }
    if (!ownPosts.length) {
      f.appendChild(R.el('p', 'section-h', '文章'));
      f.appendChild(R.el('p', 'muted', '还没有文章。'));
    } else if (ownPosts.length > 6) {
      /* 文章多时自动加“本页搜索 + 滚动区”，少时不占空间 */
      f.appendChild(R.filterable(R.el('p', 'section-h', '文章'), ownPosts, {
        tag: 'ol',
        cls: 'rows rows-scroll',
        placeholder: '在这位成员的文章中搜索标题 / 摘要 / 标签',
        empty: '没有匹配的文章。',
        match: function (x, q) {
          return (x.title + ' ' + (x.summary || '') + ' ' + (x.tags || []).join(' '))
            .toLowerCase().indexOf(q) >= 0;
        },
        render: function (x) { return R.postRow(x, m.members); }
      }));
    } else {
      f.appendChild(R.el('p', 'section-h', '文章'));
      var ol = R.el('ol', 'rows');
      for (var k2 = 0; k2 < ownPosts.length; k2++) {
        ol.appendChild(R.postRow(ownPosts[k2], m.members));
      }
      f.appendChild(ol);
    }

    var mine = [];
    for (var pj = 0; pj < (m.projects || []).length; pj++) {
      var p = m.projects[pj];
      if (p.owner === mem.id || (p.contributors || []).indexOf(mem.id) >= 0) mine.push(p);
    }
    if (mine.length) {
      f.appendChild(R.el('p', 'section-h', '参与项目'));
      var ul2 = R.el('ul');
      for (var pi2 = 0; pi2 < mine.length; pi2++) {
        var lix = R.el('li');
        lix.appendChild(R.lnk('#/project/' + mine[pi2].id, mine[pi2].name));
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
      f.appendChild(R.el('p', 'section-h', '技术互助'));
      var ul3 = R.el('ul');
      for (var si3 = 0; si3 < svcs.length; si3++) {
        var li3 = R.el('li');
        li3.appendChild(R.lnk('#/service/' + svcs[si3].id, svcs[si3].name));
        li3.appendChild(document.createTextNode(' — ' + (svcs[si3].skills || []).join('、')));
        ul3.appendChild(li3);
      }
      f.appendChild(ul3);
    }

    /* 联系方式放最后，并注明「本人授权公开」 */
    var links = mem.links || {};
    var keys = Object.keys(links);
    if (keys.length) {
      f.appendChild(R.el('p', 'section-h', '联系方式（本人授权公开）'));
      var dl = R.el('dl', 'kv');
      for (var ki = 0; ki < keys.length; ki++) {
        dl.appendChild(R.el('dt', '', R.CONTACT_LABEL[keys[ki]] || keys[ki]));
        var dd = R.el('dd');
        var v = links[keys[ki]];
        if (keys[ki] === 'email') dd.appendChild(R.outLink('mailto:' + v, v));
        else dd.appendChild(R.outLink(v, v));
        dl.appendChild(dd);
      }
      f.appendChild(dl);
    }
    R.setToc([], '', 'map.svg');
    return Promise.resolve(f);
  }

  function viewService(id, anchor) {
    var m = R.S.man;
    var s = R.byId(m.services, id);
    var f = document.createDocumentFragment();
    if (!s) {
      f.appendChild(R.el('h1', '', '没有这条互助'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    var mem = R.byId(m.members, s.owner);
    f.appendChild(R.crumb([['技术互助', '#/services'], [s.name, '']]));
    var h = R.el('h1');
    h.appendChild(document.createTextNode(s.name + ' '));
    h.appendChild(R.statusBadge(s.status, R.SERVICE_STATUS_LABEL));
    f.appendChild(h);

    var who = R.el('p', 'row-tags');
    who.appendChild(R.el('b', '', '登记人'));
    if (mem) who.appendChild(R.lnk('#/member/' + mem.id, mem.name));
    else who.appendChild(document.createTextNode(s.owner));
    who.appendChild(document.createTextNode(' · 更新 ' + (s.updated || '—')));
    f.appendChild(who);

    f.appendChild(R.el('p', 'section-h', '能帮上什么'));
    f.appendChild(R.el('p', 'lede', (s.skills || []).join('、') || '（未填写）'));
    if ((s.wants || []).length) {
      f.appendChild(R.el('p', 'section-h', '想一起做什么'));
      f.appendChild(R.el('p', '', (s.wants || []).join('、')));
    }

    return R.proseFragment(s.html).then(function (prose) {
      f.appendChild(prose);

      /* 「怎么联系」面板：右栏被站点导航占用（§2 硬约束），这里放在正文之后 */
      f.appendChild(R.el('p', 'section-h', '怎么联系'));
      var pairs = [['登记人', mem ? mem.name : s.owner, mem ? '#/member/' + mem.id : '']];
      if (s.rate) pairs.push(['协作方式（不谈价格）', s.rate]);
      for (var ci = 0; ci < (s.contact || []).length; ci++) {
        var key = s.contact[ci];
        var val = mem && mem.links ? mem.links[key] : '';
        if (val) pairs.push([R.CONTACT_LABEL[key] || key, val, key === 'email' ? 'mailto:' + val : val]);
      }
      var info = R.kv(pairs);
      if (info) f.appendChild(info);
      f.appendChild(R.el('p', 'disc',
        '本站只展示这条信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。'));

      R.setToc(s.toc, 'service/' + s.id, s.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }


  function viewTopic(id, anchor) {
    var m = R.S.man;
    var t = R.byId(m.topics, id);
    var f = document.createDocumentFragment();
    if (!t) {
      f.appendChild(R.el('h1', '', '没有这个词条'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(R.crumb([['主题词条', '#/topics'], [t.title, '']]));
    var h = R.el('h1');
    h.appendChild(document.createTextNode(t.title + ' '));
    h.appendChild(R.el('span', 'badge', (t.resolved || []).length + ' 篇'));
    f.appendChild(h);
    f.appendChild(R.el('p', 'define', t.summary || ''));

    var meta = R.el('p', 'row-tags');
    for (var mi = 0; mi < (t.tags || []).length; mi++) {
      meta.appendChild(R.el('span', 'tag', t.tags[mi]));
      meta.appendChild(document.createTextNode(' '));
    }
    if (t.file) meta.appendChild(R.el('span', 'muted', '来源 ' + t.file));
    f.appendChild(meta);

    /* 本词条要点：直接可跳，不用先读全文 */
    if ((t.toc || []).length) {
      f.appendChild(R.el('p', 'section-h', '要点'));
      var pts = R.el('div', 'topic-points');
      for (var pi = 0; pi < t.toc.length; pi++) {
        var pt = t.toc[pi];
        if (!pt || !pt.id) continue;
        var pa = R.lnk('#/topic/' + t.id + '/' + pt.id, pt.text, 'topic-point');
        pts.appendChild(pa);
      }
      f.appendChild(pts);
    }

    var g = R.relGraph(t, m.posts, m.projects, m.topics);
    if (g) { f.appendChild(R.el('p', 'section-h', '关系图')); f.appendChild(g); }

    return R.proseFragment(t.html).then(function (prose) {
      f.appendChild(prose);

      var resolved = [];
      for (var ri = 0; ri < (t.resolved || []).length; ri++) {
        var rp = R.bySlug(m.posts, t.resolved[ri]);
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
        f.appendChild(R.el('p', 'section-h', '相关文章'));
        var ol = R.el('ol', 'rows');
        for (var i = 0; i < resolved.length; i++) ol.appendChild(R.postRow(resolved[i], m.members));
        f.appendChild(ol);
      }
      if (byTag.length) {
        f.appendChild(R.el('p', 'section-h', '同标签文章'));
        var ol2 = R.el('ol', 'rows');
        for (var j = 0; j < byTag.length; j++) ol2.appendChild(R.postRow(byTag[j], m.members));
        f.appendChild(ol2);
      }
      if (!resolved.length && !byTag.length) {
        f.appendChild(R.el('p', 'muted',
          '这个词条还没有文章归入：写文章时在 front matter 里加上 '
          + (t.tags || []).map(function (x) { return '#' + x; }).join(' / ')
          + ' 就会自动出现。'));
      }

      /* 相关词条：带一句摘要，而不只是一串名字 */
      var rel = t.related || [];
      if (rel.length) {
        f.appendChild(R.el('p', 'section-h', '相关词条'));
        var g2 = R.el('div', 'grid');
        for (var k = 0; k < rel.length; k++) {
          var rt = R.byId(m.topics, rel[k]);
          if (!rt) continue;
          var card = R.el('article', 'card');
          card.appendChild(R.lnk('#/topic/' + rt.id, rt.title, 'card-title'));
          card.appendChild(R.el('p', 'card-note', rt.summary || ''));
          g2.appendChild(card);
        }
        f.appendChild(g2);
      }

      /* 编辑入口：直接给仓库编辑链接，作者知道去哪儿补 */
      var repo = m.site.repo_url || '';
      if (repo && t.file) {
        var edit = R.outLink(repo.replace(/\/$/, '') + '/edit/master/site/' + t.file.replace(/^\/+/, ''),
          '在仓库里编辑这个词条', 'disc-link');
        edit.setAttribute('target', '_blank');
        edit.setAttribute('rel', 'noopener');
        f.appendChild(R.el('p', 'disc', '')).appendChild(edit);
      } else {
        f.appendChild(R.el('p', 'disc', '觉得缺了什么？提 PR 补词条，或把稿子交给群管理代投。'));
      }

      R.setToc(t.toc, 'topic/' + t.id, t.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }
  function viewWeeklyItem(id, anchor) {
    var m = R.S.man;
    var w = R.byId(m.weekly, id);
    var f = document.createDocumentFragment();
    if (!w) {
      f.appendChild(R.el('h1', '', '没有这一期'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(R.crumb([['周报', '#/weekly'], [w.period || w.title, '']]));
    f.appendChild(R.el('h1', '', w.title));
    f.appendChild(R.el('p', 'lede', w.period || ''));

    var grid = R.el('div', 'metrics');
    grid.appendChild(R.metric((w.merged || []).length, '合并文章'));
    grid.appendChild(R.metric((w.highlights || []).length, '要点'));
    grid.appendChild(R.metric((w.contributors || []).length, '参与成员'));
    f.appendChild(grid);

    if ((w.highlights || []).length) {
      f.appendChild(R.el('p', 'section-h', '本期时间线'));
      var tl = R.el('ul', 'timeline');
      for (var i = 0; i < w.highlights.length; i++) tl.appendChild(R.el('li', '', w.highlights[i]));
      f.appendChild(tl);
    }

    if ((w.merged || []).length) {
      f.appendChild(R.el('p', 'section-h', '合并的文章'));
      var ol = R.el('ol', 'rows');
      for (var j = 0; j < w.merged.length; j++) {
        var p = R.bySlug(m.posts, w.merged[j]);
        if (p) ol.appendChild(R.postRow(p, m.members));
      }
      f.appendChild(ol);
    }

    if ((w.contributors || []).length) {
      f.appendChild(R.el('p', 'section-h', '参与成员'));
      var ul = R.el('ul');
      for (var k = 0; k < w.contributors.length; k++) {
        var mem = R.byId(m.members, w.contributors[k]);
        var li = R.el('li');
        if (mem) li.appendChild(R.lnk('#/member/' + mem.id, mem.name));
        else li.appendChild(document.createTextNode(w.contributors[k]));
        ul.appendChild(li);
      }
      f.appendChild(ul);
    }

    return R.proseFragment(w.html).then(function (prose) {
      f.appendChild(prose);
      var idx = -1;
      for (var i2 = 0; i2 < m.weekly.length; i2++) { if (m.weekly[i2].id === w.id) idx = i2; }
      var pager = R.el('nav', 'pager');
      if (idx > 0) pager.appendChild(R.lnk('#/weekly/' + m.weekly[idx - 1].id, '← ' + m.weekly[idx - 1].period));
      else pager.appendChild(R.el('span', 'muted', ''));
      if (idx >= 0 && idx < m.weekly.length - 1) {
        pager.appendChild(R.lnk('#/weekly/' + m.weekly[idx + 1].id, m.weekly[idx + 1].period + ' →'));
      }
      f.appendChild(pager);
      R.setToc(w.toc, 'weekly/' + w.id, w.map);
      if (anchor) scrollToId(anchor);
      return f;
    });
  }

  function docTree(curId) {
    var m = R.S.man;
    var d = R.el('details', 'doc-tree');
    d.setAttribute('open', 'open');
    d.appendChild(R.el('summary', '', '站文档目录'));
    var groups = {}, order = [];
    for (var i = 0; i < (m.pages || []).length; i++) {
      var p = m.pages[i];
      var g = p.group || '其它';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(p);
    }
    for (var gi = 0; gi < order.length; gi++) {
      d.appendChild(R.el('p', 'dt-group', order[gi]));
      for (var pi = 0; pi < groups[order[gi]].length; pi++) {
        var pg = groups[order[gi]][pi];
        d.appendChild(R.lnk('#/page/' + pg.id, pg.title, pg.id === curId ? 'cur' : ''));
      }
    }
    return d;
  }

  function viewPage(id, anchor) {
    var m = R.S.man;
    var p = R.byId(m.pages, id);
    var f = document.createDocumentFragment();
    if (!p) {
      f.appendChild(R.el('h1', '', '没有这个文档页'));
      R.setToc([], '', '');
      return Promise.resolve(f);
    }
    f.appendChild(R.crumb([['站文档', '#/pages'], [p.title, '']]));
    f.appendChild(R.el('h1', '', p.title));
    /* 左栏必须是本文目录（§2），文档树因此放在正文顶部 */
    f.appendChild(docTree(p.id));
    return R.proseFragment(p.html).then(function (prose) {
      f.appendChild(prose);
      if (p.group_link) {
        var btns = R.el('p', 'chips');
        btns.appendChild(R.outLink(p.group_link, '相关行动', 'chip'));
        f.appendChild(btns);
      }
      R.setToc(p.toc, 'page/' + p.id, p.map);
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


  /* ---- 本模块导出到 REC ---- */
  R.showModal = showModal;
  R.hideModal = hideModal;
  R.openStructure = openStructure;
  R.viewPost = viewPost;
  R.viewProject = viewProject;
  R.relatedReading = relatedReading;
  R.RELATED_HEAD = RELATED_HEAD;
  R.viewMember = viewMember;
  R.viewService = viewService;
  R.viewTopic = viewTopic;
  R.viewWeeklyItem = viewWeeklyItem;
  R.docTree = docTree;
  R.viewPage = viewPage;
  R.scrollToId = scrollToId;
})();
