#!/usr/bin/env python3
"""rec-blog 构建器：.sml → manifest.json + 预渲染 HTML 片段 + 静态站点产物。

用法：
    python engine/build.py              # 完整构建
    python engine/build.py --offline    # 不联网，只用仓库元数据缓存
    python engine/build.py --warn-only  # 校验问题只告警，不中断构建

2026-10-21 按职责拆到 engine/lib/（本文件只留入口、公共名再导出与主流程 _run）：
    build_common.py    公共件：esc / Report / now_iso / 分阶段计时
    build_paths.py     路径与硬编码表：ROOT/CONTENT/THEME/OUT/CACHE、REQ、guard_out、clean_out
    build_assets.py    产物收集 Out / 图片资源入口 / resource_index / inject_head / inject_shell
    build_pages.py     内容层：load / load2 / 契约校验 / render_body / 全部 build_*
    build_manifest.py  数据出口：manifest / search-index / llms / feed / sitemap / map.svg
    build_fonts.py     字体子集：site_text / font_family_weight / build_fonts

外部（gui_api / test_render_safety / tech_aid_test / i18n_test…）一律仍从
`import build` 拿名字：下面把各模块的公共名原样再导出，行为与拆分前一致。
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# fontTools 作为仓库组件 vendored 在 engine/vendor（不依赖 pip 安装）
VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
if VENDOR_DIR.is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

import config
import sml
import render
import repo_meta
import mindmap

# 「脚本直跑」时本模块名叫 __main__，而 build_pages.build_contract_page 要读
# build.GLOBAL_CONTRACTS（test_render_safety 会重绑它喂恶意契约名测转义）——
# 别名一下，让 import build 与 python engine/build.py 拿到同一个模块，
# 否则那条延迟导入会把本文件再执行一遍。
sys.modules.setdefault("build", sys.modules[__name__])

from build_common import (esc, Report, now_iso,  # noqa: E402
                          _Tick, _mark, _span, print_timings)  # noqa: E402
from build_paths import (DOC_EXT, ROOT, CONTENT, THEME, OUT, CACHE,  # noqa: E402
                         IMAGE_EXT, MAX_IMAGE, MAX_IMAGES_PER_POST, REQ,  # noqa: E402
                         clean_out, guard_out)  # noqa: E402
from build_assets import (LICENSE_NOTICE, FOOTER_TAG, Out,  # noqa: E402
                          _localize_assets, check_external_images, resource_index,  # noqa: E402
                          MIME, NAV_LABEL, inject_head, inject_shell)  # noqa: E402
from build_pages import (SERVICE_DISCLAIMER, SKIP_NAMES,  # noqa: E402
                         GLOBAL_CONTRACTS, CONTRACT_DEFAULTS,  # noqa: E402
                         set_contract_loose, load, load2, register_contracts,  # noqa: E402
                         apply_contract, docs_in, render_body, as_list, pick,  # noqa: E402
                         check_req, build_post_file, build_posts, build_projects,  # noqa: E402
                         KNOWN_MEMBER_LINK_KEYS, AVATAR_EXT, find_avatar,  # noqa: E402
                         AVATAR_CACHE, DEFAULT_CODE_COLLAPSE_LINES, collapse_lines,  # noqa: E402
                         QUOTES_DIR, QUOTES_PER_MEMBER, QUOTES_TOTAL, build_quotes,  # noqa: E402
                         fetch_remote_avatar, build_members, build_topics,  # noqa: E402
                         build_services, build_simple, build_contract_page)  # noqa: E402
from build_manifest import (site_map_svg, build_series, build_manifest,  # noqa: E402
                            search_index, llms_txt, llms_full,  # noqa: E402
                            sitemap_xml, feed_xml, headers_text)  # noqa: E402
from build_fonts import (FONT_EXT, FONT_WEIGHT, font_dirs, site_text,  # noqa: E402
                         font_family_weight, build_fonts)  # noqa: E402

try:  # 中文输出统一走 UTF-8，避免被控制台代码页搞成乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--warn-only", action="store_true")
    ap.add_argument("--base-url", default="", help="覆盖 site.sml 里的站点 URL（多域名/预览用）")
    ap.add_argument("--contract-loose", action="store_true",
                    help="放宽 E-CONTRACT-004（未声明字段）——临时允许契约外的字段")
    ap.add_argument("--timing", action="store_true",
                    help="打印分阶段耗时（站点/文章/项目/成员/写产物/字体…），供性能基线用")
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
    _t_start = time.perf_counter()
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

    # --contract-loose 是重新绑定：必须落在 build_pages 里（apply_contract 在那儿读），
    # 在 build.py 里赋值只会改本模块的副本。
    set_contract_loose(args.contract_loose)
    CONTRACT_DEFAULTS.clear()
    CONTRACT_DEFAULTS.update({k: sml.as_str(v) for k, v in (site.get("contracts") or {}).items()
                              if sml.as_str(v)})
    _t_site = _mark("site.sml/契约")

    print("-- 站点：%s" % ROOT)
    print("-- 契约")
    for f in docs_in(CONTENT / "contracts"):
        _, cs = load2(f)
        register_contracts(rep, f.relative_to(ROOT).as_posix(), cs)
    print("   %d 个契约，默认映射 %d 项" % (len(GLOBAL_CONTRACTS), len(CONTRACT_DEFAULTS)))
    _span(_t_site)


    print("-- 图片引用")
    ext_imgs = check_external_images(rep)
    print("   外链图片 %d 处（必须为 0：运行时零外部请求）" % ext_imgs)

    cache = repo_meta.Cache(CACHE)
    print("-- 文章")
    with _Tick("文章"):
        posts = build_posts(rep, cache, args.offline)
    print("   %d 篇" % len(posts))
    print("-- 项目")
    with _Tick("项目"):
        projects = build_projects(rep, cache, args.offline)
    print("   %d 个" % len(projects))
    print("-- 成员")
    with _Tick("成员"):
        members = build_members(rep)
    print("   %d 人" % len(members))
    print("-- 一言")
    with _Tick("一言"):
        quotes = build_quotes(rep, members)
    print("   %d 条" % len(quotes))
    raw_lines = site.get("code_collapse_lines")
    code_lines = collapse_lines(site)
    if raw_lines is not None and sml.as_str(raw_lines) != str(code_lines):
        rep.warn("site.sml", "code_collapse_lines `%s` 不可用，已退回 %d 行（合法范围 1–500）"
                 % (sml.as_str(raw_lines), code_lines))
    print("-- 主题词条")
    with _Tick("词条/互助/资源/周报/页"):
        topics = build_topics(rep)
        print("   %d 条" % len(topics))
        services = build_services(rep, members)
        resources = build_simple("resources", rep, cache, args.offline)
        weekly_raw = build_simple("weekly", rep)
        pages_raw = build_simple("pages", rep)
    print("-- 技术互助")
    print("   %d 条" % len(services))
    print("-- 资源 / 周报 / 文档页")
    weekly = [w[0] for w in weekly_raw]
    pages = sorted([w[0] for w in pages_raw], key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))
    print("   %d 个文档页" % len(pages))

    with _Tick("关联与系列"):
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

    series = build_series(posts)

    tag_count = {}
    for p in posts:
        for t in p["tags"]:
            tag_count[t] = tag_count.get(t, 0) + 1
    tags = sorted([{"tag": k, "count": v} for k, v in tag_count.items()], key=lambda x: (-x["count"], x["tag"]))

    out_dir = Out(out)
    with _Tick("写 HTML 产物"):
        for p in posts:
            out_dir.put_text(p["html"], p["_html"] or "<p>（空）</p>")
            if p.get("map"):
                out_dir.put_text(p["map"], p["_map"])
            # 文章多语言：非默认语言版本单独写盘（如 p/<slug>.en.html），assets 共享
            for v in (p.get("_variants") or {}).values():
                out_dir.put_text(v["html"], v["body"] or "<p>（空）</p>")
        for base, d, ctx, f in weekly_raw + pages_raw:
            where = f.relative_to(ROOT).as_posix()
            html_body, toc = render_body(d, ctx, 1, rep, where)
            out_dir.put_text(base["html"], html_body or "<p>（空）</p>")
            base["toc"] = toc
            base["text"] = render.strip_html(html_body)
            kind = "w" if f.parent.name == "weekly" else "pages"
            base["map"] = "%s/%s.map.svg" % (kind, f.stem)
            prefix = "#/weekly/" if kind == "w" else "#/page/"
            nodes = [dict(x, anchor="%s%s/%s" % (prefix, f.stem, x["id"])) for x in ctx.toc]
            out_dir.put_text(base["map"],
                mindmap.to_svg(mindmap.from_toc(base["title"], nodes), base["title"]))

        for t in topics:
            out_dir.put_text(t["html"], t["_html"] or "<p>（空）</p>")
            nodes = [dict(x, anchor="#/topic/%s/%s" % (t["id"], x["id"])) for x in t["toc"]
                     ]
            out_dir.put_text(t["map"],
                             mindmap.to_svg(mindmap.from_toc(t["title"], nodes), t["title"]))

        for s in services:
            out_dir.put_text(s["html"], s["_html"] or "<p>（空）</p>")
            nodes = [dict(x, anchor="#/service/%s/%s" % (s["id"], x["id"])) for x in s["toc"]
                     ]
            out_dir.put_text(s["map"],
                             mindmap.to_svg(mindmap.from_toc(s["name"], nodes), s["name"]))

        contract_entry = build_contract_page()
        if contract_entry:
            out_dir.put_text(contract_entry["html"], contract_entry["_html"])
            out_dir.put_text(contract_entry["map"], contract_entry["_map"])
            pages.append({k: v for k, v in contract_entry.items() if not k.startswith("_")})
            pages.sort(key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))

    with _Tick("map/manifest/search"):
        out_dir.put_text("map.svg",
                         site_map_svg(sml.as_str(site.get("title")), series, posts, projects,
                                      members, services, resources, weekly, topics, tags, pages))
        manifest = build_manifest(site, group, posts, quotes, projects, members, services,
                                  resources, weekly, topics, pages, series, tags, code_lines,
                                  avatar, args.base_url)
        out_dir.put_text("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        out_dir.put_text("search-index.json",
                         json.dumps(search_index(posts, projects, members, services, resources,
                                                 topics, weekly, pages), ensure_ascii=False))

    _t_llms = _mark("llms")
    # AI 可读的站点文档（llms.txt 约定）：索引放 llms.txt，正文合并放 llms-full.txt
    out_dir.put_text("llms.txt",
                     llms_txt(manifest, posts, series, topics, pages, projects, members,
                              services, resources))
    out_dir.put_text("llms-full.txt", llms_full(manifest, posts))
    _span(_t_llms)


    _t_feed = _mark("feed/sitemap/_headers")

    out_dir.put_text("sitemap.xml", sitemap_xml(manifest, posts, members, services, topics))
    out_dir.put_text("feed.xml", feed_xml(manifest, posts))
    out_dir.put_text("_headers", headers_text())

    _span(_t_feed)

    _t_assets = _mark("summaries/assets/theme")
    for p in posts:
        out_dir.put_text("summaries/" + p["slug"] + ".json",
                         json.dumps(p.get("ai_summary") or {}, ensure_ascii=False, indent=1))
    for p in posts:
        src = ROOT / Path(p["file"]).parent / "assets"
        if src.exists():
            out_dir.put_copy_dir(src, "assets/posts/" + p["slug"])
    for m in members:
        src_rel = m.pop("_avatar_src", "")
        if not src_rel:
            continue
        src = Path(src_rel)
        rel = "assets/members/" + ("%s%s" % (m["id"], src.suffix.lower()))
        out_dir.put_copy(src, rel)
        m["avatar"] = rel
    if avatar:
        out_dir.put_copy(ROOT / avatar, avatar)

    # 递归拷贝主题：可以有子目录（如 vendor/prism/），逐文件登记、跳过未变的。
    # index.html 除外：它由 inject_shell/inject_head 注入后走 put_text。
    out_dir.put_copy_dir(THEME, "", exclude=("index.html",))

    _span(_t_assets)

    _t_fonts = _mark("fonts/shell/head")

    index_html = inject_shell(rep, manifest, posts)      # 静态首屏：站名 + 站点导航 + 最近文章

    bodies = [p["_html"] for p in posts] + [x.get("_html", "") for x in pages + weekly + topics + services]
    fonts_css = build_fonts(rep, out_dir, manifest, bodies)
    index_html, icon = inject_head(rep, manifest, avatar, fonts_css, index_html)

    _span(_t_fonts)

    if icon and icon != avatar:
        out_dir.put_copy(ROOT / avatar, icon)   # favicon：源仍是仓库根的群头像
    if icon:
        mani = {"name": manifest["site"]["title"],
                "short_name": manifest["site"]["title"][:12], "start_url": "./",
                "display": "standalone", "background_color": "#fbfaf7", "theme_color": "#b4552d",
                "icons": [{"src": icon, "sizes": "any",
                           "type": MIME.get(Path(icon).suffix.lower(), "image/jpeg")}]}
        out_dir.put_text("site.webmanifest", json.dumps(mani, ensure_ascii=False, indent=1))
    if index_html:
        out_dir.put_text("index.html", index_html)
    out_dir.flush()
    cache.save()

    print("-- 校验")
    for w in rep.warnings:
        print("  [warn] %s" % w)
    for e in rep.errors:
        print("  [error] %s" % e)
    # 持久化构建告警，供 check.py 复核（仅告警、不影响产物与退出码）。
    # 这一段在 Out.flush() 之后：直接写盘即可（不参与跳过比对，文件很小）。
    try:
        import json as _json
        (out / "build-warnings.json").write_text(
            _json.dumps(rep.warnings, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:                       # noqa: BLE001 —— 写告警文件失败不阻断构建
        pass
    if rep.errors and not args.warn_only:
        print("构建失败：%d 个错误" % len(rep.errors))
        return 1
    print("   落盘：写入 %d / 跳过未变 %d / 清理孤儿 %d"
          % (out_dir.wrote, out_dir.skipped, out_dir.removed))
    print("产物：%s（文章 %d / 项目 %d / 成员 %d / 互助 %d）" % (out, len(posts), len(projects), len(members), len(services)))
    if args.timing:
        print_timings(time.perf_counter() - _t_start)
    return 0


if __name__ == "__main__":
    sys.exit(main())
