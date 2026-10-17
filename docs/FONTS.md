# 字体（MiSans 自托管子集）

> **2026-10-18 起恢复自托管**：为让不同系统显示一致，站点重新使用 MiSans 子集。
> 与上一版的区别：**fontTools 已 vendor 进仓库**（`engine/vendor/fontTools/`），构建不再依赖 `pip install fonttools`；
> 子集只保留**站点实际用到的字符**，产物 15.4 MB → 约 254 KB（woff，两个权重）。

## 能不能用

MiSans 由小米发布，**可免费商用，允许网页嵌入与自托管**；限制主要是：
**不能单独售卖字体文件本身**、不能改名字后当成自己的字体发布、不得用于违法用途。
上线前请对照官方《MiSans 字体知识产权许可协议》确认当前条款（许可可能更新，以官方页面为准）。

## 目录约定

```
site/fonts/
├─ src/     源字体（MiSans-Regular.ttf …）—— 不入库（.gitignore），从官方包重新获取
├─ subset/  子集产物（misans-regular.woff …）—— **构建期生成，不入库**
└─ LICENSE-MiSans.txt  字体许可 —— 入库并随产物发布
engine/vendor/fontTools/  vendored fontTools（仓库组件，非 pip 依赖；MIT 许可见 engine/vendor/fontTools-LICENSE）
```

## 怎么接

1. 从压缩包挑权重（不整包解压，避免 `bold` 命中 `demibold`）：

```bash
python engine/fonts_import.py MiSans.zip --weights Regular,Bold   # → site/fonts/src/
python engine/fonts_import.py MiSans.zip --list                   # 只看包里有什么
```

2. 构建期**子集化**：`site/fonts/src/*.ttf` → `site/fonts/subset/*` + `dist/fonts.css`，
   并在 `<head>` 注入 `<link rel="stylesheet" href="fonts.css">`。

```bash
python engine/cli.py build      # 不需要 pip install fonttools（用 engine/vendor 里的）
```

3. **子集在构建期生成，不提交**；构建器分发时随包带 MiSans 源字体（`site/fonts/src/`），所以任何一台机器 `build` 都能得到同样的字体。签名 `.stamp.json` 没变时复用缓存。
4. 没有源字体也没有子集时**什么都不做**，`font-family` 自动回退到系统字体。

## 子集策略（尽量小）

- 字符集 = manifest + 所有预渲染正文 + `site/theme/*.{js,css,html}` 里出现的字符（宁可多收，不漏字）。
- `--layout-features=kern`（只留字距）、`--no-hinting`、`--desubroutinize`、`--name-IDs=1,2`。
- 缺 `brotli` 时退化为 woff（浏览器都支持），有 brotli 时输出 woff2（体积约减半）。
- 实测：Regular + Bold 各约 127 KB（woff），合计 **254 KB**。

## 字体栈（当前生效）

```css
font-family: "MiSans", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
```

`--mono` 同理走等宽系统栈。正文、标题分别用 400 / 700 两个子集。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 构建提示「有源字体但缺 fonttools」 | 不应出现：fontTools 已 vendored；若删了 `engine/vendor/` 再 `pip install fonttools` |
| 提示「缺 brotli，子集改用 woff」 | 正常降级；要 woff2 就 `pip install brotli`（CI 可在 workflow 里装） |
| 字体没生效 | 看 `dist/fonts.css`、`site/fonts/subset/`、`<head>` 是否引用了 `fonts.css`；浏览器里 `document.fonts.check('17px MiSans')` 应为 true |
| 有字显示成方块 | 子集漏字：站点文字取自构建数据，若 CSS/JS 里硬编码了额外文字，把它们纳入子集（改 `engine/build.py` 的 `site_text()`） |
| 体积偏大 | 只留需要的权重；不要提交 `src/` 下的源字体 |
