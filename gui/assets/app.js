/* 写作台前端（M2）：树 / 契约表单 / 工具条 + 插入菜单 / 图片上传 / 资源附件 /
 * 右键菜单 / 改动徽标 / 外部改动检测 / 写入前确认。
 *
 * 纪律：
 * - 表单字段由 /api/types 的契约生成，前端不重复定义字段；
 * - 保存前先 /api/validate，422 不写盘；带上 base_hash，磁盘被改过 → 409；
 * - 预览是手动的（Ctrl+P），与构建同源；
 * - 插入的语法按当前引擎：.md 写 :::xxx，.sml 写对应裸块；
 * - 提取码只当文本复制，不拼进 href/src。
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
    checkTimer: null, resources: [], resMap: {}, resFilter: '', picked: null, ctxItem: null
  };

  var $ = function (id) { return document.getElementById(id); };

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
    var b = el('button', { class: 'code-chip', type: 'button', 'data-code': code,
      title: '复制提取码' }, [svg('i-copy'), document.createTextNode('提取码 ' + code + ' · 复制')]);
    b.onclick = function () { copyText(code, '已复制提取码：' + code); };
    return b;
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
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
    var copy = $('res-copy').checked;
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
      }
    });
  }

  boot();

  // 给 DOM 冒烟测试用的出口（不影响正常运行）
  if (typeof window !== 'undefined') {
    window.__gui = {
      S: S, openResources: openResources, renderResList: renderResList,
      resRow: resRow, codeChip: codeChip, insertAttachment: insertAttachment,
      confirmWrite: confirmWrite, insertBlock: insertBlock, renderInsertMenu: renderInsertMenu,
      runCmd: runCmd, renderAttachments: renderAttachments, toast: toast, INSERTS: INSERTS
    };
  }
})();
