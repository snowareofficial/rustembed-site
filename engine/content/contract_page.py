"""内容契约文档页：从契约表自动生成，代码即文档。"""

from engine.core import contract as contract_mod
from engine.core import contracts
from engine.render import mindmap, render


def build_contract_page():
    table = contracts.GLOBAL_CONTRACTS
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
