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
├─ src/     源字体（MiSans-Regular.ttf …）—— 不入库（.gitignore），从官方包或加密包获取
├─ subset/  子集产物（misans-regular.woff …）—— 构建期生成，同样不入库
├─ misans-fonts.tar.gz.enc  源字体的 AES-256 加密包（**入库**；没有密码解不开，不能直接当字体用）
└─ LICENSE-MiSans.txt  字体许可 —— 入库并随产物发布（build.py 拷到 dist/fonts/）
engine/vendor/fontTools/  vendored fontTools（仓库组件，非 pip 依赖；MIT 许可见 engine/vendor/fontTools-LICENSE）
```

> **加密包是 CI/自托管的字体来源**：`src/` 与 `subset/` 都不入库，克隆里没有源字体。
> CI 在构建前跑 `bash deploy/fonts-crypt.sh decrypt`（`FONT_PASSWORD` 存 GitHub secret，
> 本地则放在环境变量里），解密出 `src/*.ttf` 后照常构建期子集化；没有密码就回退系统字体，不阻断构建。
> 重新加密（改了源字体后）：`FONT_PASSWORD='...' bash deploy/fonts-crypt.sh encrypt`。
> 密码只存 CI secret / 服务器环境变量，**不进仓库、不进群聊**。

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

3. **子集在构建期生成，不提交**；源字体来自加密包解密或本机放置（见上文目录约定），
   签名 `.stamp.json` 没变时复用现有子集。
4. 没有源字体也没有子集时**什么都不做**，`font-family` 自动回退到系统字体。

## 子集策略（尽量小）

- 字符集 = manifest + 所有预渲染正文 + `site/theme/*.{js,css,html}` 里出现的字符（宁可多收，不漏字）。
- `--layout-features=kern`（只留字距）、`--no-hinting`、`--desubroutinize`、`--name-IDs=1,2`。
- 缺 `brotli` 时退化为 woff（浏览器都支持），有 brotli 时输出 woff2（体积约减半）。
- 实测：Regular + Bold 各约 127 KB（woff），合计 **254 KB**。

## 字体栈（当前生效）

```css
/* 界面/导航 */
font-family: "MiSans", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
/* 正文 .prose：西文优先 Times New Roman，中文缺字回退 MiSans */
font-family: "Times New Roman", "Liberation Serif", "Nimbus Roman", "MiSans",
             system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", serif;
```

`--mono` 同理走等宽系统栈。正文、标题分别用 400 / 700 两个子集。

### 西文为什么用 Times New Roman

- 中文仍由自托管 MiSans 子集提供；西文/数字/数学符号优先系统 **Times New Roman**
  （Windows/macOS）→ Linux 回退 `Liberation Serif` / `Nimbus Roman` → 最后 `serif`；
- 只作用于正文 `.prose`，导航、按钮、表单仍用 MiSans，避免 UI 变“论文风”；
- **系统字体，不产生外部请求、不打包字体文件**；缺字体时自然回退，不阻断构建；
- 代码块/公式的 `--mono` 不受影响；MathML 由浏览器数学字体渲染，与正文衬线更协调。

### 公式里的西文

公式也跟随正文改用 Times 系：

```css
.math-inline math, .math-block math {
  font-family: "STIX Two Math", "Times New Roman", "Cambria Math", serif;
}
```

- 本机没装 STIX 时，字母/数字走 Times New Roman；
- Times 本身**没有 OpenType MATH 表**，伸缩括号、大运算符由浏览器数学字体兜底，
  复杂公式的排版不如专业数学字体精致；
- 想要“Times 外观 + 专业数学排版”，可自托管 **STIX Two Math**（SIL OFL，约几百 KB）；
  它带 MATH 表，且风格接近 Times，仍然零外部请求；
- 不装 STIX 也不影响构建，只是复杂公式略逊于默认 Cambria Math。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 构建提示「有源字体但缺 fonttools」 | 不应出现：fontTools 已 vendored；若删了 `engine/vendor/` 再 `pip install fonttools` |
| 提示「缺 brotli，子集改用 woff」 | 正常降级；要 woff2 就 `pip install brotli`（CI 可在 workflow 里装） |
| 字体没生效 | 看 `dist/fonts.css`、`site/fonts/subset/`、`<head>` 是否引用了 `fonts.css`；浏览器里 `document.fonts.check('17px MiSans')` 应为 true |
| 有字显示成方块 | 子集漏字：站点文字取自构建数据，若 CSS/JS 里硬编码了额外文字，把它们纳入子集（改 `engine/build.py` 的 `site_text()`） |
| 体积偏大 | 只留需要的权重；不要提交 `src/` 下的源字体 |
