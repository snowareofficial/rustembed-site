#!/usr/bin/env python3
"""include / namespace / 契约桥接回归：钉住「文件入口」这条新路径。

    python engine/test_sml_include.py

分三组：
  [A] 桥接本身（不需要 native）—— 扫描规则、越界 / 不支持形态、降级报错
  [B] native 展开（需要 engine/native/sml.dll；缺失整组 SKIP，并在报告里写明）
  [C] 兼容性 —— 现有站点内容一个都没踩到 include 路径

native 组允许 SKIP 而不是 FAIL：engine/native/ 是 gitignore 的，干净克隆
（CI 即此缺省路径）本来就跑不了 native；把 CI 染红只会换来习惯性忽略，
所以显式写 SKIP，并要求装了库的人在本地跑一遍。
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))

import contract as contract_mod  # noqa: E402
import sml                       # noqa: E402

REPO_ROOT = HERE.parent

CONTRACTS = """@contract Resource loose {
  title: str                      # 标题
  kind: enum [ book tool ]        # 类型
  url: url                        # 链接（rec-blog 内置类型，native 不认）
  updated: date                   # 日期（同上）
  cover: image                    # 图片/附件（同上）
}
"""

GOOD_DATA = 'lang: "rust"\n'

failed = []
checks = 0
skipped = []


def case(name, cond, detail=""):
    global checks
    checks += 1
    if cond:
        print("  ok   %s" % name)
    else:
        print("  FAIL %s%s" % (name, (" -- " + detail) if detail else ""))
        failed.append(name + ((" -- " + detail) if detail else ""))


def expect_err(name, fn, needle, code=None):
    """断言 fn() 抛 SmlError，且消息含 needle（给了 code 就还得带这个错误码）。"""
    global checks
    checks += 1
    try:
        fn()
    except sml.SmlError as e:
        msg = str(e)
        if needle in msg and (code is None or code in msg):
            print("  ok   %s" % name)
            return
        failed.append("%s: 报错文案不含 %r: %s" % (name, needle, msg))
        print("  FAIL %s -- %s" % (name, msg))
        return
    except Exception as e:                                # noqa: BLE001
        failed.append("%s: 期望 SmlError，实得 %s: %s" % (name, type(e).__name__, e))
        print("  FAIL %s -- %s: %s" % (name, type(e).__name__, e))
        return
    failed.append("%s: 期望报错，实得通过" % name)
    print("  FAIL %s -- 没有报错" % name)


def mk(d, name, text):
    p = os.path.join(d, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)
    return p


def codes_of(table, value, cname):
    return [c for c, _ in contract_mod.validate(value, cname, table)]


def main():
    tmp = tempfile.mkdtemp(prefix="sml-include-test-")
    native = sml._native_mod() is not None

    print("== [A] 扫描规则 / 边界防护 / 降级（不需要 native）==")
    d = os.path.join(tmp, "a")
    mk(d, "outside.sml", 'k: 1\n')

    # A1 注释与字符串里伪造的 include 不算指令
    tricky = ('note: "include \\"evil.sml\\" as x"\n'
              "# include \"evil.sml\"\n"
              '// include "evil.sml"\n'
              "real_key: 1\n")
    case("串 / 注释里的伪 include 不算指令",
         sml.scan_include_refs(tricky, "x.sml") == [])

    # A2 越界：../ 逃出包含者目录（目标真实存在）
    inner = mk(d, "sub/deep.sml", 'include "../outside.sml"\nk: 2\n')
    expect_err("越界 ../ 被拒",
               lambda: sml.scan_include_refs(
                   open(inner, encoding="utf-8").read(), inner),
               "E-INCLUDE-003", "E-INCLUDE-003")

    # A3 越界：绝对路径
    expect_err("绝对路径被拒",
               lambda: sml.scan_include_refs('include "C:/Windows/win.ini"\n', "x.sml"),
               "E-INCLUDE-003", "E-INCLUDE-003")

    # A4 不支持形态（native 能展开，但契约拿不到 ⇒ 宁可报错）
    for form, why in (('include "*.sml"', "glob"), ('include "a.sml" { x }', "挑键"),
                      ('include "a.sml", "b.sml"', "多目标"),
                      ('include re:"a.*"', "正则")):
        expect_err("不支持的 %s 形态被拒" % why,
                   lambda form=form: sml.scan_include_refs(form + "\n", "x.sml"),
                   "E-INCLUDE-012", "E-INCLUDE-012")

    # A5 缺 native：含 include 的内容明确报错，不静默当字段
    need = mk(d, "needinc.sml", '# 注释\ninclude "outside.sml"\nk: 1\n')
    sml.set_backend("builtin")
    try:
        expect_err("builtin + include 明确报错", lambda: sml.load_doc(need),
                   "E-FEATURE-001", "E-FEATURE-001")
        # A6 builtin 下不含 include 的内容照常解析（兼容性）
        plain = mk(d, "plain.sml", 'title: "T"\n')
        val, cs = sml.load_doc(plain)
        case("builtin 下普通文件照常解析", val.get("title") == "T" and cs == {})
    finally:
        sml.set_backend("auto")

    if not native:
        skipped.append("[B] native include 展开（未找到 sml cdylib）")
    else:
        print("== [B] native 展开 + 契约桥接 ==")
        run_native_group(tmp)

    print("== [D] 端到端：真的用 include 建一个站（需要 native）==")
    if not native:
        skipped.append("[D] 含 include 的端到端构建")
    else:
        run_build_group(tmp)

    print("== [C] 兼容性：现有站点内容没踩到 include 路径 ==")
    content = REPO_ROOT / "site" / "content"
    touched = [str(p) for p in sorted(content.rglob("*"))
               if p.is_file() and p.suffix.lower() in (".sml", ".md", ".markdown")
               and sml._scan_include_lines(p.read_text(encoding="utf-8"), str(p))]
    case("site/content 里没有任何文件含 include/import", not touched, "；".join(touched))

    print()
    for s in skipped:
        print("SKIP  %s" % s)
    print("include 回归 %d 项（跳过 %d 组）" % (checks, len(skipped)))
    if failed:
        print("失败 %d 项：" % len(failed))
        for f in failed:
            print("  - %s" % f)
        return 1
    print("INCLUDE PASS")
    return 0


def run_native_group(tmp):
    """[B] 组：native 负责展开数据，Python 侧负责契约。"""
    d = os.path.join(tmp, "b")
    mk(d, "blog.sml", CONTRACTS)
    mk(d, "data.sml", GOOD_DATA)

    # B1 内联 include：数据合并 + 契约按裸名登记
    inline = mk(d, "inline.sml",
                'include "data.sml"\ninclude "blog.sml"\n@is Resource\n'
                'title: "T"\nkind: book\nurl: "https://example.com/"\n'
                'updated: "2026-01-01"\ncover: "c.jpg"\n')
    val, cs = sml.load_doc(inline)
    case("内联 include 展开数据", val.get("lang") == "rust", str(val))
    case("内联 include 的契约登记为裸名", "Resource" in cs, str(sorted(cs)))
    case("显式 @is 回到 __is", val.get("__is") == "Resource")
    case("内联 + 合格数据无契约错误", codes_of(cs, val, "Resource") == [],
         str(codes_of(cs, val, "Resource")))

    # B2 命名空间 include：@is blog.Resource（规范 §4.4）
    ns = mk(d, "ns.sml",
            'include "blog.sml" as blog\n@is blog.Resource\n'
            'title: "T"\nkind: tool\nurl: "https://example.com/"\n'
            'updated: "2026-01-01"\ncover: "c.jpg"\n')
    val, cs = sml.load_doc(ns)
    case("ns include 的契约登记为 blog.Resource", "blog.Resource" in cs, str(sorted(cs)))
    case("ns 数据挂到命名空间键下", isinstance(val.get("blog"), dict), str(val))
    case("ns include + @is blog.Resource 通过",
         codes_of(cs, val, "blog.Resource") == [], str(codes_of(cs, val, "blog.Resource")))
    case("命名空间隔离：裸名 Resource 不再可见",
         "Resource" not in cs, str(sorted(cs)))
    case("ns 下未定义契约仍报 E-CONTRACT-001",
         codes_of(cs, val, "Resource") == ["E-CONTRACT-001"])

    # B3 rec-blog 自定义类型（url / date / image）照样管
    bad = dict(val)
    bad["url"] = "ftp://x.example/"
    case("url 类型仍校验", "E-CONTRACT-002" in codes_of(cs, bad, "blog.Resource"))
    bad2 = dict(val)
    bad2["updated"] = "上个月"
    case("date 类型仍校验", "E-CONTRACT-002" in codes_of(cs, bad2, "blog.Resource"))
    bad3 = dict(val)
    bad3["kind"] = "movie"
    case("枚举仍校验", "E-CONTRACT-006" in codes_of(cs, bad3, "blog.Resource"))
    bad4 = {k: v for k, v in val.items() if k != "title"}
    case("必填仍校验", "E-CONTRACT-003" in codes_of(cs, bad4, "blog.Resource"))

    # B4 缺文件：带文件名 + 行号 + 错误码
    missing = mk(d, "missing.sml", '# 注释\ninclude "nope.sml"\nk: 1\n')
    expect_err("缺文件 -> E-INCLUDE-001 带行号", lambda: sml.load_doc(missing),
               "missing.sml:2: [E-INCLUDE-001]", "E-INCLUDE-001")

    # B5 循环 include
    mk(d, "loop_a.sml", 'include "loop_b.sml"\nx: 1\n')
    loop = mk(d, "loop_b.sml", 'include "loop_a.sml"\ny: 2\n')
    expect_err("循环 include -> E-INCLUDE-002", lambda: sml.load_doc(loop),
               "E-INCLUDE-002", "E-INCLUDE-002")

    # B6 重复契约（同图两份、字段不一致）
    mk(d, "dup1.sml", '@contract Same { a: str }\n')
    mk(d, "dup2.sml", '@contract Same { b: str }\n')
    duper = mk(d, "dup.sml", 'include "dup1.sml"\ninclude "dup2.sml"\nk: 1\n')
    # 同一名字、同一定义，换个命名空间就不算冲突
    okdup = mk(d, "okdup.sml", 'include "dup1.sml"\ninclude "dup1.sml" as two\nk: 1\n')
    try:
        _v, cs4 = sml.load_doc(okdup)
        case("同名契约在不同命名空间共存",
             "Same" in cs4 and "two.Same" in cs4, str(sorted(cs4)))
    except Exception as e:                                # noqa: BLE001
        case("同名契约在不同命名空间共存", False, "%s: %s" % (type(e).__name__, e))
    expect_err("重复契约（字段不一致）-> E-CONTRACT-016", lambda: sml.load_doc(duper),
               "E-CONTRACT-016", "E-CONTRACT-016")

    # B7 菱形包含同一份契约文件：内容一致，静默去重
    mk(d, "shared.sml", CONTRACTS)
    mk(d, "via1.sml", 'include "shared.sml" as one\n')
    both = mk(d, "both.sml", 'include "via1.sml" as a\ninclude "shared.sml" as b\nk: 1\n')
    try:
        _v, cs2 = sml.load_doc(both)
        case("菱形包含同一份契约文件不报错",
             "a.one.Resource" in cs2 and "b.Resource" in cs2, str(sorted(cs2)))
    except Exception as e:                                # noqa: BLE001
        case("菱形包含同一份契约文件不报错", False, "%s: %s" % (type(e).__name__, e))

    # B8 嵌套目录：以包含者所在目录为基准
    mk(d, "nested/inner.sml", 'deep: "yes"\n')
    deep = mk(d, "nested/top.sml", 'include "inner.sml"\ntitle: "T"\n')
    val, _cs = sml.load_doc(deep)
    case("嵌套 include 以当前文件为基准展开", val.get("deep") == "yes", str(val))

    # B9 临时文件不残留
    leftovers = [f for f in os.listdir(d) if ".native-" in f]
    case("临时文件已清理", not leftovers, "；".join(leftovers))


def run_build_group(tmp):
    """[D] 组：拿真实 build.py 建一个用了 include 的迷你站。"""
    root = os.path.join(tmp, "minisite")
    content = os.path.join(root, "content")
    theme = os.path.join(root, "theme")
    os.makedirs(theme, exist_ok=True)
    for name in ("index.html", "app.js", "style.css"):
        with open(os.path.join(theme, name), "w", encoding="utf-8") as fh:
            fh.write("<!-- mini shell -->\n")

    site_sml = ('title: "探针站"\n'
                'tagline: "只用来验证 include"\n'
                'url: "https://example.com/"\n'
                'contracts {\n'
                '  resource: Resource\n'
                '}\n')
    mk(content, "site.sml", site_sml)
    # 下划线开头 ⇒ docs_in 不收录，只当被 include 的共享契约盒
    mk(content, "resources/_shared.sml", CONTRACTS)
    # ① 内联 include + 默认映射
    mk(content, "resources/inline.sml",
       'include "_shared.sml"\n'
       'title: "内联条目"\nkind: book\nurl: "https://example.com/"\n'
       'updated: "2026-01-01"\ncover: "c.jpg"\n')
    # ② 命名空间 include + 显式 @is（§4.4 写法）
    mk(content, "resources/named.sml",
       'include "_shared.sml" as blog\n@is blog.Resource\n'
       'title: "命名空间条目"\nkind: tool\nurl: "https://example.com/"\n'
       'updated: "2026-01-01"\ncover: "c.jpg"\n')

    out = str(REPO_ROOT / "dist" / "_include_e2e")
    ok, log = run_build(root, out)
    case("含 include 的站点能构建", ok, log[-400:])
    if ok:
        mani = json.loads(open(os.path.join(out, "manifest.json"), encoding="utf-8").read())
        titles = [r.get("title") for r in mani.get("resources", [])]
        case("manifest 收到了两条 include 内容",
             "内联条目" in titles and "命名空间条目" in titles, str(titles))

    # ③ 命名空间隔离：裸名不再可见 ⇒ 构建应失败且带 E-CONTRACT-001
    bad_site = os.path.join(tmp, "minisite-bad")
    mk(bad_site, "content/site.sml", site_sml)
    mk(bad_site, "content/resources/_shared.sml", CONTRACTS)
    mk(bad_site, "content/resources/only_ns.sml",
       'include "_shared.sml" as blog\n'
       'title: "只写了命名空间"\nkind: book\nurl: "https://example.com/"\n'
       'updated: "2026-01-01"\ncover: "c.jpg"\n')
    out2 = str(REPO_ROOT / "dist" / "_include_e2e_bad")
    ok2, log2 = run_build(bad_site, out2)
    case("命名空间隔离生效：裸名不可见 → 构建失败",
         (not ok2) and "E-CONTRACT-001" in log2, log2[-400:])

    # ④ rec-blog 自定义类型仍生效：url 不合法 ⇒ E-CONTRACT-002
    bad2 = os.path.join(tmp, "minisite-bad2")
    mk(bad2, "content/site.sml", site_sml)
    mk(bad2, "content/resources/_shared.sml", CONTRACTS)
    mk(bad2, "content/resources/bad_url.sml",
       'include "_shared.sml" as blog\n@is blog.Resource\n'
       'title: "坏链接"\nkind: book\nurl: "javascript:alert(1)"\n'
       'updated: "2026-01-01"\ncover: "c.jpg"\n')
    out3 = str(REPO_ROOT / "dist" / "_include_e2e_bad2")
    ok3, log3 = run_build(bad2, out3)
    case("url 类型校验仍生效 → 构建失败",
         (not ok3) and "E-CONTRACT-002" in log3, log3[-400:])


def run_build(site_dir, out_dir, backend=None):
    """在子进程里跑 build.py（--site 指向迷你站），返回 (是否成功, 日志)。"""
    code = (
        "import sys, runpy\n"
        "sys.path.insert(0, 'engine')\n"
        "sys.path.insert(0, 'engine/lib')\n"
        "sys.argv = ['build.py', '--out', %r, '--offline']\n" % out_dir
    )
    if backend:
        code += "import sml; sml.set_backend(%r)\n" % backend
    code += "runpy.run_path('engine/build.py', run_name='__main__')\n"
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["REC_BLOG_SITE"] = str(site_dir)
    r = subprocess.run([sys.executable, "-c", code], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env=env)
    return r.returncode == 0, (r.stdout or "") + (r.stderr or "")


if __name__ == "__main__":
    sys.exit(main())
