'use strict';
/* js/settings.js —— 阅读设置（字号 / 行距 / 摘要折叠 / 目录收起 / 主题）+ 右侧设置面板接线 + 首页扳手。
   由 app.js 按职责拆分（2026-10-21）：跨模块调用走 window.REC 单一命名空间，
   文件内互调仍是裸名；加载顺序见 index.html，入口是 js/app.js。 */
(function () {
  'use strict';
  var R = window.REC;

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
  function readReadingSize() { return clampReadingSize(R.storeGet(READING_SIZE_KEY)); }

  /* 字号写在 documentElement 上（:root 的 --reading-size 有 CSS 默认值，
     这里覆盖它）；没有 DOM 的环境（测试桩）安静跳过。 */
  function applyReadingSize(pct) {
    var n = clampReadingSize(pct);
    R.storeSet(READING_SIZE_KEY, n);
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
  function readReadingLine() { return clampReadingLine(R.storeGet(READING_LINE_KEY)); }
  function applyReadingLine(line) {
    var n = clampReadingLine(line);
    R.storeSet(READING_LINE_KEY, n);
    if (document.documentElement && document.documentElement.style &&
        typeof document.documentElement.style.setProperty === 'function') {
      document.documentElement.style.setProperty('--reading-line', String(n));
    }
    return n;
  }

  function readSummaryCollapsed() { return R.storeGet(SUMMARY_KEY) === '1'; }
  function writeSummaryCollapsed(on) {
    R.storeSet(SUMMARY_KEY, on ? '1' : '0');
    syncSummarySwitch();   /* 面板开关与存储始终一致（渲染期调用也无害） */
  }

  function readTocCollapsed() { return R.storeGet(TOC_KEY) === '1'; }
  function writeTocCollapsed(on) { R.storeSet(TOC_KEY, on ? '1' : '0'); }

  /* 主题：空值 = 跟随系统（移除 data-theme，交给 prefers-color-scheme） */
  function readTheme() {
    var t = R.storeGet(THEME_KEY);
    return (t === 'light' || t === 'dark') ? t : '';
  }
  function applyTheme(t) {
    var v = (t === 'light' || t === 'dark') ? t : '';
    R.storeSet(THEME_KEY, v);
    if (document.documentElement && document.documentElement.setAttribute) {
      if (v) document.documentElement.setAttribute('data-theme', v);
      else document.documentElement.removeAttribute('data-theme');
    }
    syncThemeUI();
    return v;
  }

  function syncThemeUI() {
    var th = R.$('#settings-theme');
    if (th) th.value = readTheme();
  }

  /* ---------- 右侧设置面板（静态节点在 index.html，这里只接线） ---------- */

  function settingsPanel() {
    if (R.S.settings && R.S.settings.panel && R.S.settings.panel.parentNode) return R.S.settings.panel;
    return R.$('#settings-panel');
  }

  function settingsOpen() {
    var p = settingsPanel();
    return !!(p && !p.hasAttribute('hidden'));
  }

  function openSettings() {
    var p = settingsPanel();
    if (!p) return;
    p.removeAttribute('hidden');
    var fab = R.$('#settings-fab');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    var tab = R.$('#settings-tab-reading');
    if (tab && tab.focus) tab.focus();
  }

  function closeSettings() {
    var p = settingsPanel();
    if (!p) return;
    p.setAttribute('hidden', '');
    var fab = R.$('#settings-fab');
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
    var tt = R.$('#toc-toggle');
    if (tt) {
      tt.setAttribute('aria-pressed', on ? 'true' : 'false');
      tt.setAttribute('aria-label', on ? '展开目录' : '收起目录');
      tt.setAttribute('title', on ? '展开目录' : '收起目录');
    }
    syncTocSwitch();
  }

  function syncTocSwitch() {
    var sw = R.$('#settings-toc');
    if (sw) sw.checked = readTocCollapsed();
  }

  function syncSummarySwitch() {
    var sw = R.$('#settings-summary');
    if (sw) sw.checked = readSummaryCollapsed();
  }

  function syncSizeUI() {
    var n = readReadingSize();
    var range = R.$('#settings-size');
    if (range) range.value = String(n);
    var val = R.$('#settings-size-val');
    if (val) { R.clear(val); val.appendChild(document.createTextNode(n + '%')); }
  }

  function syncLineUI() {
    var n = readReadingLine();
    var range = R.$('#settings-line');
    if (range) range.value = String(n);
    var val = R.$('#settings-line-val');
    if (val) { R.clear(val); val.appendChild(document.createTextNode(n.toFixed(1))); }
  }

  function syncRecentUI() {
    var n = R.readRecent();
    var range = R.$('#settings-recent');
    if (range) range.value = String(n);
    var val = R.$('#settings-recent-val');
    if (val) { R.clear(val); val.appendChild(document.createTextNode(String(n))); }
  }

  /* tab 切换：segmented 两个按钮，aria-selected 与面板 hidden 联动 */
  function selectSettingsTab(which) {
    var panes = { reading: R.$('#settings-pane-reading'), site: R.$('#settings-pane-site') };
    var tabs = { reading: R.$('#settings-tab-reading'), site: R.$('#settings-tab-site') };
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
    var box = R.$('#settings-links');
    if (!box || !R.S.man) return;
    R.clear(box);
    var m = R.S.man;
    if (m.site && m.site.repo_url) {
      var row = R.el('p');
      row.appendChild(R.el('span', '', '仓库：'));
      row.appendChild(R.outLink(m.site.repo_url, m.site.repo_url));
      box.appendChild(row);
    }
    if (m.site && m.site.license) box.appendChild(R.el('p', '', '默认许可：' + m.site.license));
    box.appendChild(R.el('p', '', '许可细节见页脚声明。'));
  }

  /* 首页扳手：只在首页挂载，位置在「一言」按钮上方（CSS bottom 4.7rem，不重叠）。
     换页卸载，避免别的页面冒出不该有的入口。 */
  function unmountWrench() {
    if (R.S.settings && R.S.settings.wrench && R.S.settings.wrench.parentNode) {
      R.S.settings.wrench.parentNode.removeChild(R.S.settings.wrench);
    }
    if (R.S.settings) R.S.settings.wrench = null;
  }

  function mountWrench() {
    unmountWrench();
    if (!document.body) return;
    var b = R.el('button', 'settings-wrench');
    b.setAttribute('type', 'button');
    b.setAttribute('id', 'settings-wrench');
    b.setAttribute('aria-label', '打开设置');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'settings-panel');
    b.setAttribute('title', '设置');
    var svg = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : R.el('svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    var path = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : R.el('path');
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
    if (R.S.settings) R.S.settings.wrench = b;
  }

  /* 启动时接线一次：静态面板 + 右缘三角 + 全局 Esc / 点外部关闭 */
  function mountSettings() {
    if (R.S.settings && R.S.settings.done) return;
    R.S.settings = R.S.settings || {};
    var panel = R.$('#settings-panel');
    if (panel) R.S.settings.panel = panel;

    var fab = R.$('#settings-fab');
    if (fab && fab.addEventListener) {
      fab.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        toggleSettings();
      });
    }
    var tRead = R.$('#settings-tab-reading');
    var tSite = R.$('#settings-tab-site');
    if (tRead && tRead.addEventListener) tRead.addEventListener('click', function () { selectSettingsTab('reading'); });
    if (tSite && tSite.addEventListener) tSite.addEventListener('click', function () { selectSettingsTab('site'); });

    /* 阅读 tab */
    var size = R.$('#settings-size');
    if (size && size.addEventListener) {
      size.addEventListener('input', function () {
        var n = applyReadingSize(size.value);
        syncSizeUI();
      });
    }
    var sizeReset = R.$('#settings-size-reset');
    if (sizeReset && sizeReset.addEventListener) {
      sizeReset.addEventListener('click', function () {
        applyReadingSize(READING_SIZE_DEFAULT);
        syncSizeUI();
      });
    }
    var line = R.$('#settings-line');
    if (line && line.addEventListener) {
      line.addEventListener('input', function () {
        applyReadingLine(line.value);
        syncLineUI();
      });
    }
    var sumSw = R.$('#settings-summary');
    if (sumSw && sumSw.addEventListener) {
      sumSw.addEventListener('change', function () {
        writeSummaryCollapsed(!!sumSw.checked);
        /* 当前页已渲染的摘要卡不会自动跟进：重画一次路由即可 */
        if (typeof R.render === 'function') R.render();
      });
    }
    var tocSw = R.$('#settings-toc');
    if (tocSw && tocSw.addEventListener) {
      tocSw.addEventListener('change', function () {
        applyTocCollapsed(!!tocSw.checked);
      });
    }
    var resetAll = R.$('#settings-reset-all');
    if (resetAll && resetAll.addEventListener) {
      resetAll.addEventListener('click', function () {
        applyReadingSize(READING_SIZE_DEFAULT);
        applyReadingLine(READING_LINE_DEFAULT);
        writeSummaryCollapsed(false);
        applyTocCollapsed(false);
        syncSizeUI(); syncLineUI(); syncSummarySwitch();
        if (typeof R.render === 'function') R.render();
      });
    }

    /* 站点 tab */
    var theme = R.$('#settings-theme');
    if (theme && theme.addEventListener) {
      theme.addEventListener('change', function () { applyTheme(theme.value); });
    }
    var recent = R.$('#settings-recent');
    if (recent && recent.addEventListener) {
      recent.addEventListener('input', function () {
        var n = R.writeRecent(recent.value);
        syncRecentUI();
      });
    }
    /* 初值：面板控件的显示状态与存储一致 */
    applyReadingSize(readReadingSize());
    applyReadingLine(readReadingLine());
    syncSizeUI(); syncLineUI(); syncSummarySwitch(); syncTocSwitch(); syncRecentUI(); syncThemeUI();
    R.S.settings.done = true;
  }


  /* ---- 本模块导出到 REC ---- */
  R.READING_SIZE_MIN = READING_SIZE_MIN;
  R.READING_SIZE_MAX = READING_SIZE_MAX;
  R.READING_SIZE_STEP = READING_SIZE_STEP;
  R.READING_SIZE_DEFAULT = READING_SIZE_DEFAULT;
  R.READING_SIZE_KEY = READING_SIZE_KEY;
  R.SUMMARY_KEY = SUMMARY_KEY;
  R.TOC_KEY = TOC_KEY;
  R.THEME_KEY = THEME_KEY;
  R.SERIES_SCROLL_AFTER = SERIES_SCROLL_AFTER;
  R.clampReadingSize = clampReadingSize;
  R.readReadingSize = readReadingSize;
  R.applyReadingSize = applyReadingSize;
  R.READING_LINE_MIN = READING_LINE_MIN;
  R.READING_LINE_MAX = READING_LINE_MAX;
  R.READING_LINE_DEFAULT = READING_LINE_DEFAULT;
  R.READING_LINE_KEY = READING_LINE_KEY;
  R.clampReadingLine = clampReadingLine;
  R.readReadingLine = readReadingLine;
  R.applyReadingLine = applyReadingLine;
  R.readSummaryCollapsed = readSummaryCollapsed;
  R.writeSummaryCollapsed = writeSummaryCollapsed;
  R.readTocCollapsed = readTocCollapsed;
  R.writeTocCollapsed = writeTocCollapsed;
  R.readTheme = readTheme;
  R.applyTheme = applyTheme;
  R.syncThemeUI = syncThemeUI;
  R.settingsPanel = settingsPanel;
  R.settingsOpen = settingsOpen;
  R.openSettings = openSettings;
  R.closeSettings = closeSettings;
  R.toggleSettings = toggleSettings;
  R.applyTocCollapsed = applyTocCollapsed;
  R.syncTocSwitch = syncTocSwitch;
  R.syncSummarySwitch = syncSummarySwitch;
  R.syncSizeUI = syncSizeUI;
  R.syncLineUI = syncLineUI;
  R.syncRecentUI = syncRecentUI;
  R.selectSettingsTab = selectSettingsTab;
  R.buildSettingsLinks = buildSettingsLinks;
  R.unmountWrench = unmountWrench;
  R.mountWrench = mountWrench;
  R.mountSettings = mountSettings;
})();
