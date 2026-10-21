'use strict';
/* 最小 DOM 桩：给 node 环境跑 site/theme/app.js 用（node tests/smoke.js）。
 *
 * 语义是真的，不是空壳：
 *  - textContent = '' 真的清空子节点；读时真的递归拼接后代文本；
 *  - querySelector('#x') 同一选择器永远返回同一节点；
 *  - createElementNS / setAttributeNS 可用（SVG 关系图需要）；
 *  - innerHTML 赋值会真的解析成子节点（因此 frag() 能搬走节点）；
 *  - append / insert / remove / classList / getElementById / closest 都按 DOM 语义实现。
 * 不是浏览器：没有布局、没有 CSS 计算，尺寸类断言交给无头浏览器（tests/browser-check.js）。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[g] !== undefined ? ENTITIES[g] : m;
  });
}

class StubNode {
  constructor(type) {
    this.nodeType = type;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }
  get lastChild() { return this.childNodes.length ? this.childNodes[this.childNodes.length - 1] : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 && this.parentNode.childNodes[i + 1] ? this.parentNode.childNodes[i + 1] : null;
  }
  get textContent() { return collectText(this); }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) {
      const t = new StubText(String(v));
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }
  appendChild(node) {
    if (!node) return node;
    if (node.nodeType === 11) {                  // 片段：搬子节点，不留壳
      let n = node.firstChild;
      while (n) { const next = n.nextSibling; this.appendChild(n); n = next; }
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (!node) return node;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
}

class StubText extends StubNode {
  constructor(data) { super(3); this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

function collectText(node) {
  let out = '';
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.data; return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(node);
  return out;
}

class StubElement extends StubNode {
  constructor(doc, tagName, namespaceURI) {
    super(1);
    this.ownerDocument = doc;
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.namespaceURI = namespaceURI || null;
    this.attributes = {};
    this._classes = new Set();
    /* style 带 setProperty/getPropertyValue/removeProperty：CSS 自定义属性
       （--reading-size 等）在桩里也要真的存取，不只是空对象 */
    this.style = {
      setProperty: (k, v) => { this.style[k] = String(v); },
      getPropertyValue: (k) => (Object.prototype.hasOwnProperty.call(this.style, k) ? this.style[k] : ''),
      removeProperty: (k) => { delete this.style[k]; }
    };
    this.listeners = {};
    this.value = '';
  }
  get className() { return Array.from(this._classes).join(' '); }
  set className(v) {
    this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean));
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (c) => self._classes.has(c),
      toggle: (c, on) => { if (on === undefined) { if (self._classes.has(c)) self._classes.delete(c); else self._classes.add(c); } else if (on) self._classes.add(c); else self._classes.delete(c); }
    };
  }
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.ownerDocument._ids[String(value)] = this;
  }
  setAttributeNS(ns, name, value) { this.setAttribute(name, value); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, String(name))
      ? this.attributes[String(name)] : null;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, String(name)); }
  removeAttribute(name) { delete this.attributes[String(name)]; }
  get innerHTML() {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.data; return; }
      if (n.nodeType !== 1) return;
      out += '<' + n.localName;
      for (const k of Object.keys(n.attributes)) out += ' ' + k + '="' + n.attributes[k] + '"';
      out += '>';
      for (const c of n.childNodes) walk(c);
      out += '</' + n.localName + '>';
    };
    for (const c of this.childNodes) walk(c);
    return out;
  }
  set innerHTML(html) {
    this.childNodes = [];
    parseInto(this.ownerDocument, this, String(html == null ? '' : html));
  }
  get outerHTML() { return ''; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(ev || { type, target: this }));
  }
  getElementsByTagName(tag) {
    const want = String(tag).toLowerCase();
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          if (c.localName === want) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  matches(sel) {
    if (sel[0] === '#') return this.getAttribute('id') === sel.slice(1);
    if (sel[0] === '.') return this._classes.has(sel.slice(1));
    return this.localName === sel.toLowerCase();
  }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; }
    return null;
  }
  querySelector(sel) { return queryOne(this, sel); }
  querySelectorAll(sel) {
    const out = [];
    walkTree(this, (n) => { if (n !== this && matchesSelector(n, sel)) out.push(n); });
    return out;
  }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
  scrollIntoView() { this._scrolled = true; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
}

class StubFragment extends StubNode {
  constructor(doc) { super(11); this.ownerDocument = doc; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  getElementsByTagName(tag) {
    const want = String(tag).toLowerCase();
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) { if (c.localName === want) out.push(c); walk(c); }
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return queryOne(this, sel); }
  querySelectorAll(sel) {
    const out = [];
    walkTree(this, (n) => { if (n !== this && matchesSelector(n, sel)) out.push(n); });
    return out;
  }
}

function matchesSelector(node, sel) {
  if (node.nodeType !== 1) return false;          // 文本节点不参与选择器匹配
  const parts = String(sel).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (last[0] === '#') return node.getAttribute('id') === last.slice(1);
  if (last[0] === '.') return node.classList.contains(last.slice(1));
  const m = last.match(/^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?$/);
  if (!m) return false;
  if (m[1] && node.localName !== m[1].toLowerCase()) return false;
  if (m[2] && !node.classList.contains(m[2])) return false;
  return true;
}

function walkTree(root, fn) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    fn(n);
    for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
  }
}

function queryOne(root, sel) {
  let found = null;
  walkTree(root, (n) => { if (!found && n !== root && matchesSelector(n, sel)) found = n; });
  return found;
}

/* 极小 HTML 解析器：够解析 index.html 与构建期预渲染的片段 */
function parseInto(doc, parent, html) {
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [parent];
  let m;
  while ((m = re.exec(html)) !== null) {
    const chunk = m[0];
    const top = stack[stack.length - 1];
    if (chunk.startsWith('<!--') || chunk.startsWith('<!DOCTYPE')) continue;
    if (m[1]) {                                   // 闭合标签
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].localName === m[1].toLowerCase()) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {                                   // 开标签
      const el = doc.createElement(m[2].toLowerCase());
      const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || '')) !== null) {
        const val = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
        el.setAttribute(a[1], decodeEntities(val));
      }
      top.appendChild(el);
      if (!VOID.has(el.localName) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] !== undefined) {                     // 文本
      const text = decodeEntities(m[5]);
      if (text.trim() !== '' || top.localName === 'pre' || top.localName === 'code') {
        top.appendChild(doc.createTextNode(text));
      }
    }
  }
  return parent;
}

function createStub(html) {
  const doc = new StubElement(null, '#document');
  doc._ids = {};
  doc._selCache = {};
  doc.title = '';
  doc.createElement = (tag) => new StubElement(doc, tag);
  doc.createElementNS = (ns, tag) => new StubElement(doc, tag, ns);
  doc.createTextNode = (t) => new StubText(String(t));
  doc.createDocumentFragment = () => new StubFragment(doc);
  doc.getElementById = (id) => doc._ids[id] || null;
  doc.querySelector = (sel) => {
    if (Object.prototype.hasOwnProperty.call(doc._selCache, sel)) return doc._selCache[sel];
    const hit = queryOne(doc, sel);
    doc._selCache[sel] = hit;
    return hit;
  };
  doc.querySelectorAll = (sel) => {
    const out = [];
    walkTree(doc, (n) => { if (n !== doc && matchesSelector(n, sel)) out.push(n); });
    return out;
  };
  doc.getElementsByTagName = (tag) => doc.documentElement.getElementsByTagName(tag);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.dispatch = (type, ev) => { (doc.listeners[type] || []).forEach((fn) => fn(ev || { type })); };

  const root = doc.createElement('html');
  doc.appendChild(root);
  doc.documentElement = root;
  const body = doc.createElement('body');
  root.appendChild(body);
  doc.body = body;
  const head = doc.createElement('head');
  root.appendChild(head);
  doc.head = head;

  if (html) {
    const frag = doc.createDocumentFragment();
    parseInto(doc, frag, html);
    // 把解析出来的 html/head/body 结构搬到既有骨架里
    const parsedHtml = frag.childNodes.find((n) => n.localName === 'html');
    if (parsedHtml) {
      const pb = parsedHtml.childNodes.find((n) => n.localName === 'body');
      const ph = parsedHtml.childNodes.find((n) => n.localName === 'head');
      if (pb) { body.childNodes = []; let c = pb.firstChild; while (c) { const nx = c.nextSibling; body.appendChild(c); c = nx; } }
      if (ph) { let c = ph.firstChild; while (c) { const nx = c.nextSibling; head.appendChild(c); c = nx; } }
    } else {
      let c = frag.firstChild;
      while (c) { const nx = c.nextSibling; if (c.localName !== 'head') body.appendChild(c); c = nx; }
    }
  }

  const win = {
    document: doc,
    listeners: {},
    addEventListener: (type, fn) => { (win.listeners[type] = win.listeners[type] || []).push(fn); },
    dispatch: (type, ev) => { (win.listeners[type] || []).forEach((fn) => fn(ev || { type })); },
    location: { hash: '', href: 'http://127.0.0.1:8080/' },
    setTimeout: (fn) => { void fn; return 0; },
    clearTimeout: () => {},
    navigator: {},
    history: {},
    IntersectionObserver: undefined
  };
  doc.defaultView = win;
  return { document: doc, window: win, location: win.location, StubElement, StubText, parseInto };
}

module.exports = { createStub, parseInto, decodeEntities };
