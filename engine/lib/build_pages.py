#!/usr/bin/env python3
"""构建器内容层：读内容文件、契约校验、渲染出口与全部 build_*（2026-10-21 自 build.py 拆出）。

这一层不认识「产物怎么落盘、manifest 怎么拼」—— 那些在 build_assets /
build_manifest / build_fonts。跨模块调用一律走模块属性（import build_assets 后
build_assets.xxx()），避免与 build_assets 形成 from-import 环。

契约表状态（GLOBAL_CONTRACTS / CONTRACT_DEFAULTS / CONTRACT_LOOSE）住在本模块：
register_contracts 原地填表，build.py 的 _run 经 set_contract_loose 设开关
（重新绑定必须落在本模块，from-import 出去的副本会是旧值）。
"""

import re
import urllib.request
from pathlib import Path

import mindmap
import render
import repo_meta
import sml
import summary
import contract as contract_mod
import markdown as md
import urls

import build_assets
from build_common import esc, Report  # noqa: F401  （esc/Report 供本模块与再导出用）
from build_paths import (CONTENT, DOC_EXT, IMAGE_EXT, MAX_IMAGE,  # noqa: F401
                         MAX_IMAGES_PER_POST, REQ, ROOT)

# 技术互助条目固定尾部：性质声明 + 免责声明。纯展示，不交易、不担保、不抽成、
# 不经手资金、不介入纠纷；条目由 owner 本人提供并自负其责，本站不背书。
SERVICE_DISCLAIMER = (
    '<aside class="admonition warn"><p><strong>免责声明</strong>：本站只展示这条信息：'
    '不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。'
    '本条互助信息由成员本人提供并自负其责，不代表本站对任何个人或服务的认可或背书；'
    '是否协作、如何协作，请自行判断并在站外约定。'
    '联系方式仅引用成员档案中本人授权公开的字段，本站不代收任何新联系方式。'
    '条目内容按站点默认许可 CC BY-NC-SA 4.0（非商业）发布。</p></aside>\n')


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


def set_contract_loose(flag):
    """--contract-loose 开关。由 build._run 调用：重新绑定要落在本模块，
    否则 apply_contract 读到的还是 import 时的旧值（build.py 若 from-import 了这个名，
    在 build.py 里赋值只改它自己的副本）。"""
    global CONTRACT_LOOSE
    CONTRACT_LOOSE = bool(flag)


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


def uniq_str(v):
    """去重后的字符串列表（顺序不变）：用于 related_series / related_posts 这类
    引用型字段 —— 重复引用只会让前端多一次无意义的查找。"""
    out = []
    for x in as_list(v):
        s = sml.as_str(x)
        if s and s not in out:
            out.append(s)
    return out


def pick(d, keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return default


def check_req(rep, kind, where, data):
    for k in REQ.get(kind, []):
        if data.get(k) in (None, "", []):
            rep.err(where, "缺少必填字段 `%s`" % k)


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
    html_body, missing_imgs = build_assets._localize_assets(html_body, slug, f.parent)
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
    series_description = ""
    if isinstance(series, dict):
        series_id = sml.as_str(series.get("id")) or None
        series_title = sml.as_str(series.get("title", ""))
        order = series.get("order")
        # 系列简介：纯文本，超长截断并告警（不开放任意 HTML，前端文本节点二次防护）
        raw_desc = sml.as_str(series.get("description", ""))
        if raw_desc and len(raw_desc) > SERIES_DESC_MAX:
            rep.warn(where, "series.description 超过 %d 字，已截断：%s"
                     % (SERIES_DESC_MAX, series_id or ""))
            raw_desc = raw_desc[:SERIES_DESC_MAX]
        series_description = raw_desc
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
        "_series_description": series_description,
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

# 系列简介最大字数：纯文本，构建期走统一转义（前端用文本节点渲染，不开放任意 HTML）；
# 超出截断并告警，避免投稿人塞进大段正文。取组内第一篇非空值。
SERIES_DESC_MAX = 240


def build_posts(rep, cache, offline):
    """文章支持多语言（phase 1：仅 posts，白名单 zh/en）。

    同一目录的 index.(md|sml)=zh、index.<lang>.(md|sml)=对应语言，按 (year, slug) 分组，
    每个语言版本独立走现有 load2/契约/渲染/TOC/字数，不共享正文。默认语言 zh 的产物路径 /
    字段 / HTML 与旧构建完全一致（单语言文章零回归：manifest 不加 langs、html 不变）。
    """
    posts = []
    res_index = build_assets.resource_index()
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


def project_tags(d):
    """项目展示标签：作者写的 tags 原样保留；status: active 自动补「活跃开发」，
    不要求作者手写（作者写了就不重复补）。"""
    tags = [sml.as_str(x) for x in as_list(d.get("tags"))]
    if sml.as_str(d.get("status")) == "active" and "活跃开发" not in tags:
        tags.append("活跃开发")
    return tags


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
            "tags": project_tags(d),
            "status": sml.as_str(d.get("status")),
            "license": sml.as_str(d.get("license", "")),
            "owner": sml.as_str(d.get("owner", "")),
            "contributors": [sml.as_str(x) for x in as_list(d.get("contributors"))],
            # 站内相关阅读（显式关联）：related_series 存系列 id，related_posts 存文章 slug。
            # 两者都空 → 前端不渲染「相关阅读」，不做语言 / 标签的自动相交。
            "related_series": uniq_str(d.get("related_series")),
            "related_posts": uniq_str(d.get("related_posts")),
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


# 成员 links 的已知键。未知键不会被丢掉（前端回落到键名），但会构建期告警：
# 联系人的个数由键名决定，写错键名 = 给读者一个看不懂的标签。
KNOWN_MEMBER_LINK_KEYS = {"blog", "homepage", "github", "gitee", "gitee_org", "email"}

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


# ---- 阅读习惯配置：写在 site.sml，进 manifest 由前端取用 ----

DEFAULT_CODE_COLLAPSE_LINES = 20          # 代码超过这么多行就折叠（前端按钮可展开）


def collapse_lines(site):
    """代码块折叠阈值。site.sml 里 `code_collapse_lines: 20`；非法值退回默认并告警。"""
    v = site.get("code_collapse_lines", DEFAULT_CODE_COLLAPSE_LINES)
    try:
        n = int(sml.as_str(v))
    except (TypeError, ValueError):
        return DEFAULT_CODE_COLLAPSE_LINES
    # 上限只为挡住手滑多打一个 0（塞一整篇渲染进来）；下限保证「折叠后还有得看」
    return n if 1 <= n <= 500 else DEFAULT_CODE_COLLAPSE_LINES


# ---- 一言 ----

QUOTES_DIR = CONTENT / "quotes"           # content/quotes/<成员 id>/quotes.sml
QUOTES_PER_MEMBER = 3                     # 每人最多 3 条
QUOTES_TOTAL = 60                         # 全站最多 60 条


def build_quotes(rep, members):
    """收录「一言」：content/quotes/<成员 id>/quotes.sml → manifest.quotes。

    契约之外的硬约束：
      · 只收**有成员档案**的人的句子 —— 句子署的是真人，凭空出現的成员 id 没处溯源；
      · 每人最多 3 条、全站最多 60 条，超出部分构建期丢并告警（提纯——句子多了就稀释）；
      · 一条都不收录时返回空表，前端会连按钮都不渲染：绝不编造句子填版面。
    """
    if not QUOTES_DIR.is_dir():
        return []
    known = {m["id"]: m for m in members}
    out = []
    for d in sorted(p for p in QUOTES_DIR.iterdir() if p.is_dir()):
        f = d / "quotes.sml"
        where = f.relative_to(ROOT).as_posix()
        mid = d.name
        if not f.exists():
            rep.warn(where, "目录里没有 quotes.sml（约定：content/quotes/<成员 id>/quotes.sml）")
            continue
        if mid not in known:
            rep.warn(where, "没有对应的成员档案 content/members/%s.sml，整份不收录" % mid)
            continue
        data, cs = load2(f)
        register_contracts(rep, where, cs)
        kept = []
        for row in as_list(data.get("quotes")):
            if not isinstance(row, dict):
                continue
            text = sml.as_str(row.get("text", "")).strip()
            if not text:
                continue
            kept.append({
                "member": mid,
                "name": known[mid].get("name") or mid,
                "text": text,
                "source": sml.as_str(row.get("source", "")).strip(),
            })
        if len(kept) > QUOTES_PER_MEMBER:
            rep.warn(where, "%s 录了 %d 条，超过每人 %d 条，只保留前 %d 条"
                     % (mid, len(kept), QUOTES_PER_MEMBER, QUOTES_PER_MEMBER))
            kept = kept[:QUOTES_PER_MEMBER]
        out.extend(kept)
    if len(out) > QUOTES_TOTAL:
        rep.warn("quotes", "共 %d 条，超过上限 %d 条，后面的不进 manifest"
                 % (len(out), QUOTES_TOTAL))
        out = out[:QUOTES_TOTAL]
    return out


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
        for k in links:
            if not str(k).startswith("_") and str(k) not in KNOWN_MEMBER_LINK_KEYS:
                rep.warn(where, "links 里的键 `%s` 不在已知键里（%s）：前端只会显示这个键名本身，"
                         "确需新的联系方式请同步 contracts/blog.sml 的 MemberLinks "
                         "与 site/theme/js/core.js 的 CONTACT_LABEL" % (k, " / ".join(sorted(KNOWN_MEMBER_LINK_KEYS))))
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


def _current_contracts():
    """取当前契约表。

    默认就是本模块的 GLOBAL_CONTRACTS（register_contracts 原地填它）。
    但 test_render_safety 会**重绑** build.GLOBAL_CONTRACTS 再调 build_contract_page()
    （喂构造出来的恶意契约名测转义）—— 重绑只有走 build 模块属性才看得见，
    from-import 出去的副本还是旧对象。build.py 顶部把 __main__ 别名成 build，
    脚本直跑与 import 两条路在这里都拿到同一个模块。
    """
    try:
        import build  # noqa: PLC0415 延迟导入：build 反向依赖本模块，只能调用期取
        return getattr(build, "GLOBAL_CONTRACTS", GLOBAL_CONTRACTS)
    except ImportError:
        return GLOBAL_CONTRACTS


def build_contract_page():
    """从契约表自动生成文档页：代码即文档。"""
    table = _current_contracts()
    if not table:
        return None
    esc = render.esc
    html = ['<p class="muted">本页由 <code>content/contracts/*.sml</code> 自动生成 —— 改契约即改这里。'
            '错误码见 docs/ARCHITECTURE.md。</p>\n']
    toc = []
    nodes = []
    for c in contract_mod.describe(table):
        ident = "contract-" + c["name"]
        toc.append({"id": ident, "text": c["name"], "level": 2})
        # ident 来自契约名（自由文本，可含引号与尖括号），拼进属性前必须转义；
        # 否则可以闭合 id 属性注入 <img onerror> 之类，经 js/ 的 innerHTML 执行。
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
