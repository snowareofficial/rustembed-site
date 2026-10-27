"""构建期生成可点击的导图目录（SVG）。

不依赖外部工具：自写整齐树布局 + SVG 输出，节点用 <a> 包裹，点击即跳转（hash 路由）。
节点结构：{"label": str, "href": str|None, "children": [...]}
"""

import html

ROW = 38
COL_GAP = 46
NODE_H = 28
PAD = 20
MIN_W = 96
MAX_W = 300


def _units(s):
    return sum(2 if ord(c) > 0x2E80 else 1 for c in str(s))


def _node_w(label):
    return max(MIN_W, min(MAX_W, 26 + 7.4 * _units(label)))


def _esc(s):
    return html.escape(str(s), quote=True)


def _layout(node, depth, cols, cursor):
    node["_depth"] = depth
    w = _node_w(node["label"])
    node["_w"] = w
    cols[depth] = max(cols.get(depth, 0), w)
    kids = node.get("children") or []
    if not kids:
        node["_y"] = cursor[0]
        cursor[0] += ROW
    else:
        for k in kids:
            _layout(k, depth + 1, cols, cursor)
        node["_y"] = (kids[0]["_y"] + kids[-1]["_y"]) / 2.0
    node["_h"] = NODE_H


def _assign_x(node, cols):
    x = PAD
    for d in range(node["_depth"]):
        x += cols.get(d, MIN_W) + COL_GAP
    node["_x"] = x
    for k in node.get("children") or []:
        _assign_x(k, cols)


def _walk(node, fn):
    fn(node)
    for k in node.get("children") or []:
        _walk(k, fn)


def to_svg(root, title=""):
    cols = {}
    cursor = [PAD]
    _layout(root, 0, cols, cursor)
    _assign_x(root, cols)
    max_x = [0]
    max_y = [0]
    _walk(root, lambda n: (max_x.__setitem__(0, max(max_x[0], n["_x"] + n["_w"])),
                           max_y.__setitem__(0, max(max_y[0], n["_y"] + NODE_H))))
    w = int(max_x[0] + PAD)
    h = int(max_y[0] + PAD)

    out = ['<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           'width="%d" height="%d" viewBox="0 0 %d %d" font-family="-apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif">'
           % (w, h, w, h)]
    if title:
        out.append("<title>%s</title>" % _esc(title))
    out.append("<style>.nd{fill:#fff;stroke:#e4dfd6;rx:8} .rt{fill:#f6efe6;stroke:#d9c9b0}"
               ".tx{font-size:13px;fill:#23201c} .lk{cursor:pointer}"
               ".lk:hover .nd{stroke:#b4552d;fill:#fff8f2} .ed{fill:none;stroke:#ddd6c9;stroke-width:1.4}</style>")

    out.append('<g class="edges">')
    def edge(n):
        for k in n.get("children") or []:
            x1 = n["_x"] + n["_w"]
            y1 = n["_y"] + NODE_H / 2.0
            x2 = k["_x"]
            y2 = k["_y"] + NODE_H / 2.0
            mx = (x1 + x2) / 2.0
            out.append('<path class="ed" d="M%.1f %.1f C%.1f %.1f %.1f %.1f %.1f %.1f"/>'
                       % (x1, y1, mx, y1, mx, y2, x2, y2))
    _walk(root, edge)
    out.append("</g>")

    out.append('<g class="nodes">')
    def node(n):
        label = n["label"]
        used = 0
        text = ""
        for ch in label:
            used += 2 if ord(ch) > 0x2E80 else 1
            if used > (MAX_W - 24) / 7.4:
                text += "…"
                break
            text += ch
        cls = "nd rt" if n["_depth"] == 0 else "nd"
        inner = ('<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%d" rx="8"/>'
                 '<text class="tx" x="%.1f" y="%.1f">%s</text>'
                 % (cls, n["_x"], n["_y"], n["_w"], NODE_H,
                    n["_x"] + 10, n["_y"] + 19, _esc(text)))
        href = n.get("href")
        if href:
            out.append('<a class="lk" href="%s" xlink:href="%s">%s</a>' % (_esc(href), _esc(href), inner))
        else:
            out.append(inner)
    _walk(root, node)
    out.append("</g></svg>")
    return "\n".join(out)


def from_toc(title, toc, number=False):
    """章节树：把扁平的 toc（含 level）转成导图节点树。

    number=True 时按论文式给节点编号（1 / 1.1 / 1.1.1），让「更细的索引」可读。
    """
    root = {"label": title, "href": None, "children": []}
    stack = [(0, root)]
    counters = {}
    for item in toc:
        label = item.get("text") or item.get("id")
        node = {"label": label, "children": []}
        lvl = item.get("level", 2)
        if number:
            counters[lvl] = counters.get(lvl, 0) + 1
            for deeper in [k for k in counters if k > lvl]:
                counters.pop(deeper, None)
            num = ".".join(str(counters.get(k, 1)) for k in sorted(counters) if k <= lvl)
            node["label"] = num + " " + str(label)
        if item.get("anchor"):
            node["href"] = item["anchor"]
        while stack and stack[-1][0] >= lvl:
            stack.pop()
        parent = stack[-1][1] if stack else root
        parent["children"].append(node)
        stack.append((lvl, node))
    return root
