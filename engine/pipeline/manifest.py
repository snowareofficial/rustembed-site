#!/usr/bin/env python3
"""构建器数据出口：manifest / search-index / llms / feed / sitemap / _headers / map.svg
（2026-10-21 自 build.py 的 _run 拆出）。

每个函数都是「纯组装」：参数给全、返回文本或 dict，不自己落盘 —— 由 build.py 的
_run 按原顺序 put_text，产物字节与拆分前一致。调用顺序（map.svg → manifest →
search → llms → feed/sitemap/_headers）保持 _run 里的原样。
"""

import json

from engine.core import urls
from engine.core.report import esc, now_iso
from engine.content.loader import as_list
from engine.parse import sml
from engine.render import mindmap


def site_map_svg(title, series, posts, projects, members, services, resources,
                 weekly, topics, tags, pages):
    """站点结构导图 map.svg（首页「章节结构与导图」弹层与文章页共用）。

    series / posts / … 都是 _run 已算好的集合，这里只按原顺序拼树。
    """
    site_map = {"label": title, "href": "#/", "children": []}
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
    return mindmap.to_svg(site_map, title)


def build_series(posts):
    """manifest.series（_run 里同一段逻辑：series 字段相同的文章收成一个系列，
    order 缺失按 999 排；标题取第一个非空 series_title）。"""
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
    return series


def build_manifest(site, group, posts, quotes, projects, members, services,
                   resources, weekly, topics, pages, series, tags, code_lines,
                   avatar, base_url):
    """manifest.json 的内容（built_at 由 now_iso 决定，BUILT_AT 可固定）。"""
    return {
        "site": {
            "title": sml.as_str(site.get("title")),
            "tagline": sml.as_str(site.get("tagline", "")),
            # site.url 与 repo_url/avatar 同纪律：过白名单后才进 manifest 与
            # og/sitemap/feed 的 URL 出口（站点配置也在 site/content/ 里，算投稿面）
            "url": urls.safe_url(base_url or sml.as_str(
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
            # 阅读习惯参数（前端只用这两个：代码块折叠阈值、首页一言）
            "code_collapse_lines": code_lines,
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
        "quotes": quotes,
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


def search_index(posts, projects, members, services, resources, topics, weekly, pages):
    """search-index.json（前端搜索页唯一数据源；正文截断到 4000 字）。"""
    search = []
    for p in posts:
        search.append({"type": "文章", "title": p["title"], "summary": p["summary"],
                       "tags": p["tags"], "url": "#/post/" + p["slug"],
                       "text": p["_text"][:4000]})
    for pr in projects:
        ptags = (pr.get("tags") or [])
        search.append({"type": "项目", "title": pr["name"], "summary": pr["one_liner"],
                       "tags": pr["languages"] + [t for t in ptags if t not in pr["languages"]],
                       "url": "#/project/" + pr["id"],
                       "text": pr["one_liner"] + " " + " ".join(ptags)})
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
    return search


def llms_txt(manifest, posts, series, topics, pages, projects, members, services, resources):
    """llms.txt：AI 可读的站点索引（llms.txt 约定）。"""
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
    return "\n".join(L) + "\n"


def llms_full(manifest, posts):
    """llms-full.txt：全部文章正文纯文本。"""
    base_url0 = manifest["site"]["url"].rstrip("/")
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
    return "\n".join(F)


def sitemap_xml(manifest, posts, members, services, topics):
    """sitemap.xml（hash 路由：每条 URL 都带 #/ 片段）。"""
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
    return "\n".join(sm)


def feed_xml(manifest, posts):
    """feed.xml（RSS 2.0，最近 20 篇）。"""
    base_url = manifest["site"]["url"].rstrip("/")
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
    return "\n".join(feed)


def headers_text():
    """Cloudflare Pages 的 _headers：给纯文本/AI 索引显式声明 UTF-8。

    不声明时，中文系统上直接打开 llms.txt 会按 GBK 解码成乱码（内容本身是 UTF-8）。
    """
    return "\n".join([
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
    ]) + "\n"
