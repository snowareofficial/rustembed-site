'use strict';
/* js/quote.js —— 首页「一言」：定时轮换浮层。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

  /* ---------- 首页「一言」 ----------
   *
   * 句子来自构建期写进 manifest 的 quotes（里人录：site/content/quotes/<成员>/quotes.sml）。
   * 前端只读本地数组、不发请求；没有句子就不显示按钮（不编造、不用占位鸡汤）。
   * 点击 → 全屏变暗 + 中间一句；8 秒自动消失，期间点页面任何位置立刻消失。
   * 关闭一定清定时器：否则看不见的计时器会在你跳到别的页面后还把浮层拉回来。 */
  var QUOTE_MS = 8000;

  function quoteList() {
    return (R.S.man && R.S.man.quotes) || [];
  }

  function quoteVisible() {
    var v = quoteVeil();
    return !!(v && !v.hasAttribute('hidden'));
  }

  /* 浮层 / 按钮是自己插到 body 上的：句柄记在 S.quote 里，不用每次 $() 再查一遍
     （既省一次查询，也免得依赖「移除后还查得到」这种用法） */
  function quoteBtn() {
    if (R.S.quote && R.S.quote.btn && R.S.quote.btn.parentNode) return R.S.quote.btn;
    return R.$('#quote-btn');
  }

  function quoteVeil() {
    if (R.S.quote && R.S.quote.veil && R.S.quote.veil.parentNode) return R.S.quote.veil;
    return R.$('#quote-veil');
  }

  function clearQuoteTimer() {
    if (R.S.quote && R.S.quote.timer) {
      if (typeof clearTimeout === 'function') clearTimeout(R.S.quote.timer);
      R.S.quote.timer = 0;
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
    if (R.S.quote) R.S.quote.idx = idx;
    var q = qs[idx] || {};
    var t = (R.S.quote && R.S.quote.textEl) || R.$('#quote-text');
    var s = (R.S.quote && R.S.quote.srcEl) || R.$('#quote-source');
    if (t) { R.clear(t); t.appendChild(document.createTextNode(String(q.text || ''))); }
    if (s) {
      R.clear(s);
      var src = String(q.source || '');
      if (src) s.appendChild(document.createTextNode('— ' + src));
    }
    v.removeAttribute('hidden');
    R.S.quote.timer = (typeof setTimeout === 'function') ? setTimeout(closeQuote, QUOTE_MS) : 0;
  }

  /* 浮层与按钮都在 body 上（不在 #view 里）：换路由时显式拆掉，避免「上一页的浮层」 */
  function unmountQuote() {
    closeQuote();
    var b = quoteBtn();
    if (b && b.parentNode) b.parentNode.removeChild(b);
    var v = quoteVeil();
    if (v && v.parentNode) v.parentNode.removeChild(v);
    if (R.S.quote) { R.S.quote.btn = null; R.S.quote.veil = null; R.S.quote.textEl = null; R.S.quote.srcEl = null; }
    if (document.body && document.body.classList) document.body.classList.remove('quote-anim');
  }

  function mountQuote() {
    unmountQuote();
    if (!quoteList().length || !document.body) return;
    if (!R.reducedMotion()) document.body.classList.add('quote-anim');
    var btn = R.el('button', 'quote-btn');
    btn.setAttribute('type', 'button');
    btn.setAttribute('id', 'quote-btn');
    btn.setAttribute('aria-label', '读一句');
    btn.setAttribute('title', '读一句');
    /* 用给定的右引号 SVG path，不依赖字体字形。 */
    var mark = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : R.el('svg');
    mark.setAttribute('class', 'quote-btn-svg');
    mark.setAttribute('viewBox', '0 0 1300 1300');
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('fill', 'currentColor');
    var glyph = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : R.el('path');
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
    var veil = R.el('div', 'quote-veil');
    veil.setAttribute('id', 'quote-veil');
    veil.setAttribute('hidden', '');
    veil.setAttribute('role', 'presentation');
    var card = R.el('div', 'quote-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '一言');
    var p = R.el('p', 'quote-text');
    p.id = 'quote-text';
    var s = R.el('p', 'quote-source');
    s.id = 'quote-source';
    card.appendChild(p);
    card.appendChild(s);
    veil.appendChild(card);
    document.body.appendChild(btn);
    document.body.appendChild(veil);
    R.S.quote.btn = btn;
    R.S.quote.veil = veil;
    R.S.quote.textEl = p;
    R.S.quote.srcEl = s;
  }


  /* ---- 本模块导出到 REC ---- */
  R.QUOTE_MS = QUOTE_MS;
  R.quoteList = quoteList;
  R.quoteVisible = quoteVisible;
  R.quoteBtn = quoteBtn;
  R.quoteVeil = quoteVeil;
  R.clearQuoteTimer = clearQuoteTimer;
  R.closeQuote = closeQuote;
  R.openQuote = openQuote;
  R.unmountQuote = unmountQuote;
  R.mountQuote = mountQuote;
})();
