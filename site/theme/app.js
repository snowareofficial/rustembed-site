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

function projectCard(p) {
  const c = el('article', 'card');
  const head = el('div', 'row');
  head.appendChild(el('strong', '', p.name));
  if (p.status) head.appendChild(el('span', 'badge', p.status));
  c.appendChild(head);
  c.appendChild(el('p', 'muted', p.one_liner));
  const meta = el('div', 'meta');
  if (p.repo) meta.appendChild(link(p.repo, '仓库', 'tag'));
  if (p.meta) {
    if (p.meta.stars != null) meta.appendChild(el('span', '', '★ ' + p.meta.stars));
    if (p.meta.forks != null) meta.appendChild(el('span', '', '⑂ ' + p.meta.forks));
    if (p.meta.language) meta.appendChild(el('span', '', p.meta.language));
    if (p.meta.updated_at) meta.appendChild(el('span', '', '更新 ' + String(p.meta.updated_at).slice(0, 10) + (p.meta.stale ? '（缓存）' : '')));
    if (p.meta.license) meta.appendChild(el('span', '', p.meta.license));
  }
  if (p.meta && p.meta.archived) meta.appendChild(el('span', 'badge', '已归档'));
  if (p.owner) {
    const mem = M.manifest.members.find(x => x.id === p.owner);
    meta.appendChild(mem ? link('#/member/' + mem.id, mem.name) : el('span', '', p.owner));
  }
  c.appendChild(meta);
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

function serviceCard(s) {
  const m = M.manifest;
  const c = el('article', 'card');
  const h = el('div', 'row');
  h.appendChild(link('#/service/' + s.id, s.name, 'card-title'));
  h.appendChild(el('span', 'badge', s.status === 'active' ? '可接洽' : '暂停'));
  c.appendChild(h);
  const mem = m.members.find(x => x.id === s.owner);
  const meta = el('div', 'meta');
  meta.appendChild(mem ? link('#/member/' + mem.id, mem.name) : el('span', '', s.owner));
  if (s.updated) meta.appendChild(el('span', '', '更新 ' + s.updated));
  if (s.rate) meta.appendChild(el('span', '', s.rate));
  c.appendChild(meta);
  if (s.skills && s.skills.length) {
    const st = el('div', 'tags');
    s.skills.forEach(k => st.appendChild(el('span', 'tag', k)));
    c.appendChild(st);
  }
  if (s.wants && s.wants.length) c.appendChild(el('p', 'muted', '想找：' + s.wants.join('、')));
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
  art.appendChild(el('h1', '', p.title));
  art.appendChild(metaLine(p));
  if (p.topics && p.topics.length) {
    const tp = el('div', 'tags');
    p.topics.forEach(id => {
      const t = (m.topics || []).find(x => x.id === id);
      tp.appendChild(link('#/topic/' + id, '词条：' + (t ? t.title : id), 'tag'));
    });
    art.appendChild(tp);
  }
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
  if (p.license) art.appendChild(el('p', 'muted', '许可：' + p.license));
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
  art.appendChild(el('p', 'muted', '讨论请回到 QQ 群。'));
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
  main.appendChild(el('p', 'muted', '仓库元数据（stars / forks / 语言 / 最近更新）由构建期自动抓取，支持 GitHub、Gitee、Codeberg 与自建 Gitea。'));
  const g = el('div', 'cards');
  m.projects.forEach(p => g.appendChild(projectCard(p)));
  main.appendChild(g);
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
  q.oninput = () => { state.memberQ = q.value; renderList(); };
  main.appendChild(q);

  const g = el('div', 'cards');
  main.appendChild(g);

  function renderList() {
    g.textContent = '';
    const s = (state.memberQ || '').trim().toLowerCase();
    const list = m.members.filter(x => !s
      || x.name.toLowerCase().includes(s)
      || (x.signature || '').toLowerCase().includes(s)
      || (x.skills || []).join(' ').toLowerCase().includes(s));
    list.forEach(x => {
      const c = el('article', 'card member');
      const h = el('div', 'row');
      h.appendChild(avatarImg(x, 'avatar'));
      h.appendChild(link('#/member/' + x.id, x.name, 'card-title'));
      if (x.role) h.appendChild(el('span', 'badge', x.role));
      c.appendChild(h);
      if (x.signature) c.appendChild(el('p', 'muted', x.signature));
      if (x.skills && x.skills.length) {
        const st = el('div', 'tags');
        x.skills.forEach(k => st.appendChild(el('span', 'tag', k)));
        c.appendChild(st);
      }
      const meta = el('div', 'meta');
      const np = m.posts.filter(p => p.author === x.id || p.co_authors.includes(x.id)).length;
      const npr = m.projects.filter(p => p.owner === x.id || p.contributors.includes(x.id)).length;
      if (np) meta.appendChild(el('span', '', '文章 ' + np));
      if (npr) meta.appendChild(el('span', '', '项目 ' + npr));
      if (x.joined) meta.appendChild(el('span', '', '加入 ' + x.joined));
      Object.keys(x.links || {}).forEach(k => {
        const a = link(x.links[k], CONTACT_LABEL[k] || k, 'tag');
        a.target = '_blank';
        a.rel = 'noopener';
        meta.appendChild(a);
      });
      c.appendChild(meta);
      c.appendChild(link('#/member/' + x.id, '查看个人主页 →', 'leaf sec'));
      g.appendChild(c);
    });
    if (!list.length) g.appendChild(el('p', 'muted', '没有匹配的成员。'));
  }
  renderList();
}

async function viewMember(id) {
  const m = M.manifest;
  const x = m.members.find(v => v.id === id);
  const main = $('#main');
  main.textContent = '';
  if (!x) { main.appendChild(el('p', 'muted', '成员不存在。')); return; }
  document.title = x.name + ' · ' + m.site.title;
  const c = el('article', 'post');
  const head = el('div', 'row');
  head.appendChild(avatarImg(x, 'avatar big'));
  head.appendChild(el('h1', '', x.name));
  if (x.role) head.appendChild(el('span', 'badge', x.role));
  c.appendChild(head);
  if (x.signature) c.appendChild(el('p', 'lead', x.signature));
  const links = el('div', 'tags');
  Object.keys(x.links || {}).forEach(k => {
    const a = link(x.links[k], CONTACT_LABEL[k] || k, 'tag');
    if (k !== 'email') { a.target = '_blank'; a.rel = 'noopener'; }
    links.appendChild(a);
  });
  c.appendChild(links);
  if (x.joined) c.appendChild(el('p', 'muted', '加入时间：' + x.joined));

  const posts = m.posts.filter(p => p.author === id || p.co_authors.includes(id));
  if (posts.length) {
    c.appendChild(el('h2', '', '文章'));
    posts.forEach(p => c.appendChild(link('#/post/' + p.slug, p.title + '（' + p.date + '）', 'tag')));
  }
  const projs = m.projects.filter(p => p.owner === id || p.contributors.includes(id));
  if (projs.length) {
    c.appendChild(el('h2', '', '参与项目'));
    projs.forEach(p => c.appendChild(link(p.repo || '#/projects', p.name, 'tag')));
  }
  main.appendChild(c);
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

  const g = el('div', 'cards');
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
  main.appendChild(el('p', 'muted', '能力与合作 / 黄页'));
  const c = el('article', 'post');
  const head = el('div', 'row');
  head.appendChild(el('h1', '', s.name));
  head.appendChild(el('span', 'badge', s.status === 'active' ? '可接洽' : '暂停'));
  c.appendChild(head);

  const mem = m.members.find(x => x.id === s.owner);
  if (mem) {
    const who = el('div', 'row');
    who.appendChild(avatarImg(mem, 'avatar'));
    who.appendChild(link('#/member/' + mem.id, mem.name, 'tag'));
    if (mem.role) who.appendChild(el('span', 'badge', mem.role));
    c.appendChild(who);
  }

  const tags = el('div', 'tags');
  (s.skills || []).forEach(x => tags.appendChild(el('span', 'tag', x)));
  c.appendChild(tags);
  if (s.wants && s.wants.length) c.appendChild(el('p', 'lead', '想找：' + s.wants.join('、')));
  if (s.rate) c.appendChild(el('p', 'muted', '费用 / 方式：' + s.rate));

  if (mem && s.contact && s.contact.length) {
    const box = el('div', 'tags');
    s.contact.forEach(k => {
      const url = (mem.links || {})[k];
      if (!url) return;
      const a = link(url, CONTACT_LABEL[k] || k, 'tag');
      if (k !== 'email') { a.target = '_blank'; a.rel = 'noopener'; }
      box.appendChild(a);
    });
    if (box.childNodes.length) {
      c.appendChild(el('h2', '', '联系方式（成员本人公开档案里的字段）'));
      c.appendChild(box);
    }
  }
  if (s.updated) c.appendChild(el('p', 'muted', '更新于 ' + s.updated));

  const body = el('div', 'body');
  body.innerHTML = await fragment(s.html);
  c.appendChild(body);

  const pol = (m.pages || []).find(v => v.id === 'yellow-pages');
  if (pol) c.appendChild(link('#/page/yellow-pages', '收录标准、审核与申诉 →', 'leaf sec'));
  main.appendChild(c);
  sidebar(['service', id], s.toc);
  scrollToAnchor(anchor);
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
  m.topics.forEach(t => {
    const c = el('article', 'card');
    c.appendChild(link('#/topic/' + t.id, t.title, 'card-title'));
    c.appendChild(el('p', 'muted', t.summary));
    (t.resolved || []).slice(0, 5).forEach(s => {
      const p = m.posts.find(x => x.slug === s);
      if (p) c.appendChild(link('#/post/' + p.slug, p.title, 'leaf'));
    });
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
  main.appendChild(el('p', 'muted', '文章知识 / 主题词条'));
  main.appendChild(el('h1', '', t.title));
  if (t.summary) main.appendChild(el('p', 'lead', t.summary));
  const tags = el('div', 'tags');
  (t.tags || []).forEach(x => tags.appendChild(el('span', 'tag', x)));
  main.appendChild(tags);

  const body = el('div', 'body');
  body.innerHTML = await fragment(t.html);
  main.appendChild(body);

  const related = (t.resolved || []).map(s => m.posts.find(p => p.slug === s)).filter(Boolean);
  if (related.length) {
    main.appendChild(el('h2', '', '相关文章（' + related.length + '）'));
    related.forEach(p => main.appendChild(postCard(p)));
  }
  const rd = (t.related || []).map(r => (m.topics || []).find(x => x.id === r)).filter(Boolean);
  if (rd.length) {
    main.appendChild(el('h2', '', '相关词条'));
    const box = el('div', 'tags');
    rd.forEach(x => box.appendChild(link('#/topic/' + x.id, x.title, 'tag')));
    main.appendChild(box);
  }
  sidebar(['topic', id], t.toc);
  scrollToAnchor(anchor);
}

async function viewWeekly(id) {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  if (!id) {
    main.appendChild(el('h1', '', '周报 / 月刊'));
    m.weekly.forEach(w => main.appendChild(link('#/weekly/' + w.id, w.period + ' · ' + w.title, 'tag')));
    return;
  }
  const w = m.weekly.find(v => v.id === id);
  if (!w) { main.appendChild(el('p', 'muted', '不存在。')); return; }
  main.appendChild(el('h1', '', w.period + ' · ' + w.title));
  const b = el('div', 'body');
  b.innerHTML = await fragment(w.html);
  main.appendChild(b);
  sidebar(['weekly', id], w.toc);
}

async function viewPages() {
  const m = M.manifest;
  const main = $('#main');
  main.textContent = '';
  main.appendChild(el('h1', '', '站文档'));
  main.appendChild(el('p', 'muted', '站点自身的说明：投稿与创作制度、写作速查、附件规则、内容契约、部署方案。'));
  const groups = {};
  (m.pages || []).forEach(d => {
    const g = d.group || '其它';
    (groups[g] = groups[g] || []).push(d);
  });
  Object.keys(groups).forEach(g => {
    main.appendChild(el('h2', '', g));
    const box = el('div', 'tree docs-tree');
    groups[g].forEach(d => box.appendChild(link('#/page/' + d.id, d.title, 'leaf sec')));
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
  main.appendChild(el('p', 'muted', '站文档 / ' + (d.group || '')));
  main.appendChild(el('h1', '', d.title));
  if (d.group_link) {
    const b = link(d.group_link, '点击链接加入群聊【' + (m.site.group.name || '') + '】', 'btn');
    b.target = '_blank';
    b.rel = 'noopener';
    main.appendChild(b);
  }
  const b = el('div', 'body');
  b.innerHTML = await fragment(d.html);
  main.appendChild(b);
  sidebar(['page', id], d.toc);
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
  else if (seg[0] === 'resources') await viewResources();
  else if (seg[0] === 'members') await viewMembers();
  else if (seg[0] === 'member') await viewMember(seg[1]);
  else if (seg[0] === 'services') await viewServices();
  else if (seg[0] === 'service') await viewService(seg[1], seg[2]);
  else if (seg[0] === 'weekly') await viewWeekly(seg[1]);
  else if (seg[0] === 'pages') await viewPages();
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
