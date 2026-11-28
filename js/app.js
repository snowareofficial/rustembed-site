'use strict';
/* js/app.js —— 入口：装配 VIEWS 与 window.__rec，然后启动。
 *
 * 由 app.js 按职责拆分（2026-10-21），本文件只做入口：
 *   - 各职责模块（core / entries / quote / settings / code / views / detail）
 *     在加载时把导出挂到 window.REC 单一命名空间；
 *   - VIEWS 表横跨 views 与 detail 两个模块，在这里装配；
 *   - boot() 必须最后调用（它触发首次渲染），所以本文件在 index.html 里最后一个加载。
 * 运行时硬约束与原 app.js 一致：只有 manifest.json 与预渲染片段两个数据来源、
 * 零外部请求、投稿文本走文本节点、拼 href/src 一律过 safeUrl()。
 */
(function () {
  'use strict';
  var R = window.REC;

  var VIEWS = {
    home: function () { return R.viewHome(); },
    date: function (r) { return R.viewByDate(r.seg[1] || ''); },
    library: function (r) { return R.viewLibrary(r.q); },
    series: function (r) { return R.viewSeries(r.seg[1]); },
    posts: function () { return R.viewLibrary({}); },
    knowledge: function () { return R.viewKnowledge(); },
    topics: function () { return R.viewTopics(); },
    topic: function (r) { return R.viewTopic(r.seg[1], r.seg[2]); },
    post: function (r) { return R.viewPost(r.seg[1], r.seg[2], r.q); },
    projects: function () { return R.viewProjects(); },
    project: function (r) { return R.viewProject(r.seg[1]); },
    resources: function () { return R.viewResources(); },
    members: function () { return R.viewMembers(); },
    member: function (r) { return R.viewMember(r.seg[1]); },
    services: function () { return R.viewServices(); },
    service: function (r) { return R.viewService(r.seg[1], r.seg[2]); },
    weekly: function (r) { return R.viewWeekly(r.seg[1]); },
    pages: function () { return R.viewPages(); },
    page: function (r) { return R.viewPage(r.seg[1], r.seg[2]); },
    join: function () { return R.viewJoin(); },
    search: function (r) { return R.viewSearch(r.seg[1] || ''); }
  };
  R.VIEWS = VIEWS;

  var started = R.boot();
  R.started = started;

  if (typeof window !== 'undefined') {
    window.__rec = {
      S: R.S, VIEWS: R.VIEWS, render: R.render, boot: R.boot, started: R.started,
      relGraph: R.relGraph, langBar: R.langBar, safeUrl: R.safeUrl,
      attachCard: R.attachCard, resourceRow: R.resourceRow, codeChip: R.codeChip,
      copyText: R.copyText, toast: R.toast,
      /* 阅读控制三项（最近条数 / 一言 / 代码块），测试直接驱动这几个钩子 */
      recent: {
        key: R.RECENT_KEY, min: R.RECENT_MIN, max: R.RECENT_MAX, def: R.RECENT_DEFAULT,
        read: R.readRecent, write: R.writeRecent, clamp: R.clampRecent, list: R.recentEntries,
        closePanel: R.closeListPanels
      },
      date: {
        key: R.DATE_KEY, min: R.DATE_MIN, max: R.DATE_MAX, def: R.DATE_DEFAULT
      },
      library: {
        key: R.LIBRARY_KEY, min: R.LIBRARY_MIN, max: R.LIBRARY_MAX, def: R.LIBRARY_DEFAULT,
        after: R.LIBRARY_LIST_AFTER
      },
      browseAfter: R.BROWSE_AFTER,
      /* 条目收集：三处（首页 / 日期页 / 书库）共用同一份口径，测试直接打这些钩子 */
      entries: {
        collect: R.collectEntries, sort: R.sortEntries, text: R.entryText,
        title: R.entryTitle, key: R.entryKey, updated: R.entryUpdated,
        list: R.entryList, row: R.entryRow, clampLimit: R.clampLimit,
        seriesFirst: R.seriesFirstSlug, closePanels: R.closeListPanels
      },
      quotes: {
        autoMs: R.QUOTE_MS, list: R.quoteList, open: R.openQuote, close: R.closeQuote,
        mount: R.mountQuote, unmount: R.unmountQuote, visible: R.quoteVisible
      },
      /* 设置面板与阅读设置（字号 / 摘要折叠 / 目录收起 / 主题） */
      settings: {
        key: {
          size: R.READING_SIZE_KEY, line: R.READING_LINE_KEY,
          summary: R.SUMMARY_KEY, toc: R.TOC_KEY, theme: R.THEME_KEY
        },
        size: {
          min: R.READING_SIZE_MIN, max: R.READING_SIZE_MAX, step: R.READING_SIZE_STEP, def: R.READING_SIZE_DEFAULT,
          read: R.readReadingSize, write: R.applyReadingSize, clamp: R.clampReadingSize
        },
        line: {
          min: R.READING_LINE_MIN, max: R.READING_LINE_MAX, def: R.READING_LINE_DEFAULT,
          read: R.readReadingLine, write: R.applyReadingLine, clamp: R.clampReadingLine
        },

        summary: { read: R.readSummaryCollapsed, write: R.writeSummaryCollapsed },
        toc: { read: R.readTocCollapsed, write: R.writeTocCollapsed, apply: R.applyTocCollapsed },
        theme: { read: R.readTheme, write: R.applyTheme },
        panel: { open: R.openSettings, close: R.closeSettings, toggle: R.toggleSettings, isOpen: R.settingsOpen },
        tab: R.selectSettingsTab,
        wrench: { mount: R.mountWrench, unmount: R.unmountWrench },
        seriesScrollAfter: R.SERIES_SCROLL_AFTER
      },
      code: {
        threshold: R.codeCollapseLines, setup: R.setupCodeBlocks,
        highlight: R.highlightCode, countLines: R.countLines
      },
      buildSiteNav: R.buildSiteNav, buildToc: R.buildToc, route: R.route,
      viewLibrary: R.viewLibrary, viewSeries: R.viewSeries, viewPost: R.viewPost, viewTopic: R.viewTopic,
      viewProject: R.viewProject, viewMember: R.viewMember, viewService: R.viewService,
      viewWeeklyItem: R.viewWeeklyItem, viewPage: R.viewPage, viewJoin: R.viewJoin,
      viewSearch: R.viewSearch, viewMembers: R.viewMembers, viewServices: R.viewServices,
      viewProjects: R.viewProjects, viewTopics: R.viewTopics, viewKnowledge: R.viewKnowledge,
      viewResources: R.viewResources, viewPages: R.viewPages, viewWeekly: R.viewWeekly
    };
  }
})();
