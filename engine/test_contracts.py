#!/usr/bin/env python3
"""契约引擎自测：用最小样例钉住错误码语义（对齐 SML 上游 sml-codes）。

    python engine/test_contracts.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

import config  # noqa: E402
import contract  # noqa: E402
import sml  # noqa: E402

SRC = """
@contract Post {
  title: str                      # 标题
  tags: [str]                     # 标签
  level: int min 1 max 5          # 重要度
  state: enum [ draft published ] # 状态
  series: Series optional         # 系列
}

@contract Series {
  id: str
  order: int min 0
}

@contract Loose1 {
  loose
  name: str
  extra: any optional
}

@contract BadType {
  x: Nope
}

@contract OptEnum {
  mode: enum [ a b ] optional
}
"""

GOOD = {"title": "标题", "tags": ["rust"], "level": 3, "state": "draft"}


def codes(contracts, value, cname, loose=False):
    return [c for c, _ in contract.validate(value, cname, contracts, loose=loose)]


def main():
    contracts = sml.parse_doc(SRC, "selftest")[1]
    failed = []
    count = [0]

    def case(name, got, want):
        count[0] += 1
        if got != want:
            failed.append("%s：期望 %s，实得 %s" % (name, want or "无错", got or "无错"))

    case("正常通过", codes(contracts, GOOD, "Post"), [])
    case("缺必填字段", codes(contracts, {k: v for k, v in GOOD.items() if k != "title"}, "Post"),
         ["E-CONTRACT-003"])
    case("类型不符", codes(contracts, dict(GOOD, title=5), "Post"), ["E-CONTRACT-002"])
    case("数组元素类型不符", codes(contracts, dict(GOOD, tags=["ok", 7]), "Post"), ["E-CONTRACT-002"])
    case("未声明字段", codes(contracts, dict(GOOD, whatever=1), "Post"), ["E-CONTRACT-004"])
    case("loose 放宽未声明字段", codes(contracts, dict(GOOD, whatever=1), "Post", loose=True), [])
    case("数值下界", codes(contracts, dict(GOOD, level=0), "Post"), ["E-CONTRACT-005"])
    case("数值上界", codes(contracts, dict(GOOD, level=9), "Post"), ["E-CONTRACT-005"])
    case("枚举非法", codes(contracts, dict(GOOD, state="nope"), "Post"), ["E-CONTRACT-006"])
    case("未定义的契约", codes(contracts, GOOD, "Nope"), ["E-CONTRACT-001"])
    case("字段类型名未知", codes(contracts, {"x": 1}, "BadType"), ["E-CONTRACT-001"])
    case("组合字段应为块", codes(contracts, dict(GOOD, series="s1"), "Post"), ["E-CONTRACT-008"])
    case("组合字段递归通过", codes(contracts, dict(GOOD, series={"id": "s", "order": 1}), "Post"), [])
    case("组合字段递归报错", codes(contracts, dict(GOOD, series={"id": "s", "order": -1}), "Post"),
         ["E-CONTRACT-005"])
    case("内部字段不参与校验", codes(contracts, dict(GOOD, __is="Post", __md_body="x"), "Post"), [])
    case("契约解析：字段说明保留",
         [f["doc"] for f in contracts["Post"]["fields"].values()][:1], ["标题"])
    case("契约解析：optional", [contracts["Post"]["fields"]["series"]["required"]], [False])
    case("契约解析：enum 值", [contracts["Post"]["fields"]["state"]["enum"]], [["draft", "published"]])
    case("契约解析：loose", [contracts["Loose1"]["loose"]], [True])
    case("契约解析：enum 后的 optional 不被吞掉",
         [contracts["OptEnum"]["fields"]["mode"]["required"]], [False])
    case("契约解析：enum 可选字段缺失不报错",
         codes(contracts, {}, "OptEnum"), [])

    # 本站契约回归：项目页「相关阅读」靠 Project 的 related_series / related_posts
    # 显式关联。契约里删掉这两个字段 → 写了它们的项目会撞 E-CONTRACT-004。
    blog = config.CONTENT / "contracts" / "blog.sml"
    case("本站契约文件存在", blog.is_file(), True)
    if blog.is_file():
        real = sml.parse_doc(blog.read_text(encoding="utf-8"), str(blog))[1]
        fields = (real.get("Project") or {}).get("fields", {})
        for fname in ("related_series", "related_posts"):
            case("Project 契约声明了 %s（字符串数组）" % fname,
                 (fields.get(fname) or {}).get("type"), "[str]")
            case("Project.%s 是可选字段" % fname,
                 (fields.get(fname) or {}).get("required"), False)
        base = {"name": "x", "one_liner": "y", "repo": "https://e.org/a/b", "status": "active"}
        case("Project 接受 related 两字段",
             codes(real, dict(base, related_series=["s1"], related_posts=["p1"]), "Project"), [])
        case("Project 不写 related 两字段也通过（旧项目兼容）", codes(real, base, "Project"), [])
        case("Project 拒绝 related_series 非数组",
             codes(real, dict(base, related_series="s1"), "Project"), ["E-CONTRACT-002"])
        case("Project 拒绝 related_posts 里混非字符串",
             codes(real, dict(base, related_posts=["ok", 7]), "Project"), ["E-CONTRACT-002"])
        case("Project.docs 仍是 url 语义（不承文章组）", (fields.get("docs") or {}).get("type"), "url")

    if failed:
        print("契约自测失败 %d 项：" % len(failed))
        for f in failed:
            print("  - %s" % f)
        return 1
    # 断言数动态计数：以前写死「19 项」，加了用例忘了改文案，三处文档跟着漂移
    print("契约自测 ALL PASS（%d 个契约，%d 项断言）" % (len(contracts), count[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
