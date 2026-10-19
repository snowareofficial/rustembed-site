#!/usr/bin/env python3
"""rec-blog 构建器：.sml → manifest.json + 预渲染 HTML 片段 + 静态站点产物。

用法：
    python engine/build.py              # 完整构建
    python engine/build.py --offline    # 不联网，只用仓库元数据缓存
    python engine/build.py --warn-only  # 校验问题只告警，不中断构建
"""

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import urls  # noqa: E402  (依赖上一行把 engine/lib 放进 sys.path)

# fontTools 作为仓库组件 vendored 在 engine/vendor（不依赖 pip 安装）
VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
if VENDOR_DIR.is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

import config
import sml
import render
import markdown as md
import repo_meta
import mindmap
import summary
import contract as contract_mod

try:  # 中文输出统一走 UTF-8，避免被控制台代码页搞成乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

DOC_EXT = (".sml", ".md", ".markdown")

ROOT = config.SITE                   # 站点根（内容 + 主题 + 元数据缓存）
CONTENT = config.CONTENT             # 人写的内容都在这
THEME = config.THEME                 # 前端壳（静态资源）
OUT = config.OUT                     # 构建产物（仓库根 dist/）
CACHE = config.CACHE                 # 仓库元数据缓存

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
MAX_IMAGE = 2 * 1024 * 1024
MAX_IMAGES_PER_POST = 20

REQ = {
    "post": ["title", "author", "date", "tags", "summary"],
    "project": ["name", "one_liner", "repo", "status"],
    "member": ["name"],
    "resource": ["title", "kind", "url"],
    "weekly": ["period", "title"],
    "service": ["name", "owner", "skills", "contact", "status", "updated"],
    "doc": ["title"],
    "site": ["title"],
}

# 技术互助条目固定尾部：性质声明 + 免责声明。纯展示，不交易、不担保、不抽成、
# 不经手资金、不介入纠纷；条目由 owner 本人提供并自负其责，本站不背书。
SERVICE_DISCLAIMER = (
    '<aside class="admonition warn"><p><strong>免责声明</strong>：本站只展示这条信息：'
    '不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。'
    '本条互助信息由成员本人提供并自负其责，不代表本站对任何个人或服务的认可或背书；'
    '是否协作、如何协作，请自行判断并在站外约定。'
    '联系方式仅引用成员档案中本人授权公开的字段，本站不代收任何新联系方式。'
    '条目内容按站点默认许可 CC BY-NC-SA 4.0（非商业）发布。</p></aside>\n')

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


def now_iso():
    """构建时间。CI 里用 BUILT_AT 注入提交时间，保证同一提交重复构建产物一致。"""
    forced = os.environ.get("BUILT_AT", "").strip()
    if forced:
        return forced
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_out(out):
    """清空产物目录。不用 shutil.rmtree：某些环境会拦截它做「安全删除」，
    且预览服务可能持有文件句柄；逐项删除并容忍失败（后续写入会覆盖）。"""
    if not out.exists():
        out.mkdir(parents=True)
        return
    for p in sorted(out.rglob("*"), key=lambda x: len(str(x)), reverse=True):
        try:
            if p.is_file() or p.is_symlink():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
        except OSError:
            pass


def _under(parent, child):
    """child 是否等于 parent，或位于 parent 之下（两侧都会 resolve）。"""
    a = str(Path(parent).resolve()).rstrip("\\/")
    b = str(Path(child).resolve()).rstrip("\\/")
    if b == a:
        return True
    return any(b.startswith(a + s) for s in ("/", "\\"))


def guard_out(out):
    """拒绝把产物目录指到会毁掉源码的位置 —— clean_out() 会递归清空目标目录。

    放行：仓库外的目录；仓库内的 <repo>/dist 及其子目录。
    拒绝：仓库根、站点目录，以及它们的**上级**（--out . 或 --out 上级目录
          会连整个工作区一起删）；仓库内除 dist/ 外的任何位置（如 --out engine）。
    """
    out = Path(out).resolve()
    repo = Path(config.REPO).resolve()
    site = Path(config.SITE).resolve()
    dist = Path(config.OUT).resolve()
    for label, p in (("仓库根", repo), ("站点目录", site)):
        if _under(out, p):
            raise SystemExit(
                "[E-OUT-001] --out 指向%s（%s）或其上级：%s\n"
                "           构建会先递归清空该目录，请改用仓库外的目录。" % (label, p, out))
    if _under(repo, out) and not _under(dist, out):
        raise SystemExit(
            "[E-OUT-002] --out 落在仓库内但不是 dist/ 之下：%s\n"
            "           构建会先递归清空该目录（源码会丢），请改到仓库外或 %s 之下。"
            % (out, dist))
    return out


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def err(self, where, msg):
        self.errors.append("%s: %s" % (where, msg))

    def warn(self, where, msg):
        self.warnings.append("%s: %s" % (where, msg))


def check_req(rep, kind, where, data):
    for k in REQ.get(kind, []):
        if data.get(k) in (None, "", []):
            rep.err(where, "缺少必填字段 `%s`" % k)


def _strip_bom(text):
    """去掉 UTF-8 BOM：native 后端容忍、builtin 后端不容忍，必须统一。"""
    return text[1:] if text.startswith("\ufeff") else text


def load(path):
    """按扩展名分发：.sml 走 SML 解析器，.md/.markdown 取 front matter（正文放 __md_body）。"""
    if path.suffix.lower() in (".md", ".markdown"):
        meta, body = md.split_front_matter(path.read_text(encoding="utf-8"))
        meta["__md_body"] = body
        return meta
    return sml.load(path)


SKIP_NAMES = {"readme", "architecture", "changelog", "license", "contributing", "handoff", "todo"}


GLOBAL_CONTRACTS = {}
CONTRACT_DEFAULTS = {}
CONTRACT_LOOSE = False


def load2(f):
    """读内容文件：返回 (数据, 文件内契约表)。

    `.sml` 走文件入口：native 展开 include，root = CONTENT（site/content）——
    跨目录（如 resources/ → contracts/）也能包含，越界则拒。
    """
    if f.suffix.lower() in (".md", ".markdown"):
        meta, body = md.split_front_matter(f.read_text(encoding="utf-8"))
        meta["__md_body"] = body
        return meta, {}
    return sml.load_doc(str(f), root=str(CONTENT))


def register_contracts(rep, where, cs):
    """登记契约。同名**且字段一致**时静默跳过 —— 多份内容 include 同一份契约盒
    必然产生重复登记，那不是问题；只有同名但字段不同才值得告警。"""
    for name, spec in (cs or {}).items():
        old = GLOBAL_CONTRACTS.get(name)
        if old is not None:
            if old == spec:
                continue
            rep.warn(where, "契约 `%s` 重复定义且字段不一致，以先定义的为准" % name)
            continue
        GLOBAL_CONTRACTS[name] = spec


def apply_contract(rep, where, d, kind):
    """按文件里的 @is 或 site.sml 的默认映射校验字段，报错带错误码 + 人话。
    返回是否真正套用了契约（套用了就不再跑内置必填校验，免得同一问题报两遍）。"""
    cname = d.get("__is") or CONTRACT_DEFAULTS.get(kind)
    if not cname:
        return False
    if cname not in GLOBAL_CONTRACTS:
        rep.err(where, "E-CONTRACT-001 未定义的契约 `%s`（已定义：%s）"
                % (cname, ", ".join(sorted(GLOBAL_CONTRACTS)) or "无"))
        return True
    for code, text in contract_mod.validate(d, cname, GLOBAL_CONTRACTS, loose=CONTRACT_LOOSE):
        rep.err(where, "%s %s" % (code, text))
    return True


def docs_in(directory, pattern="*"):
    """列出内容文件（可按扩展名区分 SML/Markdown），跳过项目自身文档（README 等）与下划线开头。"""
    if not directory.exists():
        return []
    out = []
    for p in sorted(directory.glob(pattern)):
        if not p.is_file() or p.suffix.lower() not in DOC_EXT:
            continue
        if p.name.startswith("_") or p.stem.lower() in SKIP_NAMES:
            continue
        out.append(p)
    return out


def render_body(d, ctx, level=1, rep=None, where=""):
    """SML body / Markdown body 统一出口，返回 (html, toc)。

    渲染期产生的告警（如 gallery 子块形状非法）收集在 ctx.warnings，
    若传入 rep/where 则登记进构建报告；仅告警、不阻断构建。
    """
    body = d.get("__md_body")
    if body is not None:
        html, toc = md.render(body, ctx, level)
    else:
        html = render.render(pick(d, ["body", "children"], []), ctx, level)
        toc = ctx.toc
    if rep is not None and where:
        for w in getattr(ctx, "warnings", []):
            rep.warn(where, w)
        ctx.warnings = []
    return html, toc


def as_list(v):
    return sml.as_list(v)


def pick(d, keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return default


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


def resource_index():
    """resources/ 的 id → 关键字段，给 Attachment.resource 解析用（构建期，不落 manifest）。"""
    idx = {}
    for f in docs_in(CONTENT / "resources"):
        try:
            d, _cs = load2(f)
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


def build_post_file(rep, f, year, slug, lang, res_index):
    """渲染单篇文章的某个语言版本，返回该版本的字段字典（不含 lang 键，避免污染 manifest）。

    默认语言 zh 的出口（html 路径、字段、正文 HTML）与旧构建完全一致，保证单语言零回归。
    """
    rel = f.relative_to(ROOT).as_posix()
    d, cs = load2(f)
    where = rel
    register_contracts(rep, where, cs)
    checked = apply_contract(rep, where, d, "post")
    if d.get("draft") is True:
        print("  - 跳过草稿 %s (%s)" % (slug, lang))
        return None
    if not checked:
        check_req(rep, "post", where, d)
    author = sml.as_str(d.get("author")).strip()
    date = sml.as_str(d.get("date")).strip()
    ctx = render.Ctx()
    video_html = render.video_embed(sml.as_str(d.get("video", "")))
    html_body, toc = render_body(d, ctx, 1, rep, where)
    if video_html:
        html_body = video_html + html_body
    html_body, missing_imgs = _localize_assets(html_body, slug, f.parent)
    for rel in missing_imgs:
        rep.err(where, "正文引用的本地图片不存在：%s" % rel)
    text = render.strip_html(html_body)

    toc_nodes = [dict(x, anchor="#/post/%s/%s" % (slug, x["id"])) for x in toc]
    # 导图可选：front matter 写 map: true 才生成（默认关闭，正文更轻）
    want_map = bool(d.get("map"))
    map_svg = ""
    if want_map:
        map_svg = mindmap.to_svg(
            mindmap.from_toc(sml.as_str(d.get("title")), toc_nodes, number=True),
            sml.as_str(d.get("title")))

    atts = []
    for a in as_list(d.get("attachments")):
        if not isinstance(a, dict):
            rep.warn(where, "附件项不是块，已忽略")
            continue
        name = sml.as_str(pick(a, ["name", "title"], ""))
        url = sml.as_str(pick(a, ["url", "href", "src"], ""))
        kind = sml.as_str(pick(a, ["kind", "type"], "link")).lower()
        size = sml.as_str(a.get("size", ""))
        code = sml.as_str(a.get("code", ""))
        if kind in ("image", "img", "png", "jpg", "jpeg", "webp", "gif", "svg"):
            kind = "image"
        # 引用资源 id：构建期按 id 解析 url / 标题 / 提取码，资源改了附件就跟着变。
        # 解析不到直接报错，不静默——否则线上会出现没有链接的附件卡。
        res_id = sml.as_str(a.get("resource", ""))
        if res_id:
            r = res_index.get(res_id)
            if not r:
                rep.err(where, "附件引用了不存在的资源 id `%s`（已收录：%s）"
                        % (res_id, ", ".join(sorted(res_index)) or "无"))
                continue
            url = url or r["url"]
            name = name or r["title"]
            code = code or r["code"]
            if not urls.safe_url(url):
                rep.err(where, "附件引用的资源 `%s` 链接不在协议白名单内：%s" % (res_id, r["url"]))
                continue
        if not name or not url:
            rep.err(where, "附件缺少 name 或 url（可用 resource 引用资源 id）")
            continue
        if kind == "image":
            p = f.parent / url
            if not p.exists():
                rep.err(where, "附件图片不存在：%s" % url)
                continue
            if p.suffix.lower() not in IMAGE_EXT:
                rep.err(where, "附件图片类型不允许：%s" % p.suffix)
                continue
            if p.stat().st_size > MAX_IMAGE:
                rep.err(where, "附件图片超过 %d MB：%s" % (MAX_IMAGE // 1024 // 1024, url))
                continue
            size = size or "%.0f KB" % (p.stat().st_size / 1024)
            url = "assets/posts/%s/%s" % (slug, url)
        else:
            if not url.startswith(("http://", "https://")):
                rep.err(where, "非图片附件必须是 http(s) 外链：%s" % url)
                continue
        atts.append({"name": name, "kind": kind, "url": url, "size": size, "code": code})

    imgs = 0
    for p in sorted((f.parent / "assets").glob("*")) if (f.parent / "assets").exists() else []:
        if p.suffix.lower() in IMAGE_EXT:
            imgs += 1
            if p.stat().st_size > MAX_IMAGE:
                rep.err(where, "assets/ 内图片超过 %d MB：%s" % (MAX_IMAGE // 1024 // 1024, p.name))
    if imgs > MAX_IMAGES_PER_POST:
        rep.err(where, "assets/ 图片数量超过 %d" % MAX_IMAGES_PER_POST)

    series = d.get("series")
    series_id = None
    series_title = ""
    order = None
    if isinstance(series, dict):
        series_id = sml.as_str(series.get("id")) or None
        series_title = sml.as_str(series.get("title", ""))
        order = series.get("order")
    elif isinstance(series, str):
        series_id = series

    lang_suffix = (".%s" % lang) if lang != "zh" else ""
    return {
        "slug": slug,
        "year": year,
        "title": sml.as_str(d.get("title")),
        "author": author,
        "co_authors": [sml.as_str(x) for x in as_list(d.get("co_authors"))],
        "date": date,
        "updated": sml.as_str(pick(d, ["updated"], date)),
        "tags": [sml.as_str(x) for x in as_list(d.get("tags"))],
        "summary": sml.as_str(d.get("summary")),
        "license": sml.as_str(pick(d, ["license"], "")),
        "series": series_id,
        "series_title": series_title,
        "order": order,
        "video": sml.as_str(d.get("video", "")),
        "attachments": atts,
        "toc": toc,
        "words": len(text),
        "file": rel,
        "html": "p/%s%s.html" % (slug, lang_suffix),
        "map": ("p/%s.map.svg" % slug) if want_map else "",
        "_html": html_body,
        "_text": text,
        "_map": map_svg,
    }


_POST_NAME = re.compile(r"^index(?:\.([a-z]{2}))?\.(md|sml|markdown)$")
_LANGS = ("zh", "en")


def build_posts(rep, cache, offline):
    """文章支持多语言（phase 1：仅 posts，白名单 zh/en）。

    同一目录的 index.(md|sml)=zh、index.<lang>.(md|sml)=对应语言，按 (year, slug) 分组，
    每个语言版本独立走现有 load2/契约/渲染/TOC/字数，不共享正文。默认语言 zh 的产物路径 /
    字段 / HTML 与旧构建完全一致（单语言文章零回归：manifest 不加 langs、html 不变）。
    """
    posts = []
    res_index = resource_index()
    groups = {}  # (year, slug) -> {lang: file}
    for f in docs_in(CONTENT / "posts", "*/*/index.*"):
        rel = f.relative_to(ROOT).as_posix()
        # 安全：posts 内容不得是符号链接（可能被用来逃逸站点目录）
        if f.is_symlink():
            rep.err(rel, "posts 内容不得是符号链接（可能逃逸站点目录）：%s" % f.name)
            continue
        m = _POST_NAME.match(f.name)
        if not m:
            continue
        lang = m.group(1) or "zh"
        if lang not in _LANGS:
            rep.err(rel, "不支持的语言 `%s`（仅允许 zh / en）：%s" % (lang, f.name))
            continue
        year = f.parent.parent.name
        slug = f.parent.name
        key = (year, slug)
        g = groups.setdefault(key, {})
        if lang in g:
            rep.err(rel, "同一篇文章重复了语言 `%s`：已有 %s"
                    % (lang, g[lang].relative_to(ROOT).as_posix()))
            continue
        g[lang] = f
    for (year, slug), files in groups.items():
        variants = {}
        for lang, f in files.items():
            v = build_post_file(rep, f, year, slug, lang, res_index)
            if v is not None:
                variants[lang] = v
        if not variants:
            continue
        # 默认语言固定 zh（若存在），否则取字典序第一个；顶层字段取默认语言版本
        default_lang = "zh" if "zh" in variants else sorted(variants)[0]
        entry = variants[default_lang]
        # 仅「多语言」或「默认语言非 zh」才加 langs / default_lang；
        # 单语言 zh 保持旧 manifest 形状，确保旧产物零变化。
        if len(variants) > 1 or default_lang != "zh":
            entry["default_lang"] = default_lang
            langs = {}
            for lang, v in variants.items():
                langs[lang] = {
                    "html": v["html"],
                    "title": v["title"],
                    "summary": v["summary"],
                    "tags": v["tags"],
                    "words": v["words"],
                }
            entry["langs"] = langs
            # 非默认语言的产物待写盘（_ 前缀，不进 manifest）
            entry["_variants"] = {lang: {"html": v["html"], "body": v["_html"]}
                                  for lang, v in variants.items() if lang != default_lang}
        posts.append(entry)
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)

    summaries_dir = CONTENT / "summaries"
    for p in posts:
        p["ai_summary"] = summary.build(p, summaries_dir)
    return posts


def build_projects(rep, cache, offline):
    out = []
    for f in docs_in(CONTENT / "projects"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        register_contracts(rep, where, cs)
        if not apply_contract(rep, where, d, "project"):
            check_req(rep, "project", where, d)
        pid = f.stem
        repo_url = urls.safe_url(sml.as_str(d.get("repo")))
        if sml.as_str(d.get("repo")) and not repo_url:
            rep.warn(where, "repo 不在协议白名单内，已忽略：%s" % d.get("repo"))
        homepage = urls.safe_url(sml.as_str(d.get("homepage", "")))
        if sml.as_str(d.get("homepage", "")) and not homepage:
            rep.warn(where, "homepage 不在协议白名单内，已忽略")
        item = {
            "id": pid,
            "name": sml.as_str(d.get("name")),
            "one_liner": sml.as_str(d.get("one_liner")),
            "repo": repo_url,
            "homepage": homepage,
            "languages": [sml.as_str(x) for x in as_list(d.get("languages"))],
            "platforms": [sml.as_str(x) for x in as_list(d.get("platforms"))],
            "status": sml.as_str(d.get("status")),
            "license": sml.as_str(d.get("license", "")),
            "owner": sml.as_str(d.get("owner", "")),
            "contributors": [sml.as_str(x) for x in as_list(d.get("contributors"))],
            "featured": d.get("featured") is True,
            "meta": None,
        }
        source = sml.as_str(d.get("meta_source", "auto")).lower()
        override = d.get("meta_override") if isinstance(d.get("meta_override"), dict) else {}
        if source != "manual" and repo_url:
            item["meta"] = cache.get(repo_url, offline=offline)
        if item["meta"] and override:
            item["meta"].update({k: sml.as_str(v) for k, v in override.items()})
        elif override:
            item["meta"] = dict(item["meta"] or {}, **{k: sml.as_str(v) for k, v in override.items()})
        # 里程碑：写了才透传（前端「有数据才画时间线」，空字段不进 manifest）
        ms = d.get("milestones")
        if isinstance(ms, list):
            ms = [{"date": sml.as_str(x.get("date", "")),
                   "text": sml.as_str(x.get("text", "")),
                   "why": sml.as_str(x.get("why", ""))}
                  for x in ms if isinstance(x, dict)]
            if ms:
                item["milestones"] = ms
        out.append(item)
    out.sort(key=lambda p: (not p["featured"], p["name"]))
    return out


AVATAR_EXT = (".jpg", ".jpeg", ".png", ".webp")


def find_avatar(mid):
    """没写 avatar 字段时的自动发现：content/members/<id>.* → content/avatars/<id>.* → 站点根 <id>.*"""
    for d in (CONTENT / "members", CONTENT / "avatars", ROOT):
        for ext in AVATAR_EXT:
            p = d / (mid + ext)
            if p.exists():
                return p
    return None


AVATAR_CACHE = ROOT / "meta" / "avatars"   # 构建期下载的远端头像缓存（不入库）


def fetch_remote_avatar(rep, url, mid):
    """把远端头像下载到本地缓存，返回 Path；失败返回 None。

    站点运行时零外部请求：GitHub/Gitee 头像都在构建期本地化，
    不依赖访问者能连上 githubusercontent.com。
    """
    AVATAR_CACHE.mkdir(parents=True, exist_ok=True)
    for ext in AVATAR_EXT:
        p = AVATAR_CACHE / (mid + ext)
        if p.exists() and p.stat().st_size > 0:
            return p
    req = urllib.request.Request(url, headers={"User-Agent": "rec-blog-builder"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read(2 * 1024 * 1024 + 1)
            ctype = (r.headers.get("Content-Type") or "").lower()
    except Exception as e:  # noqa: BLE001
        rep.warn("avatar", "%s 下载失败（%s），改用占位图" % (mid, e))
        return None
    if len(data) > 2 * 1024 * 1024:
        rep.warn("avatar", "%s 超过 2 MB，已忽略" % mid)
        return None
    ext = ".jpg"
    for cand in AVATAR_EXT:
        if cand in ctype:
            ext = cand
            break
    else:
        m = re.search(r"\.(jpe?g|png|webp)(?:$|[?#])", url, re.I)
        if m:
            ext = "." + m.group(1).lower().replace("jpeg", "jpg")
    p = AVATAR_CACHE / (mid + ext)
    p.write_bytes(data)
    return p


def build_members(rep):
    out = []
    for f in docs_in(CONTENT / "members"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        register_contracts(rep, where, cs)
        if not apply_contract(rep, where, d, "member"):
            check_req(rep, "member", where, d)
        links = d.get("links") if isinstance(d.get("links"), dict) else {}
        av = sml.as_str(d.get("avatar", ""))
        avatar = ""
        src = None
        if av.startswith(("http://", "https://")):
            # 远端头像：构建期下载到本地缓存，运行时不再直连（零外部请求）
            src = fetch_remote_avatar(rep, av, f.stem)
        else:
            if av:
                p = ROOT / av
                if p.exists():
                    src = p
                else:
                    rep.warn(where, "avatar 指向的文件不存在：%s" % av)
            if src is None:
                src = find_avatar(f.stem)
        if src is not None:
            avatar = "assets/members/%s%s" % (f.stem, src.suffix.lower())
        out.append({
            "id": f.stem,
            "name": sml.as_str(pick(d, ["name"], f.stem)),
            "avatar": avatar,
            "_avatar_src": str(src) if src else "",
            "signature": sml.as_str(d.get("signature", "")),
            "role": sml.as_str(d.get("role", "群友")),
            "skills": [sml.as_str(x) for x in as_list(d.get("skills"))],
            "links": {k: safe for k, v in links.items()
                      if not k.startswith("__") and (safe := urls.safe_url(sml.as_str(v)))},
            "joined": sml.as_str(d.get("joined", "")),
            "file": where,
        })
    return out


def build_topics(rep):
    """主题词条：一个词条聚合多篇文章 + 定义。"""
    out = []
    for f in docs_in(CONTENT / "topics"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        register_contracts(rep, where, cs)
        if not apply_contract(rep, where, d, "topic"):
            check_req(rep, "topic", where, d)
        ctx = render.Ctx()
        html_body, toc = render_body(d, ctx, 1, rep, where)
        out.append({
            "id": f.stem,
            "title": sml.as_str(d.get("title")),
            "summary": sml.as_str(d.get("summary", "")),
            "tags": [sml.as_str(x) for x in as_list(d.get("tags"))],
            "posts": [sml.as_str(x) for x in as_list(d.get("posts"))],
            "related": [sml.as_str(x) for x in as_list(d.get("related"))],
            "html": "topics/%s.html" % f.stem,
            "map": "topics/%s.map.svg" % f.stem,
            "toc": toc,
            "text": render.strip_html(html_body),
            "file": where,
            "_html": html_body,
        })
    return out


def build_services(rep, members):
    """技术互助：成员自愿登记的纯展示条目。

    不变量（与 check.py 对齐）：每条必须有 owner 且 owner 必须是已建档成员；
    contact 只能引用该成员 links 里已公开的字段，不新收集个人信息。
    """
    by_id = {m["id"]: m for m in members}
    out = []
    for f in docs_in(CONTENT / "services"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        register_contracts(rep, where, cs)
        if not apply_contract(rep, where, d, "service"):
            check_req(rep, "service", where, d)
        ctx = render.Ctx()
        html_body, toc = render_body(d, ctx, 1, rep, where)
        owner = sml.as_str(d.get("owner", "")).strip()
        mem = by_id.get(owner)
        if not owner:
            rep.err(where, "缺少必填字段 `owner`（成员 id）")
        elif mem is None:
            rep.err(where, "owner `%s` 没有成员档案（应为 content/members/%s.sml）" % (owner, owner))
        contact = [sml.as_str(x).strip() for x in as_list(d.get("contact"))]
        contact = [c for c in contact if c]
        if not contact:
            rep.err(where, "缺少必填字段 `contact`（成员公开联系方式）")
        elif mem is not None:
            public = sorted(mem["links"])
            bad = [c for c in contact if c not in mem["links"]]
            if bad:
                rep.err(where, "contact 引用了未公开的联系方式 `%s`（成员 %s 的 links 只有：%s）"
                        % (" ".join(bad), owner, " ".join(public) or "无"))
        out.append({
            "id": f.stem,
            "name": sml.as_str(d.get("name")),
            "owner": owner,
            "skills": [sml.as_str(x) for x in as_list(d.get("skills"))],
            "wants": [sml.as_str(x) for x in as_list(d.get("wants"))],
            "contact": contact,
            "rate": sml.as_str(d.get("rate", "")),
            "status": sml.as_str(d.get("status", "active")),
            "updated": sml.as_str(d.get("updated", "")),
            "html": "services/%s.html" % f.stem,
            "map": "services/%s.map.svg" % f.stem,
            "toc": toc,
            "text": render.strip_html(html_body),
            "file": where,
            "_html": html_body + SERVICE_DISCLAIMER,
        })
    out.sort(key=lambda s: (s["status"] == "paused", s["name"]))
    return out


def build_simple(kind, rep, cache=None, offline=False):
    out = []
    for f in docs_in(CONTENT / kind):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        register_contracts(rep, where, cs)
        if not apply_contract(rep, where, d, {"resources": "resource", "pages": "page"}.get(kind, kind)):
            check_req(rep, kind.rstrip("s"), where, d)
        base = {
            "id": f.stem,
            "title": sml.as_str(d.get("title")),
            "file": where,
        }
        if kind == "resources":
            raw_url = sml.as_str(d.get("url"))
            url = urls.safe_url(raw_url)
            if raw_url and not url:
                rep.warn(where, "资源 url 不在协议白名单内，已跳过：%s" % raw_url)
                continue
            kindv = sml.as_str(d.get("kind", "")).lower()
            meta = None
            if cache is not None and kindv in ("tool", "repo", "framework") and repo_meta.detect(url)[0]:
                meta = cache.get(url, offline=offline)
            base.update({
                "kind": sml.as_str(d.get("kind")),
                "url": url,
                "tags": [sml.as_str(x) for x in as_list(d.get("tags"))],
                "note": sml.as_str(d.get("note", "")),
                "folder": sml.as_str(d.get("folder", "")),   # 只用于展示分组，不建真实目录
                "code": sml.as_str(d.get("code", "")),       # 提取码：列表与附件卡「复制」
                "meta": meta,
            })
        if kind == "weekly":
            ctx = render.Ctx()
            base.update({
                "period": sml.as_str(d.get("period")),
                "highlights": [sml.as_str(x) for x in as_list(d.get("highlights"))],
                "merged": [sml.as_str(x) for x in as_list(d.get("merged"))],
                "contributors": [sml.as_str(x) for x in as_list(d.get("contributors"))],
                "html": "w/%s.html" % f.stem,
            })
            out.append((base, d, ctx, f))
            continue
        if kind == "pages":
            ctx = render.Ctx()
            base.update({
                "html": "pages/%s.html" % f.stem,
                "group": sml.as_str(d.get("group", "其它")),
                "order": d.get("order") if isinstance(d.get("order"), int) else 999,
                "group_link": urls.safe_url(sml.as_str(d.get("group_link", ""))),
            })
            out.append((base, d, ctx, f))
            continue
        out.append(base)
    return out


def build_contract_page():
    """从契约表自动生成文档页：代码即文档。"""
    if not GLOBAL_CONTRACTS:
        return None
    esc = render.esc
    html = ['<p class="muted">本页由 <code>content/contracts/*.sml</code> 自动生成 —— 改契约即改这里。'
            '错误码见 docs/ARCHITECTURE.md。</p>\n']
    toc = []
    nodes = []
    for c in contract_mod.describe(GLOBAL_CONTRACTS):
        ident = "contract-" + c["name"]
        toc.append({"id": ident, "text": c["name"], "level": 2})
        # ident 来自契约名（自由文本，可含引号与尖括号），拼进属性前必须转义；
        # 否则可以闭合 id 属性注入 <img onerror> 之类，经 app.js 的 innerHTML 执行。
        html.append('<h2 id="%s">%s%s</h2>\n' % (esc(ident), esc(c["name"]), "（loose）" if c["loose"] else ""))
        html.append("<table>\n<thead><tr><th>字段</th><th>类型</th><th>必填</th><th>约束</th><th>说明</th></tr></thead>\n<tbody>\n")
        kids = []
        for f in c["fields"]:
            html.append("<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>\n"
                        % (esc(f["name"]), esc(f["type"]), "是" if f["required"] else "否",
                           esc(f["constraint"]), esc(f["doc"])))
            kids.append({"label": f["name"], "children": []})
        html.append("</tbody>\n</table>\n")
        nodes.append({"label": c["name"], "href": "#/page/contracts/" + ident, "children": kids})
    body = "".join(html)
    return {
        "id": "contracts",
        "title": "内容契约（自动生成）",
        "group": "规范",
        "order": 2,
        "html": "pages/contracts.html",
        "map": "pages/contracts.map.svg",
        "toc": toc,
        "text": render.strip_html(body),
        "generated": True,
        "_html": body,
        "_map": mindmap.to_svg({"label": "内容契约", "href": "#/page/contracts", "children": nodes},
                               "内容契约"),
    }


MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif"}

FONT_EXT = (".ttf", ".otf", ".woff2", ".woff")
FONT_WEIGHT = {"thin": 100, "extralight": 200, "light": 300, "regular": 400, "normal": 400,
               "book": 400, "medium": 500, "semibold": 600, "demibold": 600, "bold": 700,
               "extrabold": 800, "black": 900, "heavy": 900}


def font_dirs():
    """字体可以放 theme/fonts/ 或 site/fonts/。"""
    return [d for d in (THEME / "fonts", ROOT / "fonts") if d.is_dir()]


def site_text(manifest, bodies=()):
    """站点里出现过的所有文字，用于字体子集化（宁可多收，不要漏字）。

    注意：manifest 里**不含文章正文**（正文以 _ 前缀被过滤），前端 JS/CSS 里的中文也不在里面，
    所以这里把正文渲染结果与 theme 源文件一起收进来，否则正文生僻字会回退到系统字体、段内字体混排。
    """
    parts = [json.dumps(manifest, ensure_ascii=False)]
    # 正文是渲染后的 HTML：MathML/转义出口的数字实体（如 &#x02202; = ∂）是 ASCII 字面，
    # 先 unescape 再子集化，否则数学字形（∂ ∑ ∫ √ 等）不进 STIX 子集、页面回退系统字体。
    parts += [html.unescape(b) for b in bodies if b]
    for f in sorted(THEME.glob("*")):
        if f.suffix.lower() in (".js", ".css", ".html"):
            parts.append(f.read_text(encoding="utf-8", errors="replace"))
    # 页脚授权声明由构建期注入 index.html，不在 theme 源文件里，这里显式补上
    parts.append(LICENSE_NOTICE)
    return "".join(parts)


def font_family_weight(stem):
    low = stem.lower()
    if "stix" in low:
        family = "STIX Two Math"
    elif "xits" in low:
        family = "XITS Math"
    elif "misans" in low:
        family = "MiSans"
    else:
        family = re.split(r"[-_.]", stem)[0]
    weight = 400
    tail = re.split(r"[-_]", low)[-1]
    for key, val in FONT_WEIGHT.items():
        if tail == key or key in low:
            weight = val
            break
    return family, weight


def build_fonts(rep, out, manifest, bodies=()):
    """自托管字体：源字体 → 子集（woff2，缺 brotli 时退化为 woff）。

    设计：子集产物（site/fonts/subset/）**提交进仓库**，CI 不需要装 fonttools；
    本地放 `site/fonts/src/*.ttf` 时自动（重新）生成子集。字体许可文件随产物一起发布。
    许可证提醒：MiSans 等可免费商用/网页嵌入，但不得单独售卖字体文件本身。
    """
    roots = [d for d in (ROOT / "fonts", THEME / "fonts") if d.is_dir()]
    if not roots:
        return ""
    root = roots[0]
    subset_dir = root / "subset"
    srcs = [p for p in list(root.glob("*")) + list((root / "src").glob("*"))
            if p.suffix.lower() in FONT_EXT]
    existing = sorted(subset_dir.glob("*.woff2")) + sorted(subset_dir.glob("*.woff")) \
        if subset_dir.is_dir() else []

    made = []
    if srcs:
        try:
            from fontTools import subset as ftsubset
        except ImportError:
            rep.warn("fonts", "有源字体但缺 fonttools，改用已有子集（如无则不加载自定义字体）。"
                              "装法：pip install fonttools")
        else:
            flavor = "woff2"
            try:
                import brotli  # noqa: F401
            except ImportError:
                flavor = "woff"
                rep.warn("fonts", "fontTools 已子集化；缺 brotli 压缩后端，输出 woff（浏览器支持；需要 woff2 时安装 brotli）")
            text = site_text(manifest, bodies)
            subset_dir.mkdir(parents=True, exist_ok=True)
            stamp = subset_dir / ".stamp.json"
            sig = hashlib.sha1(text.encode("utf-8")).hexdigest()
            old_sig = ""
            if stamp.exists():
                try:
                    old_sig = json.loads(stamp.read_text(encoding="utf-8")).get("sig", "")
                except ValueError:
                    old_sig = ""
            fresh = sig == old_sig      # 站点文字没变、源字体也没更新时才复用现有子集
            for f in srcs:
                name = re.sub(r"[^a-z0-9]+", "-", f.stem.lower()).strip("-") + "." + flavor
                dst = subset_dir / name
                if fresh and dst.exists() and dst.stat().st_mtime >= f.stat().st_mtime:
                    made.append(dst)
                    continue
                try:
                    ftsubset.main([str(f), "--text=%s" % text, "--flavor=%s" % flavor,
                                   "--output-file=%s" % dst,
                                   "--layout-features=kern",
                                   "--no-hinting", "--desubroutinize",
                                   "--name-IDs=1,2"])
                except BaseException as e:  # noqa: BLE001
                    rep.warn("fonts", "子集化失败 %s：%s" % (f.name, e))
                    continue
                if dst.exists():
                    made.append(dst)
                else:
                    rep.warn("fonts", "子集化未产出文件：%s" % f.name)
            if made and not fresh:
                stamp.write_text(json.dumps({"sig": sig, "files": [p.name for p in made]},
                                            ensure_ascii=False, indent=1), encoding="utf-8")

    if not srcs and not existing:
        rep.warn("fonts", "没有 site/fonts/src 也没有子集：本次不生成字体（"
                          "分发构建器时应随包带 MiSans 源字体）")
    use = made or existing
    if not use:
        return ""

    (out / "fonts").mkdir(parents=True, exist_ok=True)
    for p in use:
        shutil.copy2(p, out / "fonts" / p.name)
    for lic in sorted(root.glob("LICENSE*")):
        shutil.copy2(lic, out / "fonts" / lic.name)

    faces = []
    for p in use:
        family, weight = font_family_weight(p.stem)
        faces.append((family, weight, p.name, p.stat().st_size))
    css = ["/* 由构建生成：字体子集（自托管，无第三方请求）。字体许可见 fonts/LICENSE-* */"]
    for family, weight, name, _size in faces:
        fmt = "woff2" if name.endswith(".woff2") else "woff"
        css.append("@font-face{font-family:'%s';font-style:normal;font-weight:%d;"
                   "font-display:swap;src:url('fonts/%s') format('%s')}"
                   % (family, weight, name, fmt))
    (out / "fonts.css").write_text("\n".join(css) + "\n", encoding="utf-8")
    total = sum(x[3] for x in faces) / 1024
    print("   字体子集 %d 个，共 %.0f KB（%s）"
          % (len(faces), total, ", ".join(sorted({x[0] for x in faces}))))
    return "fonts.css"


def inject_head(rep, out, manifest, avatar, fonts_css=""):
    """把标题/描述/favicon（群 logo）注入静态壳，并生成 webmanifest。"""
    idx = out / "index.html"
    if not idx.exists():
        return
    site = manifest["site"]
    icon = ""
    if avatar:
        suffix = Path(avatar).suffix.lower()
        icon = "favicon" + suffix
        try:
            shutil.copy2(out / avatar, out / icon)
        except OSError:
            icon = avatar
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
    html = idx.read_text(encoding="utf-8").replace("<!--BUILD:HEAD-->", "\n".join(lines))
    html = html.replace("<title>Rust嵌入式探讨</title>", "<title>%s</title>" % render.esc(site["title"]))
    idx.write_text(html, encoding="utf-8")

    if icon:
        mani = {"name": site["title"], "short_name": site["title"][:12], "start_url": "./",
                "display": "standalone", "background_color": "#fbfaf7", "theme_color": "#b4552d",
                "icons": [{"src": icon, "sizes": "any",
                           "type": MIME.get(Path(icon).suffix.lower(), "image/jpeg")}]}
        (out / "site.webmanifest").write_text(json.dumps(mani, ensure_ascii=False, indent=1),
                                              encoding="utf-8")


NAV_LABEL = {
    "library": "文章库", "knowledge": "文章知识", "topics": "主题词条", "projects": "项目",
    "resources": "资源", "members": "成员", "services": "技术互助", "weekly": "周报",
    "pages": "站文档", "join": "加入我们",
}


def inject_shell(rep, out, manifest, posts):
    """把「站点导航 + 最近文章」的静态 HTML 写进 index.html。

    渐进增强：JS 起来前页面已经有站名、10 个站点入口与最近文章列表（不是空白）；
    JS 起来后接管 #view / #site-nav（补当前项高亮）。右栏导航同时以静态形式存在，
    结构断言可以直接对 dist/index.html 断言，不依赖 JS。
    """
    idx = out / "index.html"
    if not idx.exists():
        return
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

    html = idx.read_text(encoding="utf-8")
    html = html.replace("<!--BUILD:NAV-->", nav_html)
    html = html.replace("<!--BUILD:FIRST-->", "".join(first))
    # 页脚授权分层声明（三行）：静态注入，JS 起来后也保留（app.js 的 buildFooter 不清它）
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
    idx.write_text(html, encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--warn-only", action="store_true")
    ap.add_argument("--base-url", default="", help="覆盖 site.sml 里的站点 URL（多域名/预览用）")
    ap.add_argument("--contract-loose", action="store_true",
                    help="放宽 E-CONTRACT-004（未声明字段）——临时允许契约外的字段")
    config.add_site_arg(ap)
    args = ap.parse_args(argv)
    try:
        return _run(args)
    except sml.SmlError as e:
        # 投稿文件里的语法笔误（坏 \u 转义、未闭合串/块、片段引用成环…）
        # 必须人话退出：SmlError 的消息本就带 path:line，直接透出即可，
        # 不许把 ValueError / RecursionError 的 traceback 甩给投稿者。
        print("\n[E-SML-001] SML 解析失败：%s" % e)
        print("           按上面的 文件:行号 改内容文件；字段类问题另有 E-CONTRACT-* 提示。")
        return 1


def _run(args):
    out = guard_out(args.out)
    rep = Report()

    print("== rec-blog build ==")
    site_path = CONTENT / "site.sml"
    site = load(site_path) if site_path.exists() else {}
    if not site:
        rep.err("site.sml", "缺失或为空")
    check_req(rep, "site", "site.sml", site)
    group = site.get("group") if isinstance(site.get("group"), dict) else {}

    avatar = None
    for cand in ("group.jpg", "group.jpeg"):
        if (ROOT / cand).exists():
            avatar = cand
            break
    if avatar is None:
        for p in sorted(ROOT.glob("*.jpg")) + sorted(ROOT.glob("*.jpeg")):
            avatar = p.name
            break
    if avatar is None:
        rep.warn("根目录", "未找到群头像 group.jpg")

    global CONTRACT_LOOSE
    CONTRACT_LOOSE = args.contract_loose
    CONTRACT_DEFAULTS.clear()
    CONTRACT_DEFAULTS.update({k: sml.as_str(v) for k, v in (site.get("contracts") or {}).items()
                              if sml.as_str(v)})
    print("-- 站点：%s" % ROOT)
    print("-- 契约")
    for f in docs_in(CONTENT / "contracts"):
        _, cs = load2(f)
        register_contracts(rep, f.relative_to(ROOT).as_posix(), cs)
    print("   %d 个契约，默认映射 %d 项" % (len(GLOBAL_CONTRACTS), len(CONTRACT_DEFAULTS)))

    cache = repo_meta.Cache(CACHE)
    print("-- 文章")
    posts = build_posts(rep, cache, args.offline)
    print("   %d 篇" % len(posts))
    print("-- 项目")
    projects = build_projects(rep, cache, args.offline)
    print("   %d 个" % len(projects))
    print("-- 成员")
    members = build_members(rep)
    print("   %d 人" % len(members))
    print("-- 主题词条")
    topics = build_topics(rep)
    print("   %d 条" % len(topics))
    print("-- 技术互助")
    services = build_services(rep, members)
    print("   %d 条" % len(services))
    print("-- 资源 / 周报 / 文档页")
    resources = build_simple("resources", rep, cache, args.offline)
    weekly_raw = build_simple("weekly", rep)
    pages_raw = build_simple("pages", rep)
    weekly = [w[0] for w in weekly_raw]
    pages = sorted([w[0] for w in pages_raw], key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))
    print("   %d 个文档页" % len(pages))

    ids = {m["id"] for m in members}
    for p in posts:
        if p["author"] and p["author"] not in ids:
            rep.warn(p["file"], "作者 `%s` 没有成员档案" % p["author"])
    for pr in projects:
        for who in [pr["owner"]] + pr["contributors"]:
            if who and who not in ids:
                rep.warn("projects/%s.sml" % pr["id"], "成员 `%s` 没有成员档案" % who)

    # 词条 ↔ 文章双向关联：词条显式列 posts，或按同标签自动收
    posts_by_slug = {p["slug"]: p for p in posts}
    for t in topics:
        ids = [s for s in t["posts"] if s in posts_by_slug]
        for p in posts:
            if p["slug"] not in ids and any(tag in p["tags"] for tag in t["tags"]):
                ids.append(p["slug"])
        t["resolved"] = ids
        for s in ids:
            posts_by_slug[s].setdefault("topics", []).append(t["id"])
    for t in topics:
        missing = [s for s in t["posts"] if s not in posts_by_slug]
        for s in missing:
            rep.warn(t["file"], "词条引用了不存在的文章 slug `%s`" % s)

    series_map = {}
    for p in posts:
        if p["series"]:
            series_map.setdefault(p["series"], []).append(p)
    series = []
    for sid, group_posts in series_map.items():
        items = sorted(group_posts, key=lambda p: (p["order"] if isinstance(p["order"], int) else 999, p["date"]))
        title = next((p["series_title"] for p in items if p["series_title"]), sid)
        series.append({
            "id": sid,
            "title": title,
            "posts": [{"slug": p["slug"], "title": p["title"], "order": p["order"]} for p in items],
        })

    tag_count = {}
    for p in posts:
        for t in p["tags"]:
            tag_count[t] = tag_count.get(t, 0) + 1
    tags = sorted([{"tag": k, "count": v} for k, v in tag_count.items()], key=lambda x: (-x["count"], x["tag"]))

    clean_out(out)
    (out / "p").mkdir(parents=True, exist_ok=True)
    for p in posts:
        (out / p["html"]).write_text(p["_html"] or "<p>（空）</p>", encoding="utf-8")
        if p.get("map"):
            (out / p["map"]).write_text(p["_map"], encoding="utf-8")
        # 文章多语言：非默认语言版本单独写盘（如 p/<slug>.en.html），assets 共享
        for v in (p.get("_variants") or {}).values():
            (out / v["html"]).write_text(v["body"] or "<p>（空）</p>", encoding="utf-8")
    for base, d, ctx, f in weekly_raw + pages_raw:
        where = f.relative_to(ROOT).as_posix()
        html_body, toc = render_body(d, ctx, 1, rep, where)
        (out / base["html"]).parent.mkdir(parents=True, exist_ok=True)
        (out / base["html"]).write_text(html_body or "<p>（空）</p>", encoding="utf-8")
        base["toc"] = toc
        base["text"] = render.strip_html(html_body)
        kind = "w" if f.parent.name == "weekly" else "pages"
        base["map"] = "%s/%s.map.svg" % (kind, f.stem)
        prefix = "#/weekly/" if kind == "w" else "#/page/"
        nodes = [dict(x, anchor="%s%s/%s" % (prefix, f.stem, x["id"])) for x in ctx.toc]
        (out / base["map"]).write_text(
            mindmap.to_svg(mindmap.from_toc(base["title"], nodes), base["title"]), encoding="utf-8")

    for t in topics:
        (out / t["html"]).parent.mkdir(parents=True, exist_ok=True)
        (out / t["html"]).write_text(t["_html"] or "<p>（空）</p>", encoding="utf-8")
        nodes = [dict(x, anchor="#/topic/%s/%s" % (t["id"], x["id"])) for x in t["toc"]]
        (out / t["map"]).write_text(
            mindmap.to_svg(mindmap.from_toc(t["title"], nodes), t["title"]), encoding="utf-8")

    for s in services:
        (out / s["html"]).parent.mkdir(parents=True, exist_ok=True)
        (out / s["html"]).write_text(s["_html"] or "<p>（空）</p>", encoding="utf-8")
        nodes = [dict(x, anchor="#/service/%s/%s" % (s["id"], x["id"])) for x in s["toc"]]
        (out / s["map"]).write_text(
            mindmap.to_svg(mindmap.from_toc(s["name"], nodes), s["name"]), encoding="utf-8")

    contract_entry = build_contract_page()
    if contract_entry:
        (out / contract_entry["html"]).parent.mkdir(parents=True, exist_ok=True)
        (out / contract_entry["html"]).write_text(contract_entry["_html"], encoding="utf-8")
        (out / contract_entry["map"]).write_text(contract_entry["_map"], encoding="utf-8")
        pages.append({k: v for k, v in contract_entry.items() if not k.startswith("_")})
        pages.sort(key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))

    site_map = {"label": sml.as_str(site.get("title")), "href": "#/", "children": []}
    art = {"label": "文章库", "children": []}
    for s in series:
        art["children"].append({
            "label": s["title"],
            "children": [{"label": x["title"], "href": "#/post/" + x["slug"], "children": []}
                         for x in s["posts"]],
        })
    singles = [p for p in posts if not p["series"]]
    if singles:
        by_year = {}
        for p in singles:
            by_year.setdefault(p["year"], []).append(p)
        for y in sorted(by_year, reverse=True):
            art["children"].append({
                "label": "%s 年" % y,
                "children": [{"label": p["title"], "href": "#/post/" + p["slug"], "children": []}
                             for p in by_year[y]],
            })
    if art["children"]:
        site_map["children"].append(art)
    if projects:
        site_map["children"].append({"label": "项目", "children": [
            {"label": p["name"], "href": "#/projects", "children": []} for p in projects]})
    if members:
        site_map["children"].append({"label": "成员", "children": [
            {"label": m["name"], "href": "#/member/" + m["id"], "children": []} for m in members]})
    if services:
        site_map["children"].append({"label": "技术互助", "children": [
            {"label": s["name"], "href": "#/service/" + s["id"], "children": []} for s in services]})
    if resources:
        site_map["children"].append({"label": "资源", "href": "#/resources", "children": [
            {"label": r["title"], "href": "#/resources", "children": []} for r in resources]})
    if weekly:
        site_map["children"].append({"label": "周报", "children": [
            {"label": w["period"], "href": "#/weekly/" + w["id"], "children": []} for w in weekly]})
    site_map["children"].insert(1, {
        "label": "文章知识", "href": "#/knowledge", "children": [
            {"label": "主题词条", "href": "#/topics", "children": [
                {"label": t["title"], "href": "#/topic/" + t["id"], "children": []} for t in topics]},
            {"label": "标签", "children": [
                {"label": "#" + t["tag"], "href": "#/library", "children": []} for t in tags[:8]]},
        ],
    })
    site_map["children"].append({"label": "加入我们", "href": "#/join", "children": []})
    if pages:
        groups = {}
        for d in pages:
            groups.setdefault(d.get("group", "其它"), []).append(d)
        site_map["children"].append({
            "label": "站文档", "children": [
                {"label": g, "children": [
                    {"label": d["title"], "href": "#/page/" + d["id"], "children": []} for d in items]}
                for g, items in groups.items()],
        })
    (out / "map.svg").write_text(
        mindmap.to_svg(site_map, sml.as_str(site.get("title"))), encoding="utf-8")

    manifest = {
        "site": {
            "title": sml.as_str(site.get("title")),
            "tagline": sml.as_str(site.get("tagline", "")),
            # site.url 与 repo_url/avatar 同纪律：过白名单后才进 manifest 与
            # og/sitemap/feed 的 URL 出口（站点配置也在 site/content/ 里，算投稿面）
            "url": urls.safe_url(args.base_url or sml.as_str(
                site.get("url", "https://rustembed.swebase.cn"))),
            "domains": [sml.as_str(x) for x in as_list(site.get("domains"))],
            "repo_url": urls.safe_url(sml.as_str(site.get("repo_url", ""))),
            "repo_mirror": urls.safe_url(sml.as_str(site.get("repo_mirror", ""))),
            "license": sml.as_str(site.get("default_license", "")),
            "announcement": sml.as_str(site.get("announcement", "")),
            "nav": [sml.as_str(x) for x in as_list(site.get("nav"))] or [
                "library", "knowledge", "topics", "projects", "resources", "members",
                "weekly", "pages", "join"],
            "avatar": urls.safe_url(avatar),
            "group": {
                "name": sml.as_str(group.get("name", sml.as_str(site.get("title")))),
                "qq": sml.as_str(group.get("qq", "")),
                "join": sml.as_str(group.get("join", "")),
                "join_url": urls.safe_url(sml.as_str(group.get("join_url", ""))),
                "intro": sml.as_str(group.get("intro", "")),
                "rules": [sml.as_str(x) for x in as_list(group.get("rules"))],
                "features": [sml.as_str(x) for x in as_list(group.get("features"))],
                "timeline": [
                    {"date": sml.as_str(t.get("date")), "text": sml.as_str(t.get("text"))}
                    for t in as_list(group.get("timeline")) if isinstance(t, dict)
                ],
            },
        },
        "posts": [{k: v for k, v in p.items() if not k.startswith("_")} for p in posts],
        "projects": projects,
        "members": members,
        "services": [{k: v for k, v in s.items() if not k.startswith("_")} for s in services],
        "resources": resources,
        "weekly": weekly,
        "topics": [{k: v for k, v in t.items() if not k.startswith("_")} for t in topics],
        "pages": pages,
        "series": series,
        "tags": tags,
        "built_at": now_iso(),
    }

    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    search = []
    for p in posts:
        search.append({"type": "文章", "title": p["title"], "summary": p["summary"],
                       "tags": p["tags"], "url": "#/post/" + p["slug"],
                       "text": p["_text"][:4000]})
    for pr in projects:
        search.append({"type": "项目", "title": pr["name"], "summary": pr["one_liner"],
                       "tags": pr["languages"], "url": "#/project/" + pr["id"],
                       "text": pr["one_liner"]})
    for m in members:
        search.append({"type": "成员", "title": m["name"], "summary": m["signature"],
                       "tags": m["skills"], "url": "#/member/" + m["id"],
                       "text": " ".join([m["signature"]] + (m["skills"] or []))})
    for s in services:
        search.append({"type": "互助", "title": s["name"], "summary": " / ".join(s["skills"]),
                       "tags": s["skills"] + s["wants"],
                       "url": "#/service/" + s["id"], "text": s["text"]})
    for r in resources:
        search.append({"type": "资源", "title": r["title"], "summary": r.get("note", ""),
                       "tags": r.get("tags", []), "url": r.get("url") or "#/resources",
                       "ext": True, "text": r.get("note", "")})
    for t in topics:
        search.append({"type": "词条", "title": t["title"], "summary": t["summary"],
                       "tags": t["tags"], "url": "#/topic/" + t["id"],
                       "text": (t.get("summary") or "") + " " + " ".join(t["tags"])})
    for w in weekly:
        search.append({"type": "周报", "title": w["title"], "summary": w.get("period", ""),
                       "tags": [], "url": "#/weekly/" + w["id"],
                       "text": (w.get("period") or "") + " " + " ".join(w.get("merged") or [])})
    for pg in pages:
        search.append({"type": "文档", "title": pg["title"], "summary": pg.get("group", ""),
                       "tags": [], "url": "#/page/" + pg["id"],
                       "text": (pg.get("text") or "")[:2000]})
    (out / "search-index.json").write_text(json.dumps(search, ensure_ascii=False), encoding="utf-8")

    # AI 可读的站点文档（llms.txt 约定）：索引放 llms.txt，正文合并放 llms-full.txt
    base_url0 = manifest["site"]["url"].rstrip("/")
    g = manifest["site"]["group"]
    L = ["# %s" % manifest["site"]["title"], "",
         "> %s" % (manifest["site"]["tagline"] or ""), "",
         "- 站点：%s" % base_url0,
         "- 仓库：%s（Gitee 是权威源；投稿走 PR，或交给群管理代投）"
         % (manifest["site"].get("repo_url") or "见站点首页"),
         "- 第二个源（SML 应用示例）：%s" % manifest["site"].get("repo_mirror", ""),
         "- 默认许可：%s" % (manifest["site"]["license"] or "见文章内 license 字段"),
         "- RSS：%s/feed.xml" % base_url0,
         "- 全部正文纯文本：%s/llms-full.txt" % base_url0,
         "- 加入群：%s" % (g.get("join_url") or ""), "",
         "## 文章（%d 篇）" % len(posts)]
    for p in posts:
        L.append("- [%s](%s/#/post/%s) — %s · %s · %s"
                 % (p["title"], base_url0, p["slug"], p["date"], "/".join(p["tags"]), p["summary"]))
    L.append("")
    if series:
        L.append("## 系列")
        for s in series:
            L.append("- %s：%s" % (s["title"], " / ".join(x["title"] for x in s["posts"])))
        L.append("")
    if topics:
        L.append("## 主题词条")
        for t in topics:
            L.append("- [%s](%s/#/topic/%s) — %s（关联文章 %d 篇）"
                     % (t["title"], base_url0, t["id"], t["summary"], len(t.get("resolved", []))))
        L.append("")
    L.append("## 站文档")
    for d in pages:
        L.append("- [%s](%s/#/page/%s)（%s）%s"
                 % (d["title"], base_url0, d["id"], d.get("group", ""),
                    " — " + d.get("text", "")[:80] if d.get("text") else ""))
    L.append("")
    L.append("## 项目")
    for pr in projects:
        meta = pr.get("meta") or {}
        L.append("- [%s](%s) — %s%s%s"
                 % (pr["name"], pr["repo"], pr["one_liner"],
                    " · " + str(meta.get("language")) if meta.get("language") else "",
                    " · ★%s" % meta.get("stars") if meta.get("stars") is not None else ""))
    L.append("")
    L.append("## 成员")
    for mem in members:
        L.append("- %s（%s）%s" % (mem["name"], mem["role"], mem["signature"]))
    L.append("")
    L.append("## 技术互助（仅信息展示：不交易、不担保、不抽成、不经手资金、不介入纠纷）")
    for s in services:
        extra = ("；想找：" + "、".join(s["wants"])) if s["wants"] else ""
        rate = ("；" + s["rate"]) if s["rate"] else ""
        L.append("- [%s](%s/#/service/%s) — %s%s%s（%s，更新 %s）"
                 % (s["name"], base_url0, s["id"], " / ".join(s["skills"]), extra, rate,
                    s["status"], s["updated"]))
    L.append("")
    L.append("## 资源")
    for r in resources:
        L.append("- [%s](%s)（%s）%s" % (r["title"], r["url"], r["kind"], r.get("note", "")))
    (out / "llms.txt").write_text("\n".join(L) + "\n", encoding="utf-8")

    F = ["# %s — 全部文章正文（纯文本）" % manifest["site"]["title"], ""]
    for p in posts:
        F.append("=" * 70)
        F.append("# %s" % p["title"])
        F.append("URL: %s/#/post/%s" % (base_url0, p["slug"]))
        F.append("作者: %s | 日期: %s | 标签: %s | 许可: %s"
                 % (p["author"], p["date"], ", ".join(p["tags"]), p["license"] or manifest["site"]["license"]))
        F.append("摘要: %s" % p["summary"])
        F.append("")
        F.append(p["_text"])
        F.append("")
    (out / "llms-full.txt").write_text("\n".join(F), encoding="utf-8")

    base_url = manifest["site"]["url"].rstrip("/")
    sitemap_urls = [base_url + "/"] + [base_url + "/#/post/" + p["slug"] for p in posts] + \
           [base_url + "/#/projects"] + [base_url + "/#/member/" + m["id"] for m in members] + \
           [base_url + "/#/services"] + [base_url + "/#/service/" + s["id"] for s in services] + \
           [base_url + "/#/resources"] + [base_url + "/#/group"] + \
           [base_url + "/#/topic/" + t["id"] for t in topics]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in sitemap_urls:
        sm.append("  <url><loc>%s</loc></url>" % esc(u))
    sm.append("</urlset>")
    (out / "sitemap.xml").write_text("\n".join(sm), encoding="utf-8")

    feed = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0"><channel>',
            "<title>%s</title>" % esc(manifest["site"]["title"]),
            "<link>%s</link>" % esc(base_url),
            "<description>%s</description>" % esc(manifest["site"]["tagline"]),
            "<lastBuildDate>%s</lastBuildDate>" % now_iso()]
    for p in posts[:20]:
        # slug 来自目录名：Windows 上不含引号/尖括号，但 git 里不保证 ——
        # 拼进 XML 前与 title/summary 一样过 esc，保持同一纪律。
        feed.append("<item><title>%s</title><link>%s/#/post/%s</link><guid>%s/#/post/%s</guid>"
                    "<pubDate>%s</pubDate><description>%s</description></item>" % (
                        esc(p["title"]), esc(base_url), esc(p["slug"]),
                        esc(base_url), esc(p["slug"]),
                        esc(p["date"]), esc(p["summary"])))
    feed.append("</channel></rss>")
    (out / "feed.xml").write_text("\n".join(feed), encoding="utf-8")

    # Cloudflare Pages 的 _headers：给纯文本/AI 索引显式声明 UTF-8。
    # 不声明时，中文系统上直接打开 llms.txt 会按 GBK 解码成乱码（内容本身是 UTF-8）。
    (out / "_headers").write_text(
        "\n".join([
            "/*",
            "  X-Content-Type-Options: nosniff",
            "",
            "/llms.txt",
            "  Content-Type: text/plain; charset=utf-8",
            "",
            "/llms-full.txt",
            "  Content-Type: text/plain; charset=utf-8",
            "",
            "/feed.xml",
            "  Content-Type: application/rss+xml; charset=utf-8",
            "",
            "/sitemap.xml",
            "  Content-Type: application/xml; charset=utf-8",
            "",
            "/manifest.json",
            "  Content-Type: application/json; charset=utf-8",
            "",
            "/search-index.json",
            "  Content-Type: application/json; charset=utf-8",
            "",
            "/site.webmanifest",
            "  Content-Type: application/manifest+json; charset=utf-8",
            "",
        ]) + "\n", encoding="utf-8")

    (out / "summaries").mkdir(parents=True, exist_ok=True)
    for p in posts:
        (out / "summaries" / (p["slug"] + ".json")).write_text(
            json.dumps(p.get("ai_summary") or {}, ensure_ascii=False, indent=1),
            encoding="utf-8")
    for p in posts:
        src = ROOT / Path(p["file"]).parent / "assets"
        if src.exists():
            dst = out / "assets" / "posts" / p["slug"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst)
    for m in members:
        src_rel = m.pop("_avatar_src", "")
        if not src_rel:
            continue
        src = Path(src_rel)
        dst = out / "assets" / "members" / ("%s%s" % (m["id"], src.suffix.lower()))
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        m["avatar"] = "assets/members/" + dst.name
    if avatar:
        shutil.copy2(ROOT / avatar, out / avatar)

    site_dir = THEME
    if site_dir.exists():
        for f in site_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, out / f.name)

    inject_shell(rep, out, manifest, posts)      # 静态首屏：站名 + 站点导航 + 最近文章

    bodies = [p["_html"] for p in posts] + [x.get("_html", "") for x in pages + weekly + topics + services]
    fonts_css = build_fonts(rep, out, manifest, bodies)
    inject_head(rep, out, manifest, avatar, fonts_css)

    cache.save()

    print("-- 校验")
    for w in rep.warnings:
        print("  [warn] %s" % w)
    for e in rep.errors:
        print("  [error] %s" % e)
    # 持久化构建告警，供 check.py 复核（仅告警、不影响产物与退出码）
    try:
        import json as _json
        (_warn_file) = out / "build-warnings.json"
        _warn_file.write_text(_json.dumps(rep.warnings, ensure_ascii=False, indent=1),
                              encoding="utf-8")
    except Exception:                       # noqa: BLE001 —— 写告警文件失败不阻断构建
        pass
    if rep.errors and not args.warn_only:
        print("构建失败：%d 个错误" % len(rep.errors))
        return 1
    print("产物：%s（文章 %d / 项目 %d / 成员 %d / 互助 %d）" % (out, len(posts), len(projects), len(members), len(services)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
