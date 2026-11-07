'use strict';
/* js/code.js —— 代码块：长代码折叠 + Prism 高亮 + 复制提示 + 附件卡片。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

  /* ---------- 代码块：长代码折叠 + 语法高亮 ----------
   *
   * 折叠阈值来自 site.sml 的 code_collapse_lines（默认 20 行）：
   *  · 折叠只加 CSS 类 + max-height，**不改动 DOM 里的代码文本** —— 复制按钮取的是
   *    textContent，折叠状态下复制到的仍然是完整代码；
   *  · 所有改动都在运行时做：禁用 JS 时代码块保持原样全展开；
   *  · 高亮交给本地 vendor 的 Prism（MIT），失败就退回纯文本。 */
  var CODE_COLLAPSE_DEFAULT = 20;

  function codeCollapseLines() {
    var n = parseInt((R.S.man && R.S.man.site && R.S.man.site.code_collapse_lines), 10);
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

    var btn = R.el('button', 'code-more');
    btn.setAttribute('type', 'button');
    if (pre) btn.setAttribute('aria-controls', pre.id);

    var apply = function (collapsed) {
      /* 折叠态给「展开全部（N 行）」，展开态给「收起」：按钮说的是「点了会发生什么」 */
      R.clear(btn);
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
    var s = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : R.el('svg');
    s.setAttribute('class', 'file-ico file-' + shape);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var paths = FILE_PATHS[shape] || FILE_PATHS.doc;
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : R.el('path');
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
    var box = R.el('div', 'toast', msg);
    document.body.appendChild(box);
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 2200);
  }

  function codeChip(code) {
    code = String(code === undefined || code === null ? '' : code).trim();
    if (!code) return null;
    var btn = R.el('button', 'code-chip', '提取码 ' + code + ' · 复制');
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
    var li = R.el('li', 'attach-card');
    li.appendChild(fileIcon(at.url, at.kind));
    var meta = R.el('div', 'file-meta');
    meta.appendChild(R.el('b', '', at.name || '附件'));
    var sub = [];
    var ext = extOf(at.url);
    if (ext) sub.push(ext.toUpperCase());
    else if (at.kind === 'link') sub.push('外链');
    if (at.size && at.size !== '—') sub.push(at.size);
    meta.appendChild(R.el('span', '', sub.join(' · ') || '文件'));
    li.appendChild(meta);
    var href = R.safeUrl(at.url);
    if (href) {
      var a = R.lnk(href, '下载 · ' + dlChannel(at.url), 'dl-btn');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      li.appendChild(a);
    } else {
      li.appendChild(R.el('span', 'muted', '链接无效'));
    }
    var chip = codeChip(at.code);
    if (chip) li.appendChild(chip);
    return li;
  }


  /* ---- 本模块导出到 REC ---- */
  R.CODE_COLLAPSE_DEFAULT = CODE_COLLAPSE_DEFAULT;
  R.codeCollapseLines = codeCollapseLines;
  R.countLines = countLines;
  R.setupCodeBlocks = setupCodeBlocks;
  R.setupOneCodeBox = setupOneCodeBox;
  R.CODE_SEQ = CODE_SEQ;
  R.nextCodeId = nextCodeId;
  R.highlightCode = highlightCode;
  R.DL_CHANNELS = DL_CHANNELS;
  R.dlChannel = dlChannel;
  R.extOf = extOf;
  R.FILE_PATHS = FILE_PATHS;
  R.fileIcon = fileIcon;
  R.copyText = copyText;
  R.toast = toast;
  R.codeChip = codeChip;
  R.attachCard = attachCard;
})();
