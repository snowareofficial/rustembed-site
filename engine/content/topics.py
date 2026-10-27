"""主题词条：一个词条聚合多篇文章 + 定义。"""

from engine.core import contracts
from engine.core.paths import CONTENT, ROOT
from engine.content.loader import as_list, check_req, docs_in, load2, render_body
from engine.parse import sml
from engine.render import render


def build_topics(rep):
    out = []
    for f in docs_in(CONTENT / "topics"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        contracts.register_contracts(rep, where, cs)
        if not contracts.apply_contract(rep, where, d, "topic"):
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
