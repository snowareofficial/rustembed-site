"""技术互助：成员自愿登记的纯展示条目。"""

from engine.core import contracts
from engine.core.paths import CONTENT, ROOT
from engine.content.loader import as_list, check_req, docs_in, load2, render_body
from engine.parse import sml
from engine.render import render

# 技术互助条目固定尾部：性质声明 + 免责声明。纯展示，不交易、不担保、不抽成、
# 不经手资金、不介入纠纷；条目由 owner 本人提供并自负其责，本站不背书。
SERVICE_DISCLAIMER = (
    '<aside class="admonition warn"><p><strong>免责声明</strong>：本站只展示这条信息：'
    '不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。'
    '本条互助信息由成员本人提供并自负其责，不代表本站对任何个人或服务的认可或背书；'
    '是否协作、如何协作，请自行判断并在站外约定。'
    '联系方式仅引用成员档案中本人授权公开的字段，本站不代收任何新联系方式。'
    '条目内容按站点默认许可 CC BY-NC-SA 4.0（非商业）发布。</p></aside>\n')


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
        contracts.register_contracts(rep, where, cs)
        if not contracts.apply_contract(rep, where, d, "service"):
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
