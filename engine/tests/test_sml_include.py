#!/usr/bin/env python3
"""include / namespace / 契约桥接回归：钉住「文件入口」这条路径。

    python engine/tests/test_sml_include.py

四组：
  [A] 桥接本身（不需要 native）—— 扫描规则、越界 / 不支持形态、降级报错
  [B] native 展开 + 契约桥接（需要 native）
  [D] 端到端：起真实 build.py 建用了 include 的迷你站（需要 native）
  [E] 回归：真实仓库两种后端产物一致（需要 native）

native 从哪来：`engine/native/sml.dll`（已 gitignore），或 `SML_LIB` /
`REC_BLOG_SML_LIB` 指向的 cdylib。本机没有时 [B][D][E] 不会静默跳过 ——
脚本**退出码 1** 并打印怎么办；只有显式设 `REC_BLOG_SML_ALLOW_NO_NATIVE=1`
才降级为跳过（给没装 Rust 的一次性本地跑用）。CI 有专门 job 负责装 native。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT))

from engine.core import contract as contract_mod  # noqa: E402
from engine.parse import sml                      # noqa: E402

CONTRACTS = """@contract Resource loose {
  title: str                      # 标题
  kind: enum [ book tool ]        # 类型
  url: url                        # 链接（rec-blog 内置类型，native 不认）
  updated: date                   # 日期（同上）
  cover: image                    # 图片/附件（同上）
}
"""

GOOD = ('title: "书"\nkind: book\nurl: "https://example.com/"\n'
        'updated: "2026-01-01"\ncover: "c.jpg"\n')

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


def tmp_include_dirs():
    """系统临时目录里属于本特性的临时根目录（残留证据用）。"""
    try:
        return sorted(n for n in os.listdir(tempfile.gettempdir())
                      if n.startswith("rec-blog-include-"))
    except OSError:
        return []


def main():
    tmp = tempfile.mkdtemp(prefix="sml-include-test-")
    native = sml._native_mod() is not None
    allow_skip = os.environ.get("REC_BLOG_SML_ALLOW_NO_NATIVE", "") == "1"
    baseline_tmp = tmp_include_dirs()

    print("== [A] 扫描规则 / 边界防护 / 降级（不需要 native）==")
    run_scan_group(tmp)

    print("== [B] native 展开 + 契约桥接 ==")
    if native:
        run_native_group(tmp)
    else:
        skipped.append("[B] native 展开 + 契约桥接（未找到 sml cdylib）")

    print("== [D] 端到端：真实 build.py 建含 include 的迷你站 ==")
    if native:
        run_build_group(tmp)
    else:
        skipped.append("[D] 端到端构建（未找到 sml cdylib）")

    print("== [E] 回归：真实仓库两种后端产物一致 ==")
    if native:
        run_regression_group(tmp)
    else:
        skipped.append("[E] 双后端产物比对（未找到 sml cdylib）")

    print("== [C] 兼容性：现有站点内容没踩到 include 路径 ==")
    run_compat_group()
    leak = [d for d in tmp_include_dirs() if d not in baseline_tmp]
    case("系统临时目录无 include 残留", not leak, "；".join(leak))

    print()
    for s in skipped:
        print("SKIP  %s" % s)
    print("include 回归 %d 项（跳过 %d 组）" % (checks, len(skipped)))
    if failed:
        print("失败 %d 项：" % len(failed))
        for f in failed:
            print("  - %s" % f)
        return 1
    if skipped and not allow_skip:
        print()
        print("缺少 native（sml cdylib），[B][D][E] 三组没跑。")
        print("  装法：把 cdylib 放到 engine/native/sml.dll，")
        print("        或用 SML_LIB / REC_BLOG_SML_LIB 指向它（见 docs/ARCHITECTURE.md §14）。")
        print("  确认要跳过时：REC_BLOG_SML_ALLOW_NO_NATIVE=1 python engine/tests/test_sml_include.py")
        return 1
    print("INCLUDE PASS")
    return 0


def run_scan_group(tmp):
    d = os.path.join(tmp, "a")
    mk(d, "outside.sml", 'k: 1\n')

    # A1 注释与字符串里伪造的 include 不算指令
    tricky = ('note: "include \\"evil.sml\\" as x"\n'
              "# include \"evil.sml\"\n"
              '// include "evil.sml"\n'
              "real_key: 1\n")
    case("串 / 注释里的伪 include 不算指令",
         sml.scan_include_refs(tricky, "x.sml") == [])

    # A2 越界：逃出站点内容目录（兄弟目录也不许往上跑）
    deep = mk(d, "content/sub/deep.sml", 'include "../../outside.sml"\nk: 2\n')
    expect_err("越界 ../../ 被拒",
               lambda: sml.scan_include_refs(
                   open(deep, encoding="utf-8").read(), deep, root=os.path.join(d, "content")),
               "E-INCLUDE-003", "E-INCLUDE-003")

    # A3 越界：绝对路径
    expect_err("绝对路径被拒",
               lambda: sml.scan_include_refs('include "C:/Windows/win.ini"\n', "x.sml"),
               "E-INCLUDE-003", "E-INCLUDE-003")

    # A4 跨兄弟目录：允许（正是本任务要开通的能力）
    ok = mk(d, "content2/resources/x.sml", 'include "../contracts/blog.sml" as blog\nk: 1\n')
    mk(d, "content2/contracts/blog.sml", CONTRACTS)
    refs = sml.scan_include_refs(open(ok, encoding="utf-8").read(), ok,
                                 root=os.path.join(d, "content2"))
    case("跨兄弟目录 include 放行",
         len(refs) == 1 and refs[0][2] == "blog"
         and os.path.basename(refs[0][1]) == "blog.sml", str(refs))

    # A5 不支持形态（native 能展开，但契约拿不到 ⇒ 宁可报错）
    for form, why in (('include "*.sml"', "glob"), ('include "a.sml" { x }', "挑键"),
                      ('include "a.sml", "b.sml"', "多目标"),
                      ('include re:"a.*"', "正则")):
        expect_err("不支持的 %s 形态被拒" % why,
                   lambda form=form: sml.scan_include_refs(form + "\n", "x.sml"),
                   "E-INCLUDE-012", "E-INCLUDE-012")

    # A6 缺 native：含 include 的内容明确报错，不当普通字段
    need = mk(d, "needinc.sml", '# 注释\ninclude "outside.sml"\nk: 1\n')
    sml.set_backend("builtin")
    try:
        expect_err("builtin + include 明确报错", lambda: sml.load_doc(need),
                   "E-FEATURE-001", "E-FEATURE-001")
        # A7 builtin 下不含 include 的内容照常解析（兼容性）
        plain = mk(d, "plain.sml", 'title: "T"\n')
        val, cs = sml.load_doc(plain)
        case("builtin 下普通文件照常解析", val.get("title") == "T" and cs == {})
    finally:
        sml.set_backend("auto")

    # A8 缺 native：整站构建必须失败，不能静默跳过含 include 的内容
    s, c = mini_site(os.path.join(tmp, "minisite-builtin"), cross=True)
    out = str(REPO_ROOT / "dist" / "_include_builtin")
    good, lg = run_build(s, out, backend="builtin")
    case("builtin 后端 + include -> 构建失败",
         (not good) and "E-FEATURE-001" in lg, lg[-500:])
    case("builtin 构建不留临时文件", not stray_files(c), str(stray_files(c)))
    shutil.rmtree(out, ignore_errors=True)


def run_compat_group():
    content = REPO_ROOT / "site" / "content"
    touched = [str(p) for p in sorted(content.rglob("*.sml"))
               if p.is_file()
               and sml._scan_include_lines(p.read_text(encoding="utf-8"), str(p))]
    case("site/content 的 SML 内容没有 include/import", not touched, "；".join(touched))


def run_native_group(tmp):
    """[B] 组：native 负责展开数据，Python 侧负责契约。"""
    d = os.path.join(tmp, "b")
    mk(d, "blog.sml", CONTRACTS)
    mk(d, "data.sml", 'lang: "rust"\n')

    # B1 内联 include：数据合并 + 契约按裸名登记
    inline = mk(d, "inline.sml",
                'include "data.sml"\ninclude "blog.sml"\n@is Resource\n' + GOOD)
    val, cs = sml.load_doc(inline, root=d)
    case("内联 include 展开数据", val.get("lang") == "rust", str(val))
    case("内联 include 的契约登记为裸名", "Resource" in cs, str(sorted(cs)))
    case("显式 @is 回到 __is", val.get("__is") == "Resource")
    case("内联 + 合格数据无契约错误", codes_of(cs, val, "Resource") == [],
         str(codes_of(cs, val, "Resource")))

    # B2 命名空间 include：@is blog.Resource（规范 §4.4）
    ns = mk(d, "ns.sml",
            'include "blog.sml" as blog\n@is blog.Resource\n'
            'title: "书"\nkind: tool\nurl: "https://example.com/"\n'
            'updated: "2026-01-01"\ncover: "c.jpg"\n')
    val, cs = sml.load_doc(ns, root=d)
    case("ns include 的契约登记为 blog.Resource", "blog.Resource" in cs, str(sorted(cs)))
    case("ns 数据挂到命名空间键下", isinstance(val.get("blog"), dict), str(val))
    case("ns include + @is blog.Resource 通过",
         codes_of(cs, val, "blog.Resource") == [], str(codes_of(cs, val, "blog.Resource")))
    case("命名空间隔离：裸名 Resource 不再可见",
         "Resource" not in cs, str(sorted(cs)))
    case("ns 下未定义契约仍报 E-CONTRACT-001",
         codes_of(cs, val, "Resource") == ["E-CONTRACT-001"])

    # B3 rec-blog 自定义类型（url / date）照样管
    bad = dict(val, url="ftp://x.example/")
    case("url 类型仍校验", "E-CONTRACT-002" in codes_of(cs, bad, "blog.Resource"))
    bad2 = dict(val, updated="上个月")
    case("date 类型仍校验", "E-CONTRACT-002" in codes_of(cs, bad2, "blog.Resource"))
    bad3 = dict(val, kind="movie")
    case("枚举仍校验", "E-CONTRACT-006" in codes_of(cs, bad3, "blog.Resource"))
    bad4 = {k: v for k, v in val.items() if k != "title"}
    case("必填仍校验", "E-CONTRACT-003" in codes_of(cs, bad4, "blog.Resource"))

    # B4 缺文件：带文件名 + 行号 + 错误码
    missing = mk(d, "missing.sml", '# 注释\ninclude "nope.sml"\nk: 1\n')
    expect_err("缺文件 -> E-INCLUDE-001 带行号",
               lambda: sml.load_doc(missing, root=d),
               "missing.sml:2: [E-INCLUDE-001]", "E-INCLUDE-001")

    # B5 循环 include
    mk(d, "loop_a.sml", 'include "loop_b.sml"\nx: 1\n')
    loop = mk(d, "loop_b.sml", 'include "loop_a.sml"\ny: 2\n')
    expect_err("循环 include -> E-INCLUDE-002", lambda: sml.load_doc(loop, root=d),
               "E-INCLUDE-002", "E-INCLUDE-002")

    # B6 重复契约（同图两份、字段不一致）
    mk(d, "dup1.sml", '@contract Same { a: str }\n')
    mk(d, "dup2.sml", '@contract Same { b: str }\n')
    duper = mk(d, "dup.sml", 'include "dup1.sml"\ninclude "dup2.sml"\nk: 1\n')
    try:
        sml.load_doc(duper, root=d)
        case("重复契约（字段不一致）-> 报错", False, "没有报错")
    except sml.SmlError as e:
        case("重复契约（字段不一致）-> 报错", "重复定义" in str(e), str(e))

    # B6b 被包含文件里带 @is：必须报错，不能静默跳过
    mk(d, "selfis.sml", '@contract Inner { a: str }\n@is Inner\na: "x"\n')
    use_selfis = mk(d, "use_selfis.sml", 'include "selfis.sml" as box\nk: 1\n')
    expect_err("被包含文件里的 @is -> 明确报错",
               lambda: sml.load_doc(use_selfis, root=d), "@is")

    # B7 菱形包含同一份契约文件：内容一致，静默去重
    mk(d, "shared.sml", CONTRACTS)
    mk(d, "via1.sml", 'include "shared.sml" as one\n')
    both = mk(d, "both.sml", 'include "via1.sml" as a\ninclude "shared.sml" as b\nk: 1\n')
    try:
        _v, cs2 = sml.load_doc(both, root=d)
        case("菱形包含同一份契约文件不报错",
             "a.one.Resource" in cs2 and "b.Resource" in cs2, str(sorted(cs2)))
    except Exception as e:                                # noqa: BLE001
        case("菱形包含同一份契约文件不报错", False, "%s: %s" % (type(e).__name__, e))

    # B8 嵌套目录：以包含者所在目录为基准
    mk(d, "nested/inner.sml", 'deep: "yes"\n')
    deep = mk(d, "nested/top.sml", 'include "inner.sml"\ntitle: "T"\n')
    val, _cs = sml.load_doc(deep, root=d)
    case("嵌套 include 以当前文件为基准展开", val.get("deep") == "yes", str(val))

    # B9 临时文件不残留
    leftovers = [f for f in os.listdir(d) if ".native-" in f]
    case("临时文件已清理", not leftovers, "；".join(leftovers))


def run_build_group(tmp):
    """[D] 组：拿真实 build.py 建一个用了 include 的迷你站。"""
    site, content = mini_site(os.path.join(tmp, "minisite"), cross=True)
    out = str(REPO_ROOT / "dist" / "_include_e2e")
    ok, log = run_build(site, out)
    case("跨目录 include 的站点能构建", ok, log[-500:])
    if ok:
        mani = json.loads(open(os.path.join(out, "manifest.json"), encoding="utf-8").read())
        titles = [r.get("title") for r in mani.get("resources", [])]
        case("manifest 收到了跨目录 include 的内容",
             "The Embedded Rust Book" in titles, str(titles))
        urls = [r.get("url") for r in mani.get("resources", [])]
        case("资源 url 正常保留", any(u and u.startswith("https://") for u in urls), str(urls))
    case("源目录无临时文件残留", not stray_files(content), str(stray_files(content)))

    # D2 非法 url → 构建失败
    bad_site, bad_content = mini_site(os.path.join(tmp, "minisite-bad"), cross=False)
    mk(os.path.join(bad_site, "content"), "resources/bad.sml",
       'include "../contracts/blog.sml" as blog\n@is blog.Resource\n'
       'title: "坏链接"\nkind: book\nurl: "javascript:alert(1)"\n'
       'updated: "2026-01-01"\ncover: "c.jpg"\n')
    out2 = str(REPO_ROOT / "dist" / "_include_e2e_bad")
    ok2, log2 = run_build(bad_site, out2)
    case("非法 url -> 构建失败",
         (not ok2) and "E-CONTRACT-002" in log2, log2[-500:])
    case("失败构建也不留临时文件", not stray_files(bad_content), str(stray_files(bad_content)))

    # D3 嵌套 + 菱形：一并放进同一个站
    nest_site, nest_content = mini_site(os.path.join(tmp, "minisite-nest"),
                                        cross=True, diamond=True)
    out3 = str(REPO_ROOT / "dist" / "_include_e2e_nest")
    ok3, log3 = run_build(nest_site, out3)
    case("嵌套 + 菱形 include 也能构建", ok3, log3[-500:])
    if ok3:
        mani3 = json.loads(open(os.path.join(out3, "manifest.json"), encoding="utf-8").read())
        t3 = [r.get("title") for r in mani3.get("resources", [])]
        case("嵌套/菱形内容都进了 manifest",
             "嵌套条目" in t3 and "菱形条目" in t3, str(t3))

    # D4 循环 / 越界 / 缺文件：构建必须失败并报出码
    for label, files, needle in (
        ("循环 include", {"resources/_a.sml": 'include "_b.sml"\n',
                          "resources/_b.sml": 'include "_a.sml"\n',
                          "resources/cycle.sml": 'include "_a.sml"\ntitle: "环"\n'},
         "E-INCLUDE-002"),
        ("越界 include", {"resources/escape.sml":
                          'include "../../../outside-secret.sml"\ntitle: "逃"\n'},
         "E-INCLUDE-003"),
        ("缺文件 include", {"resources/nofile.sml":
                            'include "../contracts/nope.sml"\ntitle: "缺"\n'},
         "E-INCLUDE-001"),
    ):
        s, c = mini_site(os.path.join(tmp, "minisite-" + label), cross=False)
        for rel, text in files.items():
            mk(c, rel, text)
        o = str(REPO_ROOT / "dist" / ("_include_e2e_" + label.replace(" ", "")))
        good, lg = run_build(s, o)
        case("%s -> 构建失败（%s）" % (label, needle),
             (not good) and needle in lg, lg[-500:])
        case("%s 后无临时残留" % label, not stray_files(c), str(stray_files(c)))
        shutil.rmtree(o, ignore_errors=True)
    for o in (out, out2, out3):
        shutil.rmtree(o, ignore_errors=True)


def mini_site(base, cross=False, diamond=False):
    """造一个最小可构建的站点，返回 (站点根, content 目录)。"""
    content = os.path.join(base, "content")
    theme = os.path.join(base, "theme")
    os.makedirs(theme, exist_ok=True)
    for name in ("index.html", "app.js", "style.css"):
        with open(os.path.join(theme, name), "w", encoding="utf-8") as fh:
            fh.write("<!-- mini shell -->\n")
    mk(content, "site.sml",
       'title: "探针站"\ntagline: "只用来验证 include"\n'
       'url: "https://example.com/"\ncontracts {\n  resource: %s\n}\n'
       % ("blog.Resource" if cross else "Resource"))
    mk(content, "contracts/blog.sml", CONTRACTS)
    if diamond:
        mk(content, "resources/_shared.sml", CONTRACTS)
        mk(content, "resources/_via.sml", 'include "_shared.sml" as one\n')
        mk(content, "resources/diamond.sml",
           'include "_via.sml" as a\ninclude "_shared.sml" as b\n@is b.Resource\n'
           'title: "菱形条目"\nkind: book\nurl: "https://example.com/"\n'
           'updated: "2026-01-01"\ncover: "c.jpg"\n')
    if cross:
        mk(content, "resources/rust-book.sml",
           'include "../contracts/blog.sml" as blog\n@is blog.Resource\n'
           'title: "The Embedded Rust Book"\nkind: book\n'
           'url: "https://docs.rust-embedded.org/book/"\n'
           'updated: "2026-01-01"\ncover: "c.jpg"\n')
    if diamond:
        # 嵌套：resources/nested.sml → resources/nested/_deep.sml
        mk(content, "resources/nested/_deep.sml", 'deep: "yes"\n')
        mk(content, "resources/nested.sml",
           'include "nested/_deep.sml"\n@is Resource\n'
           'title: "嵌套条目"\nkind: tool\nurl: "https://example.com/"\n'
           'updated: "2026-01-01"\ncover: "c.jpg"\n')
    return base, content


def stray_files(content_dir):
    """源目录里不该出现的东西：临时副本 / native 预处理残留。"""
    out = []
    for dirpath, _dirs, files in os.walk(content_dir):
        for f in files:
            if ".native-" in f or f.startswith("_") and f.endswith((".tmp", ".sml.tmp")):
                out.append(os.path.join(dirpath, f))
    return out


def run_regression_group(tmp):
    """[E] 组：真实仓库两种后端各构建一次，产物必须逐字节一致。

    这是「改动没碰到既有内容」的硬证据：现有 site/content 一个 include 都没有，
    native 与 builtin 的产出必须完全相同。
    """
    site = str(REPO_ROOT / "site")
    out_n = str(REPO_ROOT / "dist" / "_include_real_native")
    out_b = str(REPO_ROOT / "dist" / "_include_real_builtin")
    try:
        ok1, log1 = run_build(site, out_n, backend="native")
        case("真实仓库（native）构建通过", ok1, log1[-500:])
        ok2, log2 = run_build(site, out_b, backend="builtin")
        case("真实仓库（builtin）构建通过", ok2, log2[-500:])
        if not (ok1 and ok2):
            return
        m1, m2 = load_manifest(out_n), load_manifest(out_b)
        case("两种后端 manifest 逐字节一致", m1 == m2)
        for key in ("posts", "pages", "services", "topics", "members",
                    "projects", "resources", "weekly"):
            n = len(m1.get(key, []))
            case("manifest.%s 条数稳定（%d）" % (key, n), n == len(m2.get(key, [])))
        res = m1.get("resources", [])
        case("manifest 资源条目都有标题/链接",
             bool(res) and all(r.get("title") and r.get("url") for r in res), str(res))
        case("manifest 文章条目都有标题与正文链接占位",
             all(r.get("title") and r.get("html") for r in m1.get("posts", [])))
    finally:
        # dist/ 是产物目录，不能留下测试构建（会污染 check.py / tech_aid_test）
        shutil.rmtree(out_n, ignore_errors=True)
        shutil.rmtree(out_b, ignore_errors=True)


def load_manifest(out_dir):
    with open(os.path.join(out_dir, "manifest.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    data.pop("built_at", None)
    return data


def run_build(site_dir, out_dir, backend=None):
    """在子进程里跑 build.py（--site 指向迷你站），返回 (是否成功, 日志)。"""
    code = (
        "import sys, runpy\n"
        "sys.path.insert(0, '.')\n"
        "sys.argv = ['build.py', '--out', %r, '--offline']\n" % out_dir
    )
    if backend:
        code += "from engine.parse import sml; sml.set_backend(%r)\n" % backend
    code += "runpy.run_path('engine/build.py', run_name='__main__')\n"
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["REC_BLOG_SITE"] = str(site_dir)
    r = subprocess.run([sys.executable, "-c", code], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env=env)
    return r.returncode == 0, (r.stdout or "") + (r.stderr or "")


if __name__ == "__main__":
    sys.exit(main())
