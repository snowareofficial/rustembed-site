#!/usr/bin/env python3
"""写作台 API（只用标准库，不引 Flask/FastAPI）。

原则：
- 解析 / 渲染 / 契约 / 构建一律复用现有引擎（build / render / markdown / sml / contract），
  这里只做「HTTP 形状 + 路径白名单 + 保存纪律」；
- 路径白名单：realpath 必须落在 site/content/** 或 site/theme/**，否则 403；
- 保存：UTF-8 无 BOM、LF、末尾换行，且保存前跑契约，失败 422 且不写盘；
- 令牌只用于比对 `X-GUI-Token`，不写日志、不回显。

M1 已实现：types / tree / doc(GET,PUT) / validate / preview / new / status。
M2 已实现：asset / resources / delete / rename。
M3 已实现：pr（Gitee fork 兜底）/ reviewers；delete / rename / pr 要求登录
（Rust 反代只对这三个路径注入 `X-Gitee-Token`，本模块只读该头，不落盘、不日志）。
`/api/ai-summary` 仍返回 501 + 说明，不假装成功。
"""

import base64
import binascii
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
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
import urls  # noqa: E402  所有拼进 href/src 的链接都要过协议白名单
import cli  # noqa: E402  复用 slugify / 图片尺寸解析，不另写一份

SITE = config.SITE
CONTENT = config.CONTENT
THEME = config.THEME


def _find_repo_root():
    """站点所在的 git 仓库根：从 SITE 逐级向上找 `.git`。

    真实站点（`<repo>/site` 或「站点即仓库根」）都能找到；
    临时站点 / 非 git 目录返回 None —— 此时 git 类接口（status/delete/rename/pr）
    全部降级：删除/重命名退回文件系统，PR 明确失败并给出手动命令。
    """
    p = SITE.resolve()
    for cand in [p] + list(p.parents):
        if (cand / ".git").exists():
            return cand
    return None


REPO = _find_repo_root()

DOC_EXT = (".md", ".markdown", ".sml")
MAX_BODY = 32 * 1024 * 1024
MAX_IMAGE = build.MAX_IMAGE                 # 与 build.py 同一个上限（2 MB）
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
# 只看文件头几个字节，后缀可以骗人，魔数骗不了
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
    (b"RIFF", ".webp"),
)

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
                # 用「文本 + 所在路径」入口：内容里有 include 时展开，和 build 同口径
                d, _cs = sml.parse_doc_at(raw, str(path), root=str(CONTENT))
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
            # 深度无关：独立文章 posts/<年>/<短名>/，系列文章 posts/<年>/<系列>/<短名>/
            files = sorted(d.glob("*/**/index.*"))
        else:
            files = sorted(p for p in d.iterdir() if p.suffix.lower() in DOC_EXT)
        for f in files:
            if folder == "posts":
                rel = f.relative_to(d)
                if any(part.startswith("_") for part in rel.parts[:-1]):
                    continue
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


def git(*args, check_stderr=False, env=None):
    """在仓库根跑 git；`check_stderr=True` 时**失败**返回 stderr（成功返回 ""），
    拿不到 git 返回 None。REPO 为 None（站点不在 git 仓库里）时直接失败，不碰任何目录。

    `env` 只给这一次子进程（push 传注入令牌的临时 env），绝不改全局配置。

    `encoding="utf-8"`：git 输出按 UTF-8 解码（Windows 默认 GBK 会把中文
    提交信息/分支名解成 UnicodeDecodeError，管道线程炸掉、stdout 变 None）。
    """
    if REPO is None:
        return None if check_stderr else ""
    try:
        out = subprocess.run(["git", "--no-pager"] + list(args), cwd=str(REPO),
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=30, env=env)
    except (OSError, subprocess.SubprocessError):
        return None if check_stderr else ""
    if out.returncode == 0:
        if check_stderr:
            return ""                 # 成功：没有错误信息（stdout 由不带头调用另取）
        return (out.stdout or "").strip()
    if check_stderr:
        return (out.stderr or out.stdout or "").strip()
    return ""


def repo_relative(p):
    """站点相对路径 → 仓库相对路径（git rm / git mv 需要仓库根视角）。"""
    if REPO is None:
        return rel_of(p)
    try:
        return p.resolve().relative_to(REPO.resolve()).as_posix()
    except (ValueError, OSError):
        return rel_of(p)


def file_hash(p):
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return ""


def api_status():
    raw_branch = git("rev-parse", "--abbrev-ref", "HEAD") or ""
    branch = raw_branch.splitlines()[0] if raw_branch.strip() else "-"
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
            d, _cs = sml.parse_doc_at(raw, str(path), root=str(CONTENT))
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
        # 与 build.build_posts 同源：只改 `<img src="assets/`，不做全局字符串替换
        # （代码块里演示「怎么引用图片」的示例不会被误改写）。审计遗留项 c-12。
        html, _missing = build._localize_assets(html, slug, Path(path).parent)
    return html, toc, len(render.strip_html(html))


# ---------------------------------------------------------------- 图片附件

def sniff_ext(data, name=""):
    """按文件头判定真实图片类型（后缀可以骗人，魔数骗不了）；不是图片返回 None。"""
    head = data[:256].lstrip()
    if head[:5] in (b"<?xml", b"<svg") or b"<svg" in data[:4096]:
        return ".svg"
    for magic, ext in MAGIC:
        if not data.startswith(magic):
            continue
        if ext == ".webp" and data[8:12] != b"WEBP":
            continue
        return ext
    return None


def api_asset(payload):
    """上传图片到当前文档的 assets/；返回 (结果, 错误)。"""
    doc = safe_path(payload.get("path", "") or payload.get("doc", ""))
    if doc is None:
        return None, (403, "非法路径（只允许 site/content/** 与 site/theme/**）")
    raw = payload.get("data_base64") or ""
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError, TypeError):
        return None, (400, "图片数据不是合法 base64")
    if not data:
        return None, (400, "图片内容为空")
    if len(data) > MAX_IMAGE:
        return None, (413, "图片 %.1f MB 超过上限 %d MB"
                      % (len(data) / 1024 / 1024, MAX_IMAGE // 1024 // 1024))

    ext = sniff_ext(data)
    if ext is None:
        return None, (415, "不是受支持的图片格式（png / jpg / webp / gif / svg）")

    stem = cli.slugify(Path(str(payload.get("name") or "")).stem or "image", "image")[:48]
    target_dir = (doc if doc.is_dir() else doc.parent) / "assets"
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return None, (500, "assets 目录创建失败：%s" % e)

    # 同内容去重：已有完全一样的图就复用，别存第二份
    digest = hashlib.sha256(data).hexdigest()
    for old in sorted(target_dir.glob("*")):
        if old.is_file() and old.suffix.lower() in IMAGE_EXT:
            try:
                if hashlib.sha256(old.read_bytes()).hexdigest() == digest:
                    return _asset_result(old, doc, stem), None
            except OSError:
                continue

    fname = stem + ext
    i = 2
    while (target_dir / fname).exists():
        fname = "%s-%d%s" % (stem, i, ext)
        i += 1
    try:
        (target_dir / fname).write_bytes(data)
    except OSError as e:
        return None, (500, "写入失败：%s" % e)
    return _asset_result(target_dir / fname, doc, stem), None


def _asset_result(p, doc, stem):
    w, h = cli._read_image_size(p)          # noqa: SLF001 复用 cli 已实现的头部解析
    base = doc if doc.is_dir() else doc.parent
    try:
        rel = p.resolve().relative_to(base.resolve()).as_posix()
    except (ValueError, OSError):
        rel = "assets/" + p.name
    return {
        "ok": True,
        "path": rel_of(p),
        "name": p.name,
        "url": rel,                          # 只用于本站相对路径，前端不拼外链
        "markdown": "![%s](%s)" % (stem, urls.safe_url(rel) or rel),
        "width": w or 0,
        "height": h or 0,
        "size": p.stat().st_size,
    }


# ---------------------------------------------------------------- 资源库

def api_resources(q="", kind="", folder=""):
    q = (q or "").strip().lower()
    kind = (kind or "").strip().lower()
    folder = (folder or "").strip()
    out = []
    for f in build.docs_in(CONTENT / "resources"):
        try:
            d, _cs = build.load2(f)
        except Exception:                     # noqa: BLE001 单篇读不动不该拖垮列表
            continue
        title = sml.as_str(d.get("title")) or f.stem
        rkind = sml.as_str(d.get("kind", "")).lower()
        rfolder = sml.as_str(d.get("folder", ""))
        tags = [sml.as_str(x) for x in build.as_list(d.get("tags"))]
        if kind and rkind != kind:
            continue
        if folder and rfolder != folder:
            continue
        if q and q not in " ".join([title, f.stem, rkind, rfolder, " ".join(tags)]).lower():
            continue
        raw_url = sml.as_str(d.get("url"))
        url = urls.safe_url(raw_url)          # javascript: / data: 一律清空
        out.append({
            "id": f.stem,
            "title": title,
            "kind": rkind,
            "folder": rfolder,
            "url": url,
            "url_blocked": bool(raw_url) and not url,
            "code": sml.as_str(d.get("code", ""))[:64],   # 只当文本，不拼进 href/src
            "tags": tags,
            "note": sml.as_str(d.get("note", "")),
        })
    out.sort(key=lambda r: r["title"])
    return out


# ---------------------------------------------------------------- 删除 / 重命名

def _slug_of(p):
    return p.parent.name if kind_of(p) == "post" else p.stem


def api_delete(payload):
    p = safe_path(payload.get("path", ""))
    if p is None:
        return None, (403, "非法路径（只允许 site/content/** 与 site/theme/**）")
    if not p.exists():
        return None, (404, "文件不存在")
    slug = _slug_of(p)
    if str(payload.get("confirm", "")).strip() != slug:
        return None, (400, "确认文本不匹配，请输入 `%s`" % slug)
    # 文章连目录一起删（assets/ 也带走）；其余类型删文件
    target = p.parent if kind_of(p) == "post" else p
    rel = repo_relative(target)
    via = "git"
    if REPO is None:
        via = "fs"                    # 站点不在 git 仓库里：直接走文件系统
    else:
        err = git("rm", "-r", "-f", "--", rel, check_stderr=True)
        if err is None:
            return None, (500, "git rm 无法执行（本机 git 不可用？）")
        if err:
            via = "fs"                # 不在 git 里（未跟踪）：退回文件系统删除
    if via == "fs":
        try:
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        except OSError as e:
            return None, (500, "删除失败：%s" % e)
    return {"ok": True, "removed": rel, "via": via}, None


def api_rename(payload):
    p = safe_path(payload.get("path", ""))
    if p is None:
        return None, (403, "非法路径（只允许 site/content/** 与 site/theme/**）")
    if not p.exists():
        return None, (404, "文件不存在")
    new_slug = str(payload.get("slug", "")).strip()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", new_slug):
        return None, (422, "新短名只能是小写字母、数字与连字符")
    kind = kind_of(p)
    if kind == "post":
        src, dst = p.parent, p.parent.parent / new_slug
    else:
        src, dst = p, p.parent / (new_slug + p.suffix)
    if dst.exists():
        return None, (409, "目标已存在：%s" % rel_of(dst))
    via = "git"
    if REPO is None:
        via = "fs"                    # 站点不在 git 仓库里：直接走文件系统
    else:
        err = git("mv", "--", repo_relative(src), repo_relative(dst), check_stderr=True)
        if err is None:
            return None, (500, "git mv 无法执行（本机 git 不可用？）")
        if err:
            via = "fs"
    if via == "fs":
        try:
            src.rename(dst)
        except OSError as e:
            return None, (500, "重命名失败：%s" % e)
    if kind == "post":
        idx = sorted(dst.glob("index.*"))
        new_path = rel_of(idx[0]) if idx else rel_of(dst)
    else:
        new_path = rel_of(dst)
    return {"ok": True, "path": new_path, "via": via}, None


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

    # 系列文章收进系列子目录：posts/<year>/<series_id>/<slug>/（与 build_posts 的 E-POST-003 一致）
    series = payload.get("series")
    if series is None and isinstance(payload.get("front_matter"), dict):
        series = payload["front_matter"].get("series")
    if isinstance(series, dict):
        series = series.get("id")
    series = str(series or "").strip()
    if series and not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", series):
        return None, "系列 id 只能是小写字母、数字与连字符：%s" % series

    folder = KINDS[kind][0]
    if kind == "post":
        parts = ["content", "posts", str(dt.date.today().year)]
        if series:
            parts.append(series)
        parts += [slug, "index.md"]
        rel = "/".join(parts)
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
    if kind == "post" and series:
        extra += "series:\n  id: %s\n  title: %s\n  order: 1\n" % (series, series)
    if payload.get("draft") is True:
        extra += "draft: true\n"
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


# ---------------------------------------------------------------- PR / 审核人

GITEE_API = os.environ.get("REC_BLOG_GITEE_API") or "https://gitee.com/api/v5"
UA = "rec-blog-gui/0.1 (+writing desk)"
# 站点仓库的集成分支：作者 PR 一律进 staging，staging → master 由维护者合并
# （流程见 docs/WORKFLOW.md；标题行「→ staging」chip 与之一致）
BASE_BRANCH = "staging"


def _gitee(token, method, path, payload=None, timeout=20):
    """调 Gitee API v5。令牌走 Authorization 头，不进 URL、不进日志。
    返回 (status, dict)；网络错误 status=0。"""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(GITEE_API + path, data=data, method=method)
    req.add_header("Authorization", "token " + token)
    req.add_header("User-Agent", UA)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"message": raw[:200]}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"message": str(e)}


def _owner_repo():
    """站点仓库坐标（site.sml: repo_url）。拿不到返回 None。"""
    try:
        site = sml.load(CONTENT / "site.sml")
    except Exception:
        return None
    url = sml.as_str(site.get("repo_url", ""))
    if not url:
        return None
    u = urlparse(url if "://" in url else "https://" + url)
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return owner, repo


def api_reviewers():
    """PR 默认审核人：环境变量 REC_BLOG_REVIEWERS（逗号分隔）优先，否则 site.sml 的 reviewers。"""
    env = os.environ.get("REC_BLOG_REVIEWERS", "")
    if env.strip():
        return [x.strip() for x in env.split(",") if x.strip()]
    try:
        site = sml.load(CONTENT / "site.sml")
    except Exception:
        return []
    return [sml.as_str(x) for x in (site.get("reviewers") or []) if sml.as_str(x)]


def _branch_ok(b):
    """分支名：拒绝 master/main/staging（主干与集成分支都不许直接推）、
    空格、.. 与一切 shell/git 元字符。"""
    if not b or len(b) > 120 or b in ("master", "main", "staging"):
        return False
    if ".." in b or b.startswith(("/", "-", ".")) or b.endswith(("/", ".", ".lock")):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", b))


def default_branch(paths):
    """默认分支：post/<slug>-<yyyyMMddHHMM>（取第一个路径的短名）。"""
    slug = ""
    for rel in paths:
        p = safe_path(str(rel))
        if p is not None:
            slug = _slug_of(p)
            break
    return "post/%s-%s" % (slug or "draft", dt.datetime.now().strftime("%Y%m%d%H%M"))


def _pr_commands(branch, rels, message):
    """失败时给用户的可复制命令。用 shlex.quote：路径/提交信息含空格、引号、
    $、反引号时复制到 shell 里才不会坏（这是给人复制的，必须逐段转义）。"""
    return [
        "git checkout -b %s" % shlex.quote(branch),
        "git add %s" % " ".join(shlex.quote(r) for r in rels),
        "git commit -m %s" % shlex.quote(str(message)),
        "git push -u origin %s" % shlex.quote(branch),
    ]


def _pr_fail(stage, error, branch, rels, message):
    """任一步失败：给 stage + compare 链接 + 可复制命令；不 force、不重试、不改历史。"""
    or_pair = _owner_repo()
    compare = ""
    if or_pair:
        compare = "https://gitee.com/%s/%s/compare/%s...%s" % (
            or_pair[0], or_pair[1], BASE_BRANCH, branch)
    return {
        "ok": False,
        "stage": stage,
        "error": str(error)[:500],
        "branch": branch,
        "compare_url": compare,
        "commands": _pr_commands(branch, rels, message),
        "note": "没有执行 force、没有改历史、没有自动重试；分支与本地提交已保留。",
    }, None


def _is_auth_error(stderr):
    """push 的 401/403 判定（命中才走 fork 兜底；其余失败原地报）。
    注意：「没有 origin remote」时 git 也会打印 Could not read from remote repository.，
    那不是权限问题，先排除，否则会误走 fork。"""
    s = (stderr or "").lower()
    if "does not appear to be a git repository" in s or "repository not found" in s:
        return False
    return any(k in s for k in ("403", "401", "permission denied", "authentication failed",
                                "could not read from remote", "access denied",
                                "password authentication was removed"))


def _push_env(login, token):
    """push 专用临时 env：把 GUI 登录的令牌以 Basic 认证头交给 git 子进程。

    - 只作用于这一个子进程：不改全局 git 配置、不进 URL、不进 argv；
    - `GIT_TERMINAL_PROMPT=0`：没有可用凭据时立刻失败，绝不弹密码框；
    - `GIT_CONFIG_COUNT` 系列**需要 git ≥ 2.31**（见 docs/GUI-IMPLEMENT.md）；
    - 顺带清掉继承来的 `GIT_CONFIG_*`，避免和用户环境里已有的配置项串味；
    - `http.extraHeader` 对本次 push 里 git 访问的任何 http 主机都生效
      （env 只活这一个进程，风险可控；fork 的 push 同样走这里）。
    """
    basic = base64.b64encode(("%s:%s" % (login, token)).encode("utf-8")).decode("ascii")
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_CONFIG_")}
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "http.extraHeader"
    env["GIT_CONFIG_VALUE_0"] = "Authorization: Basic %s" % basic
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _create_pr(token, branch, title, body, reviewers, head=None):
    """Gitee 建 PR；head 缺省为同名分支，fork 兜底传 <login>:<branch>。"""
    or_pair = _owner_repo()
    if not or_pair:
        return None, "site.sml 里没有可用的 repo_url"
    st, pr = _gitee(token, "POST", "/repos/%s/%s/pulls" % or_pair, {
        "title": title,
        "head": head or branch,
        "base": BASE_BRANCH,
        "body": body,
        "assignees": reviewers,
    })
    if st not in (200, 201) or not pr.get("html_url"):
        return None, "创建 PR 失败（HTTP %s）：%s" % (st, pr.get("message", ""))
    return pr, None


def _fork_and_push(token, login, branch, rels, message, title, body, reviewers):
    """push 403/401 的 fork 兜底：建 fork → 等就绪 → 推 fork → PR head=<login>:<branch>。
    login 由调用方先用 GET /user 确认（不重复请求）。返回 (pr, None) 或 (None, (stage, error))。"""
    or_pair = _owner_repo()
    if not or_pair:
        return None, ("repo", "site.sml 里没有可用的 repo_url")
    st, me = _gitee(token, "GET", "/user")
    if st != 200 or not me.get("login"):
        return None, ("fork", "无法确认身份（GET /user：HTTP %s %s）" % (st, me.get("message", "")))
    login = me["login"]

    st, _f = _gitee(token, "POST", "/repos/%s/%s/forks" % or_pair)
    if st not in (200, 201, 409):     # 409 = 已 fork 过，直接复用
        return None, ("fork", "创建 fork 失败（HTTP %s %s）" % (st, _f.get("message", "")))

    ready = False
    for _ in range(10):               # 最多等 15 秒
        st2, r = _gitee(token, "GET", "/repos/%s/%s" % (login, or_pair[1]))
        if st2 == 200 and r.get("full_name"):
            ready = True
            break
        time.sleep(1.5)
    if not ready:
        return None, ("fork", "fork 一直没就绪，请稍后在 Gitee 网页端重试")

    err = git("remote", "add", "fork", "https://gitee.com/%s/%s.git" % (login, or_pair[1]),
              check_stderr=True)
    if err and "already exists" not in err:
        return None, ("fork", "添加 fork remote 失败：%s" % err)
    # fork 的 push 同样带令牌 env（干净机器上没有本机凭据）
    err = git("push", "-u", "fork", branch, check_stderr=True, env=_push_env(login, token))
    if err:
        return None, ("push", err)

    pr, perr = _create_pr(token, branch, title, body, reviewers,
                          head="%s:%s" % (login, branch))
    if perr:
        return None, ("pr", perr)
    return pr, None


def api_pr(payload):
    """提交 PR：确认身份 → checkout -b → add → commit → push → Gitee PR（403 走 fork 兜底）。
    目标分支是 staging（staging → master 由维护者合）；永不 force、永不推 master/staging；
    任一步失败返回 compare_url + commands，不自动重试、不改历史。"""
    paths = payload.get("paths") or []
    if not isinstance(paths, list) or not paths:
        return None, (400, "没有要提交的文件（paths 不能为空）")
    rels = []
    for rel in paths:
        p = safe_path(str(rel))
        if p is None:
            return None, (403, "路径越界（只允许 site/content/** 与 site/theme/**）：%s" % rel)
        rels.append(repo_relative(p))

    branch = str(payload.get("branch") or "").strip() or default_branch(paths)
    if not _branch_ok(branch):
        return None, (400, "分支名不合法（不能是 master/main/staging、不能含空格或 ..）：%s" % branch)
    message = str(payload.get("message") or "").strip() \
        or ("写作台：更新 %d 个文件" % len(rels))
    title = str(payload.get("title") or "").strip() or message.splitlines()[0]
    body = str(payload.get("body") or "")
    reviewers = [str(x).strip() for x in (payload.get("reviewers") or []) if str(x).strip()]

    if REPO is None:
        return _pr_fail("repo", "站点不在 git 仓库里（找不到 .git），无法本地提交",
                        branch, rels, message)

    # push 用 GUI 登录的令牌（Basic 头），先确认身份拿 login；
    # 令牌只进这一个子进程的 env，不进 URL、不进 argv、不进返回内容
    token = str(payload.get("_gitee_token") or "").strip()
    if not token:
        return _pr_fail("auth", "未登录：请先在顶栏「登录」（令牌只存本机钥匙串或内存）",
                        branch, rels, message)
    st, me = _gitee(token, "GET", "/user")
    if st != 200 or not me.get("login"):
        return _pr_fail("auth", "无法确认身份（GET /user：HTTP %s %s）"
                        % (st, me.get("message", "")), branch, rels, message)
    login = str(me["login"])

    err = git("checkout", "-b", branch, check_stderr=True)
    if err is None:
        return _pr_fail("checkout", "git 无法执行（本机装了 git 吗？）", branch, rels, message)
    if err:
        return _pr_fail("checkout", err, branch, rels, message)

    err = git("add", "--", *rels, check_stderr=True)
    if err is None:
        return _pr_fail("add", "git add 无法执行", branch, rels, message)
    if err:
        return _pr_fail("add", err, branch, rels, message)

    err = git("commit", "-m", message, check_stderr=True)
    if err:
        return _pr_fail("commit", err, branch, rels, message)
    commit = git("rev-parse", "--short", "HEAD") or ""

    err = git("push", "-u", "origin", branch, check_stderr=True, env=_push_env(login, token))
    if err and _is_auth_error(err):
        # 没有写权限：fork 兜底（head = <login>:<branch>），仍不 force
        pr, ferr = _fork_and_push(token, login, branch, rels, message,
                                  title, body, reviewers)
        if ferr:
            return _pr_fail(ferr[0], ferr[1], branch, rels, message)
        return {"ok": True, "branch": branch, "commit": commit,
                "pr_url": pr.get("html_url", ""), "reviewers": reviewers,
                "via": "fork", "head": pr.get("head", {}).get("label", "")}, None
    if err:
        return _pr_fail("push", err, branch, rels, message)

    pr, perr = _create_pr(payload.get("_gitee_token", ""), branch, title, body, reviewers)
    if perr:
        return _pr_fail("pr", perr, branch, rels, message)
    return {"ok": True, "branch": branch, "commit": commit,
            "pr_url": pr.get("html_url", ""), "reviewers": reviewers,
            "via": "origin", "head": pr.get("head", {}).get("label", branch)}, None


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

        def _err(self, status, msg, **extra):
            obj = {"ok": False, "error": msg}
            obj.update(extra)
            self._send(status, obj)

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

        def _gitee_token(self):
            """当前登录态带的 Gitee 令牌（Rust 反代只对写操作三件套注入）。
            本模块只读该头：不落盘、不日志、不回显。"""
            return (self.headers.get("X-Gitee-Token") or "").strip()

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
                elif method == "GET" and path == "/api/resources":
                    self._ok(api_resources(qs.get("q", [""])[0], qs.get("kind", [""])[0],
                                           qs.get("folder", [""])[0]))
                elif method == "GET" and path == "/api/reviewers":
                    self._ok(api_reviewers())
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
                elif method == "POST" and path == "/api/asset":
                    self._asset()
                elif method == "POST" and path == "/api/pr":
                    # M3 起写操作三件套要求登录：X-Gitee-Token 非空（Rust 反代注入）
                    if not self._gitee_token():
                        self._err(401, "请先登录（顶栏「登录」或设置 → 账户与安全）；"
                                       "未登录不能提交 PR / 删除 / 重命名")
                        return
                    self._pr()
                elif method == "POST" and path == "/api/delete":
                    if not self._gitee_token():
                        self._err(401, "请先登录（顶栏「登录」或设置 → 账户与安全）；"
                                       "未登录不能提交 PR / 删除 / 重命名")
                        return
                    self._delete()
                elif method == "POST" and path == "/api/rename":
                    if not self._gitee_token():
                        self._err(401, "请先登录（顶栏「登录」或设置 → 账户与安全）；"
                                       "未登录不能提交 PR / 删除 / 重命名")
                        return
                    self._rename()
                elif path == "/api/ai-summary":
                    self._err(501, "%s 尚未实现（见 docs/GUI-IMPLEMENT.md）" % path)
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
                "hash": file_hash(p),          # PUT 时带回 base_hash，用于外部改动检测
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

            # 外部改动检测：带了 base_hash 就比对，磁盘被改过 → 409，绝不覆盖
            base_hash = payload.get("base_hash") or payload.get("hash")
            if base_hash and p.exists():
                cur = file_hash(p)
                if cur and str(base_hash) != cur:
                    self._err(409, "文件已被外部修改（保存未执行）",
                              code="E-CONFLICT", hash=cur)
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
            self._ok({"ok": True, "path": rel_of(p), "errors": [], "hash": file_hash(p)})

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

        def _asset(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            data, err = api_asset(payload)
            if err:
                self._err(err[0], err[1])
                return
            self._ok(data)

        def _delete(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            data, err = api_delete(payload)
            if err:
                self._err(err[0], err[1])
                return
            self._ok(data)

        def _rename(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            data, err = api_rename(payload)
            if err:
                self._err(err[0], err[1])
                return
            self._ok(data)

        def _pr(self):
            payload = self._json_body()
            if payload is None:
                self._err(400, "请求体不是合法 JSON")
                return
            # 令牌只在这一调用链里传递，不写日志、不回显
            payload = dict(payload, _gitee_token=self._gitee_token())
            data, err = api_pr(payload)
            if err:
                self._err(err[0], err[1])
                return
            # 执行失败也是 200：ok=false + stage/compare_url/commands 交给前端展示
            self._ok(data)

    return Handler


def _redact(text, token):
    """日志脱敏：令牌一律 ***。"""
    if token and token in text:
        return text.replace(token, "***")
    return text
