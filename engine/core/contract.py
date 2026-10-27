"""内容契约校验（错误码对齐 SML 上游 sml-codes/src/codes.rs）。

码表：
  E-CONTRACT-001  未定义的契约
  E-CONTRACT-002  字段类型不符
  E-CONTRACT-003  必填字段缺失
  E-CONTRACT-004  未声明字段（严格模式；契约里写 loose 可放宽）
  E-CONTRACT-005  数值越界
  E-CONTRACT-006  枚举取值非法
  E-CONTRACT-008  组合字段应为块

报错一律「错误码 + 人话」一起给，例如：
  content/posts/2026/x/index.sml: [E-CONTRACT-003] 契约 `BlogPost` 缺少必填字段 `summary`（str）
"""

import re

BUILTIN_TYPES = {
    "any", "auto", "str", "string", "int", "num", "float", "number", "bool",
    "date", "datetime", "url", "email", "image", "link",
}

TYPE_LABEL = {
    "str": "字符串", "string": "字符串", "int": "整数", "num": "数字", "float": "数字",
    "number": "数字", "bool": "布尔", "date": "日期", "datetime": "日期时间",
    "url": "链接", "email": "邮箱", "image": "图片/附件", "link": "外链附件", "any": "任意",
}


def type_of(v):
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "num"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "block"
    if v is None:
        return "null"
    return type(v).__name__


def validate(value, cname, contracts, out=None, loose=False):
    """校验 value 是否符合 contracts[cname]，返回 [(错误码, 说明)]。"""
    out = out if out is not None else []
    spec = contracts.get(cname)
    if spec is None:
        out.append(("E-CONTRACT-001", "未定义的契约 `%s`（已定义：%s）"
                    % (cname, ", ".join(sorted(contracts)) or "无")))
        return out
    if not isinstance(value, dict):
        out.append(("E-CONTRACT-008", "契约 `%s` 只能应用于块，实际是 %s" % (cname, type_of(value))))
        return out

    fields = spec.get("fields", {})
    loose = loose or spec.get("loose", False)
    for fname, f in fields.items():
        v = value.get(fname)
        if v is None or v == "" or v == []:
            if f["required"] and f.get("default") is None:
                out.append(("E-CONTRACT-003", "契约 `%s` 缺少必填字段 `%s`（%s）"
                            % (cname, fname, TYPE_LABEL.get(f["type"], f["type"]))))
            continue
        _check(out, "%s.%s" % (cname, fname), v, f, contracts)
    if not loose:
        for k in value:
            if isinstance(k, str) and k.startswith("__"):
                continue
            if k not in fields:
                out.append(("E-CONTRACT-004", "契约 `%s` 未声明字段 `%s`（要加字段就先改契约，或在契约里写 loose）"
                            % (cname, k)))
    return out


def _check(out, label, v, f, contracts):
    t = f["type"]
    if t.startswith("[") and t.endswith("]"):
        inner = t[1:-1].strip()
        if not isinstance(v, list):
            out.append(("E-CONTRACT-002", "字段 `%s` 应为数组，实为 %s" % (label, type_of(v))))
            return
        for i, x in enumerate(v):
            _one(out, "%s[%d]" % (label, i), x, inner, contracts)
    else:
        _one(out, label, v, t, contracts)

    if f.get("enum") and str(v) not in f["enum"]:
        out.append(("E-CONTRACT-006", "字段 `%s` = `%s` 不在枚举内（允许：%s）"
                    % (label, v, " ".join(f["enum"]))))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if f.get("min") is not None and v < f["min"]:
            out.append(("E-CONTRACT-005", "字段 `%s` = %s 小于下界 %s" % (label, v, f["min"])))
        if f.get("max") is not None and v > f["max"]:
            out.append(("E-CONTRACT-005", "字段 `%s` = %s 大于上界 %s" % (label, v, f["max"])))


def _one(out, label, v, t, contracts):
    if t in ("any", "auto"):
        return
    if t in contracts:
        if not isinstance(v, dict):
            out.append(("E-CONTRACT-008", "字段 `%s` 应为块并按契约 `%s` 校验，实为 %s"
                        % (label, t, type_of(v))))
        else:
            validate(v, t, contracts, out=out)
        return
    if t not in BUILTIN_TYPES:
        out.append(("E-CONTRACT-001", "字段 `%s` 的类型 `%s` 未定义（可用：内置类型或已定义契约 %s）"
                    % (label, t, ", ".join(sorted(contracts)) or "无")))
        return

    if t in ("str", "string"):
        ok, why = isinstance(v, str), "应为字符串"
    elif t == "int":
        ok, why = isinstance(v, int) and not isinstance(v, bool), "应为整数"
    elif t in ("num", "float", "number"):
        ok, why = isinstance(v, (int, float)) and not isinstance(v, bool), "应为数字"
    elif t == "bool":
        ok, why = isinstance(v, bool), "应为 true/false"
    elif t in ("date", "datetime"):
        ok, why = isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v) is not None, "应为日期 YYYY-MM-DD"
    elif t == "url":
        ok, why = isinstance(v, str) and re.match(r"^https?://", v) is not None, "应为 http(s) 链接"
    elif t == "email":
        ok, why = isinstance(v, str) and "@" in v, "应为邮箱"
    elif t in ("image", "link"):
        ok, why = isinstance(v, str) and v != "", "应为附件地址（本地相对路径或外链）"
    else:
        return
    if not ok:
        out.append(("E-CONTRACT-002", "字段 `%s` %s，实为 %s" % (label, why, type_of(v))))


def describe(contracts):
    """给自动生成的契约文档页用：契约 → 字段行。"""
    out = []
    for name in sorted(contracts):
        spec = contracts[name]
        rows = []
        for fname, f in spec.get("fields", {}).items():
            cons = []
            if f.get("enum"):
                cons.append("枚举 " + "/".join(f["enum"]))
            if f.get("min") is not None or f.get("max") is not None:
                cons.append("范围 %s..%s" % (f.get("min", "-∞"), f.get("max", "+∞")))
            if f.get("default") is not None:
                cons.append("默认 " + str(f["default"]))
            rows.append({
                "name": fname,
                "type": f["type"],
                "required": f["required"],
                "constraint": "；".join(cons),
                "doc": f.get("doc", ""),
            })
        out.append({"name": name, "loose": spec.get("loose", False), "fields": rows})
    return out
