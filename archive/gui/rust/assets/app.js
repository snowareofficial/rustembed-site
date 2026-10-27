/* 写作台前端（M3）：三页共用（写作台 / 登录 / 设置）—— 登录态 / PR / 设置 /
 * 树 / 契约表单 / 工具条 + 插入菜单 / 图片上传 / 资源附件 / 右键菜单 /
 * 改动徽标 / 外部改动检测 / 写入前确认。
 *
 * 纪律：
 * - 表单字段由 /api/types 的契约生成，前端不重复定义字段；
 * - 保存前先 /api/validate，422 不写盘；带上 base_hash，磁盘被改过 → 409；
 * - 预览默认手动（Ctrl+P），与构建同源；
 * - 插入的语法按当前引擎：.md 写 :::xxx，.sml 写对应裸块；
 * - 提取码只当文本复制，不拼进 href/src；
 * - 令牌只走 /api/session（Rust 钥匙串/内存），localStorage 里**没有令牌**；
 * - 新拼的 href/src 一律过 safeUrl()（协议白名单，与 engine/lib/urls.py 对齐）。
 */
(function () {
  'use strict';

  var TYPE_LABEL = {
    post: '文章', page: '站文档', topic: '词条', member: '成员', project: '项目',
    resource: '资源', weekly: '周报', service: '能力与合作', contract: '契约'
  };
  var TYPE_ICON = {
    post: 'i-doc', page: 'i-shield', topic: 'i-hash', member: 'i-users', project: 'i-box',
    resource: 'i-book', weekly: 'i-cal', service: 'i-users', contract: 'i-shield'
  };
  var NEW_TYPES = ['post', 'topic', 'member', 'project', 'resource', 'weekly', 'page'];
  var KIND_LABEL = { book: '书', tutorial: '教程', tool: '工具', video: '视频',
    course: '课程', route: '路线' };

  /* URL 协议白名单（与 engine/lib/urls.py 同一口径）：http/https/mailto/tel、页内 #、相对路径。
   * javascript: / data: / vbscript: / file: / 协议相对 //host 一律拒绝（返回 ''）。 */
  function safeUrl(u) {
    u = String(u === undefined || u === null ? '' : u).trim();
    if (!u || /^[\s\x00-\x1f]/.test(u)) { return ''; }
    var m = u.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
    if (m) {
      if (['http', 'https', 'mailto', 'tel'].indexOf(m[1].toLowerCase()) < 0) { return ''; }
    } else if (u.slice(0, 2) === '//') {
      return '';
    }
    return u;
  }

  /* 插入菜单：§ 是光标落点。语法按当前引擎二选一。 */
  var INSERTS = [
    { label: '标题', md: '## §标题', sml: 'h2 { text: "§标题" }' },
    { label: '代码块', md: '```rust\n§code\n```', sml: 'code { lang: rust text: "§code" }' },
    { label: '附件', act: 'attach' },
    { label: '分割线', md: '\n---\n', sml: '\nhr\n' },
    { label: '面板', md: '\n:::panel 标题\n§正文\n:::\n', sml: '\npanel { title: "标题" text: "§正文" }\n' },
    { label: '步骤', md: '\n:::steps\n- §第一步\n- 第二步\n:::\n',
      sml: '\nsteps { items: [\n  para { text: "§第一步" }\n  para { text: "第二步" }\n] }\n' },
    { label: '提示 note', md: '\n:::note 说明\n§正文\n:::\n', sml: '\nnote { title: "说明" text: "§正文" }\n' },
    { label: '提示 tip', md: '\n:::tip 建议\n§正文\n:::\n', sml: '\ntip { title: "建议" text: "§正文" }\n' },
    { label: '提示 warn', md: '\n:::warn 注意\n§正文\n:::\n', sml: '\nwarn { title: "注意" text: "§正文" }\n' },
    { label: '图集', md: '\n:::gallery 2\n![图1](assets/§a.png)\n![图2](assets/b.png)\n:::\n',
      sml: '\ngallery { cols: 2 items: [\n  img { src: "assets/§a.png" alt: "图1" }\n  img { src: "assets/b.png" alt: "图2" }\n] }\n' },
    { label: '终端输出', md: '\n:::term\n$ §echo hello\n:::\n', sml: '\nterm { text: "$ §echo hello" }\n' },
    { label: '时间线 when', md: '\n:::when 2026-10-19\n§事件正文\n:::\n',
      sml: '\nwhen { date: "2026-10-19" text: "§事件正文" }\n' }
  ];

  var S = {
    types: [], typeMap: {}, tree: [], status: { branch: '-', dirty: [] },
    doc: null, dirty: false, baseHash: '', dirtyMap: {}, newType: 'post',
    checkTimer: null, resources: [], resMap: {}, resFilter: '', picked: null, ctxItem: null,
    // M3：登录态 / 设置 / PR
    auth: { logged: false, login: '', name: '', remembered: false, location: '' },
    prefs: null, pr: { files: [], reviewers: [], branch: '', busy: false }
  };

  /* ---------------- 设置（localStorage，**不含令牌**） ---------------- */
  var PREFS_KEY = 'rec-blog-gui-prefs';
  var DEFAULT_PREFS = {
    theme: 'auto',        // auto | light | dark
    labels: false,        // 顶部动作显示文字
    toolLabels: false,    // 工具条显示文字
    showTree: true, showSide: true,
    fontSize: 14,
    autosave: false, previewMode: 'manual', imgUpload: true,
    codeShow: true, codeCopy: true, attachMode: 'ref'
  };
  /* localStorage 可能不可用（隐私模式 / DOM 桩测试）：读不到就用默认值，仅本次生效 */
  function lsGet(key) {
    try {
      if (typeof localStorage === 'undefined') { return null; }
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try {
      if (typeof localStorage === 'undefined') { return; }
      localStorage.setItem(key, val);
    } catch (e) { /* 存不了就仅本次 */ }
  }
  function loadPrefs() {
    S.prefs = {};
    var raw = lsGet(PREFS_KEY);
    if (raw) {
      try {
        var v = JSON.parse(raw);
        for (var k in DEFAULT_PREFS) {
          if (v && Object.prototype.hasOwnProperty.call(v, k)) { S.prefs[k] = v[k]; }
        }
      } catch (e) { /* 读坏了就用默认值 */ }
    }
    for (var k2 in DEFAULT_PREFS) {
      if (S.prefs[k2] === undefined) { S.prefs[k2] = DEFAULT_PREFS[k2]; }
    }
  }
  function savePrefs() {
    lsSet(PREFS_KEY, JSON.stringify(S.prefs));
  }
  function applyPrefs() {
    var p = S.prefs;
    if (!p) { return; }
    // 主题：auto 跟随系统
    var dark = p.theme === 'dark' ||
      (p.theme === 'auto' && typeof matchMedia === 'function' &&
       matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark', !!dark);
    document.body.classList.toggle('labels-off', !p.labels);
    document.body.classList.toggle('tool-labels-off', !p.toolLabels);
    document.body.classList.toggle('no-tree', !p.showTree);
    document.body.classList.toggle('no-side', !p.showSide);
    var ed = $('editor');
    if (ed) { ed.style.fontSize = (p.fontSize || 14) + 'px'; }
  }

  var $ = function (id) { return document.getElementById(id); };

  /* 当前页面：优先 body 的 data-page，丢了就按特征元素认（DOM 桩测试友好）。 */
  function detectPage() {
    var attr = document.body && document.body.getAttribute('data-page');
    if (attr) { return attr; }
    if ($('login-token')) { return 'login'; }
    if ($('set-auth')) { return 'settings'; }
    return 'app';
  }

  /* hidden / disabled 属性与 property 双写：桩与真浏览器表现一致。 */
  function setHidden(el, on) {
    if (!el) { return; }
    el.hidden = !!on;
    if (on) { el.setAttribute('hidden', ''); } else { el.removeAttribute('hidden'); }
  }
  function setDisabled(el, on, title) {
    if (!el) { return; }
    el.disabled = !!on;
    if (on) { el.setAttribute('disabled', ''); } else { el.removeAttribute('disabled'); }
    if (title !== undefined) { el.title = title; }
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') { n.className = attrs[k]; }
      else if (k === 'text') { n.textContent = attrs[k]; }
      else { n.setAttribute(k, attrs[k]); }
    }
    (children || []).forEach(function (c) { if (c) { n.appendChild(c); } });
    return n;
  }
  function svg(id, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (cls) { s.setAttribute('class', cls); }
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
    return String(h);
  }
  function toast(msg) {
    var box = el('div', { class: 'toast', text: msg });
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) { box.parentNode.removeChild(box); } }, 2200);
  }
  function banner(msg, bad) {
    $('banner-text').textContent = msg;
    $('banner').className = 'banner' + (bad ? ' bad' : '');
    $('banner').hidden = false;
  }
  function nowHM() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || ('已复制：' + text)); };
    var fail = function () { toast('复制失败，内容：' + text); };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else { fail(); }
  }
  function codeChip(code) {
    code = String(code === undefined || code === null ? '' : code).trim();
    if (!code) { return null; }
    if (S.prefs && S.prefs.codeShow === false) { return null; }   // 设置：不显示提取码
    var copyOn = !S.prefs || S.prefs.codeCopy !== false;
    var b = el('button', { class: 'code-chip', type: 'button', 'data-code': code,
      title: copyOn ? '复制提取码' : ('提取码 ' + code) }, [svg('i-copy'), document.createTextNode('提取码 ' + code + (copyOn ? ' · 复制' : ''))]);
    b.onclick = function () {
      if (!copyOn) { return; }
      copyText(code, '已复制提取码：' + code);
    };
    return b;
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    loadPrefs();
    applyPrefs();
    api.types().then(function (types) {
      S.types = types;
      types.forEach(function (t) { S.typeMap[t.type] = t; });
      renderTypeGrid();
    }).catch(function (e) { banner('契约读取失败：' + e.message, true); });

    refreshTree();
    refreshStatus();
    renderInsertMenu();
    bindUI();
    // 默认收起元数据（与 mock 一致）
    $('meta').open = false;
    loadAuth();
  }

  // ---------------------------------------------------------------- 登录态
  function loadAuth() {
    return api.whoami().then(function (me) {
      S.auth = { logged: true, login: me.login || '', name: me.name || me.login || '',
        remembered: !!me.remembered, location: me.location || '' };
      applyAuth();
    }).catch(function (e) {
      if (e && e.status === 401) {
        S.auth = { logged: false, login: '', name: '', remembered: false, location: '' };
        applyAuth();
      }
      // 其它错误（引擎没起等）不打扰写作
    });
  }

  function applyAuth() {
    var a = S.auth;
    setDisabled($('btn-pr'), !a.logged,
      a.logged ? '提交 PR 到 Gitee' : '登录后可用（提交 PR / 删除 / 重命名需要登录）');
    setHidden($('btn-login'), a.logged);
    var chip = $('me-chip');
    if (chip) {
      setHidden(chip, !a.logged);
      if (a.logged) {
        $('me-name').textContent = a.name || a.login;
        chip.title = '已登录：' + a.login + '（' + (a.location || '内存') + '）';
      }
    }
  }

  function gateWrite(what) {
    // 写操作三件套的登录门禁：未登录给出路（去登录页），不静默失败
    if (S.auth.logged) { return true; }
    banner(what + '需要登录（令牌只存本机钥匙串或内存）', true);
    setTimeout(function () { location.href = '/login'; }, 600);
    return false;
  }

  function refreshTree() {
    return api.tree().then(function (items) { S.tree = items; renderTree(); })
      .catch(function (e) { banner('内容树读取失败：' + e.message, true); });
  }

  function refreshStatus() {
    return api.status().then(function (st) {
      S.status = st;
      S.dirtyMap = {};
      st.dirty.forEach(function (d) { S.dirtyMap[d.path.replace(/^site\//, '')] = d.status; });
      $('branch').textContent = st.branch;
      $('sb-branch').textContent = '分支 ' + st.branch;
      $('sb-changes').textContent = '改动 ' + st.dirty.length;
      renderTree();
    }).catch(function () { /* 状态失败不打断写作 */ });
  }

  // ---------------------------------------------------------------- 左树
  function renderTree() {
    var box = $('tree-groups');
    box.textContent = '';
    var q = ($('search').value || '').toLowerCase();
    var items = S.tree.filter(function (it) {
      return !q || it.title.toLowerCase().indexOf(q) >= 0 || it.path.toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) { box.appendChild(el('div', { class: 'empty', text: '没有匹配项' })); return; }
    var drafts = items.filter(function (it) { return it.draft; });
    if (drafts.length) { box.appendChild(group('草稿', drafts.length, drafts)); }
    var byType = {};
    items.filter(function (it) { return !it.draft; }).forEach(function (it) {
      byType[it.type] = byType[it.type] || [];
      byType[it.type].push(it);
    });
    Object.keys(byType).forEach(function (type) {
      var list = byType[type];
      if (type === 'post') {
        var byYear = {};
        list.forEach(function (it) {
          var m = it.path.match(/posts\/(\d{4})\//);
          var y = m ? m[1] : '其他';
          byYear[y] = byYear[y] || [];
          byYear[y].push(it);
        });
        Object.keys(byYear).sort().reverse().forEach(function (y) {
          box.appendChild(group('文章 · ' + y, byYear[y].length, byYear[y]));
        });
      } else {
        box.appendChild(group(TYPE_LABEL[type] || type, list.length, list));
      }
    });
  }

  function group(title, count, items) {
    var g = el('div', { class: 'group' });
    g.appendChild(el('div', { class: 'group-h' },
      [svg('i-chev', 'caret'), el('span', { text: title }), el('span', { class: 'count', text: String(count) })]));
    items.forEach(function (it) { g.appendChild(treeItem(it)); });
    return g;
  }

  function treeItem(it) {
    var node = el('div', {
      class: 'item' + (S.doc && S.doc.path === it.path ? ' active' : ''), title: it.path
    }, [svg(TYPE_ICON[it.type] || 'i-doc'), el('span', { text: it.title })]);
    var badge = S.dirtyMap[it.path];
    if (badge) { node.appendChild(el('span', { class: 'badge ' + badge.toLowerCase(), text: badge })); }
    if (it.draft) { node.appendChild(el('span', { class: 'draft', text: '草稿' })); }
    node.onclick = function () { openDoc(it.path); };
    node.oncontextmenu = function (e) {
      if (e && e.preventDefault) { e.preventDefault(); }
      showCtx(it, e);
    };
    return node;
  }

  // ---------------------------------------------------------------- 右键菜单
  function showCtx(it, ev) {
    S.ctxItem = it;
    var c = $('ctx');
    $('ctx-title').textContent = it.title;
    c.classList.add('on');
    // 写操作三件套要登录：未登录置灰并提示
    ['ctx-delete', 'ctx-rename'].forEach(function (id) {
      var b = $(id);
      if (!b) { return; }
      if (S.auth.logged) { b.removeAttribute('disabled'); b.title = ''; }
      else { b.setAttribute('disabled', ''); b.title = '登录后可用'; }
    });
    var x = (ev && ev.clientX) || 40;
    var y = (ev && ev.clientY) || 200;
    c.style.left = x + 'px';
    c.style.top = y + 'px';
  }
  function hideCtx() { $('ctx').classList.remove('on'); }

  function ctxRename() {
    var it = S.ctxItem;
    hideCtx();
    if (!it) { return; }
    if (!gateWrite('重命名')) { return; }
    var cur = it.type === 'post' ? it.id : it.id;
    var v = prompt('新的短名（小写字母/数字/连字符）', cur);
    if (!v || v === cur) { return; }
    api.rename({ path: it.path, slug: v }).then(function (r) {
      toast('已重命名为 ' + r.path);
      refreshTree();
      refreshStatus();
      if (S.doc && S.doc.path === it.path) { openDoc(r.path); }
    }).catch(function (e) { banner('重命名失败：' + e.message, true); });
  }

  function ctxDraft() {
    var it = S.ctxItem;
    hideCtx();
    if (!it) { return; }
    api.doc(it.path).then(function (doc) {
      if (doc.ext === 'sml') {
        banner('SML 文件的草稿需要手改 draft 字段（M2 未做 SML 字段写回）', true);
        return null;
      }
      doc.front_matter.draft = true;
      return api.save({ path: doc.path, front_matter: doc.front_matter, body: doc.body,
        base_hash: doc.hash })
        .then(function () { toast('已转为草稿'); refreshTree(); refreshStatus(); });
    }).catch(function (e) { banner('转草稿失败：' + e.message, true); });
  }

  function ctxLink() {
    var it = S.ctxItem;
    hideCtx();
    if (!it) { return; }
    var route = it.type === 'post' ? ('#/post/' + it.id)
      : it.type === 'topic' ? ('#/topic/' + it.id)
        : it.type === 'member' ? ('#/member/' + it.id)
          : it.type === 'project' ? ('#/project/' + it.id)
            : it.type === 'service' ? ('#/service/' + it.id)
              : it.type === 'weekly' ? ('#/weekly/' + it.id)
                : it.type === 'page' ? ('#/page/' + it.id) : ('#/' + it.type);
    copyText(route, '已复制站内链接：' + route);
  }

  function ctxDelete() {
    var it = S.ctxItem;
    hideCtx();
    if (!it) { return; }
    if (!gateWrite('删除')) { return; }
    $('del-sub').textContent = it.path;
    $('del-input').value = '';
    $('del-error').textContent = '';
    $('del-modal').hidden = false;
  }

  function doDelete() {
    var it = S.ctxItem;
    var typed = ($('del-input').value || '').trim();
    if (typed !== it.id) { $('del-error').textContent = '短名不匹配，请输入 ' + it.id; return; }
    api.remove({ path: it.path, confirm: typed }).then(function () {
      $('del-modal').hidden = true;
      toast('已删除（git rm，可在 PR 合并前撤回）');
      if (S.doc && S.doc.path === it.path) { S.doc = null; renderDoc(); }
      refreshTree();
      refreshStatus();
    }).catch(function (e) { $('del-error').textContent = e.message; });
  }

  // ---------------------------------------------------------------- 打开
  function openDoc(path) {
    if (S.dirty && !confirm('有未保存的改动，确定离开吗？')) { return; }
    api.doc(path).then(function (doc) {
      S.doc = doc;
      S.dirty = false;
      S.baseHash = doc.hash || '';
      renderDoc();
      $('banner').hidden = true;
      setSaveState('已保存');
      runCheck();
    }).catch(function (e) { banner('打开失败：' + e.message, true); });
  }

  function renderDoc() {
    var d = S.doc;
    if (!d) {
      $('title').textContent = '未打开文档';
      $('doc-path').textContent = '—';
      $('sb-path').textContent = '—';
      $('editor').value = '';
      $('fields').textContent = '';
      $('attach-box').hidden = true;
      setSaveState('未打开');
      return;
    }
    $('title').textContent = titleOf(d);
    $('doc-path').textContent = d.path;
    $('sb-path').textContent = d.path;
    $('type-select').textContent = '';
    $('type-select').appendChild(document.createTextNode(TYPE_LABEL[d.type] || d.type || '—'));
    $('type-select').appendChild(svg('i-chev'));
    $('contract-name').textContent = d.contract || '无契约';
    $('editor-hint') && ($('editor-hint').textContent = '');
    $('editor').value = d.ext === 'sml' ? d.raw : d.body;
    renderFields();
    renderAttachments();
    $('preview-state').textContent = '待生成';
    $('preview').textContent = '';
    $('preview').appendChild(el('p', { class: 'muted', text: '点顶栏「预览」或按 Ctrl+P 生成。' }));
  }

  function titleOf(d) {
    var fm = d.front_matter || {};
    return String(fm.title || fm.name || fm.period || d.path.split('/').pop());
  }

  function setSaveState(text) {
    $('sb-save').textContent = text;
    $('sb-save').className = (text === '已保存') ? 'ok' : '';
  }

  // ---------------------------------------------------------------- 契约表单
  function renderFields() {
    var box = $('fields');
    box.textContent = '';
    var d = S.doc;
    if (!d) { return; }
    if (d.ext === 'sml') {
      box.appendChild(el('div', { class: 'field wide',
        text: 'SML 文件按原文编辑；字段写在文件里，保存时会按 ' + (d.contract || '契约') + ' 校验。' }));
      updateMetaSum();
      return;
    }
    var spec = S.typeMap[d.type];
    var fields = (spec && spec.fields) || [];
    fields.forEach(function (f) { box.appendChild(fieldRow(f)); });
    Object.keys(d.front_matter).forEach(function (k) {
      var known = fields.some(function (f) { return f.name === k; });
      if (!known) { box.appendChild(el('div', { class: 'field wide', text: k + '：未知字段（保留原值）' })); }
    });
    updateMetaSum();
  }

  function fieldRow(f) {
    var d = S.doc;
    var val = d.front_matter[f.name];
    var wrap = el('div', { class: 'field' + (f.type === 'str' || f.name === 'summary' ? ' wide' : '') });
    wrap.appendChild(el('label', { text: f.name + ' · ' + f.type + (f.required ? ' · 必填' : '') }));
    var input;
    if (f.options && f.options.length) {
      input = el('select', {});
      input.appendChild(el('option', { value: '', text: '（空）' }));
      f.options.forEach(function (o) { input.appendChild(el('option', { value: o, text: o })); });
      input.value = val === undefined || val === null ? '' : String(val);
    } else if (f.type === 'bool') {
      input = el('select', {});
      input.appendChild(el('option', { value: '', text: '（未设置）' }));
      input.appendChild(el('option', { value: 'true', text: 'true' }));
      input.appendChild(el('option', { value: 'false', text: 'false' }));
      input.value = val === true ? 'true' : (val === false ? 'false' : '');
    } else if (f.type === 'int' || f.type === 'num' || f.type === 'float' || f.type === 'number') {
      input = el('input', { type: 'number', value: val === undefined || val === null ? '' : String(val) });
    } else if (f.type.indexOf('[') === 0) {
      return tagsRow(f, val);
    } else {
      input = el('input', { type: 'text', value: val === undefined || val === null ? '' : String(val) });
    }
    input.oninput = function () {
      d.front_matter[f.name] = cast(f, input.value);
      markDirty();
      updateMetaSum();
    };
    wrap.appendChild(input);
    var err = el('div', { class: 'err' });
    err.setAttribute('data-field', f.name);
    wrap.appendChild(err);
    return wrap;
  }

  function tagsRow(f, val) {
    var d = S.doc;
    var list = Array.isArray(val) ? val.slice() : (val ? [val] : []);
    var wrap = el('div', { class: 'field wide' });
    wrap.appendChild(el('label', { text: f.name + ' · ' + f.type + (f.required ? ' · 必填' : '') }));
    var chips = el('div', { class: 'chips' });
    function draw() {
      chips.textContent = '';
      list.forEach(function (t, i) {
        var c = el('span', { class: 'chip' }, [document.createTextNode(String(t))]);
        var x = el('span', { class: 'x', text: '×' });
        x.onclick = function () { list.splice(i, 1); d.front_matter[f.name] = list; draw(); markDirty(); updateMetaSum(); };
        c.appendChild(x);
        chips.appendChild(c);
      });
      var add = el('span', { class: 'chip add', text: '+ 添加' });
      add.onclick = function () {
        var v = prompt('新标签');
        if (v) { list.push(v.trim()); d.front_matter[f.name] = list; draw(); markDirty(); updateMetaSum(); }
      };
      chips.appendChild(add);
    }
    draw();
    wrap.appendChild(chips);
    var err = el('div', { class: 'err' });
    err.setAttribute('data-field', f.name);
    wrap.appendChild(err);
    return wrap;
  }

  function cast(f, raw) {
    if (raw === '') { return undefined; }
    if (f.type === 'bool') { return raw === 'true'; }
    if (f.type === 'int' || f.type === 'num' || f.type === 'float' || f.type === 'number') {
      var n = Number(raw);
      return isNaN(n) ? raw : n;
    }
    return raw;
  }

  function updateMetaSum() {
    var d = S.doc;
    if (!d) { return; }
    var fm = d.front_matter || {};
    var parts = [];
    ['author', 'date', 'period', 'name', 'group', 'status', 'kind'].forEach(function (k) {
      if (fm[k] !== undefined && fm[k] !== '') { parts.push(String(fm[k])); }
    });
    if (Array.isArray(fm.tags) && fm.tags.length) {
      parts.push(fm.tags.map(function (t) { return '#' + t; }).join(' '));
    }
    if (fm.map === true) { parts.push('导图开'); }
    if (fm.draft === true) { parts.push('草稿'); }
    $('meta-sum').textContent = parts.join(' · ') || '—';
  }

  // ---------------------------------------------------------------- 附件卡
  function renderAttachments() {
    var box = $('attach-list');
    var wrap = $('attach-box');
    box.textContent = '';
    var d = S.doc;
    if (!d || d.ext === 'sml') { wrap.hidden = true; return; }
    var list = (d.front_matter && d.front_matter.attachments) || [];
    wrap.hidden = !list.length;
    $('attach-hint').textContent = list.length ? (list.length + ' 项') : '';
    list.forEach(function (a, i) {
      var r = a.resource ? S.resMap[a.resource] : null;
      var card = el('div', { class: 'card' });
      card.appendChild(el('b', { text: a.name || '附件' }));
      var line = el('div', { class: 'row' });
      line.appendChild(document.createTextNode(a.resource ? ('引用资源 id：' + a.resource) : (a.url || '无链接')));
      card.appendChild(line);
      if (r && r.kind) { card.appendChild(el('div', { class: 'row', text: '渠道：' + (KIND_LABEL[r.kind] || r.kind) })); }
      var code = a.code || (r && r.code) || '';
      var chip = codeChip(code);
      if (chip) { card.appendChild(chip); }
      else if (a.resource && !code) { card.appendChild(el('span', { class: 'muted', text: '提取码由资源解析' })); }
      var rm = el('button', { class: 'btn', type: 'button', text: '移除' });
      rm.onclick = function () {
        d.front_matter.attachments.splice(i, 1);
        if (!d.front_matter.attachments.length) { delete d.front_matter.attachments; }
        renderAttachments();
        markDirty();
      };
      card.appendChild(rm);
      box.appendChild(card);
    });
  }

  // ---------------------------------------------------------------- 脏标记 / 校验
  function markDirty() {
    S.dirty = true;
    setSaveState('未保存');
    $('title').textContent = '● ' + titleOf(S.doc);
    $('preview-state').textContent = '待生成';
    scheduleCheck();
    // M3 设置：自动保存（停 2 秒）/ 自动预览（停 1 秒）
    if (S.prefs && S.prefs.autosave) {
      if (S.autoSaveTimer) { clearTimeout(S.autoSaveTimer); }
      S.autoSaveTimer = setTimeout(saveDoc, 2000);
    }
    if (S.prefs && S.prefs.previewMode === 'auto') {
      if (S.autoPrevTimer) { clearTimeout(S.autoPrevTimer); }
      S.autoPrevTimer = setTimeout(previewDoc, 1000);
    }
  }

  function payload() {
    var d = S.doc;
    var p = { path: d.path };
    if (d.ext === 'sml') { p.raw = $('editor').value; } else {
      p.front_matter = d.front_matter;
      p.body = $('editor').value;
    }
    if (S.baseHash) { p.base_hash = S.baseHash; }
    return p;
  }

  function scheduleCheck() {
    if (S.checkTimer) { clearTimeout(S.checkTimer); }
    S.checkTimer = setTimeout(runCheck, 700);
  }

  function runCheck() {
    if (!S.doc) { return; }
    api.validate(payload()).then(function (res) {
      renderContract(res.ok, res.errors || []);
      applyFieldErrors(res.errors || []);
    }).catch(function (e) { renderContract(false, e.errors || [{ field: '', msg: e.message }]); });
  }

  function applyFieldErrors(errors) {
    var boxes = $('fields').querySelectorAll('.err');
    for (var i = 0; i < boxes.length; i++) { boxes[i].textContent = ''; }
    errors.forEach(function (e) {
      if (!e.field) { return; }
      var node = $('fields').querySelector('.err[data-field="' + e.field + '"]');
      if (node) { node.textContent = e.msg; }
    });
  }

  function renderContract(ok, errors) {
    var dot = $('contract-dot');
    dot.className = 'dot' + (ok ? '' : ' bad');
    $('contract-label').textContent = ok ? '契约' : ('契约 ' + errors.length + ' 项');
    var pop = $('contract-pop');
    pop.textContent = '';
    if (ok) { pop.appendChild(row('i-check', 'ok', '契约通过：' + (S.doc.contract || '无'))); }
    else {
      errors.slice(0, 8).forEach(function (e) { pop.appendChild(row('i-alert', 'warn', e.msg, e.field)); });
    }
    pop.appendChild(el('div', { class: 'row', text: '保存前会自动校验，不通过不写盘' }));
  }

  function row(icon, cls, text, field) {
    var kids = [svg(icon, cls), el('span', { text: text })];
    if (field) { kids.push(el('span', { class: 'field', text: field })); }
    return el('div', { class: 'row' }, kids);
  }

  // ---------------------------------------------------------------- 保存 / 预览
  function saveDoc() {
    if (!S.doc) { toast('还没有打开文档'); return; }
    var d = S.doc;
    api.validate(payload()).then(function (res) {
      if (!res.ok) {
        applyFieldErrors(res.errors);
        renderContract(false, res.errors);
        $('meta').open = true;
        banner('契约未通过，文件没有改动', true);
        return null;
      }
      return api.save(payload());
    }).then(function (r) {
      if (!r) { return; }
      S.dirty = false;
      S.baseHash = r.hash || S.baseHash;
      setSaveState('已保存');
      $('title').textContent = titleOf(d);
      toast('已保存 · ' + r.path);
      $('banner').hidden = true;
      refreshTree();
      refreshStatus();
    }).catch(function (e) {
      if (e.status === 409) { onConflict(d.path); return; }
      if (e.errors && e.errors.length) { applyFieldErrors(e.errors); renderContract(false, e.errors); }
      banner('保存失败：' + e.message, true);
    });
  }

  function onConflict(path) {
    // 磁盘被外部改过：重新加载 / 覆盖 / 取消
    var reload = confirm('文件已被外部修改。\n确定＝重新加载（丢弃当前编辑）\n取消＝仍用当前内容覆盖');
    if (reload) { openDoc(path); return; }
    api.doc(path).then(function (fresh) {
      S.baseHash = fresh.hash;
      return api.save(payload());
    }).then(function (r) {
      S.dirty = false;
      S.baseHash = r.hash || S.baseHash;
      setSaveState('已保存');
      toast('已覆盖保存');
      refreshTree();
      refreshStatus();
    }).catch(function (e) { banner('覆盖保存失败：' + e.message, true); });
  }

  function previewDoc() {
    if (!S.doc) { toast('还没有打开文档'); return; }
    $('preview-state').textContent = '生成中';
    api.preview(payload()).then(function (res) {
      var box = $('preview');
      box.textContent = '';
      box.appendChild(el('p', { class: 'kicker', text: (TYPE_LABEL[S.doc.type] || '') + ' › ' + titleOf(S.doc) }));
      box.appendChild(el('h3', { text: String((S.doc.front_matter || {}).title || titleOf(S.doc)) }));
      var lede = (S.doc.front_matter || {}).summary;
      if (lede) { box.appendChild(el('p', { class: 'lede', text: String(lede) })); }
      var content = el('div', { class: 'body' });
      content.innerHTML = res.html;         // 引擎已转义，与站点同一渲染出口
      box.appendChild(content);
      $('preview-state').textContent = '已生成 · ' + nowHM();
      $('sb-words').textContent = (res.words || 0) + ' 字';
    }).catch(function (e) {
      $('preview-state').textContent = '失败';
      banner('预览失败：' + e.message, true);
    });
  }

  // ---------------------------------------------------------------- 工具条
  function selected() {
    var ta = $('editor');
    return { ta: ta, start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  }

  function put(ta, value, caretStart, caretEnd) {
    if (typeof document.execCommand === 'function') {
      try {
        ta.focus();
        if (document.execCommand('insertText', false, value)) {
          if (caretStart !== undefined) { ta.selectionStart = caretStart; ta.selectionEnd = caretEnd === undefined ? caretStart : caretEnd; }
          markDirty();
          return;
        }
      } catch (e) { /* 退回手动改写 */ }
    }
    var s = ta.selectionStart, e2 = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + value + ta.value.slice(e2);
    if (caretStart !== undefined) { ta.selectionStart = caretStart; ta.selectionEnd = caretEnd === undefined ? caretStart : caretEnd; }
    else { ta.selectionStart = ta.selectionEnd = s + value.length; }
    markDirty();
  }

  function surround(pre, post, placeholder) {
    var s = selected();
    var body = s.text || placeholder || '';
    var value = pre + body + post;
    put(s.ta, value, s.start + pre.length, s.start + pre.length + body.length);
  }

  function prefixLines(prefix) {
    var s = selected();
    var lines = (s.text || '').split('\n');
    var body = lines.map(function (l) { return prefix + l; }).join('\n');
    put(s.ta, body, s.start, s.start + body.length);
  }

  function runCmd(cmd) {
    if (!S.doc) { toast('还没有打开文档'); return; }
    var sml = S.doc.ext === 'sml';
    if (cmd === 'bold') { sml ? surround('{strong:', '}', '粗体') : surround('**', '**', '粗体'); }
    else if (cmd === 'italic') { sml ? surround('{em:', '}', '斜体') : surround('*', '*', '斜体'); }
    else if (cmd === 'code') { surround('`', '`', 'code'); }
    else if (cmd === 'link') { sml ? surround('{link:', '}', 'https://example.com') : surround('[', '](https://example.com)', '链接文字'); }
    else if (cmd === 'image') { $('file-picker').click(); }
    else if (cmd === 'video') { insertRaw('\nBV号单独一行：BV1xx411c7mD\n'); }
    else if (cmd === 'math') { insertRaw('$x^2$'); }
    else if (cmd === 'ul') { prefixLines('- '); }
    else if (cmd === 'quote') { prefixLines('> '); }
    else if (cmd === 'table') {
      insertRaw('\n| 列 A | 列 B |\n| --- | --- |\n| 值 | 值 |\n');
    }
  }

  function insertRaw(text) {
    var s = selected();
    put(s.ta, text);
  }

  function insertBlock(tpl) {
    var s = selected();
    var pos = tpl.indexOf('§');
    var value = tpl.replace('§', '');
    put(s.ta, value, s.start + (pos >= 0 ? pos : value.length));
  }

  function renderInsertMenu() {
    var pop = $('insert-pop');
    if (!pop) { return; }          // 登录页 / 设置页没有插入菜单
    pop.textContent = '';
    INSERTS.forEach(function (item) {
      var b = el('button', { class: 'blk', type: 'button', title: item.label },
        [document.createTextNode(item.label)]);
      b.onclick = function () {
        $('insert').open = false;
        if (item.act === 'attach') { openResources(); return; }
        if (!S.doc) { toast('还没有打开文档'); return; }
        insertBlock(S.doc.ext === 'sml' ? item.sml : item.md);
      };
      pop.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- 图片上传
  function uploadFile(file) {
    if (!S.doc) { toast('先打开一个文档，图片会存到它的 assets/'); return; }
    if (!file) { return; }
    if (file.size && file.size > 2 * 1024 * 1024) { toast('图片超过 2 MB：' + file.name); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result || '').split(',')[1] || '';
      api.asset({ path: S.doc.path, name: file.name, data_base64: b64 }).then(function (res) {
        insertRaw(res.markdown);
        toast('已上传 ' + res.name + '（' + res.width + '×' + res.height + '）');
      }).catch(function (e) { toast('上传失败：' + e.message); });
    };
    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------------- 资源弹层
  function openResources() {
    if (!S.doc) { toast('先打开一个文档'); return; }
    // 附件引用方式的默认值来自设置（引用 id / 复制独立附件）
    if ($('res-copy')) { $('res-copy').checked = !!S.prefs && S.prefs.attachMode === 'copy'; }
    $('res-modal').hidden = false;
    api.resources().then(function (rows) {
      S.resources = rows;
      S.resMap = {};
      rows.forEach(function (r) { S.resMap[r.id] = r; });
      renderResFilters();
      renderResList();
    }).catch(function (e) { toast('资源读取失败：' + e.message); });
  }

  function renderResFilters() {
    var box = $('res-filters');
    box.textContent = '';
    var kinds = {};
    S.resources.forEach(function (r) { if (r.kind) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; } });
    box.appendChild(filterChip('全部', ''));
    Object.keys(kinds).sort().forEach(function (k) {
      box.appendChild(filterChip((KIND_LABEL[k] || k) + ' (' + kinds[k] + ')', 'kind:' + k));
    });
    var withCode = S.resources.filter(function (r) { return r.code; }).length;
    if (withCode) { box.appendChild(filterChip('有提取码 (' + withCode + ')', 'code')); }
  }

  function filterChip(label, key) {
    var c = el('span', { class: 'chip' + (S.resFilter === key ? ' on' : ''), text: label });
    c.onclick = function () { S.resFilter = key; renderResFilters(); renderResList(); };
    return c;
  }

  function renderResList() {
    var box = $('res-list');
    box.textContent = '';
    var q = ($('res-q').value || '').trim().toLowerCase();
    var rows = S.resources.filter(function (r) {
      if (S.resFilter === 'code' && !r.code) { return false; }
      if (S.resFilter && S.resFilter.indexOf('kind:') === 0 && r.kind !== S.resFilter.slice(5)) { return false; }
      if (q && (r.title + ' ' + r.id + ' ' + (r.tags || []).join(' ') + ' ' + (r.folder || '')).toLowerCase().indexOf(q) < 0) {
        return false;
      }
      return true;
    });
    if (!rows.length) { box.appendChild(el('p', { class: 'muted', text: '没有匹配的资源。' })); }
    rows.forEach(function (r) { box.appendChild(resRow(r)); });
  }

  function resRow(r) {
    var node = el('div', { class: 'res-row' + (S.picked && S.picked.id === r.id ? ' on' : '') }, [
      el('span', { class: 'kind', text: KIND_LABEL[r.kind] || r.kind || '资源' }),
      el('span', { class: 'name', text: r.title }),
      el('span', { class: 'folder', text: r.folder ? r.folder + ' /' : '' })
    ]);
    var chip = codeChip(r.code);
    if (chip) {
      chip.onclick = function (ev) {
        if (ev && ev.stopPropagation) { ev.stopPropagation(); }
        copyText(r.code, '已复制提取码：' + r.code);
      };
      node.appendChild(chip);
    } else {
      node.appendChild(el('span', { class: 'folder', text: '无提取码' }));
    }
    node.onclick = function () {
      S.picked = r;
      renderResList();
      var p = $('res-picked');
      p.hidden = false;
      p.textContent = '';
      p.appendChild(svg('i-link'));
      p.appendChild(document.createTextNode('已选 '));
      p.appendChild(el('b', { text: r.title }));
      p.appendChild(document.createTextNode(' · ' + (r.url || '无链接') + (r.code ? (' · 提取码 ' + r.code) : '')));
      p.appendChild(el('span', { text: '资源 id: ' + r.id }));
    };
    return node;
  }

  function insertAttachment() {
    var r = S.picked;
    if (!r) { toast('先选一个资源'); return; }
    var copy = $('res-copy').checked;   // 勾选框的值（打开弹层时按设置置好默认值）
    var att = copy
      ? { name: r.title, kind: 'link', url: r.url, code: r.code || '' }
      : { name: r.title, kind: 'link', resource: r.id };
    $('res-modal').hidden = true;
    confirmWrite([
      {
        what: copy ? '附件（复制独立：固定当前 url 与提取码）' : '附件（引用资源 id：资源更新会跟随）',
        detail: r.title + ' · ' + (copy ? (r.url || '无链接') : ('resource: ' + r.id))
          + (r.code ? (' · 提取码 ' + r.code) : ''),
        src: copy ? '资源库（快照）' : '资源库（引用）',
        apply: function () {
          var fm = S.doc.front_matter;
          if (!Array.isArray(fm.attachments)) { fm.attachments = []; }
          fm.attachments.push(att);
          renderAttachments();
          markDirty();
        }
      }
    ], '写入 attachments');
  }

  // ---------------------------------------------------------------- 写入前确认
  function confirmWrite(rows, title) {
    var box = $('confirm-rows');
    box.textContent = '';
    $('confirm-sub').textContent = title || '将要写入的内容';
    rows.forEach(function (r, i) {
      var line = el('div', { class: 'confirm-row' });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = true;
      cb.id = 'cw-' + i;
      line.appendChild(cb);
      var what = el('div', { class: 'what' }, [el('b', { text: r.what }), el('span', { text: r.detail || '' })]);
      line.appendChild(what);
      line.appendChild(el('span', { class: 'src', text: r.src || '表单' }));
      box.appendChild(line);
    });
    $('confirm-count').textContent = rows.length + ' 项待确认';
    $('confirm-modal').hidden = false;

    $('confirm-all').onclick = function () {
      $('confirm-modal').hidden = true;
      rows.forEach(function (r) { r.apply(); });
      toast('已写入 ' + rows.length + ' 项');
    };
    $('confirm-some').onclick = function () {
      var n = 0;
      rows.forEach(function (r, i) {
        var cb = $('cw-' + i);
        if (cb && cb.checked) { r.apply(); n++; }
      });
      $('confirm-modal').hidden = true;
      toast(n ? ('已写入 ' + n + ' 项') : '没有勾选任何项');
    };
  }

  // ---------------------------------------------------------------- 新建
  function renderTypeGrid() {
    var box = $('type-grid');
    box.textContent = '';
    NEW_TYPES.forEach(function (t) {
      var card = el('button', { class: 'type-card' + (t === S.newType ? ' on' : ''), type: 'button' }, [
        svg(TYPE_ICON[t] || 'i-doc'), el('b', { text: TYPE_LABEL[t] }),
        el('span', { text: ((S.typeMap[t] && S.typeMap[t].dir) ? S.typeMap[t].dir : t) + '/' })
      ]);
      card.onclick = function () { S.newType = t; renderTypeGrid(); updateNewPath(); };
      box.appendChild(card);
    });
  }

  function updateNewPath() {
    var slug = $('new-slug').value.trim() || slugify($('new-title').value);
    var dir = (S.typeMap[S.newType] && S.typeMap[S.newType].dir) || S.newType;
    $('new-path').value = S.newType === 'post'
      ? ('content/posts/' + new Date().getFullYear() + '/' + (slug || '<短名>') + '/index.md')
      : ('content/' + dir + '/' + (slug || '<短名>') + '.md');
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function openNew() { $('new-modal').hidden = false; $('new-error').textContent = ''; updateNewPath(); $('new-title').focus(); }
  function closeNew() { $('new-modal').hidden = true; }

  function createDoc() {
    var title = $('new-title').value.trim();
    var slug = $('new-slug').value.trim() || slugify(title);
    if (!title) { $('new-error').textContent = '标题不能为空'; return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { $('new-error').textContent = '短名只能是小写字母、数字与连字符'; return; }
    api.create({
      type: S.newType, title: title, slug: slug, author: $('new-author').value.trim(),
      tags: $('new-tags').value.split(/[,\s]+/).filter(function (x) { return x; }),
      draft: $('new-draft').checked
    }).then(function (res) {
      closeNew();
      var fm = {};
      var parts = res.template.split(/\n---\n/);
      if (res.template.indexOf('---') === 0 && parts.length > 1) {
        fm = parseLite(parts[0].replace(/^---\n/, ''));
      }
      S.doc = {
        path: res.path, type: S.newType, contract: (S.typeMap[S.newType] || {}).contract,
        ext: 'md', front_matter: fm, body: parts.slice(1).join('\n---\n').replace(/^\n/, ''),
        raw: res.template, hash: ''
      };
      S.dirty = true;
      S.baseHash = '';
      renderDoc();
      $('meta').open = true;
      setSaveState('未保存（新建）');
      renderTree();
      runCheck();
      toast('已创建草稿，首次保存才写入文件');
    }).catch(function (e) { $('new-error').textContent = e.message; });
  }

  function parseLite(text) {
    var out = {};
    text.split('\n').forEach(function (line) {
      var m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) { return; }
      var v = m[2].trim();
      if (v.indexOf('[') === 0 && v.lastIndexOf(']') === v.length - 1) {
        var inner = v.slice(1, -1).trim();
        out[m[1]] = inner ? inner.split(/\s+/) : [];
      } else if (v.indexOf('"') === 0 && v.lastIndexOf('"') === v.length - 1) { out[m[1]] = v.slice(1, -1); }
      else if (v === 'true' || v === 'false') { out[m[1]] = v === 'true'; }
      else if (/^\d+$/.test(v)) { out[m[1]] = Number(v); }
      else { out[m[1]] = v; }
    });
    return out;
  }

  // ---------------------------------------------------------------- 提交 PR
  function openPr() {
    if (!S.auth.logged) { gateWrite('提交 PR'); return; }
    $('pr-error').textContent = '';
    $('pr-result').hidden = true;
    $('pr-result').textContent = '';
    $('pr-modal').hidden = false;
    // 改动文件：来自 git status（site/ 前缀去掉，与树一致）
    S.pr.files = (S.status.dirty || []).map(function (d) {
      return { path: d.path.replace(/^site\//, ''), status: d.status, on: true };
    });
    renderPrFiles();
    // 分支默认值：post/<slug>-<yyyyMMddHHMM>（取第一篇文章的短名）
    var slug = '';
    S.pr.files.some(function (f) {
      var m = f.path.match(/^content\/posts\/\d{4}\/([^/]+)\//);
      if (m) { slug = m[1]; return true; }
      return false;
    });
    if (!slug && S.pr.files.length) {
      slug = S.pr.files[0].path.split('/').pop().replace(/\.[a-z]+$/, '');
    }
    var d = new Date();
    function p2(n) { return ('0' + n).slice(-2); }
    S.pr.branch = 'post/' + (slug || 'draft') + '-' + d.getFullYear() + p2(d.getMonth() + 1) +
      p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes());
    $('pr-branch').value = S.pr.branch;
    $('pr-message').value = '写作台：更新 ' + S.pr.files.length + ' 个文件';
    $('pr-title').value = $('pr-message').value;
    $('pr-body').value = '由写作台提交；分支 ' + S.pr.branch + ' → ' + 'staging（staging → master 由维护者合）。';
    // 审核人：默认来自站点配置（/api/reviewers）
    api.reviewers().then(function (list) {
      S.pr.reviewers = (list || []).slice();
      renderPrReviewers();
    }).catch(function () { S.pr.reviewers = []; renderPrReviewers(); });
  }

  function renderPrFiles() {
    var box = $('pr-files');
    box.textContent = '';
    if (!S.pr.files.length) {
      box.appendChild(el('p', { class: 'muted', text: '没有改动（git status 干净）。' }));
      return;
    }
    S.pr.files.forEach(function (f, i) {
      var row = el('label', { class: 'pr-file' });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = f.on;
      cb.onchange = function () { S.pr.files[i].on = cb.checked; };
      row.appendChild(cb);
      row.appendChild(el('span', { class: 'st', text: f.status }));
      row.appendChild(el('span', { class: 'p', text: f.path, title: f.path }));
      box.appendChild(row);
    });
  }

  function renderPrReviewers() {
    var box = $('pr-reviewers');
    box.textContent = '';
    S.pr.reviewers.forEach(function (r, i) {
      var c = el('span', { class: 'chip' }, [document.createTextNode(r)]);
      var x = el('span', { class: 'x', text: '×' });
      x.onclick = function () { S.pr.reviewers.splice(i, 1); renderPrReviewers(); };
      c.appendChild(x);
      box.appendChild(c);
    });
    if (!S.pr.reviewers.length) {
      box.appendChild(el('span', { class: 'muted', text: '（没有审核人）' }));
    }
  }

  function addReviewer() {
    var v = ($('pr-rev-input').value || '').trim();
    if (!v) { return; }
    if (S.pr.reviewers.indexOf(v) < 0) { S.pr.reviewers.push(v); renderPrReviewers(); }
    $('pr-rev-input').value = '';
  }

  function doPr() {
    var paths = S.pr.files.filter(function (f) { return f.on; }).map(function (f) { return f.path; });
    var branch = ($('pr-branch').value || '').trim();
    if (!paths.length) { $('pr-error').textContent = '没有勾选任何文件'; return; }
    if (!branch) { $('pr-error').textContent = '分支名不能为空'; return; }
    $('pr-error').textContent = '';
    $('pr-go').disabled = true;
    $('pr-result').hidden = true;
    $('pr-result').textContent = '';
    api.pr({
      paths: paths, branch: branch,
      message: $('pr-message').value, title: $('pr-title').value,
      body: $('pr-body').value, reviewers: S.pr.reviewers
    }).then(function (res) {
      $('pr-go').disabled = false;
      renderPrResult(res);
      if (res.ok) { refreshStatus(); }
    }).catch(function (e) {
      $('pr-go').disabled = false;
      $('pr-result').hidden = false;
      $('pr-result').className = 'pr-result';
      $('pr-result').textContent = '';
      $('pr-result').appendChild(el('div', { class: 'row', text: '请求失败：' + e.message }));
    });
  }

  function renderPrResult(res) {
    var box = $('pr-result');
    box.hidden = false;
    box.textContent = '';
    box.className = 'pr-result' + (res.ok ? ' ok' : '');
    function row(text) { box.appendChild(el('div', { class: 'row', text: text })); }
    if (res.ok) {
      row('已提交：分支 ' + res.branch + ' · 提交 ' + (res.commit || '') +
          (res.via === 'fork' ? ' · 经 fork' : ''));
      if (res.reviewers && res.reviewers.length) {
        row('审核人：' + res.reviewers.join('、'));
      }
      var url = safeUrl(res.pr_url);
      if (url) {
        var a = el('a', { href: url, target: '_blank', rel: 'noopener' }, [document.createTextNode(url)]);
        box.appendChild(el('div', { class: 'row' }, [document.createTextNode('PR：'), a]));
      } else if (res.pr_url) {
        row('PR 链接不合法已被拦截：' + res.pr_url);
      }
      return;
    }
    row('失败于阶段：' + (res.stage || '?') + ' —— ' + (res.error || ''));
    var cmp = safeUrl(res.compare_url);
    if (cmp) {
      var ca = el('a', { href: cmp, target: '_blank', rel: 'noopener' }, [document.createTextNode(cmp)]);
      box.appendChild(el('div', { class: 'row' }, [document.createTextNode('对比：'), ca]));
    }
    if (res.commands && res.commands.length) {
      box.appendChild(el('div', { class: 'row', text: '可复制命令（没有执行 force、没有自动重试）：' }));
      box.appendChild(el('div', { class: 'cmds', text: res.commands.join('\n') }));
    }
  }

  // ---------------------------------------------------------------- 绑定
  function bindUI() {
    $('btn-save').onclick = saveDoc;
    $('btn-preview').onclick = previewDoc;
    $('btn-new').onclick = openNew;
    $('new-close').onclick = closeNew;
    $('new-cancel').onclick = closeNew;
    $('new-create').onclick = createDoc;
    $('new-title').oninput = updateNewPath;
    $('new-slug').oninput = updateNewPath;
    $('banner-close').onclick = function () { $('banner').hidden = true; };
    $('btn-toggle-tree').onclick = function () { document.body.classList.toggle('no-tree'); };
    $('btn-toggle-side').onclick = function () { document.body.classList.toggle('no-side'); };
    $('search').oninput = renderTree;

    // 工具条
    var tools = $('toolbar').querySelectorAll('.tool');
    for (var i = 0; i < tools.length; i++) {
      (function (btn) {
        btn.onclick = function () { runCmd(btn.getAttribute('data-cmd')); };
      })(tools[i]);
    }
    $('file-picker').onchange = function () {
      var f = this.files && this.files[0];
      if (f) { uploadFile(f); }
      this.value = '';
    };

    // 图片拖入
    var ta = $('editor');
    ta.addEventListener('dragover', function (e) {
      if (e && e.preventDefault) { e.preventDefault(); }
    });
    ta.addEventListener('drop', function (e) {
      if (!e || !e.preventDefault) { return; }
      e.preventDefault();
      if (S.prefs && S.prefs.imgUpload === false) {
        toast('设置里关掉了「拖入自动上传」，请用工具条「图片」手动选择');
        return;
      }
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) { return; }
      for (var k = 0; k < files.length; k++) { uploadFile(files[k]); }
    });

    // 资源弹层
    $('res-close').onclick = function () { $('res-modal').hidden = true; };
    $('res-cancel').onclick = function () { $('res-modal').hidden = true; };
    $('res-insert').onclick = insertAttachment;
    $('res-q').oninput = renderResList;

    // 删除确认
    $('del-close').onclick = function () { $('del-modal').hidden = true; };
    $('del-cancel').onclick = function () { $('del-modal').hidden = true; };
    $('del-go').onclick = doDelete;

    // 写入前确认
    $('confirm-close').onclick = function () { $('confirm-modal').hidden = true; };
    $('confirm-cancel').onclick = function () { $('confirm-modal').hidden = true; };

    // 右键菜单
    $('ctx-open').onclick = function () { hideCtx(); if (S.ctxItem) { openDoc(S.ctxItem.path); } };
    $('ctx-rename').onclick = ctxRename;
    $('ctx-draft').onclick = ctxDraft;
    $('ctx-link').onclick = ctxLink;
    $('ctx-delete').onclick = ctxDelete;

    // M3：登录 / 设置 / 提交 PR
    $('btn-login').onclick = function () { location.href = '/login'; };
    $('btn-settings').onclick = function () { location.href = '/settings'; };
    $('me-chip').onclick = function () { location.href = '/settings'; };
    $('btn-pr').onclick = openPr;
    $('pr-close').onclick = function () { $('pr-modal').hidden = true; };
    $('pr-cancel').onclick = function () { $('pr-modal').hidden = true; };
    $('pr-go').onclick = doPr;
    $('pr-rev-add').onclick = addReviewer;
    document.addEventListener('click', function (e) {
      if (e && e.target && $('ctx') && !$('ctx').contains(e.target)) { hideCtx(); }
    });

    $('editor').oninput = function () {
      markDirty();
      $('sb-words').textContent = $('editor').value.length + ' 字';
    };

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') { e.preventDefault(); saveDoc(); }
      else if (mod && e.key === 'p') { e.preventDefault(); previewDoc(); }
      else if (mod && e.key === 'b') { e.preventDefault(); runCmd('bold'); }
      else if (mod && e.key === 'i') { e.preventDefault(); runCmd('italic'); }
      else if (mod && e.key === 'k') { e.preventDefault(); runCmd('link'); }
      else if (mod && e.key === 'f') { e.preventDefault(); $('search').focus(); }
      else if (e.key === 'Escape') {
        hideCtx();
        if (!$('new-modal').hidden) { closeNew(); }
        if (!$('res-modal').hidden) { $('res-modal').hidden = true; }
        if (!$('confirm-modal').hidden) { $('confirm-modal').hidden = true; }
        if (!$('del-modal').hidden) { $('del-modal').hidden = true; }
        var pm = $('pr-modal');
        if (pm && !pm.hidden) { pm.hidden = true; }
      }
    });
  }

  // ---------------------------------------------------------------- 登录页
  function bootLogin() {
    loadPrefs();
    applyPrefs();
    var input = $('login-token');
    var go = $('login-go');
    var span = go.getElementsByTagName('span')[0];
    var label = span ? span.textContent : '';

    function setRadio() {
      $('rc-remember').classList.toggle('on', $('login-remember').checked);
      $('rc-session').classList.toggle('on', !$('login-remember').checked);
    }
    $('login-eye').onclick = function () {
      input.type = input.type === 'password' ? 'text' : 'password';
    };
    $('login-remember').onclick = setRadio;
    $('login-session').onclick = setRadio;
    setRadio();

    function doLogin() {
      var token = (input.value || '').trim();
      $('login-error').textContent = '';
      if (!token) { $('login-error').textContent = '先粘贴 Gitee 令牌'; return; }
      go.disabled = true;
      if (span) { span.textContent = '登录中…'; }
      // remember=true → Rust 写系统钥匙串；失败会明确提示并降级仅本次会话（不落文件）
      api.login({ token: token, remember: $('login-remember').checked }).then(function () {
        location.href = '/';
      }).catch(function (e) {
        go.disabled = false;
        if (span) { span.textContent = label; }
        if (e.status === 401) { $('login-error').textContent = '令牌无效或权限不足（Gitee 返回 401/403）'; }
        else if (e.status === 400) { $('login-error').textContent = e.message; }
        else { $('login-error').textContent = '无法连接 Gitee：' + e.message + '；可稍后重试'; }
      });
    }
    go.onclick = doLogin;
    input.onkeydown = function (e) { if (e && e.key === 'Enter') { doLogin(); } };
    if (input.focus) { input.focus(); }
  }

  // ---------------------------------------------------------------- 设置页
  function segBind(id, key, cast) {
    var box = $(id);
    if (!box) { return; }
    var btns = box.getElementsByTagName('button');
    function draw() {
      for (var i = 0; i < btns.length; i++) {
        var v = cast ? cast(btns[i].getAttribute('data-v')) : btns[i].getAttribute('data-v');
        if (String(v) === String(S.prefs[key])) { btns[i].classList.add('on'); }
        else { btns[i].classList.remove('on'); }
      }
    }
    for (var j = 0; j < btns.length; j++) {
      (function (b) {
        b.onclick = function () {
          var raw = b.getAttribute('data-v');
          S.prefs[key] = cast ? cast(raw) : raw;
          savePrefs();
          applyPrefs();
          draw();
        };
      })(btns[j]);
    }
    draw();
  }
  function checkBind(id, key) {
    var cb = $(id);
    if (!cb) { return; }
    cb.checked = !!S.prefs[key];
    cb.onchange = function () {
      S.prefs[key] = cb.checked;
      savePrefs();
      applyPrefs();
    };
  }

  function renderSettingsAuth() {
    var box = $('set-auth');
    var tok = $('set-token');
    box.textContent = '';
    api.whoami().then(function (me) {
      S.auth = { logged: true, login: me.login || '', name: me.name || me.login || '',
        remembered: !!me.remembered, location: me.location || '' };
      box.appendChild(document.createTextNode('已登录 '));
      box.appendChild(el('b', { text: S.auth.name || S.auth.login }));
      box.appendChild(document.createTextNode('（Gitee）'));
      var out = el('button', { class: 'btn', type: 'button', text: '退出登录' });
      out.onclick = function () {
        api.logout(false).then(function () { renderSettingsAuth(); });
      };
      box.appendChild(out);
      var outAll = el('button', { class: 'btn', type: 'button', text: '退出并清除钥匙串' });
      outAll.onclick = function () {
        api.logout(true).then(function () { renderSettingsAuth(); });
      };
      box.appendChild(outAll);
      tok.textContent = 'repo 权限 · 存放：' + (me.location || '内存') + ' · 不显示明文';
    }).catch(function (e) {
      S.auth = { logged: false, login: '', name: '', remembered: false, location: '' };
      box.appendChild(document.createTextNode('未登录 · '));
      var a = el('a', { class: 'auth-link', href: '/login' }, [document.createTextNode('去登录 →')]);
      box.appendChild(a);
      tok.textContent = e && e.status === 401 ? '未登录，本地没有令牌' : ('状态未知：' + e.message);
    });
  }

  function renderPurgeResult(res) {
    var box = $('purge-result');
    box.hidden = false;
    box.textContent = '';
    (res.items || []).forEach(function (it) {
      var row = el('div', { class: 'row' + (it.ok ? '' : ' no') });
      row.appendChild(el('span', { class: 'it', text: (it.ok ? '✓ ' : '✗ ') + it.item }));
      row.appendChild(el('span', { class: 'de', text: it.detail || '' }));
      box.appendChild(row);
    });
    if (res.note) { box.appendChild(el('div', { class: 'row' }, [el('span', { class: 'de', text: res.note })])); }
  }

  function bootSettings() {
    loadPrefs();
    applyPrefs();
    segBind('set-theme', 'theme');
    segBind('set-fontsize', 'fontSize', Number);
    segBind('set-preview-mode', 'previewMode');
    segBind('set-attach-mode', 'attachMode');
    checkBind('set-labels', 'labels');
    checkBind('set-tool-labels', 'toolLabels');
    checkBind('set-show-tree', 'showTree');
    checkBind('set-show-side', 'showSide');
    checkBind('set-autosave', 'autosave');
    checkBind('set-img-upload', 'imgUpload');
    checkBind('set-code-show', 'codeShow');
    checkBind('set-code-copy', 'codeCopy');
    renderSettingsAuth();

    api.about().then(function (a) {
      $('set-version').textContent = '写作台 ' + (a.version || '?') + ' · 引擎 commit ' + (a.engine_commit || '-');
      var tauri = (typeof window !== 'undefined' && window.__TAURI__);
      $('set-mode').textContent = tauri ? 'Tauri（原生窗口）'
        : ('Web（浏览器）' + (a.desktop_feature ? ' · 本二进制含 desktop 特性，--desktop 可开原生窗口' : ''));
    }).catch(function (e) { $('set-version').textContent = '读取失败：' + e.message; });

    // 清除痕迹：勾选框的初始态来自 HTML 属性（桩/浏览器都要能读到）
    ['pu-keyring', 'pu-memory', 'pu-cache'].forEach(function (id) {
      var cb = $(id);
      if (cb && cb.checked === undefined) {
        cb.checked = cb.getAttribute('checked') !== null;
      }
    });
    $('set-purge').onclick = function () {
      $('purge-result').hidden = true;
      $('purge-result').textContent = '';
      $('purge-modal').hidden = false;
    };
    $('purge-close').onclick = function () { $('purge-modal').hidden = true; };
    $('purge-cancel').onclick = function () { $('purge-modal').hidden = true; };
    $('purge-go').onclick = function () {
      var items = [];
      if ($('pu-keyring').checked) { items.push('keyring'); }
      if ($('pu-memory').checked) { items.push('memory', 'recent'); }
      if ($('pu-cache').checked) { items.push('cache'); }
      if (!items.length) { toast('没有勾选任何项'); return; }
      $('purge-go').disabled = true;
      api.purge(items).then(function (res) {
        $('purge-go').disabled = false;
        renderPurgeResult(res);
        renderSettingsAuth();
      }).catch(function (e) {
        $('purge-go').disabled = false;
        $('purge-result').hidden = false;
        $('purge-result').textContent = '';
        $('purge-result').appendChild(el('div', { class: 'row no', text: '清除失败：' + e.message }));
      });
    };
  }

  // ---------------------------------------------------------------- 分发
  var PAGE = detectPage();
  if (PAGE === 'login') { bootLogin(); }
  else if (PAGE === 'settings') { bootSettings(); }
  else { boot(); }

  // 给 DOM 冒烟测试用的出口（不影响正常运行）
  if (typeof window !== 'undefined') {
    window.__gui = {
      S: S, openResources: openResources, renderResList: renderResList,
      resRow: resRow, codeChip: codeChip, insertAttachment: insertAttachment,
      confirmWrite: confirmWrite, insertBlock: insertBlock, renderInsertMenu: renderInsertMenu,
      runCmd: runCmd, renderAttachments: renderAttachments, toast: toast, INSERTS: INSERTS,
      // M3
      PAGE: PAGE, safeUrl: safeUrl, loadPrefs: loadPrefs, applyPrefs: applyPrefs,
      loadAuth: loadAuth, applyAuth: applyAuth, openPr: openPr, renderPrFiles: renderPrFiles,
      renderPrReviewers: renderPrReviewers, addReviewer: addReviewer, doPr: doPr,
      renderPrResult: renderPrResult, gateWrite: gateWrite, showCtx: showCtx, hideCtx: hideCtx
    };
  }
})();
