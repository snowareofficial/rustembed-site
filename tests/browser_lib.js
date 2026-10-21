'use strict';
/* 无头浏览器验收的基础设施（2026-10-21 自 browser-check.js 拆出）：
 *   挑浏览器 / 挑一个真能 bind 的 CDP 调试端口 / 起浏览器并连上 / go·metrics·截图 /
 *   断言小工具（need/eq2/includes2）与最终报告。
 * 只依赖 Node 内置能力（fetch + 全局 WebSocket）+ 本机 Edge/Chrome 的 CDP，
 * 不给站点引任何第三方东西。
 *
 * 检查用例本身拆在同目录 browser_checks_*.js，各导出 async function check(H)，
 * 由 browser-check.js（runner）按顺序驱动；断言条数因此一个不少。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const BASE = process.env.REC_BASE || 'http://127.0.0.1:8080/';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const fails = [];
let checks = 0;
function need(cond, msg, extra) {
  checks++;
  console.log('  %s %s%s', cond ? 'PASS' : 'FAIL', msg, extra === undefined ? '' : ' → ' + extra);
  if (!cond) fails.push(msg);
  return !!cond;
}

function pickBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  return null;
}

/* 下面这些用例要比较字面量与子串，need() 的签名不够顺手，补两个薄封装 */
function eq2(got, want, msg) { return need(got === want, msg, '期望 ' + want + '，实得 ' + got); }
function includes2(hay, needle, msg) {
  return need(String(hay).indexOf(needle) >= 0, msg, '实测 ' + JSON.stringify(String(hay)));
}
/* 挑一个真能 bind 的调试端口。
 * 为什么不能写死 9222+pid%200：Windows 默认保留 9211–9310 这段（Hyper-V 动态端口），
 * 落进去时 Edge 起得来但 CDP 端口 bind 失败，/json/list 永远不通 ⇒ 干等 20s 超时。
 * 这里逐个试，bind 成功才算数（保留段里 listen 直接报错，能正确跳过）。 */
async function pickDebugPort() {
  const net = require('node:net');
  for (let i = 0; i < 40; i++) {
    const port = 9600 + (process.pid + i * 13) % 300;
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  return 9222 + (process.pid % 200);
}

async function waitFor(fn, timeout = 15000, gap = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, gap));
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', (e) => reject(new Error('WebSocket ' + (e.message || ''))));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(m.method || '' + JSON.stringify(m.error)));
        else p.res(m.result);
      } else if (m.method) {
        events.push(m);
      }
    });
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej, method });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const api = {
      send,
      close: () => ws.close(),
      waitEvent: async (name, timeout = 15000) => {
        const t0 = Date.now();
        for (;;) {
          const i = events.findIndex((e) => e.method === name);
          if (i >= 0) return events.splice(i, 1)[0];
          if (Date.now() - t0 > timeout) throw new Error('等待事件超时：' + name);
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      eval: async (expr) => {
        const r = await send('Runtime.evaluate', {
          expression: expr, returnByValue: true, awaitPromise: true
        });
        if (r.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.exceptionDetails));
        return r.result.value;
      },
      shot: async (file) => {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      }
    };
  });
}
/* 起浏览器、连 CDP、装配驱动句柄。返回 H：
 *   cdp / go / metrics / measureContrast / cleanup + 断言工具（need/eq2/includes2）。
 * 原 main() 里内联的这段（spawn → /json/list → connect → Page/Runtime.enable →
 * go / metrics / measureContrast 三个闭包）整体搬来。 */
async function start(browser) {
  const PORT = await pickDebugPort();
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recblog-'));
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars',
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => { try { child.kill(); } catch (e) { void e; } };
  process.on('exit', cleanup);

  // /json/version 是浏览器级端点（只有 Browser.*/Target.*），要用页面级目标才能 Page.*
  let target = null;
  await waitFor(async () => {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { target = page.webSocketDebuggerUrl; return true; }
      return false;
    } catch (e) { return false; }
  }, 20000, 300);

  const cdp = await connect(target);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /*
   * hash 变化是同文档导航，不会触发 load 事件：等 data-page 变成目标页且 #view 有内容。
   * 注意 data-page 是在视图 Promise 之前就写好的，而 data-toc 要等 buildToc()（渲染末尾）才写，
   * 所以要校验左栏的用例必须再等 data-toc 变成期望值，否则会读到上一页的目录状态。
   */
  const go = async (hash, page, opts) => {
    await cdp.send('Page.navigate', { url: BASE + hash });
    await waitFor(() => cdp.eval(
      'document.body.getAttribute("data-page") === ' + JSON.stringify(page) +
      ' && document.getElementById("view").children.length > 0'));
    await new Promise((r) => setTimeout(r, 250));
    if (opts && opts.toc) {
      await waitFor(() => cdp.eval(
        'document.body.getAttribute("data-toc") === ' + JSON.stringify(opts.toc)));
    }
  };

  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile
  });

  /* 对比度：读当前生效的令牌，按 WCAG 相对亮度公式算比值 */
  const measureContrast = () => cdp.eval(`(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const cs = getComputedStyle(document.documentElement);
    const t = (n) => cs.getPropertyValue(n).trim();
    const rgb = (hex) => { const h = hex.replace('#', '');
      return 'rgb(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ')'; };
    return {
      body: ratio(rgb(t('--ink')), rgb(t('--paper'))),
      soft: ratio(rgb(t('--ink-soft')), rgb(t('--paper'))),
      mute: ratio(rgb(t('--ink-mute')), rgb(t('--paper'))),
      link: ratio(rgb(t('--accent')), rgb(t('--paper')))
    };
  })()`);
  return { cdp, go, metrics, measureContrast, cleanup, need, eq2, includes2, waitFor, SHOTS, ROOT };
}

/* 最终报告（原 main() 末尾，一字未改） */
function report() {
  console.log('');
  console.log('截图目录：%s', path.relative(ROOT, SHOTS));
  if (fails.length) {
    console.log('BROWSER FAIL（%d/%d）', fails.length, checks);
    fails.forEach((f) => console.log('  - %s', f));
    process.exit(1);
  }
  console.log('BROWSER PASS（%d 项）', checks);
}

module.exports = {
  ROOT, SHOTS, BASE, pickBrowser, pickDebugPort, waitFor, connect, start, report
};
