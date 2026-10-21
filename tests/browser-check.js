'use strict';
/* 无头浏览器验收 + 截图：node tests/browser-check.js
 *
 * 2026-10-21 拆分：本文件只剩 runner —— 基础设施在 browser_lib.js，用例按职责分在
 * browser_checks_{layout,pages,reading,settings}.js，按顺序驱动，断言条数与拆分前一致。
 *
 * 真实测量（用例见各检查模块）：
 *   - 三栏是否真的存在、中栏是否 ≤ 42rem
 *   - 右栏是否默认收起、展开后是否 10 个入口
 *   - 375px / 1280px 下 documentElement.scrollWidth 是否溢出（横向滚动）
 *   - 代码块 / 表格是否撑破页面
 *   - 暗色令牌是否真的生效
 * 并输出 375×812 / 1280×900 / 暗色 1280×900 三张截图到 tests/shots/。
 */
const path = require('node:path');

const lib = require('./browser_lib.js');
const layout = require('./browser_checks_layout.js');
const pages = require('./browser_checks_pages.js');
const reading = require('./browser_checks_reading.js');
const settings = require('./browser_checks_settings.js');

async function main() {
  const browser = lib.pickBrowser();
  if (!browser) {
    console.log('没有找到 Edge/Chrome，跳过浏览器验收（结构断言与 DOM 冒烟仍然有效）。');
    process.exit(0);
  }
  const H = await lib.start(browser);
  try {
    await layout(H);
    await pages(H);
    await reading(H);
    await settings(H);
  } finally {
    H.cdp.close();
    H.cleanup();
  }
  lib.report();
}

main().catch((e) => { console.error(e); process.exit(1); });
