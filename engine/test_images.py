#!/usr/bin/env python3
"""图片引用自测：钉住「怎么找引用」与「怎么认坏图」的判定。

    python engine/test_images.py

覆盖三件事：
  · 引用识别：Markdown 代码块 / 行内代码里的教学示例不算引用（否则审计天天误报）；
    SML 里显式图片键与字符串里的 Markdown 图要能分开（文档示例只查外链）；
  · 坏图判定：magic bytes 认格式、0 字节、下载成 HTML 错误页；
  · 端到端：外链门禁真的让构建失败，审计脚本对当前站点退出码为 0。
"""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

import imgcheck as ic  # noqa: E402


def _run(args):
    """跑子进程并取回文本：Windows 控制台默认 GBK，不指定编码会解不动 UTF-8 输出。"""
    return subprocess.run([sys.executable] + args, cwd=str(ROOT), capture_output=True,
                          encoding="utf-8", errors="replace")


def main():
    failed = []
    count = [0]

    def case(name, got, want):
        count[0] += 1
        if got != want:
            failed.append("%s：期望 %r，实得 %r" % (name, want, got))

    # ---------- 1. 引用识别 ----------
    md = "正文 ![图](assets/a.png)\n"
    md += "```\n![示例](assets/x.png)\n```\n"
    md += "行内 `![示例](assets/y.png)` 不算\n"
    case("Markdown：代码块与行内代码不算引用", ic.md_image_refs(md), [(1, "assets/a.png")])
    case("Markdown：带图注与查询串",
          ic.md_image_refs('![图](assets/a.png "注")\n![图2](assets/b.png?v=2)'),
          [(1, "assets/a.png"), (2, "assets/b.png?v=2")])
    case("Markdown：原生 HTML <img> 也收",
          [r for _, r, o in ic.text_refs("a.md", '<img src="assets/c.png" alt="x">')],
          ["assets/c.png"])

    sml = 'shot { src: "assets/a.png" alt: "图" }\n'
    sml += 'table { rows: [ [ "![说明](assets/x.png)" "图片" ] ] }\n'
    case("SML：显式键与字符串示例分开",
          (ic.sml_key_refs(sml), ic.sml_text_refs(sml)),
          ([(1, "assets/a.png")], [(2, "assets/x.png")]))

    case("来源标记：md / sml-key / sml-text",
          [o for _, _, o in ic.text_refs("a.md", "![x](a.png)")]
          + [o for _, _, o in ic.text_refs("a.sml", 'img { src: "b.png" }')]
          + [o for _, _, o in ic.text_refs("a.sml", 'para { text: "![x](c.png)" }')],
          ["md", "sml-key", "sml-text"])

    case("CSS：url(...) 只收图片", ic.css_url_refs("a{background:url(assets/bg.png)}"),
          [(1, "assets/bg.png")])
    case("JS：字符串里的图片路径", ic.js_string_refs("var s = 'assets/x.png';"),
          [(1, "assets/x.png")])

    # ---------- 2. 外链 / 类型判定 ----------
    for ref, want in [("https://a/b.png", True), ("http://a/b.png", True),
                      ("//a/b.png", True), ("assets/a.png", False), ("/a/b.png", False),
                      ("#a.png", False)]:
        case("外链判定 %s" % ref, ic.is_external(ref), want)
    for ref, want in [("a.PNG", True), ("a.png?v=1#x", True), ("a.pdf", False),
                      ("a.png.html", False)]:
        case("图片扩展名判定 %s" % ref, ic.is_image_ref(ref), want)

    # ---------- 3. 坏图判定 ----------
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    jpg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    gif = b"GIF89a" + b"\x00" * 32
    webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 16
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    for data, fmt in [(png, "png"), (jpg, "jpeg"), (gif, "gif"), (webp, "webp"), (svg, "svg")]:
        case("magic 认格式 %s" % fmt, ic.sniff(data), fmt)
    case("magic 认不出返回 None", ic.sniff(b"not an image at all"), None)
    case("HTML 错误页认出来", ic.looks_like_html(b"<!DOCTYPE html><html>403</html>"), True)
    case("真图不算 HTML", ic.looks_like_html(png), False)

    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        (d / "ok.png").write_bytes(png)
        (d / "empty.png").write_bytes(b"")
        (d / "lie.png").write_bytes(b"<!DOCTYPE html><html><body>403</body></html>")
        (d / "wrong.png").write_bytes(jpg)
        case("好图：无误判", (ic.probe(d / "ok.png")["bad_magic"],
                             ic.probe(d / "ok.png")["zero"]), (False, False))
        case("0 字节", ic.probe(d / "empty.png")["zero"], True)
        case("HTML 错误页", ic.probe(d / "lie.png")["html_page"], True)
        case("扩展名与内容不符", ic.probe(d / "wrong.png")["bad_magic"], True)
        case("不存在的文件不抛异常", ic.probe(d / "nope.png")["exists"], False)

    # ---------- 4. 端到端：门禁真的会失败，审计对当前站点是干净的 ----------
    probe = "site/content/pages/zz-image-probe.md"
    probe_path = ROOT / probe
    had_probe = probe_path.exists()
    if not had_probe:
        probe_path.write_text(
            "---\ntitle: \"探针\"\ngroup: 写作\norder: 99\n---\n\n![p](https://example.com/p.png)\n",
            encoding="utf-8")
    try:
        with tempfile.TemporaryDirectory() as td:
            # 探针构建写到仓库外的临时目录：失败的构建也会落盘（错误是最后才汇总退出的），
            # 用 --out 指出去就不会把 dist 弄脏，测试也因此可反复跑。
            r = _run([str(ROOT / "engine" / "build.py"), "--offline", "--out", td])
        case("外链图片让构建失败", r.returncode, 1)
        case("失败信息带 文件:行号", "zz-image-probe.md:" in (r.stdout or "") + (r.stderr or ""), True)
    finally:
        if not had_probe:
            probe_path.unlink(missing_ok=True)
    r = _run([str(ROOT / "engine" / "audit_images.py")])
    case("审计脚本对当前站点退出码为 0", r.returncode, 0)
    case("审计脚本输出报告表", "图片引用审计" in (r.stdout or ""), True)

    if failed:
        print("图片自测失败 %d 项：" % len(failed))
        for f in failed:
            print("  - %s" % f)
        return 1
    print("图片自测 ALL PASS（%d 项断言）" % count[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
