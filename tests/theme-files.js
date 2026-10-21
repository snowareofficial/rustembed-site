'use strict';
/* 主题多文件加载助手（2026-10-21，app.js/style.css 按职责拆分后引入）。
 *
 * 唯一事实源是 <root>/index.html 里的 <script src> / <link rel=stylesheet> 顺序：
 * 源码侧（site/theme）与产物侧（dist/）用同一套逻辑，测试不硬编码文件清单。
 * vendor/prism 由测试自行决定是否加载（它是第三方库，不算本站代码）。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readIndex(root) {
  return fs.readFileSync(path.join(root, 'index.html'), 'utf8');
}

/* 按 index.html 的 link 顺序返回本站 CSS（相对路径数组） */
function cssFiles(root) {
  const html = readIndex(root);
  const out = [];
  const re = /<link\b[^>]*rel="stylesheet"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = /\bhref="([^"]+)"/i.exec(m[0]);
    if (!src) continue;
    const href = src[1];
    if (/^(https?:)?\/\//i.test(href) || href.charAt(0) === '#') continue;
    if (href.indexOf('vendor/') === 0) continue;      // Prism 是第三方，不算本站样式
    out.push(href);
  }
  return out;
}

/* 按 index.html 的 script 顺序返回本站 JS（相对路径数组，不含 vendor/prism） */
function jsFiles(root) {
  const html = readIndex(root);
  const out = [];
  const re = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src)) continue;
    if (src.indexOf('vendor/') === 0) continue;       // Prism 由测试自行加载
    out.push(src);
  }
  return out;
}

/* 按序拼接全部本站 CSS（断言整块规则时用，等价于拆分前的 style.css） */
function readCss(root) {
  return cssFiles(root)
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n');
}

/* 在同一个 vm 上下文里按序加载全部本站 JS；返回最后一个文件名 */
function loadScripts(sandbox, root) {
  const files = jsFiles(root);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox,
      { filename: path.join(root, f) });
  }
  return files;
}

module.exports = { cssFiles, jsFiles, readCss, loadScripts };
