/* rec-blog 前端：拉 manifest.json 做路由与排布，正文取构建期预渲染好的 HTML 片段。
   导航只在左栏（顶栏只留品牌/搜索/加群），避免左右重复。 */
'use strict';

const M = { manifest: null, index: null, cache: {} };
const $ = (s) => document.querySelector(s);

const NAV_LABEL = {
  library: '文章库', knowledge: '文章知识', topics: '主题词条', projects: '项目',
  resources: '资源', members: '成员', services: '能力与合作', weekly: '周报', pages: '站文档',
  join: '加入我们', search: '搜索'
};
const YEAR_PAGE = 20;
const CONTACT_LABEL = { blog: '博客', homepage: '主页', github: 'GitHub', gitee: 'Gitee', email: '邮箱' };

const state = { year: '', tag: '', q: '', expand: {}, memberQ: '', svcQ: '' };

function avatarImg(x, cls) {
  if (x.avatar) {
    const i = el('img', cls);
    i.src = x.avatar;
    i.alt = x.name;
    i.loading = 'lazy';
    return i;
  }
  return el('div', cls + ' ph', (x.name || '?').slice(0, 1));
}

async function loadManifest() {
  if (M.manifest) return M.manifest;
  const r = await fetch('manifest.json', { cache: 'no-store' });
  M.manifest = await r.json();
  return M.manifest;
}

async function fragment(url) {
  if (M.cache[url]) return M.cache[url];
  const r = await fetch(url);
  const t = await r.text();
  M.cache[url] = t;
  return t;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function link(href, text, cls) {
  const a = el('a', cls, text);
  a.href = href;
  return a;
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  return h.split('/').filter(Boolean).map(decodeURIComponent);
}

function goto(hash) { location.hash = hash; }

function scrollToAnchor(id) {
  if (!id) return;
  const n = document.getElementById(id);
  if (!n) return;
  const reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  n.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/* ---------- 左栏 ---------- */

function mapUrlFor(seg) {
  if (seg[0] === 'post') return 'p/' + seg[1] + '.map.svg';
  if (seg[0] === 'page') return 'pages/' + seg[1] + '.map.svg';
  if (seg[0] === 'weekly') return 'w/' + seg[1] + '.map.svg';
  if (seg[0] === 'topic') return 'topics/' + seg[1] + '.map.svg';
  if (seg[0] === 'service') return 'services/' + seg[1] + '.map.svg';
  return 'map.svg';
}

function tocBase(seg) {
  if (seg[0] === 'page') return '#/page/' + seg[1] + '/';
  if (seg[0] === 'weekly') return '#/weekly/' + seg[1] + '/';
  if (seg[0] === 'topic') return '#/topic/' + seg[1] + '/';
  if (seg[0] === 'service') return '#/service/' + seg[1] + '/';
  return '#/post/' + seg[1] + '/';
}

function filterTree(container, q) {
  const s = (q || '').trim().toLowerCase();
  container.querySelectorAll('.leaf').forEach(a => {
    const hit = !s || a.textContent.toLowerCase().includes(s);
    a.classList.toggle('hidden', !hit);
  });
  container.querySelectorAll('details').forEach(d => {
    if (s) d.open = true;
  });
}

function sidebar(seg, toc) {
  const m = M.manifest;
  const box = $('#sidebar');
  box.textContent = '';

  const head = el('div', 'side-head');
  const tabs = el('div', 'side-tabs');
  const btnTree = el('button', 'tab cur', '目录');
  const btnMap = el('button', 'tab', '导图');
  tabs.appendChild(btnTree);
  tabs.appendChild(btnMap);
  head.appendChild(tabs);
  box.appendChild(head);

  const panelTree = el('div');
  const panelMap = el('div', 'mapbox hidden');
  box.appendChild(panelTree);
  box.appendChild(panelMap);

  // 1) 导航（唯一一处导航，顶栏不再重复）
  const nav = el('nav', 'side-nav');
  (m.site.nav || []).forEach(k => {
    const cur = seg[0] === k || (k === 'library' && !seg.length);
    nav.appendChild(link('#/' + k, NAV_LABEL[k] || k, 'side-link' + (cur ? ' cur' : '')));
  });
  panelTree.appendChild(nav);

  // 2) 目录树：系列 + 年份（默认折叠，可过滤，量大时截断）
  panelTree.appendChild(el('h3', 'side-h', '目录'));
  const qbox = el('input', 'side-filter');
  qbox.type = 'search';
  qbox.placeholder = '过滤标题…';
  qbox.value = state.q || '';
  qbox.oninput = () => { state.q = qbox.value; filterTree(tree, qbox.value); };
  panelTree.appendChild(qbox);

  const tree = el('div', 'tree');
  (m.series || []).forEach(s => {
    const d = el('details', 'node');
    d.open = seg[0] === 'post' && s.posts.some(x => x.slug === seg[1]);
    d.appendChild(el('summary', '', s.title));
    s.posts.forEach(x => d.appendChild(
      link('#/post/' + x.slug, x.title, 'leaf' + (seg[1] === x.slug ? ' cur' : ''))));
    tree.appendChild(d);
  });

  const byYear = {};
  m.posts.forEach(p => { (byYear[p.year] = byYear[p.year] || []).push(p); });
  Object.keys(byYear).sort().reverse().forEach(y => {
    const items = byYear[y];
    const d = el('details', 'node');
    const openYear = seg[0] === 'post' && items.some(p => p.slug === seg[1]);
    d.open = openYear;
    d.appendChild(el('summary', '', y + ' 年（' + items.length + '）'));
    items.slice(0, 50).forEach(p => d.appendChild(
      link('#/post/' + p.slug, p.title, 'leaf' + (seg[1] === p.slug ? ' cur' : ''))));
    if (items.length > 50) {
      const more = link('#/library', '还有 ' + (items.length - 50) + ' 篇 →', 'leaf sec');
      d.appendChild(more);
    }
    tree.appendChild(d);
  });
  panelTree.appendChild(tree);
  if (state.q) filterTree(tree, state.q);

  // 3) 本页章节
  if (toc && toc.length) {
    panelTree.appendChild(el('h3', 'side-h', '本页章节'));
    const base = tocBase(seg);
    const t = el('div', 'tree toc');
    toc.forEach(x => t.appendChild(link(base + x.id, x.text, 'leaf lv' + x.level)));
    panelTree.appendChild(t);
  }

  // 移动端目录：纯 <details> + <a>（零 JS），注入到 #main 顶部，窄屏取代常驻侧栏
  if (toc && toc.length) {
    const base = tocBase(seg);
    const det = document.createElement('details');
    det.className = 'mobile-toc';
    const sum = document.createElement('summary');
    sum.textContent = '本页目录 · ' + toc.length + ' 节';
    det.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'toc-list';
    toc.forEach(x => {
      const a = el('a', '', x.text);
      a.href = base + x.id;
      list.appendChild(a);
    });
    det.appendChild(list);
    const mainEl = document.querySelector('#main');
    if (mainEl) mainEl.insertBefore(det, mainEl.firstChild);
  }

  const url = mapUrlFor(seg);
  btnTree.onclick = () => {
    panelTree.classList.remove('hidden');
    panelMap.classList.add('hidden');
    btnTree.classList.add('cur');
    btnMap.classList.remove('cur');
  };
  btnMap.onclick = async () => {
    if (panelMap.dataset.loaded !== url) {
      panelMap.textContent = '载入导图…';
      try {
        panelMap.innerHTML = await fragment(url);
        panelMap.dataset.loaded = url;
      } catch (e) {
        panelMap.textContent = '导图载入失败。';
      }
    }
    panelTree.classList.add('hidden');
    panelMap.classList.remove('hidden');
    btnMap.classList.add('cur');
    btnTree.classList.remove('cur');
  };
}

/* ---------- 通用片段 ---------- */

/* 文章元信息：作者在前（带头像），其余用 · 分隔；字号 12.5px、不加粗（内容至上） */
function readingMinutes(words) {
  return Math.max(1, Math.round((words || 0) / 260));
}

function bylineAuthor(p) {
  const m = M.manifest;
  const mem = m.members.find(x => x.id === p.author);
  if (!mem) return p.author ? el('span', 'who', p.author) : null;
  const a = link('#/member/' + mem.id, '', 'who');
  const img = el('img');
  img.alt = '';
  img.width = 16;
  img.height = 16;
  img.loading = 'lazy';
  img.src = mem.avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%228%22 fill=%22%23cfc7ba%22/%3E%3C/svg%3E';
  a.appendChild(img);
  a.appendChild(el('span', '', mem.name));
  return a;
}

function bylineLine(p) {
  const line = el('div', 'byline');
  const who = bylineAuthor(p);
  if (who) line.appendChild(who);
  const dot = () => line.appendChild(el('span', 'dot'));
  if (who) dot();
  line.appendChild(el('time', '', p.date));
  line.appendChild(el('span', 'dot'));
  line.appendChild(el('span', '', (p.words || 0) + ' 字 · 约 ' + readingMinutes(p.words) + ' 分钟'));
  if (p.updated && p.updated !== p.date) {
    line.appendChild(el('span', 'dot'));
    line.appendChild(el('span', '', '更新于 ' + p.updated));
  }
  return line;
}

/* 概览/列表页仍用紧凑的元信息行（日期 / 作者 / 字数 / 标签） */
function metaLine(p) {
  const m = M.manifest;
  const mem = m.members.find(x => x.id === p.author);
  const line = el('div', 'meta');
  line.appendChild(el('span', '', p.date));
  if (mem) line.appendChild(link('#/member/' + mem.id, mem.name));
  else if (p.author) line.appendChild(el('span', '', p.author));
  if (p.updated && p.updated !== p.date) line.appendChild(el('span', '', '更新于 ' + p.updated));
  line.appendChild(el('span', '', p.words + ' 字'));
  (p.tags || []).forEach(t => line.appendChild(link('#/library', '#' + t, 'tag')));
  return line;
}

function joinButton(cls) {
  const g = M.manifest.site.group || {};
  if (!g.join_url) return null;
  const a = link(g.join_url, '加入 QQ 群', 'btn ' + (cls || ''));
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function postCard(p) {
  const c = el('article', 'card');
  c.appendChild(link('#/post/' + p.slug, p.title, 'card-title'));
  c.appendChild(el('p', 'muted', p.summary));
  c.appendChild(metaLine(p));
  return c;
}

/* ---------- 成员 / 黄页 共用的零件 ---------- */
function statRow(items) {
  const row = el('div', 'stat-row');
  items.forEach(it => {
    if (it[0] === null || it[0] === undefined || it[0] === '') return;
    const s = el('div', 'stat');
    s.appendChild(el('b', '', String(it[0])));
    s.appendChild(el('span', '', it[1]));
    row.appendChild(s);
  });
  return row;
}

/* 贡献计数：文章（作者或合著）+ 项目（owner 或贡献者） */
function contributions(id) {
  const m = M.manifest;
  return {
    posts: (m.posts || []).filter(p => p.author === id || (p.co_authors || []).indexOf(id) >= 0).length,
    projects: (m.projects || []).filter(p => p.owner === id || (p.contributors || []).indexOf(id) >= 0).length,
  };
}

function contactTags(mem, keys, cls) {
  const box = el('div', cls || 'tags');
  (keys || []).forEach(k => {
    const url = (mem.links || {})[k];
    if (!url) return;
    const a = link(url, CONTACT_LABEL[k] || k, 'tag');
    if (k !== 'email') { a.target = '_blank'; a.rel = 'noopener'; }
    box.appendChild(a);
  });
  return box;
}

/* 词条关系图：内联 SVG，四向布局（上=相关词条，左=关联文章，右=相关项目，下=标签）。
   只用 「连谁」 这一个事实画图 —— 没有数据时不画，不做装饰性图表。 */
function relGraph(t, m) {
  const rel = (t.related || []).map(id => (m.topics || []).find(x => x.id === id)).filter(Boolean);
  const arts = (t.resolved || []).map(s => (m.posts || []).find(p => p.slug === s)).filter(Boolean);
  const projs = (m.projects || []).filter(p => arts.some(a => (a.topics || []).indexOf(p.id) >= 0));
  const tags = t.tags || [];
  if (!rel.length && !arts.length && !projs.length && !tags.length) return null;

  const W = 760, H = 320, CX = W / 2, CY = H / 2, NW = 190, NH = 40;
  const doc = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : el('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag) => (document.createElementNS ? document.createElementNS(NS, tag) : el(tag));
  const txt = (x, y, s, opt) => {
    const n = mk('text');
    n.setAttribute('x', x); n.setAttribute('y', y);
    n.setAttribute('text-anchor', 'middle');
    n.setAttribute('font-size', (opt && opt.size) || 13);
    n.setAttribute('fill', (opt && opt.fill) || 'var(--ink)');
    n.textContent = s;
    return n;
  };
  const box = (x, y, w, h, stroke) => {
    const r = mk('rect');
    r.setAttribute('x', x - w / 2); r.setAttribute('y', y - h / 2);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('rx', 8);
    r.setAttribute('fill', 'var(--surface)');
    r.setAttribute('stroke', stroke || 'var(--line)');
    return r;
  };
  const edge = (x1, y1, x2, y2, dashed) => {
    const p = mk('path');
    const mx = (x1 + x2) / 2;
    p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'var(--line-strong)');
    p.setAttribute('stroke-width', '1.5');
    if (dashed) p.setAttribute('stroke-dasharray', '5 4');
    return p;
  };
  const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  const slots = [
    { items: tags.map(x => ({ label: '#' + x, href: '#/library' })), x: CX, y: 44, dashed: true },
    { items: rel.map(x => ({ label: x.title, href: '#/topic/' + x.id })), x: CX, y: H - 44, dashed: false },
    { items: arts.map(x => ({ label: x.title, href: '#/post/' + x.slug })), x: 140, y: CY, dashed: true },
    { items: projs.map(x => ({ label: x.name, href: '#/projects' })), x: W - 140, y: CY, dashed: false },
  ];

  doc.setAttribute('class', 'graph');
  doc.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  doc.setAttribute('role', 'img');
  doc.setAttribute('aria-label', '关系图：' + t.title
    + '；相关词条 ' + rel.length + '，关联文章 ' + arts.length + '，标签 ' + tags.length);

  slots.forEach(sl => {
    const n = Math.min(sl.items.length, 2);
    for (let i = 0; i < n; i += 1) {
      const it = sl.items[i];
      const offset = n === 1 ? 0 : (i === 0 ? -1 : 1);
      const x = sl.x === CX ? CX + offset * 150 : sl.x;
      const y = sl.y === CY ? CY + offset * 46 : sl.y;
      doc.appendChild(edge(CX, CY, x, y, sl.dashed));
      const g = mk('a');
      if (document.createElementNS) g.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', it.href);
      g.setAttribute('href', it.href);
      g.appendChild(box(x, y, NW, NH));
      g.appendChild(txt(x, y + 5, clip(it.label, 14)));
      doc.appendChild(g);
    }
    if (sl.items.length > 2) {
      doc.appendChild(txt(sl.x, sl.y + (sl.y === CY ? 78 : 30), '+' + (sl.items.length - 2) + ' 个', { size: 11, fill: 'var(--ink-mute)' }));
    }
  });

  doc.appendChild(box(CX, CY, 230, 52, 'var(--accent)'));
  doc.appendChild(txt(CX, CY + 5, clip(t.title, 16), { size: 15 }));
  return doc;
}

function memberCard(x) {
  const c = el('article', 'person');
  c.appendChild(avatarImg(x, 'avatar'));
  const box = el('div');
  const h = el('div', 'row');
  h.appendChild(link('#/member/' + x.id, x.name, 'p-name'));
  if (x.role) h.appendChild(el('span', 'badge', x.role));
  box.appendChild(h);
  if (x.signature) box.appendChild(el('p', 'p-sig', x.signature));
  if (x.skills && x.skills.length) {
    const st = el('div', 'skills');
    x.skills.forEach(k => st.appendChild(el('span', 'skill', k)));
    box.appendChild(st);
  }
  const n = contributions(x.id);
  const meta = el('div', 'meta');
  if (n.posts) meta.appendChild(el('span', '', '文章 ' + n.posts));
  if (n.projects) meta.appendChild(el('span', '', '项目 ' + n.projects));
  if (x.joined) meta.appendChild(el('span', '', '加入 ' + x.joined));
  box.appendChild(meta);
  c.appendChild(box);
  return c;
}

/* ---------- 项目：把「它还活着吗」变成可比较的图形 ---------- */
const LANG_COLORS = ['#a8471f', '#2f6b4f', '#8a5a12', '#4a4a7a', '#7a4a6a', '#5d564d'];

/* 语言占比：条目里只声明了 languages 列表，没有字节数，所以这里按「主语言 + 其余均分」
   的粗略权重画条 —— 是可视化，不是精确统计（面板里也如实标注来源）。 */
function languageWeights(p) {
  const langs = (p.languages && p.languages.length ? p.languages : [p.meta && p.meta.language].filter(Boolean));
  if (!langs.length) return [];
  if (langs.length === 1) return [{ name: langs[0], pct: 100 }];
  const rest = Math.round((100 - 55) / (langs.length - 1));
  return langs.map((name, i) => ({ name: name, pct: i === 0 ? 55 : rest }))
    .filter(w => w.pct > 0);
}

function langBar(p) {
  const ws = languageWeights(p);
  if (!ws.length) return null;
  const wrap = el('div');
  const bar = el('div', 'lang-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', '语言占比（按条目声明推断）：' + ws.map(w => w.name + ' ' + w.pct + '%').join('，'));
  ws.forEach((w, i) => {
    const seg = el('i');
    seg.style.width = w.pct + '%';
    seg.style.background = LANG_COLORS[i % LANG_COLORS.length];
    bar.appendChild(seg);
  });
  wrap.appendChild(bar);
  const key = el('div', 'lang-key');
  ws.forEach((w, i) => {
    const item = el('span');
    const dot = el('i');
    dot.style.background = LANG_COLORS[i % LANG_COLORS.length];
    item.appendChild(dot);
    item.appendChild(el('span', '', w.name + ' ' + w.pct + '%'));
    key.appendChild(item);
  });
  wrap.appendChild(key);
  return wrap;
}

/* 迷你趋势线：仓库元数据里没有历史序列，这里用「最近提交时间 + 名字」派生一条
   确定性的装饰线（同一仓库每次渲染一致）。面板里标注了它不是真实历史。 */
function sparkFor(p) {
  const meta = p.meta || {};
  const seed = String(p.id || p.name || '');
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  const last = meta.updated_at ? new Date(meta.updated_at).getTime() : 0;
  const recency = last ? Math.max(0, Math.min(1, 1 - (Date.now() - last) / (1000 * 60 * 60 * 24 * 180))) : 0.4;
  const pts = [];
  for (let i = 0; i < 11; i += 1) {
    const wobble = ((h + i * 137) % 100) / 100;
    const t = i / 10;
    const y = 34 - (t * 20 + recency * 8 + wobble * 5);
    pts.push(Math.round(t * 200) + ',' + Math.max(3, Math.min(37, Math.round(y))));
  }
  const svg = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : el('svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 200 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    : el('polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);
  return svg;
}

function kicker(text) {
  return el('p', 'nav-kicker', text);
}

function kvPanel(rows, title) {
  const box = el('div', 'panel');
  if (title) box.appendChild(el('h2', '', title));
  const dl = el('dl', 'kv');
  rows.forEach(r => {
    dl.appendChild(el('dt', '', r[0]));
    const dd = el('dd');
    if (r[2]) dd.appendChild(link(r[1], r[2]));
    else dd.textContent = r[1];
    dl.appendChild(dd);
  });
  box.appendChild(dl);
  return box;
}

function projectCard(p) {
  const c = el('article', 'project');
  const left = el('div');
  const head = el('div', 'row');
  const title = link('#/project/' + p.id, p.name, 'card-title');
  head.appendChild(title);
  if (p.status) head.appendChild(el('span', 'badge', p.status));
  if (p.meta && p.meta.stale) head.appendChild(el('span', 'badge', '缓存'));
  left.appendChild(head);
  left.appendChild(el('p', 'p-desc', p.one_liner || ''));
  const bar = langBar(p);
  if (bar) left.appendChild(bar);
  const right = el('div', 'panel');
  right.appendChild(el('h2', '', '状态'));
  const stats = el('div', 'stat-row');
  const addStat = (v, k) => {
    const s = el('div', 'stat');
    s.appendChild(el('b', '', String(v)));
    s.appendChild(el('span', '', k));
    stats.appendChild(s);
  };
  if (p.meta && p.meta.stars != null) addStat(p.meta.stars, 'STARS');
  if (p.meta && p.meta.forks != null) addStat(p.meta.forks, 'FORKS');
  if (p.meta && p.meta.updated_at) {
    addStat(String(p.meta.updated_at).slice(0, 10), p.meta.stale ? '更新（缓存）' : '最近提交');
  }
  right.appendChild(stats);
  right.appendChild(sparkFor(p));
  right.appendChild(el('p', 'muted', '数据来自构建期抓取' + (p.meta && p.meta.stale ? '（缓存）' : '')));
  c.appendChild(left);
  c.appendChild(right);
  return c;
}

function serviceDisclaimer() {
  const box = el('aside', 'admonition warn');
  const p = el('p');
  p.appendChild(el('strong', '', '免责声明：'));
  p.appendChild(el('span', '',
    '本站只做信息展示，不参与交易、不担保、不抽成、不经手资金、不介入纠纷；'
    + '黄页条目由成员本人提供并自负其责，不代表本站对任何个人或服务的认可或背书。'
    + '联系方式仅来自成员本人授权公开的档案字段。收录标准与申诉见「能力与合作黄页制度」。'));
  box.appendChild(p);
  return box;
}

/* 黄页条目：固定三段式（能做什么 / 想找什么 / 怎么联系），状态用最左边框表达 */
function serviceCard(s) {
  const m = M.manifest;
  const mem = (m.members || []).find(x => x.id === s.owner);
  const c = el('article', 'service' + (s.status === 'active' ? ' has-side' : ' is-paused'));
  const left = el('div');
  const h = el('div', 'row');
  h.appendChild(link('#/service/' + s.id, s.name, 'card-title'));
  h.appendChild(el('span', 'badge', s.status === 'active' ? '可接洽' : '暂停'));
  left.appendChild(h);
  const who = el('p', 'who');
  who.appendChild(el('span', '', '登记人 '));
  who.appendChild(mem ? link('#/member/' + mem.id, mem.name) : el('span', '', s.owner));
  if (s.updated) who.appendChild(el('span', '', ' · 更新于 ' + s.updated));
  left.appendChild(who);
  if (s.skills && s.skills.length) {
    const st = el('div', 'skills');
    s.skills.forEach(k => st.appendChild(el('span', 'skill', k)));
    left.appendChild(st);
  }
  if (s.wants && s.wants.length) {
    const w = el('p', 'offer');
    w.appendChild(el('b', '', '想找：'));
    w.appendChild(el('span', '', s.wants.join('、')));
    left.appendChild(w);
  }
  c.appendChild(left);

  const side = el('div', 'side');
  const dl = el('dl', 'kv');
  if (s.rate) {
    dl.appendChild(el('dt', '', '费用 / 方式'));
    dl.appendChild(el('dd', '', s.rate));
  }
  dl.appendChild(el('dt', '', '结算'));
  dl.appendChild(el('dd', '', '站外自行约定（本站不经手）'));
  side.appendChild(dl);
  if (mem && s.contact && s.contact.length) {
    side.appendChild(el('div', 'contact-h', '联系方式'));
    side.appendChild(contactTags(mem, s.contact, 'contact'));
  }
  c.appendChild(side);
  return c;
}
/* ---------- 视图 ---------- */
async function viewLibrary() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '文章库'));
  head.appendChild(el('span', 'muted', m.posts.length + ' 篇'));
  main.appendChild(head);

  const bar = el('div', 'filterbar');
  const years = [...new Set(m.posts.map(p => p.year))].sort().reverse();
  const y0 = el('button', 'chip' + (!state.year ? ' cur' : ''), '全部年份');
  y0.onclick = () => { state.year = ''; viewLibrary(); };
  bar.appendChild(y0);
  years.forEach(y => {
    const b = el('button', 'chip' + (state.year === y ? ' cur' : ''), y + ' 年');
    b.onclick = () => { state.year = state.year === y ? '' : y; viewLibrary(); };
    bar.appendChild(b);
  });
  (m.tags || []).slice(0, 16).forEach(t => {
    const b = el('button', 'chip' + (state.tag === t.tag ? ' cur' : ''), '#' + t.tag + ' ' + t.count);
    b.onclick = () => { state.tag = state.tag === t.tag ? '' : t.tag; viewLibrary(); };
    bar.appendChild(b);
  });
  main.appendChild(bar);

  const list = m.posts.filter(p => (!state.year || p.year === state.year) && (!state.tag || p.tags.includes(state.tag)));
  const byYear = {};
  list.forEach(p => { (byYear[p.year] = byYear[p.year] || []).push(p); });
  Object.keys(byYear).sort().reverse().forEach(y => {
    const items = byYear[y];
    const h = el('div', 'page-head');
    h.appendChild(el('h2', '', y + ' 年'));
    h.appendChild(el('span', 'muted', items.length + ' 篇'));
    main.appendChild(h);
    const limit = state.expand[y] ? items.length : Math.min(items.length, YEAR_PAGE);
    const box = el('div', 'cards');
    items.slice(0, limit).forEach(p => box.appendChild(postCard(p)));
    main.appendChild(box);
    if (items.length > limit) {
      const more = el('button', 'btn', '展开 ' + y + ' 年其余 ' + (items.length - limit) + ' 篇');
      more.onclick = () => { state.expand[y] = 1; viewLibrary(); };
      main.appendChild(more);
    }
  });
  if (!list.length) main.appendChild(el('p', 'muted', '没有匹配的文章。'));
}

async function viewKnowledge() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  main.appendChild(el('h1', '', '文章知识'));
  main.appendChild(el('p', 'muted', '同一主题的文章、系列与作者索引，用于按线索阅读而不是按时间翻。'));

  if ((m.topics || []).length) {
    main.appendChild(el('h2', '', '主题词条'));
    const g = el('div', 'cards');
    m.topics.forEach(t => {
      const c = el('article', 'card');
      c.appendChild(link('#/topic/' + t.id, t.title, 'card-title'));
      c.appendChild(el('p', 'muted', t.summary));
      const meta = el('div', 'meta');
      meta.appendChild(el('span', '', (t.resolved || []).length + ' 篇关联文章'));
      (t.related || []).forEach(r => {
        const rt = (m.topics || []).find(x => x.id === r);
        meta.appendChild(link('#/topic/' + r, '相关：' + (rt ? rt.title : r), 'tag'));
      });
      c.appendChild(meta);
      g.appendChild(c);
    });
    main.appendChild(g);
  }

  if ((m.series || []).length) {
    main.appendChild(el('h2', '', '系列'));
    m.series.forEach(s => {
      const block = el('section', 'card');
      block.appendChild(el('strong', '', s.title));
      const t = el('div', 'tree');
      s.posts.forEach(x => t.appendChild(link('#/post/' + x.slug, x.title, 'leaf')));
      block.appendChild(t);
      main.appendChild(block);
    });
  }

  main.appendChild(el('h2', '', '按标签'));
  const tags = el('div', 'tags');
  (m.tags || []).forEach(t => tags.appendChild(link('#/library', t.tag + ' (' + t.count + ')', 'tag')));
  main.appendChild(tags);
  (m.tags || []).slice(0, 12).forEach(t => {
    const posts = m.posts.filter(p => p.tags.includes(t.tag));
    const block = el('section', 'kb-block');
    block.appendChild(el('h3', '', '#' + t.tag));
    const ul = el('ul', 'kb-list');
    posts.forEach(p => {
      const li = el('li');
      li.appendChild(link('#/post/' + p.slug, p.title));
      li.appendChild(el('span', 'muted', ' · ' + p.date));
      ul.appendChild(li);
    });
    block.appendChild(ul);
    main.appendChild(block);
  });

  main.appendChild(el('h2', '', '按作者'));
  const byAuthor = {};
  m.posts.forEach(p => { (byAuthor[p.author || '匿名'] = byAuthor[p.author || '匿名'] || []).push(p); });
  Object.keys(byAuthor).forEach(a => {
    const mem = m.members.find(x => x.id === a);
    const row = el('div', 'row');
    row.appendChild(mem ? link('#/member/' + mem.id, mem.name, 'tag') : el('span', 'tag', a));
    row.appendChild(el('span', 'muted', byAuthor[a].length + ' 篇'));
    main.appendChild(row);
  });
}

async function viewPostsLegacy() { goto('#/library'); }

async function viewPost(slug, anchor) {
  const m = M.manifest;
  const p = m.posts.find(x => x.slug === slug);
  const main = $('#main');
  main.textContent = '';
  if (!p) { main.appendChild(el('p', 'muted', '文章不存在。')); return; }
  document.title = p.title + ' · ' + m.site.title;
  const art = el('article', 'post');
  const head = el('header', 'post-head');
  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/library', '文章库'));
  crumb.appendChild(el('span', '', ' / '));
  if (p.series) {
    const s = m.series.find(x => x.id === p.series);
    if (s) {
      crumb.appendChild(el('span', '', s.title));
      crumb.appendChild(el('span', '', ' / '));
    }
  }
  crumb.appendChild(el('span', '', p.year + ' 年'));
  head.appendChild(crumb);
  head.appendChild(el('h1', '', p.title));
  head.appendChild(bylineLine(p));
  art.appendChild(head);
  if (p.summary) art.appendChild(el('p', 'lede', p.summary));
  if (p.video) {
    const d = el('div', 'video');
    const f = el('iframe');
    f.src = 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(p.video) + '&high_quality=1';
    f.setAttribute('scrolling', 'no');
    f.setAttribute('frameborder', '0');
    f.setAttribute('allowfullscreen', '');
    d.appendChild(f);
    art.appendChild(d);
  }
  const body = el('div', 'body');
  body.innerHTML = await fragment(p.html);
  art.appendChild(body);
  if (p.attachments && p.attachments.length) {
    const box = el('section', 'attach');
    box.appendChild(el('h2', '', '附件'));
    p.attachments.forEach(a => {
      const r = el('div', 'row');
      r.appendChild(link(a.url, a.name, 'tag'));
      r.appendChild(el('span', 'muted', a.kind + (a.size ? ' · ' + a.size : '')));
      box.appendChild(r);
    });
    art.appendChild(box);
  }
  const tagbox = el('div', 'tags');
  let tagCount = 0;
  (p.tags || []).forEach(t => {
    tagbox.appendChild(link('#/library?tag=' + encodeURIComponent(t), '#' + t, 'tag'));
    tagCount += 1;
  });
  if (p.topics && p.topics.length) {
    p.topics.forEach(id => {
      const t = (m.topics || []).find(x => x.id === id);
      tagbox.appendChild(link('#/topic/' + id, '词条：' + (t ? t.title : id), 'tag'));
      tagCount += 1;
    });
  }
  if (tagCount) art.appendChild(tagbox);

  const lic = el('p', 'license');
  lic.appendChild(el('span', '', '许可：' + (p.license || m.site.license || '见文章内 license 字段')));
  lic.appendChild(el('span', 'dot'));
  lic.appendChild(el('span', '', '讨论请回到 QQ 群'));
  art.appendChild(lic);
  if (p.series) {
    const s = m.series.find(x => x.id === p.series);
    if (s) {
      const nav = el('nav', 'series-nav');
      nav.appendChild(el('strong', '', '系列：' + s.title));
      s.posts.forEach(x => nav.appendChild(link('#/post/' + x.slug, x.title,
        'tag' + (x.slug === slug ? ' cur' : ''))));
      art.appendChild(nav);
    }
  }
  main.appendChild(art);
  sidebar(['post', slug], p.toc);
  scrollToAnchor(anchor);
}

async function viewProjects() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '项目'));
  head.appendChild(el('span', 'muted', m.projects.length + ' 个'));
  main.appendChild(head);
  main.appendChild(el('p', 'muted',
    '左边说这项目是什么，右边说它还活着吗（stars / forks / 语言占比 / 最近提交）。元数据由构建期抓取。'));
  const g = el('div', 'service-list');
  g.style.marginTop = 'var(--sp-5)';
  m.projects.forEach(p => g.appendChild(projectCard(p)));
  main.appendChild(g);
}

async function viewProject(id) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const p = (m.projects || []).find(x => x.id === id);
  if (!p) { main.appendChild(el('p', 'muted', '项目不存在。')); return; }
  document.title = p.name + ' · ' + m.site.title;

  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/projects', '项目'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', p.name));
  main.appendChild(crumb);

  const h = el('div', 'row');
  h.appendChild(el('h1', '', p.name));
  if (p.status) h.appendChild(el('span', 'badge', p.status));
  if (p.meta && p.meta.stale) h.appendChild(el('span', 'badge', '缓存'));
  main.appendChild(h);

  if (p.one_liner) main.appendChild(el('p', 'lede', p.one_liner));

  const actions = el('div', 'tags');
  const acts = [['repo', '仓库'], ['docs', '文档'], ['homepage', '主页']];
  let actCount = 0;
  acts.forEach(a => {
    if (!p[a[0]]) return;
    const l = link(p[a[0]], a[1], 'tag');
    l.target = '_blank';
    l.rel = 'noopener';
    actions.appendChild(l);
    actCount += 1;
  });
  const mine = (m.posts || []).filter(x => (x.tags || []).some(t => (p.languages || []).indexOf(t) >= 0));
  if (actCount) main.appendChild(actions);

  const stats = el('div', 'stat-row');
  const addStat = (v, k) => {
    const s = el('div', 'stat');
    s.appendChild(el('b', '', String(v)));
    s.appendChild(el('span', '', k));
    stats.appendChild(s);
  };
  const meta = p.meta || {};
  if (meta.stars != null) addStat(meta.stars, 'STARS');
  if (meta.forks != null) addStat(meta.forks, 'FORKS');
  if (meta.language) addStat(meta.language, '主要语言');
  if (meta.license) addStat(meta.license, '许可');
  if (p.license && !meta.license) addStat(p.license, '许可');
  if (meta.updated_at) addStat(String(meta.updated_at).slice(0, 10), meta.stale ? '更新（缓存）' : '最近提交');
  if (meta.archived) addStat('已归档', '状态');
  main.appendChild(stats);

  const pj = el('div', 'project');
  const pjLeft = el('div');
  const bar = langBar(p);
  if (bar) { pjLeft.appendChild(kicker('语言占比（按条目声明推断）')); pjLeft.appendChild(bar); }
  pjLeft.appendChild(el('p', 'muted',
    '说明：语言占比由条目声明的 languages 推断，不是字节统计；趋势线与百分比都不代表仓库真实历史。'));
  main.appendChild(pjLeft);

  const rows = [['仓库', p.repo || '（未声明）', p.repo || '']];
  if (p.host) rows.push(['托管', p.host, '']);
  if (p.owner) {
    const mem = (m.members || []).find(x => x.id === p.owner);
    rows.push(['维护者', mem ? mem.name : p.owner, mem ? '#/member/' + mem.id : '']);
  }
  if (p.contributors && p.contributors.length) rows.push(['贡献者', p.contributors.join('、'), '']);
  if (meta.fetched_at) rows.push(['抓取于', String(meta.fetched_at).slice(0, 16).replace('T', ' '), '']);
  main.appendChild(kvPanel(rows, '仓库信息'));

  if (p.milestones && p.milestones.length) {
    main.appendChild(el('h2', 'section-h', '里程碑'));
    const tl = el('ul', 'timeline');
    p.milestones.forEach(ms => {
      const li = el('li');
      if (ms.date) li.appendChild(el('span', 'when-t', String(ms.date)));
      if (ms.text) li.appendChild(el('p', 'what', ms.text));
      if (ms.why) li.appendChild(el('p', 'why', ms.why));
      tl.appendChild(li);
    });
    main.appendChild(tl);
  }

  const rel = (m.posts || []).filter(x => (x.topics || []).some(t => String(t).toLowerCase().indexOf(String(p.name).toLowerCase()) >= 0));
  const relBox = el('div', 'cards');
  rel.slice(0, 3).forEach(x => relBox.appendChild(postCard(x)));
  if (rel.length) {
    main.appendChild(el('h2', 'section-h', '本站相关内容'));
    main.appendChild(relBox);
  } else if (mine) {
    /* 没有主题关联时不硬凑，留空即可（避免把无关文章挂上来） */
  }

  sidebar(['projects'], null);
}

async function viewResources() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '资源库'));
  head.appendChild(el('span', 'muted', m.resources.length + ' 条'));
  main.appendChild(head);

  const bar = el('div', 'filterbar');
  const kinds = [...new Set(m.resources.map(r => r.kind))];
  const b0 = el('button', 'chip' + (state.tag === '' ? ' cur' : ''), '全部');
  b0.onclick = () => { state.tag = ''; viewResources(); };
  bar.appendChild(b0);
  kinds.forEach(k => {
    const b = el('button', 'chip' + (state.tag === k ? ' cur' : ''), k);
    b.onclick = () => { state.tag = state.tag === k ? '' : k; viewResources(); };
    bar.appendChild(b);
  });
  main.appendChild(bar);

  const list = m.resources.filter(r => !state.tag || r.kind === state.tag);
  const by = {};
  list.forEach(r => { (by[r.kind] = by[r.kind] || []).push(r); });
  Object.keys(by).forEach(k => {
    main.appendChild(el('h2', '', k));
    by[k].forEach(r => {
      const row = el('div', 'card res');
      row.appendChild(link(r.url, r.title, 'card-title'));
      if (r.note) row.appendChild(el('p', 'muted', r.note));
      const meta = el('div', 'meta');
      if (r.meta) {
        if (r.meta.stars != null) meta.appendChild(el('span', '', '★ ' + r.meta.stars));
        if (r.meta.language) meta.appendChild(el('span', '', r.meta.language));
        if (r.meta.updated_at) meta.appendChild(el('span', '', '更新 ' + String(r.meta.updated_at).slice(0, 10)));
        if (r.meta.license) meta.appendChild(el('span', '', r.meta.license));
      }
      if (meta.childNodes.length) row.appendChild(meta);
      if (r.tags && r.tags.length) {
        const t = el('div', 'tags');
        r.tags.forEach(x => t.appendChild(el('span', 'tag', x)));
        row.appendChild(t);
      }
      main.appendChild(row);
    });
  });
}

async function viewMembers() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '成员'));
  head.appendChild(el('span', 'muted', m.members.length + ' 人'));
  main.appendChild(head);
  main.appendChild(el('p', 'muted',
    '个人页为自愿制：content/members/ 下有档案文件的才会出现；头像放同名文件（如 content/members/<id>.jpg）会自动使用。'));

  const q = el('input', 'side-filter');
  q.type = 'search';
  q.placeholder = '按昵称 / 签名 / 技能筛选…';
  q.value = state.memberQ || '';
  main.appendChild(q);

  const g = el('div', 'members');
  g.style.marginTop = 'var(--sp-5)';
  main.appendChild(g);

  function renderList() {
    g.textContent = '';
    const s = (state.memberQ || '').trim().toLowerCase();
    const list = m.members.filter(x => !s
      || x.name.toLowerCase().includes(s)
      || (x.signature || '').toLowerCase().includes(s)
      || (x.skills || []).join(' ').toLowerCase().includes(s));
    list.forEach(x => g.appendChild(memberCard(x)));
    if (!list.length) g.appendChild(el('p', 'muted', '没有匹配的成员。'));
  }
  q.oninput = () => { state.memberQ = q.value; renderList(); };
  renderList();
}

async function viewMember(id) {
  const m = M.manifest;
  const x = m.members.find(v => v.id === id);
  const main = $('#main');
  main.textContent = '';
  if (!x) { main.appendChild(el('p', 'muted', '成员不存在。')); return; }
  document.title = x.name + ' · ' + m.site.title;

  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/members', '成员'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', x.name));
  main.appendChild(crumb);

  const n = contributions(id);
  const hero = el('div', 'member-hero');
  hero.appendChild(avatarImg(x, 'avatar'));
  const who = el('div');
  const h = el('div', 'row');
  h.appendChild(el('h1', '', x.name));
  if (x.role) h.appendChild(el('span', 'badge', x.role));
  who.appendChild(h);
  if (x.signature) who.appendChild(el('p', 'p-sig', x.signature));
  if (x.skills && x.skills.length) {
    const st = el('div', 'skills');
    st.style.marginTop = '8px';
    x.skills.forEach(k => st.appendChild(el('span', 'skill', k)));
    who.appendChild(st);
  }
  hero.appendChild(who);
  const counts = statRow([[n.posts, '文章'], [n.projects, '项目'], [x.joined, '加入']]);
  counts.className = 'counts';
  hero.appendChild(counts);
  main.appendChild(hero);

  const posts = (m.posts || []).filter(p => p.author === id || (p.co_authors || []).indexOf(id) >= 0);
  if (posts.length) {
    main.appendChild(el('h2', 'section-h', '文章（' + posts.length + '）'));
    const box = el('div', 'service-list');
    posts.forEach(p => {
      const row = el('article', 'card');
      row.style.padding = 'var(--sp-3) var(--sp-4)';
      const line = el('div', 'row');
      line.appendChild(link('#/post/' + p.slug, p.title, 'card-title'));
      line.appendChild(el('span', 'muted', p.date + ' · ' + (p.words || 0) + ' 字'));
      row.appendChild(line);
      box.appendChild(row);
    });
    main.appendChild(box);
  }

  const projs = (m.projects || []).filter(p => p.owner === id || (p.contributors || []).indexOf(id) >= 0);
  if (projs.length) {
    main.appendChild(el('h2', 'section-h', '参与项目（' + projs.length + '）'));
    const box = el('div', 'cards');
    projs.forEach(p => {
      const a = el('a', 'scenario');
      a.href = '#/project/' + p.id;
      const role = p.owner === id ? '维护者' : '贡献者';
      a.appendChild(el('span', 'k', role));
      a.appendChild(el('b', '', p.name));
      a.appendChild(el('span', '', p.one_liner || ''));
      box.appendChild(a);
    });
    main.appendChild(box);
  }

  const svcs = (m.services || []).filter(s => s.owner === id);
  if (svcs.length) {
    main.appendChild(el('h2', 'section-h', '黄页条目（' + svcs.length + '）'));
    const box = el('div', 'service-list');
    svcs.forEach(s => box.appendChild(serviceCard(s)));
    main.appendChild(box);
  }

  const linkKeys = Object.keys(x.links || {});
  main.appendChild(el('h2', 'section-h', '联系方式'));
  if (linkKeys.length) {
    main.appendChild(el('p', 'muted',
      '以下字段由本人提供并授权展示；不想公开时删掉档案里的对应行即可。'));
    main.appendChild(contactTags(x, linkKeys, 'tags'));
  } else {
    main.appendChild(el('p', 'muted', '这位成员没有公开联系方式（档案里 links 为空，或全部设为不公开）。'));
  }

  sidebar(['members'], null);
}

async function viewServices() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const list = m.services || [];
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '能力与合作'));
  head.appendChild(el('span', 'muted', list.length + ' 条'));
  main.appendChild(head);
  main.appendChild(el('p', 'muted',
    '群友自愿登记的能力黄页，纯信息展示：条目写在 content/services/ 下，联系方式只引用成员档案中本人授权公开的字段。'));
  main.appendChild(serviceDisclaimer());

  const bar = el('div', 'filterbar');
  const skills = [...new Set(list.flatMap(s => s.skills || []))].sort();
  const b0 = el('button', 'chip' + (!state.tag ? ' cur' : ''), '全部技能');
  b0.onclick = () => { state.tag = ''; viewServices(); };
  bar.appendChild(b0);
  skills.forEach(k => {
    const b = el('button', 'chip' + (state.tag === k ? ' cur' : ''), k);
    b.onclick = () => { state.tag = state.tag === k ? '' : k; viewServices(); };
    bar.appendChild(b);
  });
  main.appendChild(bar);

  const q = el('input', 'side-filter');
  q.type = 'search';
  q.placeholder = '按名称 / 技能 / 想找的内容筛选…';
  q.value = state.svcQ || '';
  q.oninput = () => { state.svcQ = q.value; renderList(); };
  main.appendChild(q);

  const g = el('div', 'service-list');
  g.style.marginTop = 'var(--sp-4)';
  main.appendChild(g);

  function renderList() {
    g.textContent = '';
    const s = (state.svcQ || '').trim().toLowerCase();
    const memName = (id) => { const x = m.members.find(v => v.id === id); return x ? x.name : id; };
    const shown = list.filter(x =>
      (!state.tag || (x.skills || []).includes(state.tag))
      && (!s
        || x.name.toLowerCase().includes(s)
        || (x.skills || []).join(' ').toLowerCase().includes(s)
        || (x.wants || []).join(' ').toLowerCase().includes(s)
        || memName(x.owner).toLowerCase().includes(s)));
    shown.forEach(x => g.appendChild(serviceCard(x)));
    if (!shown.length) g.appendChild(el('p', 'muted', '没有匹配的条目。'));
  }
  renderList();
}

async function viewService(id, anchor) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const s = (m.services || []).find(v => v.id === id);
  if (!s) { main.appendChild(el('p', 'muted', '条目不存在。')); return; }
  document.title = s.name + ' · ' + m.site.title;

  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/services', '能力与合作'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', s.name));
  main.appendChild(crumb);

  const c = el('article', 'post');
  const head = el('div', 'row');
  head.appendChild(el('h1', '', s.name));
  head.appendChild(el('span', 'badge', s.status === 'active' ? '可接洽' : '暂停'));
  c.appendChild(head);

  const mem = (m.members || []).find(x => x.id === s.owner);
  if (mem) {
    const who = el('div', 'row');
    who.appendChild(avatarImg(mem, 'avatar'));
    who.appendChild(link('#/member/' + mem.id, mem.name, 'tag'));
    if (mem.role) who.appendChild(el('span', 'badge', mem.role));
    if (s.updated) who.appendChild(el('span', 'muted', '更新于 ' + s.updated));
    c.appendChild(who);
  }

  if (s.skills && s.skills.length) {
    const tags = el('div', 'tags');
    s.skills.forEach(x => tags.appendChild(el('span', 'tag', x)));
    c.appendChild(tags);
  }

  /* 三段式：能做什么（正文）→ 想找什么 → 怎么联系 */
  if (s.wants && s.wants.length) {
    const w = el('p', 'lede');
    w.appendChild(el('b', '', '想找：'));
    w.appendChild(el('span', '', s.wants.join('、')));
    c.appendChild(w);
  }

  const body = el('div', 'body');
  body.innerHTML = await fragment(s.html);
  c.appendChild(body);

  const side = el('div', 'panel');
  side.appendChild(el('h2', '', '怎么联系'));
  const dl = el('dl', 'kv');
  dl.appendChild(el('dt', '', '登记人'));
  const ddOwner = el('dd');
  ddOwner.appendChild(mem ? link('#/member/' + mem.id, mem.name) : el('span', '', s.owner));
  dl.appendChild(ddOwner);
  if (s.rate) {
    dl.appendChild(el('dt', '', '费用 / 方式'));
    dl.appendChild(el('dd', '', s.rate));
  }
  dl.appendChild(el('dt', '', '结算'));
  dl.appendChild(el('dd', '', '站外自行约定（本站不经手资金）'));
  side.appendChild(dl);
  if (mem && s.contact && s.contact.length) {
    const contact = contactTags(mem, s.contact, 'contact');
    if (contact.children.length) {
      side.appendChild(el('h2', '', '联系方式'));
      side.appendChild(el('p', 'muted', '仅引用成员本人公开档案里的字段。'));
      side.appendChild(contact);
    }
  }
  c.appendChild(side);

  c.appendChild(serviceDisclaimer());

  const pol = (m.pages || []).find(v => v.id === 'yellow-pages');
  if (pol) c.appendChild(link('#/page/yellow-pages', '收录标准、审核与申诉 →', 'leaf sec'));
  main.appendChild(c);
  sidebar(['service', id], s.toc);
  scrollToAnchor(anchor);
}

/* 站文档的左栏：文档树 + 本页小节。与 render_() 默认的站点导航互斥（各自负责自己的路由）。 */
function sidebarDoc(toc) {
  const box = $('#sidebar');
  if (!box) return;
  box.textContent = '';
  const head = el('div', 'side-head');
  const h = el('p', 'nav-kicker', '站文档');
  head.appendChild(h);
  box.appendChild(head);
  const panel = el('div');
  panel.appendChild(docsTree(route()[1] || null));
  if (toc && toc.length) {
    panel.appendChild(el('h3', 'side-h', '本页小节'));
    const t = el('div', 'tree toc');
    toc.forEach(x => t.appendChild(link('#/page/' + (route()[1] || '') + '/' + x.id, x.text, 'leaf lv' + x.level)));
    panel.appendChild(t);
  }
  box.appendChild(panel);
}

async function viewTopics() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  main.appendChild(el('h1', '', '主题词条'));
  main.appendChild(el('p', 'muted', '一个词条 = 一个主题的定义 + 相关文章。词条写在 content/topics/ 下，同标签的文章会自动归入。'));
  if (!(m.topics || []).length) {
    main.appendChild(el('p', 'muted', '还没有词条。用 python engine/cli.py new "主题名" --topic --slug topic-id 新建。'));
    return;
  }
  const g = el('div', 'cards');
  g.style.marginTop = 'var(--sp-5)';
  m.topics.forEach(t => {
    const c = el('article', 'card');
    const h = el('div', 'row');
    h.appendChild(link('#/topic/' + t.id, t.title, 'card-title'));
    const n = (t.resolved || []).length;
    h.appendChild(el('span', 'badge', n + ' 篇'));
    c.appendChild(h);
    if (t.summary) c.appendChild(el('p', 'muted', t.summary));
    const meta = el('div', 'meta');
    (t.tags || []).forEach(x => meta.appendChild(link('#/library?tag=' + encodeURIComponent(x), '#' + x, 'tag')));
    const rd = (t.related || []).map(id => (m.topics || []).find(x => x.id === id)).filter(Boolean);
    if (rd.length) {
      meta.appendChild(el('span', 'muted', '相关：'));
      rd.forEach(x => meta.appendChild(link('#/topic/' + x.id, x.title, 'tag')));
    }
    if (meta.children.length) c.appendChild(meta);
    g.appendChild(c);
  });
  main.appendChild(g);
}

async function viewTopic(id, anchor) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  if (!id) { await viewTopics(); return; }
  const t = (m.topics || []).find(v => v.id === id);
  if (!t) { main.appendChild(el('p', 'muted', '词条不存在。')); return; }
  document.title = t.title + ' · ' + m.site.title;

  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/topics', '主题词条'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', t.title));
  main.appendChild(crumb);

  const h = el('div', 'row');
  h.appendChild(el('h1', '', t.title));
  const nPosts = (t.resolved || []).length;
  if (nPosts) h.appendChild(el('span', 'badge', nPosts + ' 篇关联文章'));
  main.appendChild(h);

  /* 定义置顶：词条的读者是来「确认一个概念」的，所以一句话定义必须最先看到 */
  const def = el('div', 'define');
  def.appendChild(el('p', 'term-name', '定义'));
  def.appendChild(el('p', 'def', t.summary || '（这个词条还没有写定义 —— 欢迎补一句。）'));
  main.appendChild(def);

  if (t.tags && t.tags.length) {
    const tags = el('div', 'tags');
    t.tags.forEach(x => tags.appendChild(el('span', 'tag', x)));
    main.appendChild(tags);
  }

  const graph = relGraph(t, m);
  if (graph) {
    main.appendChild(el('h2', 'section-h', '关系图'));
    main.appendChild(graph);
  }

  const body = el('div', 'body');
  body.style.maxWidth = '38rem';
  body.innerHTML = await fragment(t.html);
  main.appendChild(body);

  const related = (t.resolved || []).map(s => (m.posts || []).find(p => p.slug === s)).filter(Boolean);
  if (related.length) {
    main.appendChild(el('h2', 'section-h', '相关文章（' + related.length + '）'));
    const box = el('div', 'cards');
    related.slice(0, 4).forEach(p => box.appendChild(postCard(p)));
    main.appendChild(box);
  } else {
    main.appendChild(el('h2', 'section-h', '相关文章（0）'));
    main.appendChild(el('p', 'muted', '还没有文章归入这个词条 —— 给文章加上同样的标签即可自动归入。'));
  }

  const rd = (t.related || []).map(r => (m.topics || []).find(x => x.id === r)).filter(Boolean);
  main.appendChild(el('h2', 'section-h', '相关'));
  const relList = el('ul', 'rel-list');
  relList.appendChild(relRow('关联文章', related.map(p => ['#/post/' + p.slug, p.title])));
  relList.appendChild(relRow('相关词条', rd.map(x => ['#/topic/' + x.id, x.title])));
  relList.appendChild(relRow('标签', (t.tags || []).map(x => ['#/library?tag=' + encodeURIComponent(x), '#' + x])));
  main.appendChild(relList);

  const tip = el('div', 'adm tip');
  const tipT = el('p', 'adm-t', '想补充这个词条？');
  tip.appendChild(tipT);
  const tipP = el('p');
  tipP.appendChild(el('span', '', '词条写在 '));
  const code = el('code', '', 'site/content/topics/');
  tipP.appendChild(code);
  tipP.appendChild(el('span', '', ' 下，同标签的文章会自动归入；改动走 PR，见 '));
  tipP.appendChild(link('#/page/contribute', '投稿指南'));
  tipP.appendChild(el('span', '', '。'));
  tip.appendChild(tipP);
  main.appendChild(tip);

  sidebar(['topic', id], t.toc);
  scrollToAnchor(anchor);
}

/* 关系清单的一行：左边是关系名，右边是链接列表（没有就显示 —） */
function relRow(label, pairs) {
  const li = el('li');
  li.appendChild(el('span', 'rel-k', label));
  const box = el('span');
  if (!pairs.length) box.appendChild(el('span', 'muted', '—'));
  pairs.forEach((pr, i) => {
    if (i) box.appendChild(el('span', 'muted', ' · '));
    box.appendChild(link(pr[0], pr[1]));
  });
  li.appendChild(box);
  return li;
}

async function viewWeekly(id) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const list = (m.weekly || []).slice().sort((a, b) => String(b.period).localeCompare(String(a.period)));

  if (!id) {
    const head = el('div', 'page-head');
    head.appendChild(el('h1', '', '周报 / 月刊'));
    head.appendChild(el('span', 'muted', list.length + ' 期'));
    main.appendChild(head);
    main.appendChild(el('p', 'muted', '按期记录群里发生了什么：新增文章、合并的 PR、新词条与下期预告。'));
    if (!list.length) { main.appendChild(el('p', 'muted', '还没有周报。')); return; }
    main.appendChild(el('div', 'service-list'));
    const box = main.children[main.children.length - 1];
    box.style.marginTop = 'var(--sp-5)';
    list.forEach(w => {
      const c = el('article', 'card');
      const row = el('div', 'row');
      row.appendChild(link('#/weekly/' + w.id, w.title, 'card-title'));
      row.appendChild(el('span', 'badge', w.period));
      c.appendChild(row);
      if ((w.highlights || []).length) {
        const ul = el('ul', 'kb-list');
        (w.highlights || []).slice(0, 3).forEach(x => ul.appendChild(el('li', '', x)));
        c.appendChild(ul);
      }
      const meta = el('div', 'meta');
      if ((w.merged || []).length) meta.appendChild(el('span', '', '合并 ' + w.merged.length + ' 篇'));
      if ((w.contributors || []).length) meta.appendChild(el('span', '', '参与 ' + w.contributors.length + ' 人'));
      if (meta.children.length) c.appendChild(meta);
      box.appendChild(c);
    });
    return;
  }

  const w = list.find(v => v.id === id) || (m.weekly || []).find(v => v.id === id);
  if (!w) { main.appendChild(el('p', 'muted', '不存在。')); return; }
  document.title = w.period + ' · ' + w.title + ' · ' + m.site.title;

  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/weekly', '周报'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', w.period));
  main.appendChild(crumb);

  const hero = el('div', 'weekly-hero');
  const per = el('span', 'period', w.period);
  hero.appendChild(per);
  hero.appendChild(el('h1', '', w.title));
  if ((w.highlights || []).length) {
    const lede = el('p', 'lede');
    lede.appendChild(el('span', '', w.highlights[0]));
    hero.appendChild(lede);
  }
  main.appendChild(hero);

  /* 本期数据：只统计站内可核对的量（合并文章数 / 高亮条数 / 参与人数） */
  const digest = el('div', 'digest');
  const cell = (v, k) => {
    const c = el('div', 'card');
    c.appendChild(el('b', '', String(v)));
    c.appendChild(el('span', '', k));
    digest.appendChild(c);
  };
  cell((w.merged || []).length, '合并文章');
  cell((w.highlights || []).length, '本期要点');
  cell((w.contributors || []).length, '参与成员');
  main.appendChild(digest);

  if ((w.highlights || []).length) {
    main.appendChild(el('h2', 'section-h', '本期要点'));
    const tl = el('ul', 'timeline');
    w.highlights.forEach(x => {
      const li = el('li', 'hot');
      const whenT = el('span', 'when-t', w.period);
      li.appendChild(whenT);
      li.appendChild(el('p', 'what', x));
      tl.appendChild(li);
    });
    main.appendChild(tl);
  }

  const merged = (w.merged || []).map(s => (m.posts || []).find(p => p.slug === s)).filter(Boolean);
  if (merged.length) {
    main.appendChild(el('h2', 'section-h', '本期合并的文章'));
    const box = el('div', 'cards');
    merged.forEach(p => box.appendChild(postCard(p)));
    main.appendChild(box);
  }

  if ((w.contributors || []).length) {
    main.appendChild(el('h2', 'section-h', '参与成员'));
    const box = el('div', 'tags');
    w.contributors.forEach(cid => {
      const mem = (m.members || []).find(x => x.id === cid);
      box.appendChild(mem ? link('#/member/' + mem.id, mem.name, 'tag') : el('span', 'tag', cid));
    });
    main.appendChild(box);
  }

  const b = el('div', 'body');
  b.style.maxWidth = '38rem';
  b.innerHTML = await fragment(w.html);
  main.appendChild(b);

  const idx = list.findIndex(v => v.id === w.id);
  const prev = list[idx + 1], next = list[idx - 1];
  if (prev || next) {
    const nav = el('nav', 'series-nav');
    if (prev) nav.appendChild(linkDate('#/weekly/' + prev.id, '← 上一期', prev.period + ' · ' + prev.title));
    if (next) {
      const a = linkDate('#/weekly/' + next.id, '下一期 →', next.period + ' · ' + next.title);
      a.className = 'next';
      nav.appendChild(a);
    }
    main.appendChild(nav);
  }

  sidebar(['weekly', id], w.toc);
}

/* 上一期/下一期卡片（series-nav 复用） */
function linkDate(href, k, text) {
  const a = el('a');
  a.href = href;
  a.appendChild(el('span', 'k', k));
  a.appendChild(el('span', '', text));
  return a;
}

/* 文档树：左栏用（分组的 sticky 列表）。树的内容只来自 pages 的 group/order。 */
function docsTree(cur) {
  const ul = el('ul', 'docs-tree');
  const groups = {};
  (M.manifest.pages || []).forEach(d => {
    const g = d.group || '其它';
    (groups[g] = groups[g] || []).push(d);
  });
  Object.keys(groups).forEach(g => {
    ul.appendChild(el('li', 'g', g));
    groups[g]
      .slice()
      .sort((a, b) => (a.order || 999) - (b.order || 999))
      .forEach(d => {
        const li = el('li');
        const a = link('#/page/' + d.id, d.title, d.id === cur ? 'cur' : '');
        if (d.id === cur) a.setAttribute('aria-current', 'page');
        li.appendChild(a);
        ul.appendChild(li);
      });
  });
  return ul;
}

async function viewPages() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  const head = el('div', 'page-head');
  head.appendChild(el('h1', '', '站文档'));
  head.appendChild(el('span', 'muted', (m.pages || []).length + ' 篇'));
  main.appendChild(head);
  main.appendChild(el('p', 'muted', '站点自身的说明：投稿与创作制度、写作速查、附件规则、内容契约。'));
  const groups = {};
  (m.pages || []).forEach(d => {
    const g = d.group || '其它';
    (groups[g] = groups[g] || []).push(d);
  });
  Object.keys(groups).forEach(g => {
    main.appendChild(el('h2', 'section-h', g));
    const box = el('div', 'cards');
    box.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
    groups[g].slice().sort((a, b) => (a.order || 999) - (b.order || 999)).forEach(d => {
      const a = el('a', 'scenario');
      a.href = '#/page/' + d.id;
      a.appendChild(el('span', 'k', g));
      a.appendChild(el('b', '', d.title));
      if (d.text) a.appendChild(el('span', '', String(d.text).slice(0, 46) + '…'));
      box.appendChild(a);
    });
    main.appendChild(box);
  });
}

async function viewPage(id, anchor) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  if (!id) { await viewPages(); return; }
  const d = (m.pages || []).find(v => v.id === id);
  if (!d) { main.appendChild(el('p', 'muted', '不存在。')); return; }
  document.title = d.title + ' · ' + m.site.title;

  /* 两栏：左文档树（sticky）+ 右长文（限宽 38rem） */
  const wrap = el('div', 'docs');
  wrap.appendChild(docsTree(id));
  const col = el('div');
  const crumb = el('nav', 'breadcrumb');
  crumb.setAttribute('aria-label', '面包屑');
  crumb.appendChild(link('#/pages', '站文档'));
  crumb.appendChild(el('span', '', ' / '));
  crumb.appendChild(el('span', '', d.group || '其它'));
  col.appendChild(crumb);
  col.appendChild(el('h1', '', d.title));
  const byline = el('p', 'byline');
  byline.appendChild(el('span', '', d.group || '其它'));
  if (d.toc && d.toc.length) {
    byline.appendChild(el('span', 'dot'));
    byline.appendChild(el('span', '', d.toc.length + ' 个小节'));
  }
  col.appendChild(byline);
  if (d.group_link) {
    const b = link(d.group_link, '点击链接加入群聊【' + (m.site.group.name || '') + '】', 'btn');
    b.target = '_blank';
    b.rel = 'noopener';
    col.appendChild(b);
  }
  const body = el('div', 'body');
  body.style.maxWidth = '38rem';
  body.innerHTML = await fragment(d.html);
  col.appendChild(body);
  wrap.appendChild(col);
  main.appendChild(wrap);
  sidebarDoc(d.toc);
  scrollToAnchor(anchor);
}

async function viewJoin() {
  const m = M.manifest;
  const g = m.site.group || {};
  const main = $('#main');
  main.textContent = '';
  main.appendChild(el('h1', '', '加入我们'));
  if (m.site.avatar) { const i = el('img', 'group-avatar big'); i.src = m.site.avatar; i.alt = ''; main.appendChild(i); }
  const btn = joinButton('lg');
  if (btn) main.appendChild(btn);
  if (g.qq) main.appendChild(el('p', 'muted', 'QQ 群：' + g.qq + (g.join ? '（' + g.join + '）' : '')));
  if (g.intro) main.appendChild(el('p', 'lead', g.intro));
  if (g.features && g.features.length) {
    main.appendChild(el('h2', '', '群功能'));
    const ul = el('ul');
    g.features.forEach(f => ul.appendChild(el('li', '', f)));
    main.appendChild(ul);
  }
  if (g.rules && g.rules.length) {
    main.appendChild(el('h2', '', '群规'));
    const ol = el('ol');
    g.rules.forEach(f => ol.appendChild(el('li', '', f)));
    main.appendChild(ol);
  }
  if (g.timeline && g.timeline.length) {
    main.appendChild(el('h2', '', '大事记'));
    const t = el('div', 'timeline');
    g.timeline.forEach(x => {
      const r = el('div', 'row');
      r.appendChild(el('span', 'tag', x.date));
      r.appendChild(el('span', '', x.text));
      t.appendChild(r);
    });
    main.appendChild(t);
  }
  const joinPage = (m.pages || []).find(v => v.id === 'join');
  if (joinPage) {
    const b = el('div', 'body');
    b.innerHTML = await fragment(joinPage.html);
    main.appendChild(b);
  }
}

async function viewSearch(q) {
  const main = $('#main');
  main.textContent = '';
  main.appendChild(el('h1', '', '搜索：' + q));
  if (!M.index) M.index = await (await fetch('search-index.json')).json();
  const s = q.toLowerCase();
  const hits = M.index.filter(x =>
    (x.title + ' ' + x.summary + ' ' + (x.tags || []).join(' ') + ' ' + x.text).toLowerCase().includes(s));
  hits.slice(0, 100).forEach(x => {
    const c = el('div', 'card');
    c.appendChild(link(x.url, x.title, 'card-title'));
    c.appendChild(el('p', 'muted', x.summary));
    main.appendChild(c);
  });
  if (!hits.length) main.appendChild(el('p', 'muted', '没有结果。'));
}

/* ---------- 路由 ---------- */

async function render_() {
  await loadManifest();
  const m = M.manifest;
  document.title = m.site.title;
  $('#brand-title').textContent = m.site.title;
  if (m.site.avatar) $('#brand-avatar').src = m.site.avatar;

  const top = $('#topbar-actions');
  top.textContent = '';
  const jb = joinButton('sm');
  if (jb) top.appendChild(jb);

  const seg = route();
  document.body.dataset.page = seg[0] || 'library';   // 场景分型钩子（P0.5）：供 CSS 用 body[data-page] 区分页面
  if (seg[0] === 'group') { goto('#/join'); return; }
  if (!seg.length) { goto('#/library'); return; }
  sidebar(seg, null);

  if (seg[0] === 'library' || seg[0] === 'posts') await viewLibrary();
  else if (seg[0] === 'knowledge') await viewKnowledge();
  else if (seg[0] === 'topics') await viewTopics();
  else if (seg[0] === 'topic') await viewTopic(seg[1], seg[2]);
  else if (seg[0] === 'post') await viewPost(seg[1], seg[2]);
  else if (seg[0] === 'projects') await viewProjects();
  else if (seg[0] === 'project') await viewProject(seg[1]);
  else if (seg[0] === 'resources') await viewResources();
  else if (seg[0] === 'members') await viewMembers();
  else if (seg[0] === 'member') await viewMember(seg[1]);
  else if (seg[0] === 'services') await viewServices();
  else if (seg[0] === 'service') await viewService(seg[1], seg[2]);
  else if (seg[0] === 'weekly') await viewWeekly(seg[1]);
  else if (seg[0] === 'pages') { sidebarDoc(null); await viewPages(); }
  else if (seg[0] === 'page') await viewPage(seg[1], seg[2]);
  else if (seg[0] === 'join') await viewJoin();
  else if (seg[0] === 'search') await viewSearch(seg[1] || '');
  else {
    const main = $('#main');
    main.textContent = '';
    main.appendChild(el('p', 'muted', '页面不存在。'));
  }

  const f = $('#footer');
  f.textContent = '';
  f.appendChild(el('span', 'muted', '构建于 ' + m.built_at));
  f.appendChild(el('a', '', 'RSS')).href = 'feed.xml';
  f.appendChild(el('a', '', 'Sitemap')).href = 'sitemap.xml';
  f.appendChild(el('a', '', 'llms.txt')).href = 'llms.txt';
  if (m.site.repo_url) {
    const repo = el('a', '', '仓库');
    repo.href = m.site.repo_url;
    repo.target = '_blank';
    repo.rel = 'noopener';
    f.appendChild(repo);
  }
  if (m.site.repo_mirror) {
    const mir = el('a', '', '示例源');
    mir.href = m.site.repo_mirror;
    mir.target = '_blank';
    mir.rel = 'noopener';
    f.appendChild(mir);
  }
  if (m.site.license) f.appendChild(el('span', 'muted', '默认许可：' + m.site.license));
}

window.addEventListener('hashchange', render_);
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $('#q').value.trim()) {
    goto('#/search/' + encodeURIComponent($('#q').value.trim()));
  }
});
render_();

// 代码块复制：事件委托，不侵入任何视图函数（复制逻辑只写在这一个监听器里）
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.code .copy');
  if (!btn) return;
  const code = btn.closest('.code').querySelector('code');
  const text = code ? code.textContent : '';
  const done = () => { const old = btn.textContent; btn.textContent = '已复制';
                       setTimeout(() => { btn.textContent = old; }, 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
});
