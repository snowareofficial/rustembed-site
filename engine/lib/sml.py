"""SML 子集解析器（rec-blog 专用）；下方另有原生后端说明。

支持：# / -- / // 行注释、/* */ 与 _* *_ 块注释、引号串（\\n \\t \\u{} 等转义）、
裸词、int/float/bool/null、对象块、数组、裸块（`name arg { }`）、同名键合并为数组。

SML 解析器：原生后端（优先）+ 内置子集（兜底）。

两个后端对本站内容产出**同一数据模型**，渲染 / 契约 / 导图层无感：

  - 裸块 `topic 标题 { }` → {__type: "topic", __name: "标题", __args?: [...]}
  - 同名键重复出现 → 合并为数组，保持书写顺序
  - 片段 `@frag { }` 定义、`&frag` 值引用展开
  - `@contract` / `@is` 由 rec-blog 侧契约引擎处理（解析前剥离，见 _strip_directives）

后端选择（默认 auto）：

  - **native**：swsml 的 Python 绑定（`_swsml.py`，ctypes → Rust cdylib），
    完整 SML v4 能力 —— include / $env / @when / @for / 顶层数组、
    富错误（行号 + 列号 + 稳定错误码）。库发现顺序：
    `$SML_LIB` / `$REC_BLOG_SML_LIB` → `engine/native/` → 同级 sml checkout
    （含 cargo `target-dir` 重定向）→ PATH。找不到就自动退到 builtin，
    CI 不装 Rust 也能构建。
  - **builtin**：纯 Python 子集解析器，零第三方依赖。

特性开关：环境变量 `REC_BLOG_SML_FEATURES`（逗号/空格分隔，默认
`bareword-string,include,fragment`；`all` 全开）。未知特性名直接报错，
避免打字错误静默失效。`$env` 默认关闭 —— 它会把环境变量内联进产物。

include / namespace（`include "x.sml" as blog` + `@is blog.Resource`）：
只有**文件入口** `load_doc()` 会走 —— native 按 SML 规范递归展开数据，
rec-blog 侧用旁路契约表把被包含文件的 `@contract` 拉回来校验（native 既不懂
本站的 url/date/image 类型、也没实现 ns 限定名，详见下方 include 小节的实测结论）。
没有 include 的内容走原文本入口，语义逐字不变；native 缺失时含 include 的内容
直接报错，不静默降级。

约定（与本项目内容格式绑定）：
  - 裸词遇空白或 `} ] , {` 结束；含空格的文本必须加引号。
  - 裸块 `topic 标题 { ... }` 解析为 {__type: "topic", __name: "标题", ...}。
  - 同名键重复出现时合并为数组并保持书写顺序。
"""

import copy
import hashlib
import os
import re
import shutil
import tempfile

# include 允许根的惰性缓存（None = 还没算过，见 include_root()）
_INCLUDE_ROOT = None

_WS = " \t\r\n"
_STOP = "}]{,"


class SmlError(Exception):
    pass


def _scalar(tok):
    if tok == "true":
        return True
    if tok == "false":
        return False
    if tok in ("null", "none"):
        return None
    if re.fullmatch(r"[+-]?\d+", tok):
        return int(tok)
    if re.fullmatch(r"[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?", tok) and (
        "." in tok or "e" in tok.lower()
    ):
        return float(tok)
    return tok


class _Parser:
    def __init__(self, text, path="<sml>"):
        self.s = text
        self.i = 0
        self.n = len(text)
        self.path = path
        self.contracts = {}

    def err(self, msg):
        line = self.s.count("\n", 0, self.i) + 1
        raise SmlError("%s:%d: %s" % (self.path, line, msg))

    def _hex_cp(self, hexs, hint):
        """`\\u` 转义的码点校验：必须是 4 位以上十六进制、且 ≤ 0x10FFFF。

        非法输入（`\\uZZZZ` / `\\u{110000}` / 不足 4 位）一律走 self.err 抛
        SmlError（带 path:line），不许把 ValueError / 越界 chr() 泄漏给投稿者 ——
        两条后端都经过这里（原生路径的 _strip_directives 也调 string()）。
        """
        if len(hexs) < 4 or re.search(r"[^0-9a-fA-F]", hexs):
            self.err("%s，实得 %r" % (hint, hexs))
        cp = int(hexs, 16)
        if cp > 0x10FFFF:
            self.err("\\u 码点超出 Unicode 范围（> 0x10FFFF）：%s" % hexs)
        return cp

    def skip(self):
        while self.i < self.n:
            c = self.s[self.i]
            if c in _WS:
                self.i += 1
                continue
            if c == "#" or self.s.startswith("//", self.i) or self.s.startswith("--", self.i):
                nl = self.s.find("\n", self.i)
                self.i = self.n if nl < 0 else nl + 1
                continue
            if self.s.startswith("/*", self.i):
                e = self.s.find("*/", self.i + 2)
                if e < 0:
                    self.err("未闭合块注释 /*")
                self.i = e + 2
                continue
            if self.s.startswith("_*", self.i):
                e = self.s.find("*_", self.i + 2)
                if e < 0:
                    self.err("未闭合块注释 _*")
                self.i = e + 2
                continue
            break

    def bare(self):
        start = self.i
        while self.i < self.n:
            c = self.s[self.i]
            if c in _WS or c in _STOP or c in "#:":
                break
            if self.s.startswith("//", self.i) or self.s.startswith("--", self.i):
                break
            self.i += 1
        if self.i == start:
            self.err("期望一个值")
        return self.s[start:self.i]

    def string(self):
        self.i += 1
        buf = []
        while True:
            if self.i >= self.n:
                self.err("未闭合字符串")
            c = self.s[self.i]
            if c == '"':
                self.i += 1
                break
            if c == "\\":
                self.i += 1
                if self.i >= self.n:
                    self.err("转义符后缺字符")
                e = self.s[self.i]
                self.i += 1
                if e in ("n", "t", "r", "0", '"', "\\"):
                    buf.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0", '"': '"', "\\": "\\"}[e])
                elif e == "u":
                    if self.i < self.n and self.s[self.i] == "{":
                        j = self.s.find("}", self.i)
                        if j < 0:
                            self.err("未闭合 \\u{}")
                        cp = self._hex_cp(self.s[self.i + 1:j],
                                          "\\u{...} 里不是十六进制数字")
                        buf.append(chr(cp))
                        self.i = j + 1
                    else:
                        cp = self._hex_cp(self.s[self.i:self.i + 4],
                                          "\\u 后需要 4 位十六进制数字（如 \\u4e2d）")
                        buf.append(chr(cp))
                        self.i += 4
                else:
                    buf.append(e)
            else:
                buf.append(c)
                self.i += 1
        return "".join(buf)

    def raw_block(self):
        """原样抓取 `{ ... }` 的内部文本（契约定义用，不受数据语法影响）。"""
        if self.s[self.i] != "{":
            self.err("期望 `{`")
        self.i += 1
        start = self.i
        depth = 1
        while self.i < self.n:
            c = self.s[self.i]
            if c == '"':
                self.string()
                continue
            if self.s.startswith("/*", self.i) or self.s.startswith("_*", self.i):
                end = "*/" if self.s.startswith("/*", self.i) else "*_"
                j = self.s.find(end, self.i + 2)
                self.i = self.n if j < 0 else j + 2
                continue
            if c == "#" or self.s.startswith("//", self.i) or self.s.startswith("--", self.i):
                nl = self.s.find("\n", self.i)
                self.i = self.n if nl < 0 else nl + 1
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    body = self.s[start:self.i]
                    self.i += 1
                    return body
            self.i += 1
        self.err("未闭合的契约定义块")

    def put_entry(self, obj, key, val):
        """统一处理 `@is` 与 `@` 指令：`@is` 记为 __is；片段定义保留给展开阶段；其余指令丢弃。"""
        if key == "@is":
            obj["__is"] = val.strip() if isinstance(val, str) else str(val)
            return
        if isinstance(key, str) and key.startswith("@"):
            if key != "@contract" and isinstance(val, dict):
                _put(obj, key, val)   # @名字 { } 片段定义，等 _expand 处理
            return
        _put(obj, key, val)

    def scan_tokens(self):
        """从当前位置收集裸词/字符串，直到遇到 `{`（视为裸块参数）或 `}`/`]`/`,`。
        返回 (tokens, 是否遇到 `{`)。不消费定界符本身。"""
        toks = []
        while True:
            self.skip()
            if self.i >= self.n:
                break
            c = self.s[self.i]
            if c == "{":
                return toks, True
            if c in "}],":
                break
            toks.append(self.string() if c == '"' else self.bare())
        return toks, False

    def value(self):
        self.skip()
        if self.i >= self.n:
            self.err("期望一个值")
        c = self.s[self.i]
        if c == "{":
            return self.object()
        if c == "[":
            return self.array()
        if c == '"':
            return self.string()
        return _scalar(self.bare())

    def object(self):
        self.i += 1
        obj = {}
        while True:
            self.skip()
            if self.i >= self.n:
                self.err("未闭合块")
            if self.s[self.i] == "}":
                self.i += 1
                break
            key, val = self.entry()
            self.put_entry(obj, key, val)
        return obj

    def array(self):
        self.i += 1
        arr = []
        while True:
            self.skip()
            if self.i >= self.n:
                self.err("未闭合数组")
            c = self.s[self.i]
            if c == "]":
                self.i += 1
                break
            if c == ",":
                self.i += 1
                continue
            if c == "{":
                arr.append(self.object())
                continue
            if c == "[":
                arr.append(self.array())
                continue
            first = self.string() if c == '"' else self.bare()
            after_first = self.i
            args, is_block = self.scan_tokens()
            if is_block:
                sub = self.object()
                sub["__type"] = first
                if args:
                    sub["__name"] = args[0]
                if len(args) > 1:
                    sub["__args"] = args[1:]
                arr.append(sub)
            else:
                self.i = after_first
                arr.append(_scalar(first))
        return arr

    def entry(self):
        self.skip()
        head = self.string() if self.s[self.i] == '"' else self.bare()
        if head == "@contract":
            args, _ = self.scan_tokens()
            name = args[0] if args else ""
            self.skip()
            if self.i < self.n and self.s[self.i] == "{":
                spec = _parse_contract_body(self.raw_block(), name)
                # 规范形式是 `@contract Name loose {`（VS Code 扩展/上游语法）；
                # 体首行 `loose` 也继续兼容。
                if "loose" in args:
                    spec["loose"] = True
                self.contracts[name] = spec
            return head, {"__contract": name}
        self.skip()
        if self.i < self.n and self.s[self.i] == ":":
            self.i += 1
            return head, self.value()
        args, is_block = self.scan_tokens()
        if is_block:
            sub = self.object()
            sub["__type"] = head
            if args:
                sub["__name"] = args[0]
                if len(args) > 1:
                    sub["__args"] = args[1:]
            return head, sub
        if args:
            return head, (_scalar(args[0]) if len(args) == 1 else [_scalar(a) for a in args])
        return head, True


def _put(obj, key, val):
    if key not in obj:
        obj[key] = val
        return
    cur = obj[key]
    if isinstance(cur, list):
        cur.append(val)
    else:
        obj[key] = [cur, val]


def _expand(node, frags, _active=()):
    """展开片段引用：`@名字 { ... }` 定义、`&名字` 以值形式引用；@ 开头的指令/定义不进结果。

    _active 记录展开链上的片段名：自引用（`@a { k: &a }`）与互相引用
    （`@a { k: &b }` + `@b { k: &a }`）会成环，抛 SmlError 并给出成环链 ——
    以前这里是裸 RecursionError，投稿者看到的是 traceback 而不是 path:line。
    原生后端对同类输入报 E-INCLUDE-006（见 _map_native_error），口径一致。
    """
    if isinstance(node, list):
        return [_expand(x, frags, _active) for x in node]
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("@"):
                continue
            if isinstance(v, str) and v.startswith("&") and len(v) > 1 and v[1:] in frags:
                name = v[1:]
                if name in _active:
                    chain = " -> ".join(list(_active) + [name])
                    raise SmlError("片段引用成环：&%s（%s）" % (name, chain))
                sub = _expand(copy.deepcopy(frags[name]), frags, _active + (name,))
                if isinstance(sub, dict):
                    sub = {k2: v2 for k2, v2 in sub.items() if not k2.startswith("__")}
                out[k] = sub
                continue
            out[k] = _expand(v, frags, _active)
        return out
    return node


# ---------------------------------------------------------------------------
# 原生后端：swsml Python 绑定（engine/lib/_swsml.py，ctypes → Rust cdylib）
# ---------------------------------------------------------------------------

# 特性位（与 swsml c/sml_rs.h 逐位一致，v4 全集）。
_FEATURE_BITS = {
    "bareword-string": 1 << 0,
    "include": 1 << 1,
    "env": 1 << 2,
    "contract": 1 << 3,
    "fragment": 1 << 4,
    "top-level-array": 1 << 5,
    "namespace": 1 << 6,
    "implicit-ns": 1 << 7,
    "multi-include": 1 << 8,
    "glob-include": 1 << 9,
    "regex-include": 1 << 10,
    "ext-rewrite": 1 << 11,
    "when": 1 << 12,
    "for": 1 << 13,
    "typed-block": 1 << 14,
    "case-insensitive": 1 << 15,
    "block-name": 1 << 16,
}

# 默认开启 = 上游基线（SML_F_BASIC：裸词 / include / 片段）。
# 其余（env / when / for / 顶层数组 / 命名空间与 glob include …）按需用
# REC_BLOG_SML_FEATURES 开。$env 默认必须关：会把环境变量内联进公开产物。
_DEFAULT_FEATURES = ("bareword-string", "include", "fragment")

_LIB_NAMES = (["sml.dll", "libsml.dll"] if os.name == "nt"
              else ["libsml.so", "libsml.dylib", "sml"])

# @contract / @is：后面必须跟 空白/冒号/引号/{/行尾，防误伤 @island、@contractor
_DIRECTIVE_RE = re.compile(r"@(contract|is)(?=[\s:\"'{]|$)")

_native_cache = None      # None=未探测；False=不可用；module=可用
_FLAGS = None             # 特性位缓存（None=未计算）
_BACKEND = "auto"         # auto | native | builtin（测试用 set_backend）


def _cargo_target_dirs(project):
    """cargo 可能把 target-dir 重定向到别处（`.cargo/config.toml` 的
    `[build] target-dir`）。零依赖正则解析；相对路径按 project 解析。"""
    dirs = []
    home = os.path.expanduser(os.path.join("~", ".cargo"))
    cfgs = [os.path.join(project, ".cargo", "config.toml"),
            os.path.join(project, ".cargo", "config"),
            os.path.join(home, "config.toml"),
            os.path.join(home, "config")]
    for cfg in cfgs:
        try:
            with open(cfg, "r", encoding="utf-8") as fh:
                m = re.search(r'^\s*target-dir\s*=\s*"([^"]+)"', fh.read(), re.M)
        except OSError:
            continue
        if not m:
            continue
        d = os.path.expanduser(os.path.expandvars(m.group(1)))
        if not os.path.isabs(d):
            d = os.path.join(project, d)
        dirs.append(d)
    return dirs


def _candidate_libs():
    """原生库候选（全路径或目录），按优先级返回。"""
    here = os.path.dirname(os.path.abspath(__file__))     # engine/lib
    engine = os.path.dirname(here)                        # engine
    repo = os.path.dirname(engine)                        # 仓库根
    out = []
    for env in ("SML_LIB", "REC_BLOG_SML_LIB"):
        v = os.environ.get(env)
        if v:
            out.append(v)
    native_dir = os.path.join(engine, "native")           # 自带库放 engine/native/
    # 目录候选必须展开成具体文件名：_native_mod() 用 os.path.isfile() 过滤，
    # 只给目录会被整条跳过（曾导致「按文档把库放进 engine/native/」却仍走 builtin）。
    for name in _LIB_NAMES:
        out.append(os.path.join(native_dir, name))
    out.append(native_dir)
    sibling = os.path.join(repo, os.pardir, "sml")        # 本机开发布局：../sml
    dirs = [os.path.join(sibling, "rust", "target", "release"),
            os.path.join(sibling, "target", "release")]
    # cargo 的 target-dir 重定向指向 <dir>，release 产物实际在 <dir>/release/ 下；
    # 两种都放进来，免得有人把 target-dir 直接指到 release 目录时又找不到。
    for d in _cargo_target_dirs(os.path.join(sibling, "rust")):
        dirs.append(d)
        dirs.append(os.path.join(d, "release"))
    for d in dirs:
        for name in _LIB_NAMES:
            out.append(os.path.join(d, name))
    return out


def _native_mod():
    """原生绑定模块；加载失败返回 None（结果缓存，不反复试探）。"""
    global _native_cache
    if _native_cache is not None:
        return _native_cache or None
    try:
        import _swsml as mod
    except Exception:                                    # noqa: BLE001 —— 缺文件/语法错都当不可用
        _native_cache = False
        return None
    for cand in _candidate_libs():
        if not os.path.isfile(cand):
            continue
        try:
            mod.load_library(cand)
        except Exception:                                # noqa: BLE001 —— 旧库缺符号等
            continue
        _native_cache = mod
        return mod
    _native_cache = False
    return None


def set_backend(name):
    """强制后端：`native` / `builtin` / `auto`（默认 auto；测试与排查用）。"""
    global _BACKEND
    _BACKEND = name if name in ("auto", "native", "builtin") else "auto"


def _use_native():
    if _BACKEND == "builtin":
        return False
    return _native_mod() is not None


def backend():
    """当前生效的后端名：`native` / `builtin`。"""
    return "native" if _use_native() else "builtin"


def backend_info():
    """给人看的一行后端说明（构建日志用）。"""
    if not _use_native():
        return "builtin（内置子集解析器，零依赖）"
    try:
        return "native（swsml %s，特性 %s）" % (_native_mod().version(), _features_text())
    except Exception:                                    # noqa: BLE001
        return "native"


def _parse_features(spec):
    """特性名列表 → 位掩码。空 = 默认集；`all` = 0（上游语义：全开）。"""
    spec = (spec or "").strip()
    if not spec:
        bits = 0
        for n in _DEFAULT_FEATURES:
            bits |= _FEATURE_BITS[n]
        return bits
    if spec.lower() in ("all", "*"):
        return 0
    bits = 0
    for name in re.split(r"[,\s]+", spec):
        if name not in _FEATURE_BITS:
            raise SmlError("未知 SML 特性 `%s`（可用：%s）"
                           % (name, " ".join(sorted(_FEATURE_BITS))))
        bits |= _FEATURE_BITS[name]
    return bits


def feature_flags():
    """当前特性位（首次计算后缓存；REC_BLOG_SML_FEATURES 覆盖默认）。"""
    global _FLAGS
    if _FLAGS is None:
        _FLAGS = _parse_features(os.environ.get("REC_BLOG_SML_FEATURES", ""))
    return _FLAGS


def set_features(spec):
    """编程式设置特性（spec 同环境变量：逗号/空格分隔的名字，或 all）。测试用。"""
    global _FLAGS
    _FLAGS = _parse_features(spec or "")


def _features_text():
    bits = feature_flags()
    on = [n for n, b in _FEATURE_BITS.items() if bits and (bits & b)]
    return "/".join(on) if on else "all"


def _blank(buf, a, b):
    """把 [a, b) 的非换行字符换成空格 —— 等长回填，上游错误行号不漂。"""
    for k in range(a, b):
        if buf[k] != "\n":
            buf[k] = " "


def _read_is_arg(p):
    """`@is` 后跟 [:] 裸词或引号串（对齐内置 entry() 的取值）。读不到值返回 None。"""
    p.skip()
    if p.i < p.n and p.s[p.i] == ":":
        p.i += 1
        p.skip()
    if p.i >= p.n:
        return None
    c = p.s[p.i]
    if c in _WS or c in _STOP or c in "#:":
        return None
    val = p.string() if c == '"' else _scalar(p.bare())
    return val.strip() if isinstance(val, str) else str(val)


def _strip_directives(text, path="<sml>"):
    """剥掉 rec-blog 侧契约指令，返回 (干净文本, 契约表, __is 值)。
    `@contract 名 { ... }` / `@is 名` 必须由内置契约引擎处理（默认映射、
    loose、文档页、错误码文案都在 Python 侧），不能让上游解析期消费 ——
    上游的契约表只有「本文件内定义」，且校验后不进结果。其余 @ 指令
    （@frag、@when…）原样留给上游。剥掉的区间用等长空格回填（保留换行），
    上游错误报告的行号才不会漂。
    path 透给内部 _Parser：串内坏转义（\\uZZZZ 等）报错时带真实文件路径。
    """
    p = _Parser(text, path)
    buf = list(text)
    contracts = {}
    is_name = ""
    i = 0
    n = p.n
    while i < n:
        c = text[i]
        if c == '"':                       # 串内的 @ 不是指令
            p.i = i
            p.string()
            i = p.i
            continue
        if c == "#" or text.startswith("//", i) or text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if text.startswith("/*", i) or text.startswith("_*", i):
            end = "*/" if text.startswith("/*", i) else "*_"
            j = text.find(end, i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "@":
            m = _DIRECTIVE_RE.match(text, i)
            if m and m.group(1) == "is":
                p.i = m.end()
                name = _read_is_arg(p)
                if name is not None:
                    is_name = name
                    _blank(buf, i, p.i)
                    i = p.i
                    continue
            elif m:                        # @contract
                p.i = m.end()
                args, is_block = p.scan_tokens()
                if is_block:
                    name = args[0] if args else ""
                    spec = _parse_contract_body(p.raw_block(), name)
                    if "loose" in args:
                        spec["loose"] = True
                    contracts[name] = spec
                _blank(buf, i, p.i)
                i = p.i
                continue
        i += 1
    return "".join(buf), contracts, is_name


def _map_native_error(e, path, text, refs=(), tmap=None):
    """上游富错误 → rec-blog 的 SmlError（`path:line: [码] 人话`）。

    三件事：
      1. 定位：上游 EOF/预处理类错误 line=0，先在 refs（本机扫到的 include 行）
         里按**目标文件名**归因到真实行号，归不到才退回文档末行；
      2. 路径：native 看到的是临时树，`source` / 文案里的临时路径一律映射回
         原始文件 —— 作者不该看到 `C:\\Users\\...\\Temp\\rec-blog-include-xxx`；
      3. 兜底：拿不到任何原始文件信息时，至少报回入口文件。
    """
    src = (getattr(e, "source", "") or "").strip()
    msg = getattr(e, "text", "") or str(e)
    line = getattr(e, "line", 0)
    where = _original_of_path(src, tmap) if src else ""
    msg = _unmap_temp_paths(msg, tmap)
    if not where:
        where = _original_of_path(msg, tmap)
    if not where:
        where = str(path)
    if not line:
        line = _attribute_line(msg, refs)
    if not line:
        line = text.count("\n") + 1
    code = getattr(e, "code_str", "") or _GENERIC_CODE
    return SmlError("%s:%d: [%s] %s" % (where, line, code, msg))


def _original_of_path(text, tmap):
    """从一个可能含临时路径的串里认出原始文件（整段路径优先，其次 basename）。"""
    if not text or not tmap:
        return ""
    for tmp, orig in tmap.items():
        if tmp and tmp in text:
            return orig
    for tmp, orig in tmap.items():
        name = os.path.basename(tmp)
        if name and len(name) > 8 and name in text:
            return orig
    return ""


def _unmap_temp_paths(msg, tmap):
    """把文案里的临时路径换回原始路径；换不干净的残留抹成 `<临时目录>`。"""
    if not msg or not tmap:
        return msg
    for tmp, orig in tmap.items():
        for cand in (tmp, tmp.replace(os.sep, "/")):
            if cand:
                msg = msg.replace(cand, orig)
    return msg


# ---------------------------------------------------------------------------
# include / namespace：文件入口
# ---------------------------------------------------------------------------
#
# 分工（实测 swsml 0.6.4 定下的，别照抄注释，看 _native_load_doc 上方的原因）：
#
#   native load_file        —— 按 §4.6 在解析前递归展开 include、处理 `as ns`
#                              包裹、做越界/成环/深度防护。**只管数据**。
#   rec-blog Python 侧      —— 契约。被包含文件里的 @contract 由
#                              `bridge_contracts()` 走一遍 `_strip_directives`
#                              拉回来组成"旁路契约表"，校验仍走 `lib/contract.py`
#                              （url / date / image 这些 rec-blog 内置类型只有它认）。
#
# 为什么不让 native 校验契约：
#   1. 类型系统不等价 —— native 遇到 `url` / `date` / `image` 会当作"契约名"
#      去套 ContractRef，实测报 `E-CONTRACT-008 字段 url 应为块并按契约 url
#      校验`，而不是做格式检查；
#   2. 命名空间语义缺失 —— `include "x.sml" as blog` 之后 native 把契约登记成
#      **裸名**，`@is blog.Resource`（§4.4 规定的跨文件引用写法）实测报
#      `E-CONTRACT-001 未定义的契约 blog.Resource`。
#
# native 的沙箱基准是**包含者所在目录**，跨目录 include 一律 E-INCLUDE-003；
# 我们不改 native，而是**预处理绕开**：把 include 闭包复制进系统临时目录并
# 扁平化，改写每条 include 行为临时树内的相对路径，native 就只看到
# 「同目录 / 子目录」的 include。于是「能不能包含」由本节的允许根决定。

_MAX_INCLUDE_DEPTH = 32     # 与上游 sml-include::MAX_INCLUDE_DEPTH 对齐
_MAX_INCLUDE_FILES = 64     # 单个文件的 include 图预算（超过即拒，防菱形爆炸）
_MAX_INCLUDE_BYTES = 8 * 1024 * 1024   # 闭包总字节上限（防 include 炸弹）

# rec-blog 侧通用错误码：上游 sml-codes 里没有对应语义时用它，
# 不冒充上游码（上游 001..018 各有明确含义，借来用会骗人）。
_GENERIC_CODE = "E-PARSE"

_INCLUDE_LINE_RE = re.compile(r"^[ \t]*@?[ \t]*(include|import)[ \t]+(.*)$")

# 只认规范子集：`"路径"` 或 `"路径" as ns`。glob / 正则 / 挑键 / 多目标 /
# 点分模块名一律不支持（见 _unsupported_include_msg：native 会照常展开数据，
# 但旁路契约表拉不到它们的契约，两边会静默分叉，宁可报错）。
_INCLUDE_TARGET_RE = re.compile(
    r'^"(?P<path>[^"\\]*(?:\\.[^"\\]*)*)"'
    r'(?:[ \t]+as[ \t]+(?P<ns>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*))?[ \t]*$'
)


def _code_lines(text, path="<sml>"):
    """[(行号, 行文本)]：字符串与块注释内部的行被掩成空串。

    与上游 sml-include::segments 同思路 —— 注释或字符串里伪造一行
    `include "x.sml"` 不该真的去读文件。行号是 1 起的真实行号（报错要用）。
    """
    p = _Parser(text, path)
    spans = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            p.i = i
            try:
                p.string()
            except SmlError:                # 未闭合：后面整段都当串内，不当指令
                spans.append((i, n))
                break
            spans.append((i, p.i))
            i = p.i
            continue
        if c == "#" or text.startswith("//", i) or text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if text.startswith("/*", i) or text.startswith("_*", i):
            end = "*/" if text.startswith("/*", i) else "*_"
            j = text.find(end, i + 2)
            if j < 0:                       # 未闭合块注释：到 EOF 都算注释内
                spans.append((i, n))
                break
            spans.append((i, j + 2))
            i = j + 2
            continue
        i += 1
    out = []
    pos = 0
    for lineno, line in enumerate(text.split("\n"), 1):
        start = pos
        pos += len(line) + 1
        masked = any(a <= start < b for a, b in spans)
        out.append((lineno, "" if masked else line.rstrip("\r")))
    return out


def scan_include_refs(text, path="<sml>", root=None):
    """导出给上层的最低限度 include 信息：[(行号, 目标绝对路径, ns)]。

    只做语法识别 + 越界防护（见 _safe_include_target），不读目标文件。
    native 缺失时也用它来判定"这份内容需要原生后端"。
    """
    base = os.path.dirname(os.path.abspath(path)) or "."
    out = []
    for lineno, keyword, rest in _scan_include_lines(text, path):
        m = _INCLUDE_TARGET_RE.match(rest)
        if not m:
            raise SmlError(_unsupported_include_msg(path, lineno, keyword, rest))
        target = _safe_include_target(base, _unescape_path(m.group("path")),
                                       path, lineno, root=root)
        out.append((lineno, target, m.group("ns")))
    return out


def _scan_include_lines(text, path):
    out = []
    # 便宜的短路：绝大多数文件里根本没有这两个词，不值得跑一遍词法扫描
    #（也免得把「文件里有个没闭合的引号」这类错误提前暴露成 include 扫描错误）。
    if "include" not in text and "import" not in text:
        return out
    for lineno, line in _code_lines(text, path):
        m = _INCLUDE_LINE_RE.match(line)
        if m:
            out.append((lineno, m.group(1), m.group(2).strip()))
    return out


def _unescape_path(raw):
    """`"a\\"b"` → `a"b` 的最小反转义（路径里用不到 \\n 这类）。"""
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw):
            out.append(raw[i + 1])
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _same_or_under(child, parent):
    """realpath 隶属于判定（Windows 大小写不敏感）。"""
    c = os.path.normcase(os.path.abspath(child))
    p = os.path.normcase(os.path.abspath(parent))
    return c == p or c.startswith(p.rstrip(os.sep) + os.sep)


def include_root():
    """include 的**允许根**：站点内容目录（config.CONTENT = `site/content`）。

    native 自己还有一层更紧的沙箱（基准 = 包含者所在目录），我们靠预处理绕开它；
    真正决定「内容能引用到哪」的就是这里 —— 只允许站点内容目录以内的文件。
    测试 / 多站点可用 `set_include_root()` 覆盖，或用
    `REC_BLOG_SML_INCLUDE_ROOT` 环境变量。
    """
    global _INCLUDE_ROOT
    if _INCLUDE_ROOT is not None:
        return _INCLUDE_ROOT
    env = os.environ.get("REC_BLOG_SML_INCLUDE_ROOT", "")
    if env:
        root = env
    else:
        try:
            import config
            root = str(config.CONTENT)
        except Exception:                  # noqa: BLE001 —— 脱离 engine/ 单用时退回约定布局
            here = os.path.dirname(os.path.abspath(__file__))         # engine/lib
            root = os.path.join(here, os.pardir, os.pardir, "site", "content")
    _INCLUDE_ROOT = os.path.realpath(root)
    return _INCLUDE_ROOT


def set_include_root(path):
    """覆盖 include 允许根（测试 / 多站点用）。传空值恢复自动推断。"""
    global _INCLUDE_ROOT
    _INCLUDE_ROOT = os.path.realpath(str(path)) if path else None


def _safe_include_target(base, raw, path, lineno, root=None):
    """把 include 目标解析成绝对路径（realpath）。越界一律拒 —— 内容文件
    不得借 include 读到站点内容目录以外的东西（含仓库外的敏感文件）。

    基准目录 = **包含者所在目录**（解析相对路径用）；边界 = **允许根**
    （默认 `site/content`），两者不同：允许跨兄弟目录，但不许逃出内容目录。
    绝对路径、含 `..` 的逃逸、指向根外的 symlink 都在这里被拒（E-INCLUDE-003）。
    """
    root = os.path.realpath(str(root)) if root else include_root()
    if not raw.strip():
        raise SmlError("%s:%d: [E-INCLUDE-012] include 路径为空" % (path, lineno))
    if re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith(("/", "\\")):
        raise SmlError("%s:%d: [E-INCLUDE-003] include 越界拒绝：不允许绝对路径 `%s`；"
                       "请写相对于本文件的路径" % (path, lineno, raw))
    if "*" in raw or raw.startswith("re:"):
        raise SmlError(_unsupported_include_msg(path, lineno, "include", '"%s"' % raw))
    target = os.path.realpath(os.path.normpath(os.path.join(base, raw)))
    if not _same_or_under(target, root):
        raise SmlError("%s:%d: [E-INCLUDE-003] include 越界拒绝：%s 不在站点内容目录 %s 内"
                       % (path, lineno, target, root))
    return target


def _unsupported_include_msg(path, lineno, keyword, rest):
    """不支持的 include 形态 → 人话 + 怎么办。宁可拒绝也不静默分叉。"""
    hint = ("rec-blog 的 include 桥接只认 `include \"路径\"` 与 `include \"路径\" as ns`"
            "（native 按规范能展开更多形态，但契约没人校验，产物会静默漏校验）")
    for probe, why in (
        ("{", "挑键写法 `{ a, b }`"),
        (",", "一行多个目标"),
        ("*", "glob 通配"),
        ("re:", "正则匹配"),
    ):
        if probe in rest:
            return "%s:%d: [E-INCLUDE-012] 不支持的 include 形态（%s）：%s —— %s" % (
                path, lineno, why, rest.strip(), hint)
    if "." in rest.split()[0] if rest.split() else False:
        return "%s:%d: [E-INCLUDE-012] 点分模块名 `%s` 请写成带引号的相对路径 —— %s" % (
            path, lineno, rest.strip(), hint)
    return "%s:%d: [E-INCLUDE-012] include 路径必须加引号且单个目标：`%s` —— %s" % (
        path, lineno, rest.strip(), hint)


def _attribute_line(msg, refs):
    """上游 line=0 时，按 refs 里的目标文件名归因到真实行号。"""
    for ref in refs or ():
        lineno, target = ref[0], ref[1]
        name = os.path.basename(target)
        if name and name in msg:
            return lineno
    return 0


def _walk_include_graph(entry_path, entry_text, budget=None, root=None):
    """沿 include 图收集被包含文件：[{"path","ns","lineno","owner"}]。

    按「边」而不是「文件」去重：同一份文件被两条路径包含时（菱形），它在两个
    命名空间下都该有契约 —— 只登记先到的那条会让 `@is b.Resource` 莫名找不到。
    成环的情况交给 native 报 E-INCLUDE-002（它按「当前展开链」判定，比全局
    visited 准），这里只负责别把栈走爆（深度 + 文件数双上限）。
    """
    found = []
    budget = [_MAX_INCLUDE_FILES] if budget is None else budget
    visited = set()
    seen_bytes = [0]

    def visit(path, text, ns, chain):
        if len(chain) > _MAX_INCLUDE_DEPTH:
            raise SmlError("%s: [E-INCLUDE-004] include 嵌套超过 %d 层"
                           % (path, _MAX_INCLUDE_DEPTH))
        for lineno, target, child_ns in scan_include_refs(text, str(path), root=root):
            full = ("%s.%s" % (ns, child_ns) if ns and child_ns
                    else (ns or child_ns or ""))
            real = os.path.realpath(target)
            if real in chain:                 # 成环：native 会报 E-INCLUDE-002
                continue
            key = (real, full)
            if key in visited:
                continue
            visited.add(key)
            budget[0] -= 1
            if budget[0] < 0:
                raise SmlError("%s:%d: [E-INCLUDE-004] 单篇内容的 include 文件数超过上限 %d"
                               % (path, lineno, _MAX_INCLUDE_FILES))
            if not os.path.isfile(target):
                raise SmlError("%s:%d: [E-INCLUDE-001] include 目标不存在：%s"
                               % (path, lineno, target))
            try:
                with open(target, "r", encoding="utf-8") as fh:
                    sub = fh.read()
            except OSError as e:
                raise SmlError("%s:%d: [E-INCLUDE-001] include 读取失败 %s：%s"
                               % (path, lineno, target, e))
            seen_bytes[0] += len(sub.encode("utf-8"))
            if seen_bytes[0] > _MAX_INCLUDE_BYTES:
                raise SmlError("%s: [E-INCLUDE-004] include 闭包总大小超过上限 %d 字节"
                               % (path, _MAX_INCLUDE_BYTES))
            found.append({"path": target, "ns": full, "lineno": lineno, "owner": str(path)})
            visit(target, sub, full, chain + [real])

    entry = os.path.realpath(os.path.abspath(entry_path))
    visit(entry, entry_text, "", [entry])
    return found


class PreparedIncludeTree(object):
    """include 闭包的一份**临时扁平副本**，native 只看到这里。

        temp_root/entry.sml                 ← 入口（@contract/@is 已剥离）
        temp_root/<sha1(abs)[:12]>.sml      ← 闭包里每个被包含文件一份

    为什么要**全部平铺到同一个目录**（而不是 `entry.sml` + `_inc/` 子目录）：
    native 的沙箱基准是「**包含者所在目录**」，被包含文件里的 include 只能指向
    它自己所在目录的子树。一旦把被包含文件放进子目录，它对入口的引用就变成了
    `../entry.sml` ⇒ 直接吃 `E-INCLUDE-003`。平铺后每条 include 都是**同级**
    文件名，沙箱自然放行 —— 跨目录 include 就是这么绕开的。
    文件名用原始绝对路径的 sha1 前 12 位：不同目录的同名文件不会撞车。
    """

    def __init__(self, temp_root, entry_temp, copies, reverse):
        self.temp_root = temp_root
        self.entry_temp = entry_temp
        self.copies = copies                 # 原始 realpath → 临时路径
        self.reverse = reverse               # 临时 realpath → 原始路径

    def cleanup(self):
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def original_of(self, tmp_path):
        return self.reverse.get(os.path.realpath(str(tmp_path)))


def prepare_include_tree(entry_path, entry_text=None, root=None, graph=None):
    """把入口 + 它的 include 闭包复制进临时目录，并改写 include 路径。

    - 每个原始文件只复制一份（菱形包含共享同一份副本）；
    - 复制时沿用 `_strip_directives` 剥掉 @contract/@is，native 不碰契约；
    - 行号保持不变，native 报错的行号才能直接对应回原始文件；
    - `graph` 可传入已算好的 include 图，避免重复遍历。
    返回 PreparedIncludeTree；**调用方负责在 finally 里 cleanup()**。
    """
    root = os.path.realpath(str(root)) if root else include_root()
    entry = os.path.realpath(os.path.abspath(entry_path))
    if not _same_or_under(entry, root):
        raise SmlError("%s: [E-INCLUDE-003] include 越界拒绝：内容文件不在站点内容目录 %s 内"
                       % (entry_path, root))
    if entry_text is None:
        entry_text = _read_text(entry)
    if graph is None:
        graph = _walk_include_graph(entry, entry_text, root=root)

    temp_root = tempfile.mkdtemp(prefix="rec-blog-include-")
    copies = {entry: os.path.join(temp_root, "entry.sml")}
    for item in graph:
        h = hashlib.sha1(os.path.normcase(item["path"]).encode("utf-8")).hexdigest()[:12]
        copies[item["path"]] = os.path.join(temp_root, h + ".sml")

    reverse = {}
    try:
        for orig, tmp in copies.items():
            text = entry_text if (orig == entry and entry_text is not None) else _read_text(orig)
            body = _rewrite_includes(text, orig, root, copies, tmp)
            os.makedirs(os.path.dirname(tmp), exist_ok=True)
            with open(tmp, "w", encoding="utf-8", newline="") as fh:
                fh.write(body)
            reverse[os.path.realpath(tmp)] = orig
    except Exception:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise
    return PreparedIncludeTree(temp_root, copies[entry], copies, reverse)


def _rewrite_includes(text, path, root, copies, tmp_self):
    """把 text 里的每条 include 行改写成「从 tmp_self 到目标临时文件」的相对路径。

    顺带剥掉 @contract / @is（沿用 `_strip_directives`），只把数据和 include
    行留给 native。**只做行内替换，不增删行** —— 行号因此能与原始文件对齐。
    """
    clean, _contracts, _is = _strip_directives(text, path)
    out = clean.split("\n")
    tmp_dir = os.path.dirname(os.path.abspath(tmp_self))
    for lineno, kw, rest in _scan_include_lines(text, path):
        m = _INCLUDE_TARGET_RE.match(rest)
        if not m:
            raise SmlError(_unsupported_include_msg(path, lineno, kw, rest))
        raw = _unescape_path(m.group("path"))
        target = _safe_include_target(os.path.dirname(os.path.abspath(path)), raw,
                                       path, lineno, root=root)
        tmp_target = copies.get(os.path.realpath(target))
        if tmp_target is None:             # 兜底：图与副本必须一一对应，否则说明内部不一致
            raise SmlError("%s:%d: [E-INCLUDE-011] include 预处理失败：%s 不在闭包内"
                           % (path, lineno, os.path.basename(target)))
        rel = os.path.relpath(tmp_target, tmp_dir).replace(os.sep, "/")
        out[lineno - 1] = _rebuild_include_line(out[lineno - 1], kw, rel, m.group("ns"))
    return "\n".join(out)


def _rebuild_include_line(line, kw, rel, ns):
    """按原缩进 / 原 `as ns` 重建一行 include 指令。"""
    stripped = line.lstrip(" \t")
    indent = line[:len(line) - len(stripped)]
    at = "@" if stripped.startswith("@") else ""
    s = '%s%s "%s"' % (at, kw, rel)
    if ns:
        s += " as " + ns
    return indent + s


def bridge_contracts(entry_path, entry_text=None, root=None, graph=None):
    """旁路契约表：把 include 图里各文件定义的 @contract 拉回 Python 侧。

    `graph` 可传入已算好的 include 图（`_walk_include_graph` 的结果），
    省得同一份内容走两遍图。

    - 从**原始**文件读（不是临时副本），`as ns` → `ns.契约名`（§4.4 写法，
      native 0.6.4 缺这块，由这里补齐）；内联 → 裸 `契约名`；
    - 入口自己的 @contract 优先，不做覆盖；
    - 同一份文件被多处包含只过一次；同图内同名且**字段一致**静默去重；
    - 同图内同名但字段不一致 → 报错。上游 sml-codes **没有**「重复定义」专属码
      （016 是「契约叠加冲突」，不能借），所以用 rec-blog 侧通用码
      `_GENERIC_CODE`（= `E-PARSE`）并在文案里写清是重复定义；
    - 被包含文件里出现 `@is` → 明确报错（不静默忽略，否则契约会被悄悄跳过）。
    """
    root = os.path.realpath(str(root)) if root else include_root()
    if graph is None:
        if entry_text is None:
            entry_text = _read_text(entry_path)
        graph = _walk_include_graph(entry_path, entry_text, root=root)
    table = {}
    origin = {}                       # 限定名 → 首次定义它的文件（报错要指名道姓）
    for item in graph:
        text = _read_text(item["path"])
        _clean, local, is_name = _strip_directives(text, item["path"])
        if is_name:
            raise SmlError(
                "%s: [%s] 被包含文件里的 `@is %s` 暂不支持：契约应用只能写在入口文件"
                "（当前实现只把入口的 @is 带回 Python 侧校验）—— 请删掉它，"
                "或改用 `site.sml` 的 `contracts{}` 默认映射"
                % (item["path"], _GENERIC_CODE, is_name))
        for name, spec in local.items():
            key = "%s.%s" % (item["ns"], name) if item["ns"] else name
            spec = dict(spec, name=key)
            if key in table:
                if table[key] == spec:
                    continue          # 同一份文件被多处包含（菱形引用）：内容一致，静默去重
                raise SmlError(
                    "%s: [%s] 契约 `%s` 重复定义且字段不一致 —— %s 与 %s 各写了一份；"
                    "只留一份定义，或用 `as ns` 命名空间区分"
                    % (item["path"], _GENERIC_CODE, key, origin[key], item["path"]))
            table[key] = spec
            origin[key] = item["path"]
    return table


def _include_guard(val, path, hint):
    """内置解析器与文本入口都不展开 include（上游 loads 同样不展开）——
    内容里写了 include 就明确报错，避免正文静默变成垃圾字段。"""
    if isinstance(val, dict):
        for k in ("include", "import"):
            v = val.get(k)
            if isinstance(v, str) and v.endswith((".sml", ".conf")):
                raise SmlError("%s: `%s \"%s\"` —— %s" % (path, k, v, hint))
    return val


_BUILTIN_INCLUDE_HINT = "内置解析器不展开 include（要 include 请构建 swsml cdylib，见 engine/README.md）"
_TEXT_INCLUDE_HINT = "文本入口不展开 include，请用文件入口 load_doc()/load()"
_NATIVE_MISSING_HINT = (
    "内容用了 include / import，必须走原生后端（native）才能展开："
    "把 sml cdylib 放到 engine/native/sml.dll，或用 SML_LIB / REC_BLOG_SML_LIB 指向它"
    "（见 docs/ARCHITECTURE.md §14）。不装 native 的内容请不要写 include，"
    "rec-blog 不会把 include 静默当成普通字段"
)


def _native_parse_doc(text, path):
    mod = _native_mod()
    clean, contracts, is_name = _strip_directives(text, path)
    try:
        val = mod.loads(clean, flags=feature_flags())
    except mod.SmlError as e:
        raise _map_native_error(e, path, text)
    _include_guard(val, path, _TEXT_INCLUDE_HINT)
    if is_name and isinstance(val, dict):
        val["__is"] = is_name
    return val, contracts


def _file_feature_flags():
    """文件入口的特性位：当前集（含 REC_BLOG_SML_FEATURES）并上 namespace / contract。

    被包含文件里可能有 `@contract`，缺 `contract` 位会直接吃
    `E-FEATURE-001 @contract 需要特性 contract`；`as ns` 同理缺 `namespace` 位。
    `implicit-ns` **刻意不开** —— 开了以后 `include "foo"` 会悄悄变成命名空间
    `foo`，与本站既有口径不一致。
    """
    return (feature_flags()
            | _FEATURE_BITS["namespace"]
            | _FEATURE_BITS["contract"])


def _native_load_file(target, where, text, refs=(), tmap=None):
    """对（临时树里的）`target` 跑文件入口 load_file。

    `where` / `text` 是**原始**入口文件与其文本，只用于报错；
    `tmap` 把 native 文案里的临时路径映射回原始路径。
    """
    mod = _native_mod()
    try:
        return mod.load_file(target, flags=_file_feature_flags())
    except mod.SmlError as e:
        raise _map_native_error(e, where, text, refs, tmap)
    except Exception as e:                     # noqa: BLE001 —— ctypes/OSError 不裸抛
        raise SmlError("%s: [E-NATIVE-001] 原生后端调用失败（%s）：%s"
                       % (where, type(e).__name__, e))


def _native_load_doc(path):
    """文件入口：预处理 include 闭包 → native 展开数据 → 契约留 Python 侧。"""
    with open(str(path), "r", encoding="utf-8") as fh:
        return _load_doc_included(str(path), fh.read())


def parse_doc_at(text, path, root=None):
    """「文本 + 它所在的文件路径」入口：内容含 include 就走预处理 + native，
    否则与 `parse_doc()` 逐字一致。

    给写作台的保存前校验 / 预览用 —— 编辑器里那份可能还没落盘，但**路径**是
    真路径，include 的相对基准因此仍然成立，校验口径和 `build` 完全一致
    （用 `parse_doc()` 会撞上「文本入口不展开 include」的护栏）。
    """
    p = str(path)
    if os.path.splitext(p)[1].lower() != ".sml" or not _scan_include_lines(text, p):
        return parse_doc(text, p)
    return _load_doc_included(p, text, root=root)


def _load_doc_included(path, text, root=None):
    """含 include 的文件入口。

    流程（对应上面小节的设计）：
      1. 扫 include 图（含越界 / 成环 / 深度 / 数量防护）；
      2. 把闭包复制进系统临时目录并扁平化、剥离 @contract/@is、改写 include 路径；
      3. native load_file 只解析临时入口；
      4. 契约从**原始**文件收集（`bridge_contracts`）后交给 `lib/contract.py`；
      5. finally 里删掉整个临时目录。
    """
    root = os.path.realpath(str(root)) if root else include_root()
    if not _use_native():
        refs = _scan_include_lines(text, path)
        raise SmlError("%s:%d: [E-FEATURE-001] %s"
                       % (path, refs[0][0] if refs else 1, _NATIVE_MISSING_HINT))
    clean, contracts, is_name = _strip_directives(text, path)
    refs = scan_include_refs(text, path, root=root)
    graph = _walk_include_graph(path, text, root=root)
    tree = prepare_include_tree(path, entry_text=text, root=root, graph=graph)
    try:
        val = _native_load_file(tree.entry_temp, path, text, refs, tree.reverse)
    finally:
        tree.cleanup()
    # 旁路契约表：被包含文件里的 @contract —— 入口自己的契约优先，不做覆盖
    for key, spec in bridge_contracts(path, text, root=root, graph=graph).items():
        contracts.setdefault(key, spec)
    if is_name and isinstance(val, dict):
        val["__is"] = is_name
    return val, contracts


def _read_text(path):
    with open(str(path), "r", encoding="utf-8") as fh:
        return fh.read()


def parse_doc(text, path="<sml>"):
    """返回 (值, 契约表)。优先原生后端；库不可用时自动用内置子集解析器。"""
    if _use_native():
        return _native_parse_doc(text, path)
    val, contracts = _builtin_parse_doc(text, path)
    return _include_guard(val, path, _BUILTIN_INCLUDE_HINT), contracts


def _builtin_parse_doc(text, path="<sml>"):
    p = _Parser(text, path)
    p.skip()
    if p.i < p.n and p.s[p.i] == "{":
        obj = p.object()
    else:
        obj = {}
        while True:
            p.skip()
            if p.i >= p.n:
                break
            if p.s[p.i] == "}":
                p.err("多余的 }")
            key, val = p.entry()
            p.put_entry(obj, key, val)
    frags = {k[1:]: v for k, v in obj.items()
             if isinstance(k, str) and k.startswith("@") and isinstance(v, dict)}
    val = _expand(obj, frags) if frags else obj
    return val, p.contracts


def parse(text, path="<sml>"):
    return parse_doc(text, path)[0]


_CONTRACT_FIELD = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.+)$")


def _num(tok):
    try:
        return int(tok)
    except ValueError:
        try:
            return float(tok)
        except ValueError:
            return None


def _parse_contract_body(text, name=""):
    """契约定义体 → {"name","loose","fields":{字段:{type,required,enum,min,max,default,doc}}}

    `#` 后的文字作为该字段的说明，会出现在自动生成的契约文档页里（代码即文档）。
    """
    spec = {"name": name, "loose": False, "fields": {}}
    for raw in text.split("\n"):
        line = raw.strip()
        if not line or line.startswith("//") or line.startswith("--"):
            continue
        doc = ""
        if "#" in line:
            line, doc = line.split("#", 1)
            doc = doc.strip()
        line = line.strip()
        if not line:
            continue
        if line in ("loose", "loose true"):
            spec["loose"] = True
            continue
        m = _CONTRACT_FIELD.match(line)
        if not m:
            continue
        fname, rest = m.group(1), m.group(2).strip()
        toks = rest.split()
        if toks and toks[0] == "enum":
            mm = re.search(r"\[(.*?)\]", rest)
            vals = [x for x in re.split(r"[,\s]+", mm.group(1).strip()) if x] if mm else []
            tail = rest.split("]", 1)[1] if "]" in rest else ""
            spec["fields"][fname] = {
                "type": "str", "required": "optional" not in tail.split(),
                "enum": vals, "min": None, "max": None,
                "default": None, "doc": doc,
            }
            continue
        f = {"type": toks[0] if toks else "any", "required": True,
             "enum": None, "min": None, "max": None, "default": None, "doc": doc}
        i = 1
        while i < len(toks):
            t = toks[i]
            if t == "optional":
                f["required"] = False
            elif t == "required":
                f["required"] = True
            elif t == "enum":
                mm = re.search(r"\[(.*?)\]", " ".join(toks[i + 1:]))
                if mm:
                    f["enum"] = [x for x in re.split(r"[,\s]+", mm.group(1).strip()) if x]
                i = len(toks)
                continue
            elif t == "min" and i + 1 < len(toks):
                i += 1
                f["min"] = _num(toks[i])
            elif t == "max" and i + 1 < len(toks):
                i += 1
                f["max"] = _num(toks[i])
            elif t == "default" and i + 1 < len(toks):
                i += 1
                f["default"] = toks[i].strip('"')
            i += 1
        spec["fields"][fname] = f
    return spec


def load_doc(path, root=None):
    """返回 (值, 契约表)。**文件入口**的分流发生在这里：

    - 内容里有 include / import → 走 `_load_doc_included()`：把 include 闭包复制进
      系统临时目录并扁平化、剥离 @contract/@is、改写 include 路径，再让 native
      展开数据；契约由旁路契约表拉回 Python 侧校验。native 不可用则**明确报错**
      （不静默退化成普通字段 —— 那会让正文变成垃圾）；
    - 没有 include → 维持原来的文本入口语义（含 @contract / @is 的既有处理）。

    只按 include 分流的理由：文件入口要落临时文件，让不含 include 的文件为此白写
    一次盘（GUI 实时校验 / 只读目录都会受影响），而它在没有 include 时与文本入口
    的产出**逐字一致**。Markdown 不进入（include 是 SML 指令）。
    """
    p = str(path)
    if os.path.splitext(p)[1].lower() != ".sml":
        with open(p, "r", encoding="utf-8") as fh:
            return parse_doc(fh.read(), p)
    with open(p, "r", encoding="utf-8") as fh:
        text = fh.read()
    if not _scan_include_lines(text, p):
        return parse_doc(text, p)
    try:
        return _load_doc_included(p, text, root=root)
    except SmlError:
        raise
    except Exception as e:                         # noqa: BLE001 —— 兜住 ctypes 原始异常
        raise SmlError("%s: [E-NATIVE-001] 原生 include 加载失败（%s）：%s"
                       % (p, type(e).__name__, e))


def load(path):
    return load_doc(path)[0]


def get(d, key, default=None):
    if isinstance(d, dict):
        v = d.get(key)
        return default if v is None else v
    return default


def as_list(v):
    if v is None:
        return []
    if isinstance(v, list):
        return v
    return [v]


def as_str(v, default=""):
    if v is None:
        return default
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)
