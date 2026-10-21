#!/usr/bin/env python3
"""构建器字体子集（2026-10-21 自 build.py 拆出）。

site_text() 收集「站点里出现过的所有文字」做子集签名 —— 主题源码（含按职责拆出来的
js/、css/ 子目录）、正文渲染结果与页脚授权声明都要收，否则 UI 文案缺字会回退系统字体。
"""

import hashlib
import html
import json
import re
from pathlib import Path

from build_assets import LICENSE_NOTICE
from build_paths import ROOT, THEME

FONT_EXT = (".ttf", ".otf", ".woff2", ".woff")
FONT_WEIGHT = {"thin": 100, "extralight": 200, "light": 300, "regular": 400, "normal": 400,
               "book": 400, "medium": 500, "semibold": 600, "demibold": 600, "bold": 700,
               "extrabold": 800, "black": 900, "heavy": 900}


def font_dirs():
    """字体可以放 theme/fonts/ 或 site/fonts/。"""
    return [d for d in (THEME / "fonts", ROOT / "fonts") if d.is_dir()]


def site_text(manifest, bodies=()):
    """站点里出现过的所有文字，用于字体子集化（宁可多收，不要漏字）。

    注意：manifest 里**不含文章正文**（正文以 _ 前缀被过滤），前端 JS/CSS 里的中文也不在里面，
    所以这里把正文渲染结果与 theme 源文件一起收进来，否则正文生僻字会回退到系统字体、段内字体混排。

    built_at 不参与签名：它是每次构建都变的时间戳，算进去会让 stamp 永远不命中，
    于是每次全量子集化（实测 4 个字体 30s+）——签名只该反映「文字内容与源字体」。
    """
    sig_manifest = {k: v for k, v in manifest.items() if k != "built_at"}
    parts = [json.dumps(sig_manifest, ensure_ascii=False)]
    # 正文是渲染后的 HTML：MathML/转义出口的数字实体（如 &#x02202; = ∂）是 ASCII 字面，
    # 先 unescape 再子集化，否则数学字形（∂ ∑ ∫ √ 等）不进 STIX 子集、页面回退系统字体。
    parts += [html.unescape(b) for b in bodies if b]
    for f in sorted(THEME.glob("*")):
        if f.suffix.lower() in (".js", ".css", ".html"):
            parts.append(f.read_text(encoding="utf-8", errors="replace"))
    # 主题 JS/CSS 按职责拆到 js/、css/ 子目录（2026-10-21）：与顶层文件一样收进子集，
    # 否则 UI 文案（导航标签 / 设置面板 / 一言…）缺字会回退系统字体、段内混排。
    # 只收这两个目录：vendor/（Prism）的头注释不进子集，保持与原行为一致。
    for sub in ("js", "css"):
        d = THEME / sub
        if d.is_dir():
            for f in sorted(d.glob("*")):
                if f.suffix.lower() in (".js", ".css"):
                    parts.append(f.read_text(encoding="utf-8", errors="replace"))
    # 页脚授权声明由构建期注入 index.html，不在 theme 源文件里，这里显式补上
    parts.append(LICENSE_NOTICE)
    return "".join(parts)


def font_family_weight(stem):
    low = stem.lower()
    if "stix" in low:
        family = "STIX Two Math"
    elif "xits" in low:
        family = "XITS Math"
    elif "misans" in low:
        family = "MiSans"
    else:
        family = re.split(r"[-_.]", stem)[0]
    weight = 400
    tail = re.split(r"[-_]", low)[-1]
    for key, val in FONT_WEIGHT.items():
        if tail == key or key in low:
            weight = val
            break
    return family, weight


def build_fonts(rep, out, manifest, bodies=()):
    """自托管字体：源字体 → 子集（woff2，缺 brotli 时退化为 woff）。

    out 是 Out 收集器：复制/写 CSS 都记账，由 Out.flush 决定跳过与否。

    设计：子集产物（site/fonts/subset/）**提交进仓库**，CI 不需要装 fonttools；
    本地放 `site/fonts/src/*.ttf` 时自动（重新）生成子集。字体许可文件随产物一起发布。
    许可证提醒：MiSans 等可免费商用/网页嵌入，但不得单独售卖字体文件本身。
    """
    roots = [d for d in (ROOT / "fonts", THEME / "fonts") if d.is_dir()]
    if not roots:
        return ""
    root = roots[0]
    subset_dir = root / "subset"
    srcs = [p for p in list(root.glob("*")) + list((root / "src").glob("*"))
            if p.suffix.lower() in FONT_EXT]
    existing = sorted(subset_dir.glob("*.woff2")) + sorted(subset_dir.glob("*.woff")) \
        if subset_dir.is_dir() else []

    made = []
    if srcs:
        try:
            from fontTools import subset as ftsubset
        except ImportError:
            rep.warn("fonts", "有源字体但缺 fonttools，改用已有子集（如无则不加载自定义字体）。"
                              "装法：pip install fonttools")
        else:
            flavor = "woff2"
            try:
                import brotli  # noqa: F401
            except ImportError:
                flavor = "woff"
                rep.warn("fonts", "fontTools 已子集化；缺 brotli 压缩后端，输出 woff（浏览器支持；需要 woff2 时安装 brotli）")
            text = site_text(manifest, bodies)
            subset_dir.mkdir(parents=True, exist_ok=True)
            stamp = subset_dir / ".stamp.json"
            sig = hashlib.sha1(text.encode("utf-8")).hexdigest()
            old_sig = ""
            if stamp.exists():
                try:
                    old_sig = json.loads(stamp.read_text(encoding="utf-8")).get("sig", "")
                except ValueError:
                    old_sig = ""
            fresh = sig == old_sig      # 站点文字没变、源字体也没更新时才复用现有子集
            for f in srcs:
                name = re.sub(r"[^a-z0-9]+", "-", f.stem.lower()).strip("-") + "." + flavor
                dst = subset_dir / name
                if fresh and dst.exists() and dst.stat().st_mtime >= f.stat().st_mtime:
                    made.append(dst)
                    continue
                try:
                    ftsubset.main([str(f), "--text=%s" % text, "--flavor=%s" % flavor,
                                   "--output-file=%s" % dst,
                                   "--layout-features=kern",
                                   "--no-hinting", "--desubroutinize",
                                   "--name-IDs=1,2"])
                except BaseException as e:  # noqa: BLE001
                    rep.warn("fonts", "子集化失败 %s：%s" % (f.name, e))
                    continue
                if dst.exists():
                    made.append(dst)
                else:
                    rep.warn("fonts", "子集化未产出文件：%s" % f.name)
            if made and not fresh:
                stamp.write_text(json.dumps({"sig": sig, "files": [p.name for p in made]},
                                            ensure_ascii=False, indent=1), encoding="utf-8")

    if not srcs and not existing:
        rep.warn("fonts", "没有 site/fonts/src 也没有子集：本次不生成字体（"
                          "分发构建器时应随包带 MiSans 源字体）")
    use = made or existing
    if not use:
        return ""

    for p in use:
        out.put_copy(p, "fonts/" + p.name)
    for lic in sorted(root.glob("LICENSE*")):
        out.put_copy(lic, "fonts/" + lic.name)

    faces = []
    for p in use:
        family, weight = font_family_weight(p.stem)
        faces.append((family, weight, p.name, p.stat().st_size))
    css = ["/* 由构建生成：字体子集（自托管，无第三方请求）。字体许可见 fonts/LICENSE-* */"]
    for family, weight, name, _size in faces:
        fmt = "woff2" if name.endswith(".woff2") else "woff"
        css.append("@font-face{font-family:'%s';font-style:normal;font-weight:%d;"
                   "font-display:swap;src:url('fonts/%s') format('%s')}"
                   % (family, weight, name, fmt))
    out.put_text("fonts.css", "\n".join(css) + "\n")
    total = sum(x[3] for x in faces) / 1024
    print("   字体子集 %d 个，共 %.0f KB（%s）"
          % (len(faces), total, ", ".join(sorted({x[0] for x in faces}))))
    return "fonts.css"
