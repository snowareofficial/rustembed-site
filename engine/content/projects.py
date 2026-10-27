"""项目展示条目：content/projects/*.sml → manifest.projects。"""

from engine.core import contracts, urls
from engine.core.paths import CONTENT, ROOT
from engine.content.loader import as_list, check_req, docs_in, load2, uniq_str
from engine.parse import sml


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
        contracts.register_contracts(rep, where, cs)
        if not contracts.apply_contract(rep, where, d, "project"):
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
