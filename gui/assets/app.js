/* 写作台前端 · 主逻辑（M1：树 / 契约表单 / Markdown 编辑 / 保存 / 预览 / 新建 / 草稿）
 *
 * 纪律：
 * - 表单字段由 /api/types 的契约生成，前端不重复定义字段；
 * - 保存前先 /api/validate，422 时不写盘，错误定位到字段；
 * - 预览是手动的（Ctrl+P），与构建同源；
 * - 不支持形状的字段（嵌套块、附件）只读保留，保存时原样带回去。
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

  var S = {
    types: [], typeMap: {}, tree: [], status: { branch: '-', dirty: [] },
    doc: null, dirty: false, savedHash: '', dirtyMap: {},
    newType: 'post', checkTimer: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') { n.className = attrs[k]; }
      else if (k === 'text') { n.textContent = attrs[k]; }
      else if (k === 'html') { n.innerHTML = attrs[k]; }
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
    var t = el('div', { class: 'toast', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
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

  // ---------------------------------------------------------------- 启动
  function boot() {
    api.types().then(function (types) {
      S.types = types;
      types.forEach(function (t) { S.typeMap[t.type] = t; });
      renderTypeGrid();
    }).catch(function (e) { banner('契约读取失败：' + e.message, true); });

    refreshTree();
    api.status().then(function (st) {
      S.status = st;
      S.dirtyMap = {};
      st.dirty.forEach(function (d) {
        S.dirtyMap[d.path.replace(/^site\//, '')] = d.status;
      });
      $('branch').textContent = st.branch;
      $('sb-branch').textContent = '分支 ' + st.branch;
      $('sb-changes').textContent = '改动 ' + st.dirty.length;
      renderTree();
    }).catch(function (e) { banner('仓库状态读取失败：' + e.message, true); });

    bindUI();
    // 默认收起元数据（与 mock 一致）
    $('meta').open = false;
  }

  function refreshTree() {
    return api.tree().then(function (items) { S.tree = items; renderTree(); })
      .catch(function (e) { banner('内容树读取失败：' + e.message, true); });
  }

  // ---------------------------------------------------------------- 左树
  function renderTree() {
    var box = $('tree-groups');
    box.textContent = '';
    var q = ($('search').value || '').toLowerCase();
    var items = S.tree.filter(function (it) {
      return !q || it.title.toLowerCase().indexOf(q) >= 0 || it.path.toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) {
      box.appendChild(el('div', { class: 'empty', text: '没有匹配项' }));
      return;
    }
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
    var head = el('div', { class: 'group-h' }, [svg('i-chev', 'caret'), el('span', { text: title }), el('span', { class: 'count', text: String(count) })]);
    g.appendChild(head);
    items.forEach(function (it) { g.appendChild(treeItem(it)); });
    return g;
  }

  function treeItem(it) {
    var node = el('div', {
      class: 'item' + (S.doc && S.doc.path === it.path ? ' active' : ''),
      title: it.path
    }, [svg(TYPE_ICON[it.type] || 'i-doc'), el('span', { text: it.title })]);
    var badge = S.dirtyMap[it.path];
    if (badge) { node.appendChild(el('span', { class: 'badge ' + badge.toLowerCase(), text: badge })); }
    if (it.draft) { node.appendChild(el('span', { class: 'draft', text: '草稿' })); }
    node.onclick = function () { openDoc(it.path); };
    return node;
  }

  // ---------------------------------------------------------------- 打开
  function openDoc(path) {
    if (S.dirty && !confirm('有未保存的改动，确定离开吗？')) { return; }
    api.doc(path).then(function (doc) {
      S.doc = doc;
      S.dirty = false;
      S.savedHash = hash(JSON.stringify(doc.front_matter) + '\n' + currentText());
      renderDoc();
      $('banner').hidden = true;
      runCheck();
    }).catch(function (e) { banner('打开失败：' + e.message, true); });
  }

  function currentText() {
    if (!S.doc) { return ''; }
    return S.doc.ext === 'sml' ? $('editor').value : $('editor').value;
  }

  function renderDoc() {
    var d = S.doc;
    $('title').textContent = titleOf(d);
    $('doc-path').textContent = d.path;
    $('sb-path').textContent = d.path;
    $('type-select').textContent = '';
    $('type-select').appendChild(document.createTextNode(TYPE_LABEL[d.type] || d.type || '—'));
    $('type-select').appendChild(svg('i-chev'));
    $('contract-name').textContent = d.contract || '无契约';
    $('editor-hint').textContent = d.ext === 'sml' ? 'SML 原文（保存前会解析并校验契约）' : 'Markdown 正文';
    $('editor').value = d.ext === 'sml' ? d.raw : d.body;
    renderFields();
    setSaveState('已打开');
    $('preview-state').textContent = '待生成';
    $('preview').textContent = '';
    $('preview').appendChild(el('p', { class: 'muted', text: '点顶栏「预览」或按 Ctrl+P 生成。' }));
  }

  function titleOf(d) {
    var fm = d.front_matter || {};
    return String(fm.title || fm.name || fm.period || d.path.split('/').pop());
  }

  // ---------------------------------------------------------------- 契约表单
  function renderFields() {
    var box = $('fields');
    box.textContent = '';
    var d = S.doc;
    if (!d) { return; }
    if (d.ext === 'sml') {
      box.appendChild(el('div', {
        class: 'field wide',
        text: 'SML 文件按原文编辑；字段直接写在文件里，保存时会按 ' + (d.contract || '契约') + ' 校验。'
      }));
      updateMetaSum();
      return;
    }
    var spec = S.typeMap[d.type];
    var fields = (spec && spec.fields) || [];
    fields.forEach(function (f) { box.appendChild(fieldRow(f)); });
    // 契约外的字段：只读保留，不丢内容
    Object.keys(d.front_matter).forEach(function (k) {
      var known = fields.some(function (f) { return f.name === k; });
      if (!known) {
        box.appendChild(el('div', { class: 'field wide', text: k + '：未知字段（保留原值）' }));
      }
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
    err.dataset.field = f.name;
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
    err.dataset.field = f.name;
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

  // ---------------------------------------------------------------- 脏标记 / 校验
  function markDirty() {
    S.dirty = true;
    setSaveState('未保存');
    $('title').textContent = '● ' + titleOf(S.doc);
    $('preview-state').textContent = '待生成';
    scheduleCheck();
  }

  function setSaveState(text) {
    $('sb-save').textContent = text;
    $('sb-save').className = (text === '已保存') ? 'ok' : '';
  }

  function payload() {
    var d = S.doc;
    if (d.ext === 'sml') { return { path: d.path, raw: $('editor').value }; }
    return { path: d.path, front_matter: d.front_matter, body: $('editor').value };
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
    if (ok) {
      pop.appendChild(row('i-check', 'ok', '契约通过：' + (S.doc.contract || '无')));
    } else {
      errors.slice(0, 8).forEach(function (e) {
        pop.appendChild(row('i-alert', 'warn', e.msg, e.field));
      });
    }
    pop.appendChild(el('div', { class: 'row', text: '保存前会自动校验，不通过不写盘' }));
  }

  function row(icon, cls, text, field) {
    var kids = [svg(icon, cls)];
    kids.push(el('span', { text: text }));
    if (field) { kids.push(el('span', { class: 'field', text: field })); }
    return el('div', { class: 'row' }, kids);
  }

  // ---------------------------------------------------------------- 保存 / 预览
  function saveDoc() {
    if (!S.doc) { toast('还没有打开文档'); return; }
    var p = payload();
    api.validate(p).then(function (res) {
      if (!res.ok) {
        applyFieldErrors(res.errors);
        renderContract(false, res.errors);
        $('meta').open = true;
        banner('契约未通过，文件没有改动', true);
        return;
      }
      return api.doc(S.doc.path).then(function (fresh) {
        if (hash(fresh.raw) !== S.savedHash && S.savedHash) {
          var reload = confirm('文件已被外部修改。\n确定＝重新加载（丢弃当前编辑）\n取消＝仍然覆盖');
          if (reload) { openDoc(S.doc.path); return null; }
        }
        return api.save(p);
      });
    }).then(function (r) {
      if (!r) { return; }
      S.dirty = false;
      S.savedHash = hash(JSON.stringify(S.doc.front_matter) + '\n' + $('editor').value);
      setSaveState('已保存');
      $('title').textContent = titleOf(S.doc);
      toast('已保存 · ' + r.path);
      $('banner').hidden = true;
      refreshTree();
      api.status().then(function (st) {
        S.status = st;
        S.dirtyMap = {};
        st.dirty.forEach(function (d) { S.dirtyMap[d.path.replace(/^site\//, '')] = d.status; });
        $('sb-changes').textContent = '改动 ' + st.dirty.length;
        renderTree();
      });
    }).catch(function (e) {
      if (e.errors && e.errors.length) { applyFieldErrors(e.errors); renderContract(false, e.errors); }
      banner('保存失败：' + e.message, true);
    });
  }

  function previewDoc() {
    if (!S.doc) { toast('还没有打开文档'); return; }
    $('preview-state').textContent = '生成中';
    api.preview(payload()).then(function (res) {
      var box = $('preview');
      box.textContent = '';
      box.appendChild(el('p', { class: 'kicker', text: (TYPE_LABEL[S.doc.type] || '') + ' › ' + titleOf(S.doc) }));
      var h = el('h3', { text: String((S.doc.front_matter || {}).title || titleOf(S.doc)) });
      box.appendChild(h);
      var content = el('div', { class: 'body' });
      content.innerHTML = res.html;   // 引擎已转义，与站点同一渲染出口
      box.appendChild(content);
      $('preview-state').textContent = '已生成 · ' + nowHM();
      $('sb-words').textContent = (res.words || 0) + ' 字';
    }).catch(function (e) {
      $('preview-state').textContent = '失败';
      banner('预览失败：' + e.message, true);
    });
  }

  // ---------------------------------------------------------------- 新建
  function renderTypeGrid() {
    var box = $('type-grid');
    box.textContent = '';
    NEW_TYPES.forEach(function (t) {
      var card = el('button', { class: 'type-card' + (t === S.newType ? ' on' : ''), type: 'button' }, [
        svg(TYPE_ICON[t] || 'i-doc'), el('b', { text: TYPE_LABEL[t] }),
        el('span', { text: (S.typeMap[t] && S.typeMap[t].dir ? S.typeMap[t].dir : t) + '/' })
      ]);
      card.onclick = function () { S.newType = t; renderTypeGrid(); updateNewPath(); };
      box.appendChild(card);
    });
  }

  function updateNewPath() {
    var slug = $('new-slug').value.trim() || slugify($('new-title').value);
    var dir = (S.typeMap[S.newType] && S.typeMap[S.newType].dir) || S.newType;
    var rel = S.newType === 'post'
      ? 'content/posts/' + new Date().getFullYear() + '/' + (slug || '<短名>') + '/index.md'
      : 'content/' + dir + '/' + (slug || '<短名>') + '.md';
    $('new-path').value = rel;
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
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      $('new-error').textContent = '短名只能是小写字母、数字与连字符';
      return;
    }
    api.create({
      type: S.newType, title: title, slug: slug, author: $('new-author').value.trim(),
      tags: $('new-tags').value.split(/[,\s]+/).filter(function (x) { return x; }),
      draft: $('new-draft').checked
    }).then(function (res) {
      closeNew();
      // 创建后直接进编辑器（未落盘，首次保存才写）
      var fm = {};
      var parts = res.template.split(/\n---\n/);
      if (res.template.indexOf('---') === 0 && parts.length > 1) {
        fm = parseLite(parts[0].replace(/^---\n/, ''));
      }
      S.doc = {
        path: res.path, type: S.newType, contract: (S.typeMap[S.newType] || {}).contract,
        ext: 'md', front_matter: fm, body: parts.slice(1).join('\n---\n').replace(/^\n/, ''), raw: res.template
      };
      S.dirty = true;
      S.savedHash = '';
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
      } else if (v.indexOf('"') === 0 && v.lastIndexOf('"') === v.length - 1) {
        out[m[1]] = v.slice(1, -1);
      } else if (v === 'true' || v === 'false') {
        out[m[1]] = v === 'true';
      } else if (/^\d+$/.test(v)) {
        out[m[1]] = Number(v);
      } else {
        out[m[1]] = v;
      }
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
    $('editor').oninput = function () {
      markDirty();
      $('sb-words').textContent = $('editor').value.length + ' 字';
    };
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') { e.preventDefault(); saveDoc(); }
      else if (mod && e.key === 'p') { e.preventDefault(); previewDoc(); }
      else if (mod && e.key === 'f') { e.preventDefault(); $('search').focus(); }
      else if (e.key === 'Escape' && !$('new-modal').hidden) { closeNew(); }
    });
  }

  boot();
})();
