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

约定（与本项目内容格式绑定）：
  - 裸词遇空白或 `} ] , {` 结束；含空格的文本必须加引号。
  - 裸块 `topic 标题 { ... }` 解析为 {__type: "topic", __name: "标题", ...}。
  - 同名键重复出现时合并为数组并保持书写顺序。
"""

import copy
import os
import re

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
                        buf.append(chr(int(self.s[self.i + 1:j], 16)))
                        self.i = j + 1
                    else:
                        buf.append(chr(int(self.s[self.i:self.i + 4], 16)))
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


def _expand(node, frags):
    """展开片段引用：`@名字 { ... }` 定义、`&名字` 以值形式引用；@ 开头的指令/定义不进结果。"""
    if isinstance(node, list):
        return [_expand(x, frags) for x in node]
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("@"):
                continue
            if isinstance(v, str) and v.startswith("&") and len(v) > 1 and v[1:] in frags:
                sub = _expand(copy.deepcopy(frags[v[1:]]), frags)
                if isinstance(sub, dict):
                    sub = {k2: v2 for k2, v2 in sub.items() if not k2.startswith("__")}
                out[k] = sub
                continue
            out[k] = _expand(v, frags)
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


def _strip_directives(text):
    """剥掉 rec-blog 侧契约指令，返回 (干净文本, 契约表, __is 值)。

    `@contract 名 { ... }` / `@is 名` 必须由内置契约引擎处理（默认映射、
    loose、文档页、错误码文案都在 Python 侧），不能让上游解析期消费 ——
    上游的契约表只有「本文件内定义」，且校验后不进结果。其余 @ 指令
    （@frag、@when…）原样留给上游。剥掉的区间用等长空格回填（保留换行），
    上游错误报告的行号才不会漂。
    """
    p = _Parser(text)
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


def _map_native_error(e, path, text):
    """上游富错误 → rec-blog 的 SmlError（`path:line: [码] 人话`）。
    EOF 类错误上游 line=0，退回文档末行。"""
    line = getattr(e, "line", 0) or (text.count("\n") + 1)
    code = getattr(e, "code_str", "") or "E-PARSE"
    msg = getattr(e, "text", "") or str(e)
    return SmlError("%s:%d: [%s] %s" % (path, line, code, msg))


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


def _native_parse_doc(text, path):
    mod = _native_mod()
    clean, contracts, is_name = _strip_directives(text)
    try:
        val = mod.loads(clean, flags=feature_flags())
    except mod.SmlError as e:
        raise _map_native_error(e, path, text)
    _include_guard(val, path, _TEXT_INCLUDE_HINT)
    if is_name and isinstance(val, dict):
        val["__is"] = is_name
    return val, contracts


def _native_load_doc(path):
    """文件入口：剥离指令后写**同目录**临时文件再 load_file —— include 的
    相对路径以内容文件所在目录为基准（上游 loads 没有基准路径参数）。
    临时文件带 `_` 前缀，docs_in 与文章 glob 都不会收录。"""
    mod = _native_mod()
    p = os.path.abspath(path)
    with open(p, "r", encoding="utf-8") as fh:
        text = fh.read()
    clean, contracts, is_name = _strip_directives(text)
    stem, ext = os.path.splitext(os.path.basename(p))
    tmp = os.path.join(os.path.dirname(p), "_%s.native-%d%s" % (stem, os.getpid(), ext))
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(clean)
        try:
            val = mod.load_file(tmp, flags=feature_flags())
        except mod.SmlError as e:
            raise _map_native_error(e, path, text)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if is_name and isinstance(val, dict):
        val["__is"] = is_name
    return val, contracts


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


def load_doc(path):
    """返回 (值, 契约表)。"""
    with open(path, "r", encoding="utf-8") as fh:
        return parse_doc(fh.read(), str(path))


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
