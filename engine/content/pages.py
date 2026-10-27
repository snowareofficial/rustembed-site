"""资源 / 周报 / 文档页：形状相近的「简单条目」共用一个构建器。"""

from engine.core import contracts, urls
from engine.core.paths import CONTENT, ROOT
from engine.content import repo_meta
from engine.content.loader import as_list, check_req, docs_in, load2
from engine.parse import sml
from engine.render import render


def build_simple(kind, rep, cache=None, offline=False):
    out = []
    for f in docs_in(CONTENT / kind):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        contracts.register_contracts(rep, where, cs)
        if not contracts.apply_contract(rep, where, d, {"resources": "resource", "pages": "page"}.get(kind, kind)):
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
