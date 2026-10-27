"""契约表状态：登记 / 默认映射 / 校验开关（2026-10-28 自内容层独立成模块）。

放在 core 是为了打断入口（build.py）↔ 内容层（content/*）的循环依赖：
两边都只读这里的表，谁先导入都不影响结果。**始终通过模块属性访问**
（`contracts.GLOBAL_CONTRACTS`），不要 from-import 具体字典 ——
测试会重绑整张表喂恶意契约名，副本看不见重绑。
"""

from engine.core import contract as contract_mod

GLOBAL_CONTRACTS = {}     # 契约名 → 字段表（register_contracts 原地填）
CONTRACT_DEFAULTS = {}    # 内容类型 → 契约名（site.sml 的 contracts 映射）
CONTRACT_LOOSE = False    # --contract-loose：未声明字段只告警


def set_contract_loose(flag):
    global CONTRACT_LOOSE
    CONTRACT_LOOSE = bool(flag)


def register_contracts(rep, where, cs):
    """登记契约。同名**且字段一致**时静默跳过 —— 多份内容 include 同一份契约盒
    必然产生重复登记，那不是问题；只有同名但字段不同才值得告警。"""
    for name, spec in (cs or {}).items():
        old = GLOBAL_CONTRACTS.get(name)
        if old is not None:
            if old == spec:
                continue
            rep.warn(where, "契约 `%s` 重复定义且字段不一致，以先定义的为准" % name)
            continue
        GLOBAL_CONTRACTS[name] = spec


def apply_contract(rep, where, d, kind):
    """按文件里的 @is 或 site.sml 的默认映射校验字段，报错带错误码 + 人话。
    返回是否真正套用了契约（套用了就不再跑内置必填校验，免得同一问题报两遍）。"""
    cname = d.get("__is") or CONTRACT_DEFAULTS.get(kind)
    if not cname:
        return False
    if cname not in GLOBAL_CONTRACTS:
        rep.err(where, "E-CONTRACT-001 未定义的契约 `%s`（已定义：%s）"
                % (cname, ", ".join(sorted(GLOBAL_CONTRACTS)) or "无"))
        return True
    for code, text in contract_mod.validate(d, cname, GLOBAL_CONTRACTS, loose=CONTRACT_LOOSE):
        rep.err(where, "%s %s" % (code, text))
    return True
