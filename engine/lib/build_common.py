#!/usr/bin/env python3
"""构建器公共件：转义 / 构建报告 / 时间戳与分阶段计时（2026-10-21 自 build.py 拆出）。

只放「任何构建模块都可能用、且不依赖站点路径」的小东西 —— 这样 build_* 各模块
可以单向依赖它，不会互相 import 成环。
"""

import os
import time
from datetime import datetime, timezone


def now_iso():
    """构建时间。CI 里用 BUILT_AT 注入提交时间，保证同一提交重复构建产物一致。"""
    forced = os.environ.get("BUILT_AT", "").strip()
    if forced:
        return forced
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ---- 分阶段计时（build.py --timing；engine/bench.py 汇总冷/热/单篇基线） ----
# 只做记录与打印，不改变任何产物；没有 --timing 时 _Tick 仍记账但无输出。
_TIMINGS = []


class _Tick:
    """with _Tick("文章"): ... —— 记录一段耗时（秒，perf_counter）。"""

    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *exc):
        _TIMINGS.append((self.name, time.perf_counter() - self.t0))
        return False


def _mark(name):
    """打一个时间戳，配合 _span() 记录不便用 with 包裹的大段。"""
    return (name, time.perf_counter())


def _span(t0):
    """_span(_mark("llms"))：把这段耗时记进 _TIMINGS。"""
    _TIMINGS.append((t0[0], time.perf_counter() - t0[1]))


def print_timings(total):
    """按记录顺序打印各阶段耗时与占比（--timing 用）。"""
    if not _TIMINGS:
        return
    print("-- 计时")
    for name, dt in _TIMINGS:
        print("   %-22s %6.2fs  %4.1f%%" % (name, dt, (dt / total * 100) if total else 0))
    print("   %-22s %6.2fs" % ("合计", total))


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def err(self, where, msg):
        self.errors.append("%s: %s" % (where, msg))

    def warn(self, where, msg):
        self.warnings.append("%s: %s" % (where, msg))
