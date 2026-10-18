#!/usr/bin/env python3
"""写作台 API（只用标准库，不引 Flask/FastAPI）。

原则：
- 解析 / 渲染 / 契约 / 构建一律复用现有引擎（build / render / markdown / sml / contract），
  这里只做「HTTP 形状 + 路径白名单 + 保存纪律」；
- 路径白名单：realpath 必须落在 site/content/** 或 site/theme/**，否则 403；
- 保存：UTF-8 无 BOM、LF、末尾换行，且保存前跑契约，失败 422 且不写盘；
- 令牌只用于比对 `X-GUI-Token`，不写日志、不回显。

M1 已实现：types / tree / doc(GET,PUT) / validate / preview / new / status。
M2、M3 的 asset / resources / delete / pr / ai-summary 会在这里补，先给 501 说明。
"""

import datetime as dt
import hmac
import json
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = str(Path(__file__).resolve().parent)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import build  # noqa: E402  复用 load2 / render_body（导入时会把 lib 加进 sys.path）
import config  # noqa: E402
import render  # noqa: E402
import markdown as md  # noqa: E402
import sml  # noqa: E402
import contract as contract_mod  # noqa: E402

SITE = config.SITE
CONTENT = config.CONTENT
THEME = config.THEME
REPO = config.REPO

DOC_EXT = (".md", ".markdown", ".sml")
MAX_BODY = 32 * 1024 * 1024

# 类型 → (目录, 兜底契约名)。contracts/ 只读；site.sml 不在树里（改它要人工审）
KINDS = {
    "post": ("posts", "BlogPost"),
    "page": ("pages", "Page"),
    "topic": ("topics", "Topic"),
    "member": ("members", "Member"),
    "project": ("projects", "Project"),
    "resource": ("resources", "Resource"),
    "weekly": ("weekly", "Weekly"),
    "service": ("services", "Service"),
    "contract": ("contracts", None),
}

STATUS_LETTER = {"M": "M", "A": "A", "D": "D", "R": "R", "U": "U", "C": "C"}

TEMPLATES = {
    "post": """---
title: "%(title)s"
author: %(author)s
date: %(date)s
tags: [%(tags)s]
summary: "一句话摘要（列表页与分享卡片用）"
%(extra)s---

## 第一个小节

正文。支持 **粗体**、`行内代码`、表格、引用、代码块、图片（放 `assets/` 下）。
""",
    "topic": """---
title: "%(title)s"
summary: "一句话定义（词条页与知识页用）"
tags: [%(tags)s]
%(extra)s---

## 定义

写清楚这个主题到底是什么、边界在哪里。
""",
    "member": """---
name: "%(title)s"
role: 群友
skills: [%(tags)s]
%(extra)s---

## 自我介绍

一两句话就够。
""",
    "project": """---
name: "%(title)s"
one_liner: "一句话简介"
repo: https://gitee.com/%(author)s/%(slug)s
status: wip
%(extra)s---

## 这个项目解决什么

写清楚动机与现状。
""",
    "resource": """---
title: "%(title)s"
kind: book
url: https://example.com/
tags: [%(tags)s]
note: "一句话说明"
%(extra)s---

## 为什么推荐

适合谁、看到哪里就够了。
""",
    "weekly": """---
period: %(period)s
title: "%(title)s"
highlights: [%(tags)s]
%(extra)s---

## 本期要点

- 要点一
""",
    "page": """---
title: "%(title)s"
group: 指南
order: 99
%(extra)s---

## 这一页讲什么

写给谁看、看完能做什么。
""",
}


# ---------------------------------------------------------------- 路径白名单

def safe_path(rel):
    """客户端给的相对路径 → 绝对路径；越界/可疑返回 None（调用方给 403）。"""
    if not isinstance(rel, str) or not rel.strip():
        return None
    rel = rel.strip().replace("\\", "/")
    while rel.startswith("/"):
        rel = rel[1:]
    if rel.startswith("site/"):
        rel = rel[len("site/"):]
    segs = []
    for seg in rel.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            return None
        segs.append(seg)
    if not segs:
        return None
    try:
        p = SITE.joinpath(*segs).resolve()
    except OSError:
        return None
    for base in (CONTENT, THEME):
        try:
            base = base.resolve()
        except OSError:
            continue
        if p == base or base in p.parents:
            return p
    return None


def rel_of(p):
    """绝对路径 → 站点相对路径（posix）。"""
    try:
        return p.resolve().relative_to(SITE.resolve()).as_posix()
    except (ValueError, OSError):
        return str(p)


def kind_of(p):
    """按所在目录判定内容类型。"""
    try:
        parts = p.resolve().relative_to(SITE.resolve()).parts
    except (ValueError, OSError):
        return None
    if len(parts) >= 2 and parts[0] == "content":
        folder = parts[1]
        for kind, (f, _c) in KINDS.items():
            if f == folder:
                return kind
    return None


# ---------------------------------------------------------------- 契约

def contract_registry():
    reg = {}
    cf = CONTENT / "contracts"
    if not cf.is_dir():
        return reg
    for f in sorted(cf.glob("*.sml")):
        try:
            _v, cs = sml.load_doc(f)
        except Exception:
            continue
        for k, v in (cs or {}).items():
            reg.setdefault(k, v)
    return reg


def contract_defaults():
    try:
        site = sml.load(CONTENT / "site.sml")
    except Exception:
        return {}
    return {k: sml.as_str(v) for k, v in (site.get("contracts") or {}).items()
            if sml.as_str(v)}


def contract_of(path):
    """某文件应套用的契约名（按 site.sml 的默认映射）。"""
    kind = kind_of(path)
    if not kind:
        return None, None
    return kind, contract_defaults().get(kind) or KINDS.get(kind, (None, None))[1]


def field_of(code, text):
    """从契约报错里抠出字段名，前端才能定位到控件。"""
    toks = re.findall(r"`([^`]+)`", text or "")
    if not toks or code == "E-CONTRACT-001":
        return ""
    if "." in toks[0]:
        return re.sub(r"\[\d+\]$", "", toks[0].split(".")[-1])
    return toks[-1]


def validate_doc(path, front_matter=None, body=None, raw=None):
    """保存前校验。返回 (ok, [{"field","code","msg"}])。"""
    errors = []
    kind, cname = contract_of(path)
    reg = contract_registry()
    if not cname:
        return True, []

    if raw is not None:
        if str(path).endswith(".sml"):
            try:
                d, _cs = sml.parse_doc(raw, str(path))
            except Exception as e:
                return False, [{"field": "", "code": "E-PARSE", "msg": "SML 解析失败：%s" % e}]
            if not isinstance(d, dict):
                return False, [{"field": "", "code": "E-PARSE", "msg": "SML 顶层必须是块"}]
        else:
            d, body = md.split_front_matter(str(raw))
    else:
        d = dict(front_matter or {})
    d = dict(d or {}) if isinstance(d, dict) else {}
    # 文件里写 @is 优先，其次 site.sml 的默认映射（与 build.apply_contract 一致）
    if d.get("__is"):
        cname = sml.as_str(d.get("__is"))
    d["__md_body"] = body or ""

    pairs = []
    contract_mod.validate(d, cname, reg, out=pairs)
    for code, text in pairs:
        errors.append({"field": field_of(code, text), "code": code, "msg": text})
    return (not errors), errors


# ---------------------------------------------------------------- 读写

def read_doc(p):
    raw = p.read_text(encoding="utf-8")
    ext = p.suffix.lower()
    if ext in (".md", ".markdown"):
        fm, body = md.split_front_matter(raw)
        fm = {k: v for k, v in fm.items() if not str(k).startswith("__")}
        return {"ext": "md", "front_matter": fm, "body": body, "raw": raw}
    try:
        d = sml.load(p)
        fm = {k: v for k, v in d.items() if not str(k).startswith("__")}
    except Exception:
        fm = {}
    return {"ext": "sml", "front_matter": fm, "body": "", "raw": raw}


def _is_scalar(v):
    return isinstance(v, (str, int, float, bool)) or v is None


def _scalar_str(v):
    if v is None:
        return '""'
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s == "":
        return '""'
    risky = (re.search(r"[:#\[\]{},&*?|>%@`!]", s) or s.strip() != s
             or s.lower() in ("true", "false", "null", "yes", "no", "~")
             or re.match(r"^[-+.]?[\d.]+$", s))
    if risky:
        return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')
    return s


def dump_yaml(data, indent=0):
    """front matter 的 YAML 子集序列化（能被 markdown._yaml_subset 读回）。"""
    pad = "  " * indent
    lines = []
    for k, v in data.items():
        if k is None or str(k).startswith("__"):
            continue
        if v is None or v == "" or v == [] or v == {}:
            continue
        key = "%s%s:" % (pad, k)
        if isinstance(v, dict):
            lines.append(key)
            lines.append(dump_yaml(v, indent + 1))
        elif isinstance(v, list):
            if all(_is_scalar(x) for x in v):
                lines.append(key)
                for x in v:
                    lines.append("%s  - %s" % (pad, _scalar_str(x)))
            else:
                lines.append(key)
                for x in v:
                    if isinstance(x, dict):
                        sub = dump_yaml(x, indent + 2).split("\n")
                        lines.append("%s  - %s" % (pad, sub[0].strip()))
                        lines.extend(sub[1:])
                    else:
                        lines.append("%s  - %s" % (pad, _scalar_str(x)))
        else:
            lines.append("%s %s" % (key, _scalar_str(v)))
    return "\n".join([x for x in lines if x != ""])


def dump_doc(front_matter, body):
    """front matter + 正文 → 完整文件文本。"""
    body = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    body = body.rstrip("\n") + "\n" if body.strip() else ""
    if not front_matter:
        return body
    return "---\n" + dump_yaml(front_matter) + "\n---\n\n" + body


def write_text(p, text):
    """落盘纪律：无 BOM、LF、末尾换行。"""
    # BOM（U+FEFF）在正文里没有任何排版意义，且会让 CI 的 builtin SML 解析失败，一律去掉
    text = text.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if text and not text.endswith("\n"):
        text += "\n"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# ---------------------------------------------------------------- 业务

def api_types():
    reg = contract_registry()
    defaults = contract_defaults()
    out = []
    for kind, (folder, fallback) in KINDS.items():
        cname = defaults.get(kind) or fallback
        spec = (reg.get(cname) or {})
        fields = []
        for fname, f in (spec.get("fields") or {}).items():
            fields.append({
                "name": fname,
                "type": f.get("type", "any"),
                "required": bool(f.get("required", False)),
                "options": f.get("enum") or None,
                "default": f.get("default"),
                "doc": f.get("doc", ""),
            })
        out.append({"type": kind, "dir": folder, "contract": cname,
                    "loose": bool(spec.get("loose", False)), "fields": fields})
    return out


def doc_files(kind=None):
    out = []
    for k, (folder, _c) in KINDS.items():
        if kind and k != kind:
            continue
        d = CONTENT / folder
        if not d.is_dir():
            continue
        if folder == "posts":
            files = sorted(d.glob("*/*/index.*"))
        else:
            files = sorted(p for p in d.iterdir() if p.suffix.lower() in DOC_EXT)
        for f in files:
            if f.name.startswith("_") or f.suffix.lower() not in DOC_EXT:
                continue
            out.append((k, f))
    return out


def api_tree(kind=None, q=""):
    items = []
    q = (q or "").strip().lower()
    for k, f in doc_files(kind):
        try:
            rel = rel_of(f)
            title = f.parent.name if k == "post" else f.stem
            draft = False
            ext = f.suffix.lower()
            try:
                if ext in (".md", ".markdown"):
                    fm, _b = md.split_front_matter(f.read_text(encoding="utf-8"))
                else:
                    fm = sml.load(f)
            except Exception:
                fm = {}
            title = str(pick_first(fm, ["title", "name", "period"]) or title)
            draft = fm.get("draft") is True
            if q and q not in title.lower() and q not in rel.lower():
                continue
            items.append({
                "type": k,
                "id": f.parent.name if k == "post" else f.stem,
                "title": title,
                "path": rel,
                "draft": draft,
                "ext": ext.lstrip("."),
                "mtime": int(f.stat().st_mtime),
            })
        except OSError:
            continue
    items.sort(key=lambda x: (x["type"], not x["draft"], x["title"]))
    return items


def pick_first(d, keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return None


def api_status():
    def git(*args):
        try:
            out = subprocess.run(["git", "--no-pager"] + list(args), cwd=str(REPO),
                                 capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return ""
        return out.stdout.strip() if out.returncode == 0 else ""

    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "-"
    dirty = []
    for line in git("status", "--porcelain", "--untracked-files=all").splitlines():
        m = re.match(r"^(..)\s+(.*)$", line)   # porcelain：XY + 空格 + 路径
        if not m:
            continue
        xy, path = m.group(1), m.group(2)
        if "->" in path:                      # 重命名
            path = path.split(" -> ")[-1]
        path = path.strip().strip('"')
        if xy == "??":
            letter = "U"
        else:
            letter = STATUS_LETTER.get(xy[1].strip() or xy[0].strip(), "M")
        dirty.append({"path": path, "status": letter})
    return {"branch": branch, "dirty": dirty}


def build_preview(path, front_matter, body, raw):
    """与 build 同源的渲染：返回 (html, toc, words)。"""
    if raw is not None and str(path).endswith(".sml"):
        try:
            d, _cs = sml.parse_doc(raw, str(path))
        except Exception as e:
            raise ValueError("SML 解析失败：%s" % e)
        if not isinstance(d, dict):
            raise ValueError("SML 顶层必须是块")
    else:
        d = dict(front_matter or {})
        d["__md_body"] = body or ""
    ctx = render.Ctx()
    html, toc = build.render_body(d, ctx, 1)
    # 与 build_posts 一致的两处后处理，保证「预览好看、线上不同」不会发生
    video = render.video_embed(sml.as_str(d.get("video", "")))
    if video:
        html = video + html
    if kind_of(path) == "post":
        slug = Path(path).parent.name
        html = html.replace('src="assets/', 'src="assets/posts/%s/' % slug)
    return html, toc, len(render.strip_html(html))


def api_new(payload):
    kind = str(payload.get("type") or "post")
    if kind not in TEMPLATES:
        return None, "不支持的类型：%s" % kind
    title = str(payload.get("title") or "").strip()
    if not title:
        return None, "标题不能为空"
    slug = str(payload.get("slug") or "").strip()
    if not slug:
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
        return None, "短名只能是小写字母、数字与连字符：%s" % slug

    folder = KINDS[kind][0]
    if kind == "post":
        rel = "content/posts/%d/%s/index.md" % (dt.date.today().year, slug)
    else:
        rel = "content/%s/%s.md" % (folder, slug)
    p = safe_path(rel)
    if p is None:
        return None, "路径越界：%s" % rel
    if p.exists():
        return None, "已存在同名文件：%s" % rel

    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [x for x in re.split(r"[,\s]+", tags) if x]
    extra = ""
    if payload.get("draft") is True:
        extra = "draft: true\n"
    text = TEMPLATES[kind] % {
        "title": title.replace('"', '\\"'),
        "author": str(payload.get("author") or "sal"),
        "date": dt.date.today().isoformat(),
        "period": dt.date.today().strftime("%Y-W%V"),
        "tags": " ".join(str(t) for t in tags) or "rust",
        "slug": slug,
        "extra": extra,
    }
    # 按 mock「创建后会打开编辑器，首次保存时写入文件」：这里只回模板，不落盘
    return {"path": rel, "template": text, "written": False}, None


# ---------------------------------------------------------------- HTTP

def make_handler(token):
    """生成带令牌校验的 handler 类。"""

    class Handler(BaseHTTPRequestHandler):
        server_version = "rec-blog-gui"
        protocol_version = "HTTP/1.1"

        # ---- 基础 ----
        def log_message(self, fmt, *args):
            try:
                msg = fmt % args
            except Exception:
                msg = str(fmt)
            sys.stderr.write("[gui] %s\n" % _redact(msg, token))
            sys.stderr.flush()

        def _send(self, code, obj):
            raw = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def _ok(self, obj, code=200):
            self._send(code, obj)

        def _err(self, code, msg, **extra):
            obj = {"ok": False, "error": msg}
            obj.update(extra)
            self._send(code, obj)

        def _body(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            if n <= 0:
                return b""
            if n > MAX_BODY:
                return b""
            return self.rfile.read(n)

        def _json_body(self):
            raw = self._body()
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return None

        def _auth(self):
            if not token:
                return True
            got = self.headers.get("X-GUI-Token", "") or ""
            return hmac.compare_digest(got, token)

        # ---- 路由 ----
        def do_GET(self):
            self._dispatch("GET")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_POST(self):
            self._dispatch("POST")

        def do_DELETE(self):
            self._dispatch("DELETE")

        def _dispatch(self, method):
            u = urlparse(self.path)
            path, qs = u.path, parse_qs(u.query)
            if not path.startswith("/api/"):
                self._err(404, "没有这个接口：%s" % path)
                return
            if not self._auth():
                self._err(401, "缺少或错误的 X-GUI-Token")
                return

            try:
                if method == "GET" and path == "/api/types":
                    self._ok(api_types())
                elif method == "GET" and path == "/api/tree":
                    self._ok(api_tree(qs.get("type", [""])[0], qs.get("q", [""])[0]))
                elif method == "GET" and path == "/api/status":
                    self._ok(api_status())
                elif method == "GET" and path == "/api/doc":
                    self._get_doc(qs.get("path", [""])[0])
                elif method == "PUT" and path == "/api/doc":
                    self._put_doc()
                elif method == "POST" and path == "/api/validate":
                    self._validate()
                elif method == "POST" and path == "/api/preview":
                    self._preview()
                elif method == "POST" and path == "/api/new":
                    self._new()
                elif path in ("/api/asset", "/api/resources", "/api/delete",
                              "/api/pr", "/api/ai-summary"):
                    self._err(501, "%s 尚未实现（见分期计划）" % path)
                else:
                    self._err(404, "没有这个接口：%s" % path)
            except Exception as e:  # 任何异常都要变成 JSON，别把栈丢给前端
                self._err(500, "%s: %s" % (type(e).__name__, e))

        # ---- 各接口 ----
        def _get_doc(self, rel):
            p = safe_path(rel)
            if p is None:
                self._err(403, "非法路径（只允许 site/content/** 与 site/theme/**）：%s" % rel)
                return
            if not p.exists():
                self._err(404, "文件不存在：%s" % rel)
                return
            try:
                doc = read_doc(p)
            except (OSError, UnicodeDecodeError) as e:
                self._err(500, "读取失败：%s" % e)
                return
            kind, cname = contract_of(p)
            self._ok({
                "ok": True,
                "path": rel_of(p),
                "type": kind,
                "contract": cname,
                "ext": doc["ext"],
                "front_matter": doc["front_matter"],
                "body": doc["body"],
                "raw": doc["raw"],
                "mtime": int(p.stat().st_mtime),
            })

        def _put_doc(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            p = safe_path(payload.get("path", ""))
            if p is None:
                self._err(403, "非法路径（只允许 site/content/** 与 site/theme/**）")
                return
            raw = payload.get("raw")
            fm = payload.get("front_matter")
            body = payload.get("body")
            if raw is None and fm is None and body is None:
                self._err(400, "缺少 front_matter/body 或 raw")
                return

            ok, errors = validate_doc(p, front_matter=fm, body=body, raw=raw)
            if not ok:
                self._err(422, "契约校验未通过，文件没有改动", errors=errors)
                return
            try:
                if raw is not None:
                    text = str(raw)
                else:
                    text = dump_doc(fm or {}, body or "")
                write_text(p, text)
            except OSError as e:
                self._err(500, "写入失败：%s" % e)
                return
            self._ok({"ok": True, "path": rel_of(p), "errors": []})

        def _validate(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            rel = payload.get("path", "")
            p = safe_path(rel) if rel else None
            if rel and p is None:
                self._err(403, "非法路径（只允许 site/content/** 与 site/theme/**）")
                return
            if p is None:
                # 没有 path 时按「未命名草稿」处理：只校验 front_matter 的形状
                p = CONTENT / "posts" / "_draft" / "index.md"
            ok, errors = validate_doc(p, front_matter=payload.get("front_matter"),
                                      body=payload.get("body"), raw=payload.get("raw"))
            self._ok({"ok": ok, "errors": errors})

        def _preview(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            rel = payload.get("path", "")
            p = safe_path(rel) if rel else None
            if rel and p is None:
                self._err(403, "非法路径（只允许 site/content/** 与 site/theme/**）")
                return
            try:
                html, toc, words = build_preview(p or (CONTENT / "posts" / "_draft" / "index.md"),
                                                 payload.get("front_matter"),
                                                 payload.get("body"),
                                                 payload.get("raw"))
            except ValueError as e:
                self._err(422, str(e))
                return
            except Exception as e:
                self._err(500, "渲染失败：%s: %s" % (type(e).__name__, e))
                return
            self._ok({"ok": True, "html": html, "toc": toc, "words": words})

        def _new(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            data, err = api_new(payload)
            if err:
                self._err(422, err)
                return
            self._ok(dict(data, ok=True))

    return Handler


def _redact(text, token):
    """日志脱敏：令牌一律 ***。"""
    if token and token in text:
        return text.replace(token, "***")
    return text
