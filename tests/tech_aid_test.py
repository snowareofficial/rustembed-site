#!/usr/bin/env python3
"""P0 技术互助改名 / 授权声明 回归测试（只读断言，标准库，无第三方依赖）。

对 dist/（构建产物）做只读检查，不构建、不改任何文件：
- dist/index.html 注入三行授权声明（license-notice / -members / -site 三个 span）；
- manifest.json 的 services 条目含 rate（协作方式）与 wants（无商业词）；
- services/pcb-emc-review.html 含新文案、不含商业措辞；
- 渲染类产物（app.js / manifest.json / services/*.html）无「黄页」；
  dist/style.css 与 dist/pages/yellow-pages.* 是已知残留白名单（对齐移交文档 §3，
  其落地后把白名单删掉即可全文断言）；
- 字体子集不漏字：LICENSE_NOTICE 每个非 ASCII 字符都在 dist/fonts/*.woff 的 cmap 里
  （无子集文件时 SKIP）。

前置：先跑 `python engine/build.py`（或 cli.py build）。dist/ 缺失直接退出（对齐 check.py 口径）。

结构仿 tests/i18n_test.py：极简 ok/bad/skip 框架，退出码 0/1。
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIST = REPO / "dist"

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


def read(p):
    return Path(p).read_text(encoding="utf-8")


# 已知残留白名单（相对 dist 的 glob）：这些文件仍允许出现「黄页」，
# 来源不在本任务授权清单内（见 docs/P0-TECH-MUTUAL-AID-HANDOFF.md §3）：
# - style.css：theme 注释「黄页：三段式」（原样拷贝）；
# - pages/yellow-pages*：整页《能力与合作黄页制度》源文件；
# - llms.txt / map.svg / search-index.json / manifest.json：都由上面那页衍生的条目文本。
# §3 落地（页面改写 + 注释清理）后把白名单删掉即可全文断言。
YELLOW_PAGES_WHITELIST = [
    "style.css",
    "pages/yellow-pages*",
    "llms.txt",
    "map.svg",
    "search-index.json",
    "manifest.json",
]


def main():
    if not DIST.is_dir():
        print("dist/ 不存在，请先构建：python engine/build.py")
        sys.exit(1)

    # ---- 1. index.html 三行授权声明 ----
    idx_path = DIST / "index.html"
    if not idx_path.exists():
        bad("index.html", "文件不存在")
    else:
        idx = read(idx_path)
        for sid in ("license-notice", "license-notice-members", "license-notice-site"):
            if '<span id="%s"' % sid in idx:
                ok("index.html 含 span#%s" % sid)
            else:
                bad("index.html 含 span#%s" % sid, "授权声明未注入（页脚占位变了？）")
        for phrase in ("CC BY-NC-SA 4.0", "不参与交易撮合、资金托管与交付担保"):
            if phrase in idx:
                ok("index.html 含声明文案「%s」" % phrase)
            else:
                bad("index.html 含声明文案「%s」" % phrase, "缺失")

    # ---- 2. manifest services 条目 ----
    man_path = DIST / "manifest.json"
    if not man_path.exists():
        bad("manifest.json", "文件不存在")
    else:
        man = json.loads(read(man_path))
        svcs = man.get("services")
        if not svcs:
            bad("manifest services", "键缺失或为空")
        else:
            rate_ok = wants_ok = True
            for s in svcs:
                sid = s.get("id") or s.get("slug")
                if "rate" not in s:
                    rate_ok = False
                    bad("services/%s 含 rate" % sid, "缺字段")
                if "wants" not in s:
                    wants_ok = False
                    bad("services/%s 含 wants" % sid, "缺字段")
            if rate_ok:
                ok("manifest services 全部含 rate")
            if wants_ok:
                ok("manifest services 全部含 wants")
            # wants 不含商业词
            hits = [
                (s.get("id"), w2)
                for s in svcs
                for w2 in ("报价", "按板计费", "报酬", "价格")
                if w2 in (s.get("wants") or "")
            ]
            if hits:
                bad("manifest services wants 无商业词", "命中 %s" % hits)
            else:
                ok("manifest services wants 无商业词")

    # ---- 3. pcb-emc-review 详情页 ----
    svc_path = DIST / "services" / "pcb-emc-review.html"
    if not svc_path.exists():
        bad("services/pcb-emc-review.html", "文件不存在")
    else:
        html = read(svc_path)
        for phrase in ("协作方式", "时间与方式双方自行约定"):
            if phrase in html:
                ok("pcb-emc-review 含「%s」" % phrase)
            else:
                bad("pcb-emc-review 含「%s」" % phrase, "缺失")
        for phrase in ("按板计费", "报酬", "报价"):
            if phrase in html:
                bad("pcb-emc-review 不含「%s」" % phrase, "仍命中商业措辞")
            else:
                ok("pcb-emc-review 不含「%s」" % phrase)

    # ---- 4. 渲染类产物无「黄页」（白名单外） ----
    render_targets = [DIST / "app.js"] + sorted((DIST / "services").glob("*.html"))
    # manifest.json 在白名单内（页条目来自 yellow-pages.md），但 services 条目必须严格无「黄页」
    if man_path.exists():
        man_txt = read(man_path)
        svc_zone = json.dumps(man.get("services", []), ensure_ascii=False) if man else ""
        if "黄页" in svc_zone:
            bad("manifest services 无黄页", "services 条目命中「黄页」")
        else:
            ok("manifest services 无黄页")
    def in_whitelist(f):
        rel = str(f.relative_to(DIST)).replace("\\", "/")
        import fnmatch
        return any(fnmatch.fnmatch(rel, g) for g in YELLOW_PAGES_WHITELIST)

    for t in render_targets:
        if not t.exists():
            bad("%s 无黄页" % t.relative_to(DIST), "文件不存在")
            continue
        if "黄页" in read(t):
            bad("%s 无黄页" % t.relative_to(DIST), "命中「黄页」")
        else:
            ok("%s 无黄页" % t.relative_to(DIST))
    # 全 dist 扫描：白名单文件之外不允许出现「黄页」
    leaked = []
    for f in DIST.rglob("*"):
        if not f.is_file() or in_whitelist(f):
            continue
        if f.suffix in (".woff", ".woff2", ".png", ".jpg", ".ico"):
            continue
        try:
            if "黄页" in read(f):
                leaked.append(str(f.relative_to(DIST)))
        except (UnicodeDecodeError, OSError):
            continue
    if leaked:
        bad("dist 白名单外无黄页", "泄漏于 %s" % leaked)
    else:
        ok("dist 白名单外无「黄页」（白名单 %d 项）" % len(YELLOW_PAGES_WHITELIST))

    # ---- 5. 字体子集不漏字（LICENSE_NOTICE 全字符在 cmap） ----
    sys.path.insert(0, str(REPO))
    try:
        from engine.build import LICENSE_NOTICE  # noqa: E402
    except Exception as e:  # noqa: BLE001
        skip("字体子集 cmap", "无法导入 LICENSE_NOTICE：%r" % e)
        LICENSE_NOTICE = ""
    fonts = sorted((DIST / "fonts").glob("*.woff")) if (DIST / "fonts").is_dir() else []
    if not fonts:
        skip("字体子集 cmap", "dist/fonts 无 woff（先构建）")
    elif not LICENSE_NOTICE:
        skip("字体子集 cmap", "LICENSE_NOTICE 导入失败")
    else:
        vendor = REPO / "engine" / "vendor"
        if vendor.is_dir() and str(vendor) not in sys.path:
            sys.path.insert(0, str(vendor))
        from fontTools.ttLib import TTFont

        chars = {c for c in LICENSE_NOTICE if ord(c) > 127}
        covered = set()
        for fp in fonts:
            cmap = TTFont(str(fp)).getBestCmap()
            covered |= {c for c in chars if ord(c) in cmap}
        missing = chars - covered
        if missing:
            bad("字体子集不漏字", "缺 %d 字：%s" % (len(missing), "".join(sorted(missing))))
        else:
            ok("字体子集不漏字（%d 个字体文件，%d 个非 ASCII 字符全命中）"
               % (len(fonts), len(chars)))

    print("\n结果：%d 通过 / %d 失败" % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
