#!/usr/bin/env python3
"""构建器产物收集与主题壳装配（2026-10-21 自 build.py 拆出）。

  · Out —— 先记账最后一齐落盘的产物收集器（热构建的核心）；
  · _localize_assets / check_external_images / resource_index —— 图片与资源入口；
  · inject_head / inject_shell —— 把站点信息注入静态壳 index.html。

与 build_pages 的循环依赖用「模块级 import、调用期取属性」解开：
resource_index 要 build_pages.docs_in/load2，build_pages.build_post_file 要这里的
_localize_assets —— 两边都只在函数体内访问对方属性，导入顺序无关。
"""

import re
import shutil
from pathlib import Path

import imgcheck
import render
import sml
import urls

import build_pages
from build_common import esc
from build_paths import CONTENT, ROOT, THEME

# 页脚授权分层声明（三行，原文见 docs/TECH-MUTUAL-AID.md §2）：
# 文章/词条/知识库的许可、成员档案信息的归属与边界、本站不背书。
# 由 inject_shell 注入 index.html 的 <footer id="footer">（JS 只重画链接，不动这三个 span），
# 并进 site_text() 让字体子集收齐这些字。
LICENSE_NOTICE = (
    '<span id="license-notice">本站文章、词条与知识库内容默认采用 CC BY-NC-SA 4.0，禁止商业性使用。</span>\n'
    '        <span id="license-notice-members">成员档案页的自我介绍、照片与能力信息由成员本人提供，'
    '版权归成员本人，本站经授权展示；这些信息仅用于技术协作联系，未经本人同意，'
    '不得用于商业招揽、打包售卖或对外培训。购买成员的服务，不等于获得其在本站发表内容的商业授权。</span>\n'
    '        <span id="license-notice-site">本站只做技术互助展示，不参与交易撮合、资金托管与交付担保，'
    '不对合作结果背书。</span>\n')
FOOTER_TAG = '<footer class="footer" id="footer"></footer>'


class Out:
    """产物收集器：先记账，最后一齐落盘。

    为什么不是「先清空再全写」：Windows 上仓库目录（Desktop 等）里的文件
    删除/写入会被 Defender 实时扫描，152 个产物「删 + 写」实测 20s+；
    而读内容比对只要 0.1s。所以热构建的形态是：
      · put_text(rel, text) —— 内容与 dist 里现有文件相同就跳过写；
      · put_copy(src, rel) —— (size, mtime_ns) 与 dist 里现有文件相同就跳过复制；
      · flush() —— 删掉 dist 里不在本次清单中的文件（孤儿，如上版本的旧文章），
        逐项删除并容忍失败（预览服务可能持有句柄）。

    确定性不受影响：产物清单完全由输入决定，同一提交两次构建逐字节一致
    （built_at 除外 —— 它本来就不该进内容签名，见 site_text）。
    """

    def __init__(self, root):
        self.root = Path(root)
        self.texts = {}      # rel -> text
        self.copies = {}     # rel -> 源文件 Path
        self.wrote = 0
        self.skipped = 0
        self.removed = 0

    def put_text(self, rel, text):
        self.texts[rel] = text

    def put_copy(self, src, rel):
        self.copies[rel] = Path(src)

    def put_copy_dir(self, src_dir, rel_dir, exclude=()):
        """整目录复制（assets/posts/<slug>、theme/…）：逐文件登记，跳过未变的。

        exclude 里的相对路径不登记（如主题的 index.html —— 它走 put_text 的
        注入后版本，复制原始件会把它盖回去）。
        """
        src_dir = Path(src_dir)
        if not src_dir.is_dir():
            return
        prefix = rel_dir.strip("/")
        skip = set(exclude)
        for f in sorted(src_dir.rglob("*")):
            if f.is_file():
                rel = f.relative_to(src_dir).as_posix()
                if rel in skip:
                    continue
                self.put_copy(f, prefix + "/" + rel if prefix else rel)

    def flush(self):
        keep = set(self.texts) | set(self.copies)
        if self.root.exists():
            for p in sorted(self.root.rglob("*"), key=lambda x: len(str(x)), reverse=True):
                rel = p.relative_to(self.root).as_posix()
                try:
                    if p.is_file() or p.is_symlink():
                        if rel not in keep:
                            p.unlink()
                            self.removed += 1
                    elif p.is_dir() and not any(p.iterdir()):
                        p.rmdir()
                except OSError:
                    pass
        for rel, text in self.texts.items():
            dst = self.root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                if dst.read_text(encoding="utf-8") == text:
                    self.skipped += 1
                    continue
            except (OSError, UnicodeDecodeError):
                pass
            dst.write_text(text, encoding="utf-8")
            self.wrote += 1
        for rel, src in self.copies.items():
            dst = self.root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                a, b = src.stat(), dst.stat()
                if a.st_size == b.st_size and a.st_mtime_ns == b.st_mtime_ns:
                    self.skipped += 1
                    continue
            except OSError:
                pass
            try:
                shutil.copy2(src, dst)
                self.wrote += 1
            except OSError:
                pass


def _localize_assets(html_body, slug, post_dir):
    """把正文里的本地图片引用 `assets/...` 改写到 `assets/posts/<slug>/...`。

    只认 `<img src="assets/` 属性，**不做全局字符串替换**：代码块里演示
    「怎么引用图片」的示例（esc 后是 `src=&quot;assets/...&quot;`）既不会
    被误改写，也不会触发「图片不存在」误报。以前是
    `html_body.replace('src="assets/', ...)`，靠「全文都已转义」这个隐不变式
    兜底；这里把不变式变成显式契约，回归测试见 test_render_safety.py [11]。

    返回 (改写后的 html, 不存在的引用列表)。
    """
    missing = []
    for m in re.finditer(r'<img src="(assets/[^"]+)"', html_body):
        if not (post_dir / m.group(1)).exists():
            missing.append(m.group(1))
    fixed = html_body.replace('<img src="assets/', '<img src="assets/posts/%s/' % slug)
    return fixed, missing


def check_external_images(rep):
    """外链图片一律构建失败。

    站点运行时零外部请求：正文里的 `<img src="https://…">` 会让读者的浏览器直连
    语雀 / GitHub raw 之类的 CDN —— 图床一挂文章就裂，也不受白名单保护。
    本地图片才有版本、才有离线副本。注意本地路径缺失由 _localize_assets 报，
    这里只拦外链，两类错误互不遮掩。

    扫源码而不是产物：要给投稿者 文件:行号。Markdown 代码块里的教学示例已被
    imgcheck 的围栏识别排除；SML 字符串里的示例只可能是本地路径，外链在任何
    位置都不该出现，所以照报。
    """
    found = 0
    for root in (CONTENT, THEME):
        for f in sorted(root.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in (".md", ".sml", ".html", ".css", ".js"):
                continue
            try:
                text = f.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                rep.err(f.relative_to(ROOT).as_posix(), "读不出内容（%s）：%s" % (type(e).__name__, e))
                continue
            for line, ref, _origin in imgcheck.text_refs(f.name, text):
                if imgcheck.is_external(ref):
                    found += 1
                    rep.err(f.relative_to(ROOT).as_posix() + ":%d" % line,
                            "正文图片不许外链（运行时零外部请求）：%s；"
                            "请下载到本篇 assets/ 后用相对路径引用" % ref)
    return found


def resource_index():
    idx = {}
    for f in build_pages.docs_in(CONTENT / "resources"):
        try:
            d, _cs = build_pages.load2(f)
        except Exception:                       # noqa: BLE001 单篇读不动不该拖垮整站
            continue
        idx[f.stem] = {
            "title": sml.as_str(d.get("title")) or f.stem,
            "url": urls.safe_url(sml.as_str(d.get("url"))),
            "code": sml.as_str(d.get("code", "")),
            "kind": sml.as_str(d.get("kind", "")),
            "folder": sml.as_str(d.get("folder", "")),
        }
    return idx


MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif"}


def inject_head(rep, manifest, avatar, fonts_css, html):
    """把标题/描述/favicon（群 logo）注入静态壳；返回 (html, icon)。

    favicon 与 site.webmanifest 不在这里落盘：favicon 由调用方 put_copy
    （源是仓库根的群头像），webmanifest 走 put_text —— 统一由 Out 决定跳过与否。
    """
    site = manifest["site"]
    icon = ""
    if avatar:
        icon = "favicon" + Path(avatar).suffix.lower()
    lines = ['<meta name="description" content="%s">' % render.esc(site.get("tagline", "")),
             '<meta name="theme-color" content="#b4552d">',
             '<meta property="og:title" content="%s">' % render.esc(site["title"]),
             '<meta property="og:description" content="%s">' % render.esc(site.get("tagline", "")),
             '<meta property="og:type" content="website">',
             '<meta property="og:url" content="%s">' % render.esc(site["url"])]
    if fonts_css:
        lines.append('<link rel="stylesheet" href="%s">' % fonts_css)
    if icon:
        lines += ['<link rel="icon" href="%s">' % icon,
                  '<link rel="apple-touch-icon" href="%s">' % icon,
                  '<link rel="manifest" href="site.webmanifest">']
        lines.append('<meta property="og:image" content="%s/%s">' % (
            render.esc(site["url"].rstrip("/")), icon))
    html = html.replace("<!--BUILD:HEAD-->", "\n".join(lines))
    html = html.replace("<title>Rust嵌入式探讨</title>", "<title>%s</title>" % render.esc(site["title"]))
    return html, icon


NAV_LABEL = {
    "library": "文章库", "knowledge": "文章知识", "topics": "主题词条", "projects": "项目",
    "resources": "资源", "members": "成员", "services": "技术互助", "weekly": "周报",
    "pages": "站文档", "join": "加入我们",
}


def inject_shell(rep, manifest, posts):
    """把「站点导航 + 最近文章」的静态 HTML 注入主题壳，返回 index.html 文本。

    渐进增强：JS 起来前页面已经有站名、10 个站点入口与最近文章列表（不是空白）；
    JS 起来后接管 #view / #site-nav（补当前项高亮）。右栏导航同时以静态形式存在，
    结构断言可以直接对 dist/index.html 断言，不依赖 JS。

    不再读写 dist 里的 index.html：直接读主题源文件、返回文本，由 Out 统一落盘。
    """
    src = THEME / "index.html"
    if not src.exists():
        rep.warn("index.html", "主题缺少 index.html")
        return ""
    html = src.read_text(encoding="utf-8")
    site = manifest["site"]
    nav = site.get("nav") or []
    nav_html = "\n".join('        <a href="#/%s">%s</a>' % (esc(k), esc(NAV_LABEL.get(k, k)))
                         for k in nav)
    NAV_DESC = {
        "library": "按年份浏览全部文章", "knowledge": "系列 / 标签 / 作者索引",
        "topics": "主题词条与关系图", "projects": "仓库元数据与活跃度比较",
        "resources": "书 / 教程 / 工具 / 视频", "members": "成员档案与作品",
        "services": "技术互助", "weekly": "周报 / 月刊",
        "pages": "制度与写作文档", "join": "加入 QQ 群",
    }
    NAV_ICON = {
        "library": "M3 5h18M3 10h18M3 15h12",
        "knowledge": "M4 3h9l3 3v13H4zM8 9h5M8 12h5M8 15h3",
        "topics": "M3 5h7v6H3zM10 5h7v6h-7zM3 11h7v6H3zM10 11h7v6h-7z",
        "projects": "M3 6h6l2 2h7v9H3z",
        "resources": "M4 4h7v13H4zM13 4h7v13h-7z",
        "members": "M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 18c0-3 3-5 6-5s6 2 6 5M16 8h6M19 5v6",
        "services": "M3 7h18v11H3zM3 11h18M9 7v11",
        "weekly": "M4 5h16v15H4zM8 3v4M16 3v4M4 10h16",
        "pages": "M5 3h9l4 4v14H5zM14 3v5h5",
        "join": "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6M17 9v6M14 12h6",
    }
    counts = {
        "library": len(manifest.get("posts") or []),
        "topics": len(manifest.get("topics") or []),
        "projects": len(manifest.get("projects") or []),
        "resources": len(manifest.get("resources") or []),
        "members": len(manifest.get("members") or []),
        "services": len(manifest.get("services") or []),
        "weekly": len(manifest.get("weekly") or []),
        "pages": len(manifest.get("pages") or []),
    }
    avatar = site.get("avatar") or ""
    first = ['<section class="home-hero">\n']
    if avatar:
        first.append('  <img class="home-logo" src="%s" alt="" width="56" height="56">\n' % esc(avatar))
    first.append('  <h1 class="home-title">%s</h1>\n' % esc(site.get("title", "")))
    first.append('  <p class="home-tagline">%s</p>\n' % esc(site.get("tagline", "")))
    first.append('  <form class="home-search" role="search" action="#/search/">\n'
                 '    <input class="home-input" type="search" name="q" '
                 'placeholder="全站搜索：文章 / 项目 / 成员 / 资源（回车）" aria-label="全站搜索">\n'
                 '    <button class="home-btn" type="submit">搜索</button>\n'
                 '  </form>\n</section>\n')
    first.append('<div class="nav-cards">\n')
    for k in nav:
        if k not in NAV_ICON:
            continue
        c = counts.get(k)
        first.append(
            '  <a class="nav-card" href="#/%s">'
            '<svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true">'
            '<path d="%s" fill="none" stroke="currentColor" stroke-width="1.6" '
            'stroke-linecap="round"/></svg>'
            '<b>%s</b><span>%s</span>%s</a>\n'
            % (esc(k), NAV_ICON[k], esc(NAV_LABEL.get(k, k)), esc(NAV_DESC.get(k, "")),
               ('<em>%d 项</em>' % c) if c is not None else ""))
    first.append('</div>\n')
    first.append('<p class="section-h">最近更新</p>\n<ol class="rows">\n')
    n = 0
    for p in posts[:3]:
        first.append('  <li class="row">\n'
                     '    <span class="row-date">%s</span>\n'
                     '    <a class="row-title" href="#/post/%s">%s</a>\n'
                     '    <span class="row-words">%d 字</span>\n'
                     '  </li>\n'
                     % (esc(str(p["date"])[:10]), esc(p["slug"]), esc(p["title"]), p["words"]))
        n += 1
    first.append('</ol>\n')
    if not n:
        first.append('<p class="muted">还没有文章。</p>\n')

    html = html.replace("<!--BUILD:NAV-->", nav_html)
    html = html.replace("<!--BUILD:FIRST-->", "".join(first))
    # 页脚授权分层声明（三行）：静态注入，JS 起来后也保留（js/core.js 的 buildFooter 不清它）
    if FOOTER_TAG in html:
        html = html.replace(FOOTER_TAG,
                            '<footer class="footer" id="footer">\n        ' + LICENSE_NOTICE
                            + '</footer>')
    else:
        rep.warn("index.html", "页脚占位没找到（主题的 footer 结构变了？），授权声明未注入")
    html = re.sub(r'(<span id="brand-title">)[^<]*(</span>)',
                  lambda m: m.group(1) + esc(site.get("title", "")) + m.group(2), html)
    if "<!--BUILD:NAV-->" in html or "<!--BUILD:FIRST-->" in html:
        rep.warn("index.html", "静态首屏/导航占位没被替换（主题缺少占位注释）")
    return html
