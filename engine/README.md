# engine/ — 可复用的工具体系

这套工具**不认识任何具体内容**，只依赖一套目录约定；换站点只需换 `site/`，换目录只需 `--site`。

## 文件职责（每个文件都不长，改之前看这里）

| 文件 | 职责 | 想改什么就来这 |
|---|---|---|
| `config.py` | 站点定位与路径约定 | 改目录名、加新内容目录 |
| `lib/sml.py` | SML 子集解析器（含片段 `&`、契约 `@contract`/`@is`、`include`+命名空间） | 加语法、改解析行为 |
| `lib/markdown.py` | Markdown 子集渲染器（front matter、`:::note`） | 加 Markdown 语法 |
| `lib/render.py` | SML 块 → HTML（含内联角色、B 站视频白名单） | 加块类型、改 HTML 结构 |
| `lib/contract.py` | 契约校验（错误码对齐上游 sml-codes） | 加类型、改错误码文案 |
| `lib/mindmap.py` | 导图 SVG 生成（整齐树布局） | 改导图样式/布局 |
| `lib/repo_meta.py` | 仓库元数据抓取（GitHub/Gitee/Codeberg/Gitea）+ 缓存 | 加平台、改字段 |
| `lib/mathml.py` | LaTeX → MathML（构建期，失败回退 `math-raw`） | 改公式渲染 |
| `lib/summary.py` | 摘要：优先 `summaries/*.json`，否则抽取式 | 改摘要策略 |
| `lib/urls.py` | URL 协议白名单（http/https/mailto/tel、`#`、相对路径）—— 所有拼 href/src 的用户输入都必须过 `safe_url()` | 改白名单（先读 test_render_safety [9]/[11]） |
| `lib/imgcheck.py` | 图片引用识别与坏图判定（magic bytes / 0 字节 / HTML 错误页 / 外链）—— build 的外链门禁、check 的产物图片不变量、audit 的报告共用这一份 | 改图片格式判定、加引用写法 |
| `lib/_swsml.py` | SML 原生绑定（vendored from swsml 0.6.4，MulanPSL-2） | 别就地改，升级 vendor 时以上游为准 |
| `native/` | 原生后端载体：`sml.dll` / `libsml.so` / `libsml.dylib`（默认 gitignore；缺失时不含 `include` 的内容照常构建、含 `include` 的直接报错；详见 docs/NATIVE.md） | 换平台/升级 swsml |
| `native_build.py` | 本机编译 SML native cdylib 并放到 `engine/native/`；自动找 cargo target-dir，加载验证版本 | 没有预编译库/换平台时 |
| `build.py` | 构建主流程：校验 → manifest → 预渲染 → 索引/RSS/sitemap/llms/字体子集/_headers | 加产物、改流程顺序 |
| `check.py` | 产物自检（不变量，CI 用）：含「每个 `<img src>` 必须本地、存在、非 0 字节、格式与扩展名一致」 | 加你踩过的坑当断言 |
| `audit_images.py` | 全站图片引用审计（只报告不改文件）：外链 / 本地缺失 / 没进产物 / 坏图 / 孤儿图，输出 `文件\|行号\|引用\|问题\|建议\|可自动修` 表；退出码 1 可当门禁 | 加检查项、改报告列 |
| `preview.py` | 本地静态服务（后台运行 + 日志） | 改端口/日志 |
| `cli.py` | 命令行入口：`new/list/assets/gen/contracts/build/check/test/preview` | 加子命令 |
| `test_contracts.py` | 契约引擎自测（断言数动态计数，钉住错误码语义） | 加断言 |
| `test_sml_include.py` | include / 命名空间 / 契约桥接回归（`[B][D]` 组需 `sml.dll`，缺则 SKIP 并在末尾列出） | 改 include 规则 / 桥接时加用例 |
| `test_render_safety.py` | 渲染安全回归（契约页转义 / 内联角色 / 嵌套列表 / `--out` 守卫 / URL 白名单 / 双后端 SML 错误类型 / assets 改写 / 代码块外壳 / assets 生成器） | 加你踩过的坑当用例 |
| `test_structure.py` | 产物结构断言（三栏/版心/零外链/摘要/导图，纯静态） | 加结构不变量 |
| `test_images.py` | 图片引用自测（引用识别 / 坏图判定 / 外链门禁真的让构建失败 / 审计退出码） | 加图片相关回归 |
| `verify_parity.py` | MD ↔ SML 渲染一致性**证据脚本**（打印「一致 N / 不一致 M」，不一致时退出码 1）；CI 门禁在 `test_render_safety.py` §5，改对照表时两处同步 | 加对照用例 |
| `ai_summarize.py` | 构建期 AI 摘要：调 OpenAI 兼容网关（GLM-4.7-Flash），写 `site/content/summaries/<slug>.json`；失败自动退回抽取式 | 改提示词 / 换模型 |
| `fonts_import.py` | 从字体压缩包里挑权重到 `site/fonts/src/`（不整包解压） | 改权重匹配、加许可文件识别 |
| `git_ready.py` | 入库前检查（大文件 / 忽略规则 / 已被跟踪但应忽略）；`--commit` 本地提交（**不 push**） | 改忽略清单、改阈值 |
| `gui.py` / `gui_api.py` | 写作台 API 入口与 `/api/*`（树 / 文档读写 / 校验 / 预览 / 新建 / 资源 / PR） | GUI 侧改动（另见 docs/GUI.md） |
| `vendor/fontTools/` | **vendored** 的 fontTools（字体子集化用；仓库组件，不依赖 pip）；许可见 `vendor/fontTools-LICENSE` | 升级时整体替换该目录 |
| `vendor/latex2mathml/` | **vendored** 的 latex2mathml（`$...$` → MathML；同样是仓库组件） | 升级时整体替换该目录 |

## 目录约定（站点根目录，默认 `<repo>/site`）

```
content/site.sml                 站点配置（导航、群信息、默认契约映射）
content/posts/<年>/<短名>/index.(md|sml) + assets/
content/pages/*.sml              站文档（group + order 决定文档树）
content/topics/*.(md|sml)        主题词条（tags 相同标签文章自动归入）
content/members/*.sml            成员档案（同目录 <id>.jpg 自动作为头像）
content/services/*.sml           能力与合作黄页（纯展示：owner 必须是成员，contact 只引用其已公开 links）
content/projects/*.sml           项目（构建期抓仓库元数据）
content/resources/*.sml          资源条目
content/weekly/*.sml             周报
content/contracts/*.sml          内容契约（字段即文档）
theme/{index.html,app.js,style.css}
meta/repos.json                  元数据缓存（入库）
*.jpg                            群 logo（同时作为 favicon）
```

产物固定到 `<repo>/dist/`。

## 常见改动怎么做

- **加一个块类型**：`lib/render.py` 的 `render()` 里加一个 `if t == "你的块"` 分支；再在 `site/content/contracts/blog.sml` 里加对应契约字段（若它是字段）。
- **加一个内容类型**（例如「活动」）：`build.py` 里仿 `build_topics()` 写一个 `build_xxx()` → 在 `main()` 里调用 → 写文件与 manifest 键 → `lib/contract.py` 或契约文件补字段 → `site/theme/app.js` 加路由与视图。
- **改错误码/校验**：只改 `lib/contract.py`；契约语法在 `lib/sml.py` 的 `_parse_contract_body()`。
- **跨文件复用契约/数据**：内容里写 `include "_shared.sml" as blog` 或
  `include "../contracts/blog.sml" as blog`（路径相对本文件；允许根 = site/content，
  跨兄弟目录可以，逃出内容目录一律 `E-INCLUDE-003`）。只有文件入口 `load_doc()` 会展开，
  **需要 native**（靠临时扁平副本绕开 native 的「包含者目录」沙箱），缺失时构建直接失败。
  契约仍由 `lib/contract.py` 校验；机制与已知限制见 `docs/ARCHITECTURE.md` §14 / §15。
- **改样式**：`site/theme/style.css`（页面结构在 `app.js`，右侧正文由 `render.py` 产出）。

## 复用到别的站点

```bash
cp -r engine /path/to/other-site/engine
mkdir -p /path/to/other-site/site/{content,theme}
# 放好 site/content/site.sml 与 site/theme/*，然后：
python /path/to/other-site/engine/cli.py build
# 站点不在 site/ 下时：--site <目录> 或环境变量 REC_BLOG_SITE
```

## 验证（提交前）

```bash
python engine/test_contracts.py         # 契约自测
python engine/test_sml_include.py       # include / 命名空间回归
python engine/test_render_safety.py     # 渲染安全回归
python engine/test_images.py            # 图片引用自测（含外链门禁反证）
python engine/audit_images.py           # 全站图片审计（只报告）
python engine/cli.py build              # 构建（含契约校验 + 外链图片门禁）
python engine/check.py                  # 产物自检（含图片不变量）
python engine/test_structure.py         # 结构断言
python engine/cli.py preview            # 本地看
```

要求 Python 3.8+（开发/CI 用 3.11）；渲染安全与结构断言要直接跑脚本
（`cli.py test` 只跑契约自测）。
