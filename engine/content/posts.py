"""文章：多语言版本收录、字段组装，以及「目录树守卫」。

守卫与 core/content_paths 的分工：那边只给路径与发现，这边只校验「内容树是否
退化成摊平结构」并把错误报给人。改发现逻辑前先读 docs/REPO-LAYOUT.md。
"""

from engine.core import content_paths, contracts, urls
from engine.core.paths import (CONTENT, DOC_EXT, IMAGE_EXT, MAX_IMAGE,
                               MAX_IMAGES_PER_POST, ROOT)
from engine.content import summary
from engine.content.loader import (as_list, check_req, load2, pick, render_body)
from engine.parse import sml
from engine.pipeline import assets
from engine.render import mindmap, render

_POST_NAME = content_paths.POST_NAME
_LANGS = content_paths.LANGS
_YEAR_NAME = content_paths.YEAR_NAME


def build_post_file(rep, f, year, slug, lang, res_index):
    """渲染单篇文章的某个语言版本，返回该版本的字段字典（不含 lang 键，避免污染 manifest）。

    默认语言 zh 的出口（html 路径、字段、正文 HTML）与旧构建完全一致，保证单语言零回归。
    """
    rel = f.relative_to(ROOT).as_posix()
    d, cs = load2(f)
    where = rel
    contracts.register_contracts(rep, where, cs)
    checked = contracts.apply_contract(rep, where, d, "post")
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
    html_body, missing_imgs = assets._localize_assets(html_body, slug, f.parent)
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


def build_posts(rep, cache, offline):
    """文章支持多语言（phase 1：仅 posts，白名单 zh/en）。

    同一目录的 index.(md|sml)=zh、index.<lang>.(md|sml)=对应语言，按 (year, slug) 分组，
    每个语言版本独立走现有 load2/契约/渲染/TOC/字数，不共享正文。默认语言 zh 的产物路径 /
    字段 / HTML 与旧构建完全一致（单语言文章零回归：manifest 不加 langs、html 不变）。
    """
    posts = []
    res_index = assets.resource_index()
    groups = {}  # (year, slug) -> {lang: file}
    posts_root = CONTENT / content_paths.POSTS_DIR
    # 目录树约定：posts/<年>/[系列/]<文章>/index.*（发现逻辑见 core/content_paths）
    for f, rel0 in content_paths.iter_posts(posts_root):
        rel = f.relative_to(ROOT).as_posix()
        # 安全：posts 内容不得是符号链接（可能被用来逃逸站点目录）
        if f.is_symlink():
            rep.err(rel, "posts 内容不得是符号链接（可能逃逸站点目录）：%s" % f.name)
            continue
        lang = content_paths.post_lang(f.name)
        if lang is None:
            continue
        if lang not in _LANGS:
            rep.err(rel, "不支持的语言 `%s`（仅允许 zh / en）：%s" % (lang, f.name))
            continue
        # 年份取 posts 下第一层（不再用 parent.parent —— 系列插层后那会拿到系列名）
        year = rel0.parts[0]
        if not _YEAR_NAME.match(year):
            rep.err(rel, "E-POST-002 文章目录第一层必须是四位年份（posts/<年>/…），实际是 `%s`" % year)
            continue
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

    _guard_tree(rep, posts, posts_root)

    summaries_dir = CONTENT / "summaries"
    for p in posts:
        p["ai_summary"] = summary.build(p, summaries_dir)
    return posts


# ---- 目录树守卫（别再退回去）----
# 背景：早先发现逻辑写死 posts/<年>/<文章>/ 两层，于是系列文章（一次几十篇）直接
# 摊平在年目录下，人眼看不出任何分组；更糟的是谁插一层子目录，文章就会被静默漏掉
# （不报错、直接不收录）。下面两条把这两件事钉死。


def _guard_tree(rep, posts, posts_root):
    # 1) 正文必须叫 index.*：换个名字会被发现逻辑整篇跳过（静默少一篇，且无任何提示）
    if posts_root.exists():
        for f in sorted(posts_root.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in DOC_EXT:
                continue
            r0 = f.relative_to(posts_root)
            if any(part.startswith("_") for part in r0.parts):
                continue
            if _POST_NAME.match(f.name) or f.stem.lower() in content_paths.SKIP_NAMES:
                continue
            rep.err(f.relative_to(ROOT).as_posix(),
                    "E-POST-001 文章正文必须命名为 index.(md|sml) 或 index.<语言>.(md|sml)，"
                    "否则不会被收录（会静默少一篇）：%s" % f.name)

    # 2) 同一系列必须收进同一个系列子目录：posts/<年>/<系列>/<文章>/
    #    容忍跨年（2026/系列 与 2027/系列 算同一系列目录名），但不许散在多个目录名。
    places = {}  # 系列 id -> {系列目录名: [slug]}
    for p in posts:
        sid = p.get("series")
        if not sid:
            continue
        tail = content_paths.tails_under_posts(p["file"])
        if len(tail) < 4:
            rep.err(p["file"],
                    "E-POST-003 系列文章必须收进系列子目录 posts/<年>/<系列>/<文章>/，"
                    "现在直接挂在年目录下 —— 系列一多就会摊平成一大片（系列 `%s`）" % sid)
            continue
        places.setdefault(sid, {}).setdefault(tail[-3], []).append(p["slug"])
    for sid, where in sorted(places.items()):
        if len(where) > 1:
            rep.err("content/posts",
                    "E-POST-004 系列 `%s` 的文章分散在 %d 个目录（%s），同一系列必须收在"
                    "同一个 posts/<年>/<系列>/ 下" % (sid, len(where), "、".join(sorted(where))))
