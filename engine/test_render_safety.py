#!/usr/bin/env python3
"""渲染安全与构建守卫的回归测试。

    python engine/test_render_safety.py

钉住四类「改错了不会有人发现」的问题：

  1. 契约名拼进 HTML 属性时未转义 → 可执行 XSS
     （契约文档页由 build.py 的 build_contract_page() 生成）
  2. 内联角色对**已转义**文本再转义一次 → {math:a < b} 显示成字面量、
     带 & 的 {link:} 变成坏链
  3. Markdown 嵌套列表把 Python list 的 repr 打印到页面，或直接抛 TypeError
  4. --out 指向源码目录 → clean_out() 会递归清空它

这些用例都对应实际发生过的缺陷，属于「加你踩过的坑当断言」。
"""

import re
import sys
import tempfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(ENGINE / "lib"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

import build as B            # noqa: E402
import markdown as md        # noqa: E402
import render as R           # noqa: E402
import sml                   # noqa: E402
import cli as C              # noqa: E402  (图片尺寸解析，纯 stdlib)

FAILS = []
COUNT = [0]


def case(name, cond, detail=""):
    COUNT[0] += 1
    if cond:
        print("  ok   %s" % name)
    else:
        print("  FAIL %s" % name)
        if detail:
            print("       %s" % str(detail)[:400])
        FAILS.append(name)


# ---------------------------------------------------------------- 1. XSS
def test_contract_page_escaping():
    print("[1] 契约文档页转义（XSS）")

    # 契约名是自由文本，sml.bare() 只把空白与 }]{,#: 当终止符，
    # 引号与尖括号都会原样进名字 —— 必须靠转义兜住。
    payloads = [
        '@contract x"><script>alert(1)</script> { a: string }',
        '@contract x"><img/src=x/onerror=alert(1)> { a: string }',
        '@contract x"><svg/onload=alert(1)> { a: string }',
    ]
    saved = B.GLOBAL_CONTRACTS
    try:
        for src in payloads:
            _val, contracts = B.sml.parse_doc(src, path="<test>")
            if not contracts:
                case("解析出契约名：%s" % src[:40], False, "契约表为空")
                continue
            B.GLOBAL_CONTRACTS = dict(contracts)
            page = B.build_contract_page()
            body = page["_html"]
            svg = page["_map"]

            # 断言方式很关键：不能查 "<img"/"onerror" 这类子串 ——
            #   * 转义后的惰性文本 &lt;img/src=x/onerror=…&gt; 里 "onerror" 仍在；
            #   * 导图本来就是 SVG，"<svg" 是它自己的根元素。
            # 所以直接对照「注入片段本身」：原样的不许在，转义后的必须在。
            hostile = list(contracts)[0].split('">', 1)[1]
            esc_hostile = (hostile.replace("&", "&amp;").replace("<", "&lt;")
                           .replace(">", "&gt;").replace('"', "&quot;"))
            label = "%s…" % hostile[:20]

            case("契约页无原样注入片段 %s" % label, hostile not in body, body[:300])
            case("契约页导图无原样注入片段 %s" % label, hostile not in svg, svg[:300])
            case("契约页已转义注入片段 %s" % label, esc_hostile in body, body[:300])
            case("契约页导图已转义注入片段 %s" % label, esc_hostile in svg, svg[:300])
            case("契约页无内联事件属性 %s" % label,
                 not re.search(r"\son[a-z]+\s*=", body, re.I), body[:300])
    finally:
        B.GLOBAL_CONTRACTS = saved

    # 正向对照：确认引号与尖括号确实被转义了。
    # 缺这一条，上面那批负向断言在「整段根本没生成」时也会假通过。
    _val, c2 = B.sml.parse_doc('@contract x"><b> { a: string }', path="<test>")
    B.GLOBAL_CONTRACTS = dict(c2)
    try:
        p2 = B.build_contract_page()
        case("契约页确实转义了引号与尖括号（正向对照）",
             "&quot;&gt;" in p2["_html"] and "&quot;&gt;" in p2["_map"],
             p2["_html"][:200])
    finally:
        B.GLOBAL_CONTRACTS = saved

    # 正常的契约名不该被改坏
    _val, contracts = B.sml.parse_doc("@contract BlogPost { title: str }", path="<test>")
    B.GLOBAL_CONTRACTS = dict(contracts)
    try:
        page = B.build_contract_page()
        case("正常契约名仍然生成标题",
             '<h2 id="contract-BlogPost">' in page["_html"], page["_html"][:300])
        case("正常契约名仍进 toc",
             any(t["id"] == "contract-BlogPost" for t in page["toc"]), page["toc"])
    finally:
        B.GLOBAL_CONTRACTS = saved


# ------------------------------------------------- 2. 内联角色不双重转义
def test_inline_roles():
    print("[2] 内联角色转义")

    case("math 里的 < 只转义一次",
         R.inline("{math:a < b}") == '<span class="math">\\(a &lt; b\\)</span>',
         R.inline("{math:a < b}"))
    case("link 里的 & 只转义一次",
         R.inline("{link:https://a.example/?a=1&b=2|click}")
         == '<a href="https://a.example/?a=1&amp;b=2" target="_blank" '
            'rel="nofollow noopener">click</a>',
         R.inline("{link:https://a.example/?a=1&b=2|click}"))
    case("strong 里的 & 只转义一次",
         R.inline("{strong:A & B}") == "<strong>A &amp; B</strong>",
         R.inline("{strong:A & B}"))
    case("term / em 同理",
         R.inline("{term:R&D}") == "<dfn>R&amp;D</dfn>"
         and R.inline("{em:x < y}") == "<em>x &lt; y</em>",
         R.inline("{term:R&D}") + " | " + R.inline("{em:x < y}"))
    case("角色外的裸标签被转义",
         "<script" not in R.inline("<script>alert(1)</script>").lower(),
         R.inline("<script>alert(1)</script>"))
    case("未识别的角色原样保留",
         R.inline("{nope:x}") == "{nope:x}", R.inline("{nope:x}"))

    # Markdown 侧
    case("Markdown 图片 src 不多转一次",
         "a&amp;b.png" in md.md_inline("![图](assets/a&b.png)")
         and "a&amp;amp;b.png" not in md.md_inline("![图](assets/a&b.png)"),
         md.md_inline("![图](assets/a&b.png)"))


# ------------------------------------------------------- 3. 嵌套列表
def test_nested_lists():
    print("[3] Markdown 列表")

    html, _ = md.render("- a\n- b\n")
    case("扁列表行为不变",
         html == "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n", repr(html))

    html, _ = md.render("1. a\n2. b\n")
    case("有序列表仍用 <ol>",
         html.startswith("<ol>") and html.count("<li>") == 2, repr(html))

    html, _ = md.render("- a\n  - b\n- c\n")
    case("一层嵌套不再打印 Python repr",
         "[" not in html and "]" not in html, repr(html))
    case("一层嵌套产出配对的 <ul>",
         html.count("<ul>") == 2 and html.count("</ul>") == 2, repr(html))
    case("一层嵌套的 <li> 数量正确",
         html.count("<li>") == 3, repr(html))
    case("一层嵌套的 <li> 标签配对",
         html.count("<li>") == html.count("</li>"), repr(html))

    try:
        html, _ = md.render("- a\n    - b\n  - c\n")
        crashed = None
    except Exception as exc:                      # noqa: BLE001
        html, crashed = "", "%s: %s" % (type(exc).__name__, exc)
    case("缩进错位不再抛 TypeError", crashed is None, crashed)
    if crashed is None:
        case("缩进错位仍配平",
             html.count("<ul>") == html.count("</ul>")
             and html.count("<li>") == html.count("</li>"), repr(html))


# --------------------------------------------------------- 4. --out 守卫
def test_out_guard():
    print("[4] --out 守卫")

    repo = Path(B.config.REPO).resolve()
    site = Path(B.config.SITE).resolve()
    dist = Path(B.config.OUT).resolve()

    def refused(target):
        try:
            B.guard_out(str(target))
            return False
        except SystemExit:
            return True

    case("拒绝仓库根（--out .）", refused(repo), repo)
    case("拒绝站点目录（--out site）", refused(site), site)
    case("拒绝源码目录（--out engine）", refused(repo / "engine"), repo / "engine")
    case("拒绝 .git", refused(repo / ".git"), repo / ".git")
    case("拒绝上级目录（会删掉整个上级）", refused(repo.parent), repo.parent)
    case("放行默认 dist/", not refused(dist), dist)
    case("放行 dist/ 的子目录", not refused(dist / "x"), dist / "x")
    case("放行仓库外目录",
         not refused(Path(tempfile.gettempdir()) / "rec-blog-out"),
         Path(tempfile.gettempdir()) / "rec-blog-out")


# ------------------------------------------------------- 5. 新块 MD 渲染
def test_new_blocks_equality():
    print("[5] 新块 MD 渲染")

    # panel
    md_text = ":::panel 结论先行\n正文内容\n:::"
    html_md, _ = md.render(md_text)
    case("panel MD 渲染正常", 'class="panel"' in html_md, html_md)

    # steps：外层 <ol class="steps">，内部直接 <li>，不得再套 <ol>/<ul>
    md_text = ":::steps\n- 第一步\n- 第二步\n:::"
    html_md, _ = md.render(md_text)
    case("steps MD 精确结构", html_md == '<ol class="steps">\n<li>第一步</li>\n<li>第二步</li>\n</ol>\n', html_md)
    case("steps 无嵌套 ol/ul", "<ul>" not in html_md and html_md.count("<ol") == 1, html_md)

    # term：逐行 <br> 连接，内部不得出现 <p>
    md_text = ":::term\n$ echo hello\n$ echo world\n:::"
    html_md, _ = md.render(md_text)
    case("term MD 精确结构",
         html_md == '<div class="term">\n$ echo hello<br>\n$ echo world\n</div>\n', html_md)
    case("term 内部无 <p>", "<p" not in html_md, html_md)

    # when
    md_text = ":::when 2026-10-16 发布会\n标题\n:::"
    html_md, _ = md.render(md_text)
    case("when MD 渲染正常", 'class="when"' in html_md, html_md)

    # shot：非全宽不带 class，全宽带 class="full"，有图注带 <figcaption>
    md_text = ':::shot\n![接线](assets/a.png "图注")\n:::'
    html_md, _ = md.render(md_text)
    case("shot 非全宽精确结构",
         html_md == '<figure>\n<img src="assets/a.png" alt="接线" loading="lazy">'
                    '<figcaption>图注</figcaption>\n</figure>\n', html_md)
    md_text = ':::shot full\n![接线](assets/a.png "图注")\n:::'
    html_md, _ = md.render(md_text)
    case("shot 全宽精确结构",
         html_md == '<figure class="full">\n<img src="assets/a.png" alt="接线" loading="lazy">'
                    '<figcaption>图注</figcaption>\n</figure>\n', html_md)

    # shot 非图片语法：降级为普通段落 + 告警，页面里不得出现「错误：」文案
    md_text = ":::shot\n随便一段文字\n:::"
    html_md, _ = md.render(md_text)
    case("shot 非图片降级为段落", "<p>随便一段文字</p>" in html_md, html_md)
    case("shot 降级不输出错误文案", "错误：" not in html_md, html_md)

    # 空 shot：无「错误：」文案、无 figure
    md_text = ":::shot\n:::"
    html_md, _ = md.render(md_text)
    case("空 shot 不输出错误文案", "错误：" not in html_md and "<figure" not in html_md, html_md)

    # gallery：含两张图则输出两个 <figure>，不得留空 div / 注释垃圾
    md_text = ":::gallery 2\n![a](a.png)\n![b](b.png)\n:::"
    html_md, _ = md.render(md_text)
    case("gallery 含两张图", html_md.count("<figure>") == 2, html_md)
    case("gallery 无空 div", '<div class="gallery' in html_md and "</div>" in html_md, html_md)

    # 空 gallery：不输出 div、不留注释垃圾
    md_text = ":::gallery 2\n:::"
    html_md, _ = md.render(md_text)
    case("空 gallery 不输出 div", '<div class="gallery' not in html_md, html_md)
    case("空 gallery 不留注释垃圾", "<!--" not in html_md, html_md)

    # MD ↔ SML 逐字节一致性（与 engine/verify_parity.py 同一张对照表）：
    # 每个块给出 (Markdown 源码, SML 值) 两条等价输入，比对逐字节 HTML。
    _parity = [
        ("panel", ":::panel 结论先行\n正文内容\n:::",
         {"__type": "panel", "title": "结论先行", "children": ["正文内容"]}),
        ("shot 普通带图注", ':::shot\n![接线](assets/a.png "图注")\n:::',
         {"__type": "shot", "src": "assets/a.png", "alt": "接线", "caption": "图注"}),
        ("shot full 带图注", ':::shot full\n![接线](assets/a.png "图注")\n:::',
         {"__type": "shot", "src": "assets/a.png", "alt": "接线", "caption": "图注", "full": True}),
        ("gallery 2 张", ":::gallery 2\n![](a.png)\n![](b.png)\n:::",
         {"__type": "gallery", "cols": "2",
          "children": [{"__type": "img", "src": "a.png"}, {"__type": "img", "src": "b.png"}]}),
        ("gallery 1 张", ":::gallery\n![](a.png)\n:::",
         {"__type": "gallery", "children": [{"__type": "img", "src": "a.png"}]}),
        ("gallery 0 张", ":::gallery 2\n:::",
         {"__type": "gallery", "children": []}),
        ("term text 多行", ":::term\n$ cargo build\nFinished\n:::",
         {"__type": "term", "text": "$ cargo build\nFinished"}),
        ("term children 多行", ":::term\n$ cargo build\nFinished\n:::",
         {"__type": "term", "children": ["$ cargo build", "Finished"]}),
        ("steps 短横", ":::steps\n- 装工具链\n- 配环境\n:::",
         {"__type": "steps", "items": ["装工具链", "配环境"]}),
        ("steps 数字", ":::steps\n1. 装工具链\n2. 配环境\n:::",
         {"__type": "steps", "items": ["装工具链", "配环境"]}),
        ("when 单行", ":::when 2026-10-16 围栏落地\n:::",
         {"__type": "when", "date": "2026-10-16", "text": "围栏落地"}),
        ("when 多行", ":::when 2026-10-16\n围栏落地 补齐渲染。\n:::",
         {"__type": "when", "date": "2026-10-16", "text": "围栏落地 补齐渲染。"}),
    ]
    for _name, _md_text, _sml_value in _parity:
        _h_md, _ = md.render(_md_text)
        _h_sml = R.render(_sml_value)
        case("MD↔SML 逐字节一致：%s" % _name, _h_md == _h_sml,
             "\n  MD : %s\n  SML: %s" % (repr(_h_md), repr(_h_sml)))


# ------------------------------------------------- 6. 图片尺寸解析（纯 stdlib）
def test_image_size():
    print("[6] 图片尺寸解析（PNG/JPEG/WebP）")
    import struct
    import tempfile

    # 现造最小合法字节串：PNG 1600x800
    png = (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
           + struct.pack(">I", 1600) + struct.pack(">I", 800)
           + b"\x08\x06\x00\x00\x00" + b"\x00" * 4)
    # JPEG（关键帧）：宽 640、高 640（APP0 段长度需与载荷一致）
    jpeg = (b"\xff\xd8"
            + b"\xff\xe0" + struct.pack(">H", 15) + b"JFIF" + b"\x00" * 9
            + b"\xff\xc0" + struct.pack(">H", 10) + b"\x08"
            + struct.pack(">H", 640) + struct.pack(">H", 640) + b"\x01\x11\x11"
            + b"\xff\xd9")
    # WebP（VP8L 无损）：宽 640、高 480
    w, h = 640, 480
    bits = (w - 1) | ((h - 1) << 14)
    vp8l = b"\x2f" + bits.to_bytes(4, "little")
    webp = (b"RIFF" + struct.pack("<I", 8 + len(vp8l)) + b"WEBP"
            + b"VP8L" + struct.pack("<I", len(vp8l)) + vp8l)

    with tempfile.TemporaryDirectory() as d:
        for name, blob, exp in (("a.png", png, (1600, 800)),
                                ("a.jpg", jpeg, (640, 640)),
                                ("a.webp", webp, (640, 480))):
            p = Path(d) / name
            p.write_bytes(blob)
            got = C._read_image_size(p)
            case("尺寸解析 %s" % name, got == exp, (name, got, exp))
        # 无法识别的字节串必须返回 (None, None)，不抛异常
        bad = Path(d) / "bad.bin"
        bad.write_bytes(b"not an image at all")
        case("非法字节返回 (None, None)", C._read_image_size(bad) == (None, None), bad)


# ----------------------------------------- 8. 代码块外壳（MD 与 SML 一致 + 语言名净化）
def test_code_block_consistency():
    print("[8] 代码块外壳（MD↔SML 一致 + 净化）")

    # 同一段代码：markdown.render 与 render.render 产出的 <div class="code">…</div> 必须逐字节相等
    sml_obj = {"__type": "code", "lang": "rust", "text": "fn main() {}"}
    html_sml = R.render(sml_obj)
    html_md, _ = md.render("```rust\nfn main() {}\n```")
    case("MD 与 SML 代码块逐字节一致（带语言）", html_md == html_sml,
         "\n  MD : %s\n  SML: %s" % (repr(html_md), repr(html_sml)))

    # 无语言：两端都应是 language-text，且结构一致
    sml_obj2 = {"__type": "code", "text": "plain code"}
    html_sml2 = R.render(sml_obj2)
    html_md2, _ = md.render("```\nplain code\n```")
    case("MD 与 SML 代码块逐字节一致（无语言）", html_md2 == html_sml2,
         "\n  MD : %s\n  SML: %s" % (repr(html_md2), repr(html_sml2)))

    # 目标结构：外壳 + 头部（标签 + 复制按钮）+ 不变的 <pre><code> 层级
    case("代码块含 .code 外壳",
         html_sml.startswith('<div class="code">\n') and html_sml.rstrip().endswith("</div>"),
         html_sml)
    case("代码块含 .code-head 与复制按钮",
         '<div class="code-head"><span>rust</span>'
         '<button class="copy" type="button" aria-label="复制代码">复制</button></div>' in html_sml,
         html_sml)
    case("<code> 仍在 <pre> 内（层级不变）",
         '<pre><code class="language-rust">fn main() {}</code></pre>' in html_sml, html_sml)

    # 语言名净化：非法字符一律退化为 text，绝不把作者输入原样塞进 class / 标签
    bad = R.code_block('<script>', 'x')
    case("非法语言名不出现 <script", "<script" not in bad.lower(), bad)
    case("非法语言名标签位显示 text", "<span>text</span>" in bad, bad)
    case("非法语言名 class 退化为 language-text", "language-text" in bad, bad)

    long_lang = R.code_block("x" * 21, "x")
    case("超长语言名退化为 text", "<span>text</span>" in long_lang, long_lang)
    inj = R.code_block("py;drop", "x")
    case("含非法字符的语言名退化为 text", "<span>text</span>" in inj, inj)

    # 合法语言名（含铁臂字符）原样保留
    ok = R.code_block("c++", "x")
    case("合法语言名 c++ 保留", '<span>c++</span>' in ok and "language-c++" in ok, ok)



def _unwanted_raw_under_test(text):
    """与 check.py 中 _unwanted_raw 完全相同的逻辑，用于证明口径有效。"""
    benign = re.compile(
        r"</?(?:strong|em|code|span|a|b|i|u|del|s|dfn|sub|sup|kbd|mark|abbr|q|cite|small)\b[^>]*>"
        r"|</?figure>|</?figcaption>|<br\s*/?>|<img\b[^>]*>"
        r"|<svg\b.*?</svg>|<!--.*?-->", re.I | re.S)
    t = benign.sub("", text)
    if "<" in t:
        return True
    if re.search(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)", t):
        return True
    return False


def test_unescaped_check():
    print("[7] 未转义检测口径")
    # 下面是标签内文本（check.py 取 <p>(.*?)</p> 的内部文本，已不含外层 <p>）
    # 合法内联标签不应被误报（之前用 .*? + '<' in text 会误伤 <strong>）
    benign = "正文 <strong>粗体</strong> 与 <em>斜体</em> 结尾"
    case("合法内联标签不误报", not _unwanted_raw_under_test(benign), benign)
    # 渲染器实际产出的 del / dfn 等也不得误报
    case("del/dfn 等合法标签不误报",
         not _unwanted_raw_under_test("支持 <del>删除线</del> 与 <dfn>术语</dfn>"),
         "del/dfn")
    # 裸 < 必须被抓出（能真正失败，而非空操作）
    raw_lt = "看 3 < 5 这个不等式"
    case("裸 < 被抓出", _unwanted_raw_under_test(raw_lt), raw_lt)
    # 裸 script 必须被抓出
    raw_script = "危险 <script>alert(1)</script>"
    case("裸 script 被抓出", _unwanted_raw_under_test(raw_script), raw_script)
    # 合法实体 &amp; 不误报
    case("&amp; 不误报", not _unwanted_raw_under_test("A&amp;B"), "&amp;")
    # 未转义 & 被抓出
    case("裸 & 被抓出", _unwanted_raw_under_test("AT&T 公司"), "AT&T")


# ----------------------------------------- 9. assets 生成器（cli.py）
def test_assets_generator():
    print("[9] assets 生成器（cli.py）")

    # 1) _is_full 阈值边界：宽 1600、宽高比 1.8
    case("_is_full 1599x1000 -> False", C._is_full(1599, 1000) is False, C._is_full(1599, 1000))
    case("_is_full 1600x1000 -> True", C._is_full(1600, 1000) is True, C._is_full(1600, 1000))
    case("_is_full 1000x600 -> False", C._is_full(1000, 600) is False, C._is_full(1000, 600))
    case("_is_full 1001x600 -> False", C._is_full(1001, 600) is False, C._is_full(1001, 600))
    # 1.8 宽高比边界（宽 < 1600，仅由比例决定，避免被宽度阈值覆盖）
    case("_is_full 1500x834 -> False", C._is_full(1500, 834) is False, C._is_full(1500, 834))
    case("_is_full 1500x833 -> True", C._is_full(1500, 833) is True, C._is_full(1500, 833))
    case("_is_full 尺寸缺失 -> False",
         C._is_full(0, 100) is False and C._is_full(100, 0) is False)
    # 用户报障专项：1600×800 横图必须判为 full（宽 >= 1600 触发），与 MD/SML 一致
    case("_is_full 1600x800 -> True", C._is_full(1600, 800) is True, C._is_full(1600, 800))

    # 造三张真 PNG 到临时文章目录（纯 stdlib，与 _read_image_size 互验）
    import struct as _s, zlib as _z, tempfile as _tf, io as _io, re as _re
    from pathlib import Path as _P
    def _mk_png(p, w, h):
        raw = bytearray()
        row = b"\x00" + b"\x88\x99\xaa" * w
        for _ in range(h):
            raw += row
        def _ck(t, d):
            c = t + d
            return _s.pack(">I", len(d)) + c + _s.pack(">I", _z.crc32(c) & 0xffffffff)
        sig = b"\x89PNG\r\n\x1a\n"
        ihdr = _s.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
        with open(p, "wb") as f:
            f.write(sig + _ck(b"IHDR", ihdr)
                    + _ck(b"IDAT", _z.compress(bytes(raw), 9)) + _ck(b"IEND", b""))
    # 不同宽高比 -> 不会合并成图集，便于逐张比对 full
    specs = [("a-wide.png", 2000, 600), ("b-tall.png", 700, 700), ("c-small.png", 400, 300)]
    d = _P(_tf.mkdtemp()) / "post" / "assets"
    d.mkdir(parents=True)
    for name, w, h in specs:
        _mk_png(d / name, w, h)

    class _A:
        pass
    def _run(style):
        a = _A()
        a.post_dir = str(d.parent); a.style = style; a.ratio = "2"; a.write = None
        buf = _io.StringIO()
        old = sys.stdout
        try:
            sys.stdout = buf
            C.cmd_assets(a)
        finally:
            sys.stdout = old
        return buf.getvalue()

    out_md = _run("md")
    out_sml = _run("sml")

    # 2) 输出里的图片引用必须带 assets/ 前缀，且不得出现未加前缀的裸路径
    for name, _, _ in specs:
        case("MD 引用带 assets/ 前缀：%s" % name, ("assets/" + name) in out_md, out_md)
        case("SML 引用带 assets/ 前缀：%s" % name, ("assets/" + name) in out_sml, out_sml)
        case("MD 无裸路径 %s" % name, ("](%s)" % name) not in out_md, out_md)
        case("SML 无裸路径 %s" % name, ('src: "%s"' % name) not in out_sml, out_sml)

    # 缺陷 1 边界：直接传 assets 目录，仍输出 assets/，不得 assets/assets/
    a2 = _A()
    a2.post_dir = str(d); a2.style = "md"; a2.ratio = "2"; a2.write = None
    buf = _io.StringIO()
    old = sys.stdout
    try:
        sys.stdout = buf
        C.cmd_assets(a2)
    finally:
        sys.stdout = old
    edge = buf.getvalue()
    case("直接传 assets 目录仍输出 assets/ 前缀", ("assets/" + specs[0][0]) in edge, edge)
    case("直接传 assets 目录无 assets/assets/ 双前缀", "assets/assets/" not in edge, edge)

    # 3) MD 与 SML 的 full 判定逐张一致（不用子串存在性，比对 (name, full) 序列）
    def _md_pairs(out):
        res = []
        for m in _re.finditer(r":::shot( full)?\n!\[说明\]\(assets/([^\"\s]+)", out):
            res.append((m.group(2), bool(m.group(1))))
        return res
    def _sml_pairs(out):
        res = []
        for line in out.splitlines():
            if "shot {" in line:
                nm = _re.search(r'src: "assets/([^"]+)"', line)
                if nm:
                    res.append((nm.group(1), "full: true" in line))
        return res
    pm, ps = _md_pairs(out_md), _sml_pairs(out_sml)
    case("MD 与 SML 的 full 判定逐张一致", pm == ps,
         "\n  MD : %s\n  SML: %s" % (pm, ps))


def main():
    print("== rec-blog 渲染安全回归 ==")
    test_contract_page_escaping()
    test_inline_roles()
    test_nested_lists()
    test_out_guard()
    test_new_blocks_equality()
    test_image_size()
    test_unescaped_check()
    test_code_block_consistency()
    test_assets_generator()
    print("\n%d 项断言" % COUNT[0])
    if FAILS:
        print("失败 %d 项：" % len(FAILS))
        for f in FAILS:
            print("  - %s" % f)
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
