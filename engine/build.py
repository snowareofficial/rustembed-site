#!/usr/bin/env python3
"""rec-blog 构建入口：.sml → manifest.json + 预渲染 HTML 片段 + 静态站点产物。

用法：
    python engine/build.py              # 完整构建
    python engine/build.py --offline    # 不联网，只用仓库元数据缓存
    python engine/build.py --warn-only  # 校验问题只告警，不中断构建

分层（详细职责见 docs/ARCHITECTURE.md 与各包 docstring）：
    core/      路径、站点定位、契约表、URL 白名单、报告与计时
    parse/     SML 解析（native / builtin 两个后端）
    render/    SML 块渲染、Markdown 渲染、LaTeX→MathML、导图 SVG
    content/   内容类型：文章 / 项目 / 成员 / 一言 / 词条 / 互助 / 资源页
    pipeline/  产物层：Out 收集器、manifest 与 feed、字体子集
本文件只留入口与主流程 _run，并把常用名字再导出给测试/工具（`import engine.build`）。
"""

import argparse
import json
import sys
import time
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# fontTools 作为仓库组件 vendored 在 engine/vendor（不依赖 pip 安装）
VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
if VENDOR_DIR.is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

from engine.core import config, content_paths, contracts, paths  # noqa: E402
from engine.core.report import (Report, _Tick, _mark, _span,  # noqa: E402
                                esc, now_iso, print_timings)
from engine.content import (contract_page, loader, members, pages, posts,  # noqa: E402
                            projects, quotes, reading, services, topics)
from engine.content import repo_meta  # noqa: E402
from engine.parse import sml  # noqa: E402
from engine.pipeline import assets, fonts, manifest as manifest_mod  # noqa: E402
from engine.render import mindmap, render  # noqa: E402

try:  # 中文输出统一走 UTF-8，避免被控制台代码页搞成乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(paths.OUT))
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
    out = paths.guard_out(args.out)
    rep = Report()

    print("== rec-blog build ==")
    site_path = paths.CONTENT / "site.sml"
    site = loader.load(site_path) if site_path.exists() else {}
    if not site:
        rep.err("site.sml", "缺失或为空")
    loader.check_req(rep, "site", "site.sml", site)
    group = site.get("group") if isinstance(site.get("group"), dict) else {}

    avatar = None
    for cand in ("group.jpg", "group.jpeg"):
        if (paths.ROOT / cand).exists():
            avatar = cand
            break
    if avatar is None:
        for p in sorted(paths.ROOT.glob("*.jpg")) + sorted(paths.ROOT.glob("*.jpeg")):
            avatar = p.name
            break
    if avatar is None:
        rep.warn("根目录", "未找到群头像 group.jpg")

    contracts.set_contract_loose(args.contract_loose)
    contracts.CONTRACT_DEFAULTS.clear()
    contracts.CONTRACT_DEFAULTS.update({k: sml.as_str(v) for k, v in (site.get("contracts") or {}).items()
                                        if sml.as_str(v)})
    _t_site = _mark("site.sml/契约")

    print("-- 站点：%s" % paths.ROOT)
    print("-- 契约")
    for f in content_paths.docs_in(paths.CONTENT / "contracts"):
        _, cs = loader.load2(f)
        contracts.register_contracts(rep, f.relative_to(paths.ROOT).as_posix(), cs)
    print("   %d 个契约，默认映射 %d 项" % (len(contracts.GLOBAL_CONTRACTS),
                                            len(contracts.CONTRACT_DEFAULTS)))
    _span(_t_site)

    print("-- 图片引用")
    ext_imgs = assets.check_external_images(rep)
    print("   外链图片 %d 处（必须为 0：运行时零外部请求）" % ext_imgs)

    cache = repo_meta.Cache(paths.CACHE)
    print("-- 文章")
    with _Tick("文章"):
        post_list = posts.build_posts(rep, cache, args.offline)
    print("   %d 篇" % len(post_list))
    print("-- 项目")
    with _Tick("项目"):
        project_list = projects.build_projects(rep, cache, args.offline)
    print("   %d 个" % len(project_list))
    print("-- 成员")
    with _Tick("成员"):
        member_list = members.build_members(rep)
    print("   %d 人" % len(member_list))
    print("-- 一言")
    with _Tick("一言"):
        quote_list = quotes.build_quotes(rep, member_list)
    print("   %d 条" % len(quote_list))
    raw_lines = site.get("code_collapse_lines")
    code_lines = reading.collapse_lines(site)
    if raw_lines is not None and sml.as_str(raw_lines) != str(code_lines):
        rep.warn("site.sml", "code_collapse_lines `%s` 不可用，已退回 %d 行（合法范围 1–500）"
                 % (sml.as_str(raw_lines), code_lines))
    print("-- 主题词条")
    with _Tick("词条/互助/资源/周报/页"):
        topic_list = topics.build_topics(rep)
        print("   %d 条" % len(topic_list))
        service_list = services.build_services(rep, member_list)
        resources = pages.build_simple("resources", rep, cache, args.offline)
        weekly_raw = pages.build_simple("weekly", rep)
        pages_raw = pages.build_simple("pages", rep)
    print("-- 技术互助")
    print("   %d 条" % len(service_list))
    print("-- 资源 / 周报 / 文档页")
    weekly = [w[0] for w in weekly_raw]
    page_list = sorted([w[0] for w in pages_raw],
                       key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))
    print("   %d 个文档页" % len(page_list))

    with _Tick("关联与系列"):
        ids = {m["id"] for m in member_list}
        for p in post_list:
            if p["author"] and p["author"] not in ids:
                rep.warn(p["file"], "作者 `%s` 没有成员档案" % p["author"])
        for pr in project_list:
            for who in [pr["owner"]] + pr["contributors"]:
                if who and who not in ids:
                    rep.warn("projects/%s.sml" % pr["id"], "成员 `%s` 没有成员档案" % who)

        # 词条 ↔ 文章双向关联：词条显式列 posts，或按同标签自动收
        posts_by_slug = {p["slug"]: p for p in post_list}
        for t in topic_list:
            ids = [s for s in t["posts"] if s in posts_by_slug]
            for p in post_list:
                if p["slug"] not in ids and any(tag in p["tags"] for tag in t["tags"]):
                    ids.append(p["slug"])
            t["resolved"] = ids
            for s in ids:
                posts_by_slug[s].setdefault("topics", []).append(t["id"])
        for t in topic_list:
            missing = [s for s in t["posts"] if s not in posts_by_slug]
            for s in missing:
                rep.warn(t["file"], "词条引用了不存在的文章 slug `%s`" % s)

    series = manifest_mod.build_series(post_list)

    tag_count = {}
    for p in post_list:
        for t in p["tags"]:
            tag_count[t] = tag_count.get(t, 0) + 1
    tags = sorted([{"tag": k, "count": v} for k, v in tag_count.items()], key=lambda x: (-x["count"], x["tag"]))

    out_dir = assets.Out(out)
    with _Tick("写 HTML 产物"):
        for p in post_list:
            out_dir.put_text(p["html"], p["_html"] or "<p>（空）</p>")
            if p.get("map"):
                out_dir.put_text(p["map"], p["_map"])
            # 文章多语言：非默认语言版本单独写盘（如 p/<slug>.en.html），assets 共享
            for v in (p.get("_variants") or {}).values():
                out_dir.put_text(v["html"], v["body"] or "<p>（空）</p>")
        for base, d, ctx, f in weekly_raw + pages_raw:
            where = f.relative_to(paths.ROOT).as_posix()
            html_body, toc = loader.render_body(d, ctx, 1, rep, where)
            out_dir.put_text(base["html"], html_body or "<p>（空）</p>")
            base["toc"] = toc
            base["text"] = render.strip_html(html_body)
            kind = "w" if f.parent.name == "weekly" else "pages"
            base["map"] = "%s/%s.map.svg" % (kind, f.stem)
            prefix = "#/weekly/" if kind == "w" else "#/page/"
            nodes = [dict(x, anchor="%s%s/%s" % (prefix, f.stem, x["id"])) for x in ctx.toc]
            out_dir.put_text(base["map"],
                mindmap.to_svg(mindmap.from_toc(base["title"], nodes), base["title"]))

        for t in topic_list:
            out_dir.put_text(t["html"], t["_html"] or "<p>（空）</p>")
            nodes = [dict(x, anchor="#/topic/%s/%s" % (t["id"], x["id"])) for x in t["toc"]
                     ]
            out_dir.put_text(t["map"],
                             mindmap.to_svg(mindmap.from_toc(t["title"], nodes), t["title"]))

        for s in service_list:
            out_dir.put_text(s["html"], s["_html"] or "<p>（空）</p>")
            nodes = [dict(x, anchor="#/service/%s/%s" % (s["id"], x["id"])) for x in s["toc"]
                     ]
            out_dir.put_text(s["map"],
                             mindmap.to_svg(mindmap.from_toc(s["name"], nodes), s["name"]))

        contract_entry = contract_page.build_contract_page()
        if contract_entry:
            out_dir.put_text(contract_entry["html"], contract_entry["_html"])
            out_dir.put_text(contract_entry["map"], contract_entry["_map"])
            page_list.append({k: v for k, v in contract_entry.items() if not k.startswith("_")})
            page_list.sort(key=lambda x: (x.get("group", ""), x.get("order", 999), x["id"]))

    with _Tick("map/manifest/search"):
        out_dir.put_text("map.svg",
                         manifest_mod.site_map_svg(sml.as_str(site.get("title")), series, post_list,
                                                   project_list, member_list, service_list, resources,
                                                   weekly, topic_list, tags, page_list))
        mani = manifest_mod.build_manifest(site, group, post_list, quote_list, project_list,
                                           member_list, service_list, resources, weekly, topic_list,
                                           page_list, series, tags, code_lines, avatar, args.base_url)
        out_dir.put_text("manifest.json", json.dumps(mani, ensure_ascii=False, indent=1))
        out_dir.put_text("search-index.json",
                         json.dumps(manifest_mod.search_index(post_list, project_list, member_list,
                                                              service_list, resources, topic_list,
                                                              weekly, page_list), ensure_ascii=False))

    _t_llms = _mark("llms")
    # AI 可读的站点文档（llms.txt 约定）：索引放 llms.txt，正文合并放 llms-full.txt
    out_dir.put_text("llms.txt",
                     manifest_mod.llms_txt(mani, post_list, series, topic_list, page_list,
                                           project_list, member_list, service_list, resources))
    out_dir.put_text("llms-full.txt", manifest_mod.llms_full(mani, post_list))
    _span(_t_llms)

    _t_feed = _mark("feed/sitemap/_headers")

    out_dir.put_text("sitemap.xml", manifest_mod.sitemap_xml(mani, post_list, member_list, service_list, topic_list))
    out_dir.put_text("feed.xml", manifest_mod.feed_xml(mani, post_list))
    out_dir.put_text("_headers", manifest_mod.headers_text())

    _span(_t_feed)

    _t_assets = _mark("summaries/assets/theme")
    for p in post_list:
        out_dir.put_text("summaries/" + p["slug"] + ".json",
                         json.dumps(p.get("ai_summary") or {}, ensure_ascii=False, indent=1))
    for p in post_list:
        src = paths.ROOT / Path(p["file"]).parent / "assets"
        if src.exists():
            out_dir.put_copy_dir(src, "assets/posts/" + p["slug"])
    for m in member_list:
        src_rel = m.pop("_avatar_src", "")
        if not src_rel:
            continue
        src = Path(src_rel)
        rel = "assets/members/" + ("%s%s" % (m["id"], src.suffix.lower()))
        out_dir.put_copy(src, rel)
        m["avatar"] = rel
    if avatar:
        out_dir.put_copy(paths.ROOT / avatar, avatar)

    # 递归拷贝主题：可以有子目录（如 vendor/prism/），逐文件登记、跳过未变的。
    # index.html 除外：它由 inject_shell/inject_head 注入后走 put_text。
    out_dir.put_copy_dir(paths.THEME, "", exclude=("index.html",))

    _span(_t_assets)

    _t_fonts = _mark("fonts/shell/head")

    index_html = assets.inject_shell(rep, mani, post_list)      # 静态首屏：站名 + 站点导航 + 最近文章

    bodies = ([p["_html"] for p in post_list]
              + [x.get("_html", "") for x in page_list + weekly + topic_list + service_list])
    fonts_css = fonts.build_fonts(rep, out_dir, mani, bodies)
    index_html, icon = assets.inject_head(rep, mani, avatar, fonts_css, index_html)

    _span(_t_fonts)

    if icon and icon != avatar:
        out_dir.put_copy(paths.ROOT / avatar, icon)   # favicon：源仍是仓库根的群头像
    if icon:
        manifesto = {"name": mani["site"]["title"],
                     "short_name": mani["site"]["title"][:12], "start_url": "./",
                     "display": "standalone", "background_color": "#fbfaf7", "theme_color": "#b4552d",
                     "icons": [{"src": icon, "sizes": "any",
                                "type": assets.MIME.get(Path(icon).suffix.lower(), "image/jpeg")}]}
        out_dir.put_text("site.webmanifest", json.dumps(manifesto, ensure_ascii=False, indent=1))
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
        (out / "build-warnings.json").write_text(
            json.dumps(rep.warnings, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:                       # noqa: BLE001 —— 写告警文件失败不阻断构建
        pass
    if rep.errors and not args.warn_only:
        print("构建失败：%d 个错误" % len(rep.errors))
        return 1
    print("   落盘：写入 %d / 跳过未变 %d / 清理孤儿 %d"
          % (out_dir.wrote, out_dir.skipped, out_dir.removed))
    print("产物：%s（文章 %d / 项目 %d / 成员 %d / 互助 %d）"
          % (out, len(post_list), len(project_list), len(member_list), len(service_list)))
    if args.timing:
        print_timings(time.perf_counter() - _t_start)
    return 0


# ---- 对外名字（测试与工具从 `import engine.build` 取，别再各自去猜新路径）----
GLOBAL_CONTRACTS = contracts.GLOBAL_CONTRACTS
CONTRACT_DEFAULTS = contracts.CONTRACT_DEFAULTS
build_posts = posts.build_posts
build_projects = projects.build_projects
build_members = members.build_members
build_quotes = quotes.build_quotes
build_topics = topics.build_topics
build_services = services.build_services
build_simple = pages.build_simple
build_contract_page = contract_page.build_contract_page
build_fonts = fonts.build_fonts
build_manifest = manifest_mod.build_manifest
build_series = manifest_mod.build_series
site_text = fonts.site_text
guard_out = paths.guard_out
_localize_assets = assets._localize_assets
LICENSE_NOTICE = assets.LICENSE_NOTICE


if __name__ == "__main__":
    sys.exit(main())
