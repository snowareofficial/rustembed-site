#!/usr/bin/env python3
"""i18n phase 1 回归测试（标准库，无第三方依赖）。

覆盖：
- 单语言文章：manifest 无 langs / default_lang，产物与旧构建零变化；
- 多语言：index.en.md 生成 p/<slug>.en.html，manifest langs.en 正确，静态 GET 200；
- 同 slug 两个 zh（index.md + index.zh.md）→ 构建失败；
- 同 slug 两个 en（index.en.md + index.en.sml）→ 构建失败；
- 符号链接逃逸 → 拒绝（构建失败）；Windows 无权限建符号链接时跳过；
- 非法 lang 文件名（index.fr.md）→ 构建失败；
- manifest 顶层字段保持 zh 兼容（防回归）。

注意：?lang= 的运行时回退（fr / ../x / javascript: → 回落 zh、不越界）属于 site/theme/js/ 行为，
无法用纯 Python 单测，见 docs/I18N.md 的「人工验收」。本测试只覆盖构建期不变量。
"""

import functools
import http.server
import os
import shutil
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# ---- 极简测试框架（不引 pytest） ----
PASS = 0
FAIL = 0


def ok(name):
    global PASS
    PASS += 1
    print("  [PASS] %s" % name)


def bad(name, msg):
    global FAIL
    FAIL += 1
    print("  [FAIL] %s: %s" % (name, msg))


def skip(name, msg):
    print("  [SKIP] %s: %s" % (name, msg))


# ---- 临时站点 ----
SITE_SML = """title: "测试站"
nav: [library, posts]
contracts { post: BlogPost }
"""

ZH_MD = """---
title: "中文标题"
author: sal
date: 2026-10-19
tags: [rust, embedded]
summary: "中文摘要"
---
中文正文第一段。
"""

EN_MD = """---
title: "English Title"
author: sal
date: 2026-10-19
tags: [rust, embedded]
summary: "English summary"
---
English body first paragraph.
"""

EN_SML = """title: "English SML Title"
author: sal
date: 2026-10-19
tags: [rust, embedded]
summary: "English SML summary"
body: [ "English SML body." ]
"""


def make_site(base):
    site = base / "site"
    (site / "content" / "posts").mkdir(parents=True)
    (site / "content" / "contracts").mkdir(parents=True)
    (site / "content" / "summaries").mkdir(parents=True)
    (site / "meta").mkdir(parents=True)
    (site / "content" / "site.sml").write_text(SITE_SML, encoding="utf-8")
    # 契约直接复用仓库内的 BlogPost（只读拷贝，不改真实 site/content）
    shutil.copy(REPO / "site" / "content" / "contracts" / "blog.sml",
                site / "content" / "contracts" / "blog.sml")
    return site


def reset_posts(site):
    d = site / "content" / "posts"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)


def write_post(site, year, slug, lang, text):
    d = site / "content" / "posts" / year / slug
    d.mkdir(parents=True, exist_ok=True)
    name = "index.md" if lang == "zh" else "index.%s.md" % lang
    (d / name).write_text(text, encoding="utf-8")
    return d


def run_build(build_mod, out_dir):
    return build_mod.main(["--out", str(out_dir), "--offline"])


def load_manifest(out_dir):
    return __import__("json").loads((out_dir / "manifest.json").read_text(encoding="utf-8"))


def get_post(manifest, slug):
    for p in manifest["posts"]:
        if p.get("slug") == slug:
            return p
    return None


def main():
    base = Path(tempfile.mkdtemp(prefix="rec-i18n-"))
    build_mod = None
    try:
        site = make_site(base)
        os.environ["REC_BLOG_SITE"] = str(site)
        sys.path.insert(0, str(REPO))
        import engine.build as build_mod  # noqa: E402

        # ---- 场景 A：单语言 zh（零变化） ----
        reset_posts(site)
        write_post(site, "2026", "demo", "zh", ZH_MD)
        outA = base / "distA"
        rc = run_build(build_mod, outA)
        if rc != 0:
            bad("A 单语言构建", "rc=%s" % rc)
        else:
            man = load_manifest(outA)
            p = get_post(man, "demo")
            if p is None:
                bad("A 单语言 manifest", "找不到 demo")
            elif "langs" in p or "default_lang" in p:
                bad("A 单语言无 langs", "出现了 langs/default_lang：%s" % sorted(p.keys()))
            elif p.get("html") != "p/demo.html":
                bad("A 单语言 html 路径", p.get("html"))
            elif not (outA / "p" / "demo.html").exists():
                bad("A 单语言 html 文件", "p/demo.html 不存在")
            elif "中文正文第一段" not in (outA / "p" / "demo.html").read_text(encoding="utf-8"):
                bad("A 单语言正文", "正文内容不符")
            else:
                ok("A 单语言零变化（无 langs、html 不变）")

        # ---- 场景 B：加 index.en.md ----
        write_post(site, "2026", "demo", "en", EN_MD)
        outB = base / "distB"
        rc = run_build(build_mod, outB)
        if rc != 0:
            bad("B 多语言构建", "rc=%s" % rc)
        else:
            man = load_manifest(outB)
            p = get_post(man, "demo")
            if p is None:
                bad("B 多语言 manifest", "找不到 demo")
            elif p.get("default_lang") != "zh":
                bad("B default_lang", p.get("default_lang"))
            elif not isinstance(p.get("langs"), dict):
                bad("B langs", "langs 缺失或非 dict")
            elif "en" not in p["langs"] or "zh" not in p["langs"]:
                bad("B langs 键", sorted(p["langs"].keys()))
            elif p["langs"]["en"].get("html") != "p/demo.en.html":
                bad("B en html 路径", p["langs"]["en"].get("html"))
            elif p["langs"]["en"].get("title") != "English Title":
                bad("B en title", p["langs"]["en"].get("title"))
            elif p["langs"]["zh"].get("html") != "p/demo.html":
                bad("B zh html 路径", p["langs"]["zh"].get("html"))
            elif not (outB / "p" / "demo.en.html").exists():
                bad("B en 文件", "p/demo.en.html 不存在")
            elif not (outB / "p" / "demo.html").exists():
                bad("B zh 文件", "默认 p/demo.html 丢失")
            elif "English body first paragraph." not in (outB / "p" / "demo.en.html").read_text(encoding="utf-8"):
                bad("B en 正文", "en 正文内容不符")
            else:
                ok("B 多语言：langs.en 正确且 p/demo.en.html 已生成")
            # 静态 GET 200
            try:
                handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(outB))
                httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
                port = httpd.server_address[1]
                t = threading.Thread(target=httpd.serve_forever, daemon=True)
                t.start()
                try:
                    r = urllib.request.urlopen("http://127.0.0.1:%d/p/demo.en.html" % port, timeout=5)
                    body = r.read().decode("utf-8")
                    if r.status == 200 and "English body first paragraph." in body:
                        ok("B 静态 GET p/demo.en.html = 200")
                    else:
                        bad("B 静态 GET", "status=%s" % r.status)
                finally:
                    httpd.shutdown()
            except Exception as e:  # noqa: BLE001
                bad("B 静态 GET", "异常 %r" % e)

        # ---- 场景 C：同 slug 两个 zh（index.md + index.zh.md） ----
        reset_posts(site)
        write_post(site, "2026", "dup", "zh", ZH_MD)   # index.md
        (site / "content" / "posts" / "2026" / "dup" / "index.zh.md").write_text(ZH_MD, encoding="utf-8")
        outC = base / "distC"
        rc = run_build(build_mod, outC)
        if rc == 1:
            ok("C 重复 zh → 构建失败")
        else:
            bad("C 重复 zh", "期望 rc=1，实际 rc=%s" % rc)

        # ---- 场景 D：同 slug 两个 en（index.en.md + index.en.sml） ----
        reset_posts(site)
        write_post(site, "2026", "dupen", "en", EN_MD)
        (site / "content" / "posts" / "2026" / "dupen" / "index.en.sml").write_text(EN_SML, encoding="utf-8")
        outD = base / "distD"
        rc = run_build(build_mod, outD)
        if rc == 1:
            ok("D 重复 en → 构建失败")
        else:
            bad("D 重复 en", "期望 rc=1，实际 rc=%s" % rc)

        # ---- 场景 E：符号链接逃逸 → 拒绝 ----
        reset_posts(site)
        evil = site / "content" / "posts" / "2026" / "evil"
        evil.mkdir(parents=True, exist_ok=True)
        target = site / "content" / "site.sml"  # posts 目录外的文件
        link = evil / "index.md"
        try:
            os.symlink(str(target), str(link))
        except (OSError, NotImplementedError, AttributeError) as e:
            skip("E 符号链接", "无法创建符号链接（%r），跳过" % e)
        else:
            if not link.is_symlink():
                skip("E 符号链接", "链接未建成，跳过")
            else:
                outE = base / "distE"
                rc = run_build(build_mod, outE)
                if rc == 1:
                    ok("E 符号链接逃逸 → 构建失败")
                else:
                    bad("E 符号链接", "期望 rc=1，实际 rc=%s" % rc)

        # ---- 场景 F：非法 lang 文件名（index.fr.md） ----
        reset_posts(site)
        write_post(site, "2026", "frpost", "fr", ZH_MD)  # name=index.fr.md
        # write_post 用 .md 后缀，lang=fr → 文件名 index.fr.md
        outF = base / "distF"
        rc = run_build(build_mod, outF)
        if rc == 1:
            ok("F 非法 lang → 构建失败")
        else:
            bad("F 非法 lang", "期望 rc=1，实际 rc=%s" % rc)

        # ---- 防回归：manifest 顶层字段包含 zh 兼容字段 ----
        reset_posts(site)
        write_post(site, "2026", "demo", "zh", ZH_MD)
        write_post(site, "2026", "demo", "en", EN_MD)
        outG = base / "distG"
        run_build(build_mod, outG)
        man = load_manifest(outG)
        p = get_post(man, "demo")
        needed = ["title", "summary", "tags", "html", "words"]
        missing = [k for k in needed if k not in p]
        if missing:
            bad("G 顶层字段兼容", "缺 %s" % missing)
        elif p["title"] != "中文标题" or p["html"] != "p/demo.html":
            bad("G 顶层字段取 zh", "title=%r html=%r" % (p.get("title"), p.get("html")))
        else:
            ok("G 顶层字段保持 zh 兼容（防回归）")

        # ---- 场景 H：.markdown 扩展名单语言（防止把 index.markdown 误判） ----
        reset_posts(site)
        d = site / "content" / "posts" / "2026" / "mk"
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.markdown").write_text(ZH_MD, encoding="utf-8")
        outH = base / "distH"
        rc = run_build(build_mod, outH)
        if rc != 0:
            bad("H .markdown 单语言", "rc=%s" % rc)
        else:
            man = load_manifest(outH)
            p = get_post(man, "mk")
            if p is None:
                bad("H .markdown manifest", "找不到 mk")
            elif "langs" in p:
                bad("H .markdown 无 langs", "出现了 langs")
            elif not (outH / "p" / "mk.html").exists():
                bad("H .markdown 文件", "p/mk.html 不存在")
            else:
                ok("H .markdown 单语言正确（无误判）")

    finally:
        if build_mod is not None:
            # 清理 engine 模块缓存，避免影响其它进程（可选）
            pass
        shutil.rmtree(base, ignore_errors=True)

    print("\n结果：%d 通过 / %d 失败" % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
