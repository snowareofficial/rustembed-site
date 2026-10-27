"""阅读习惯配置：写在 site.sml，进 manifest 由前端取用。"""

from engine.parse import sml

DEFAULT_CODE_COLLAPSE_LINES = 20          # 代码超过这么多行就折叠（前端按钮可展开）


def collapse_lines(site):
    """代码块折叠阈值。site.sml 里 `code_collapse_lines: 20`；非法值退回默认并告警。"""
    v = site.get("code_collapse_lines", DEFAULT_CODE_COLLAPSE_LINES)
    try:
        n = int(sml.as_str(v))
    except (TypeError, ValueError):
        return DEFAULT_CODE_COLLAPSE_LINES
    # 上限只为挡住手滑多打一个 0（塞一整篇渲染进来）；下限保证「折叠后还有得看」
    return n if 1 <= n <= 500 else DEFAULT_CODE_COLLAPSE_LINES
