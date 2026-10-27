# engine/ — 可复用的工具体系

这套工具**不认识任何具体内容**，只依赖一套目录约定；换站点只需换 `site/`，换目录只需 `--site`。

包结构按依赖方向分五层，**只允许上层依赖下层**：

```
入口      build.py / check.py / cli.py / preview.py
            │
产物      pipeline/   assets / manifest / fonts        （只拼产物，不解析内容）
            │
内容      content/    posts / projects / members / quotes / topics /
                      services / pages / contract_page / summary / repo_meta / imgcheck
            │         （共用 loader.py；内容层依赖渲染层与核心层）
渲染      render/     render / markdown / mindmap / mathml
            │
解析      parse/      sml / _swsml
            │
核心      core/       config / paths / content_paths / contract / contracts / urls / report
```

`core/` 不依赖任何其他子包；`parse/`、`render/` 之间也各自独立。
跨包一律 `from engine.xxx import yyy`（绝对导入），入口脚本先把仓库根放进 `sys.path`。
循环依赖的解法是「模块级 import + 调用期取属性」，不要用延迟 from-import。

## 入口脚本

| 文件 | 职责 |
|---|---|
| `build.py` | 构建入口：argparse / 主流程 `_run` / 公共名再导出（实现在各子包） |
| `check.py` | 产物自检（不变量，CI 用） |
| `cli.py` | 命令行入口：`new/list/assets/gen/contracts/build/check/test/preview` |
| `preview.py` | 本地静态服务（后台运行 + 日志） |

## core/ — 底层约定

| 文件 | 职责 | 想改什么就来这 |
|---|---|---|
| `config.py` | 站点定位与路径约定（`--site` / `REC_BLOG_SITE`） | 改目录名 |
| `paths.py` | 路径表、`DOC_EXT`、`REQ` 必填表、`guard_out` / `clean_out` | 改 `--out` 守卫、改必填字段 |
| `content_paths.py` | 内容树约定：`docs_in` / `iter_posts` / `new_post_path` / 语言后缀 | 改文章命名规则（唯一事实源） |
| `contract.py` | 契约校验（错误码对齐上游 sml-codes） | 加类型、改错误码文案 |
| `contracts.py` | 契约表状态：`register_contracts` / `apply_contract` / loose 开关 | 改契约装配流程 |
| `urls.py` | URL 协议白名单（http/https/mailto/tel、`#`、相对路径）—— 所有拼 href/src 的用户输入都必须过 `safe_url()` | 改白名单（先读 test_render_safety [9]/[11]） |
| `report.py` | `esc` / `Report` / `now_iso` / 分阶段计时 | 改日志格式 |

## parse/ — SML 解析

| 文件 | 职责 |
|---|---|
| `sml.py` | SML 子集解析器（片段 `&`、契约 `@contract`/`@is`、`include`+命名空间；builtin/native 双后端） |
| `_swsml.py` | SML 原生绑定（vendored from swsml 0.6.4，MulanPSL-2）；别就地改，升级以上游为准 |

## render/ — 渲染

| 文件 | 职责 | 想改什么就来这 |
|---|---|---|
| `render.py` | SML 块 → HTML（含内联角色、B 站视频白名单） | 加块类型、改 HTML 结构 |
| `markdown.py` | Markdown 子集渲染器（front matter、`:::note`） | 加 Markdown 语法 |
| `mindmap.py` | 导图 SVG 生成（整齐树布局） | 改导图样式/布局 |
| `mathml.py` | LaTeX → MathML（构建期，失败回退 `math-raw`） | 改公式渲染 |

## content/ — 内容类型

每种内容一个模块，共用 `loader.py`（`load` / `load2` / `render_body` / 字段小工具）。

| 文件 | 职责 |
|---|---|
| `posts.py` | 文章：多语言、附件、目录树守卫 `E-POST-001`–`004` |
| `projects.py` | 项目（构建期抓仓库元数据） |
| `members.py` | 成员档案与头像（本地优先，远端构建期下载缓存） |
| `quotes.py` | 首页「一言」（每人 ≤3、全站 ≤60 的限额） |
| `topics.py` | 主题词条 |
| `services.py` | 能力与合作黄页（纯展示 + 免责声明） |
| `pages.py` | 资源 / 周报 / 独立页的通用构建 |
| `contract_page.py` | 契约文档页（代码即文档） |
| `reading.py` | 阅读习惯配置（代码折叠阈值） |
| `summary.py` | 摘要：优先 `summaries/*.json`，否则抽取式 |
| `repo_meta.py` | 仓库元数据抓取（GitHub/Gitee/Codeberg/Gitea）+ 缓存 |
| `imgcheck.py` | 图片引用识别与坏图判定（magic bytes / 0 字节 / HTML 错误页 / 外链） |

## pipeline/ — 产物出口

| 文件 | 职责 |
|---|---|
| `assets.py` | 产物收集 `Out` / 图片资源入口 / `inject_head` / `inject_shell` |
| `manifest.py` | manifest / search-index / llms / feed / sitemap / map.svg |
| `fonts.py` | 字体子集：`site_text` / `font_family_weight` / `build_fonts` |

## tools/ — 辅助脚本（不进构建主链）

| 文件 | 职责 |
|---|---|
| `ai_summarize.py` | 构建期 AI 摘要（OpenAI 兼容网关），写 `site/content/summaries/<slug>.json` |
| `verify_parity.py` | MD ↔ SML 渲染一致性证据脚本 |
| `fonts_import.py` | 从字体压缩包挑权重到 `site/fonts/src/`（不整包解压） |
| `git_ready.py` | 入库前检查（大文件 / 忽略规则）；`--commit` 本地提交（**不 push**） |
| `native_build.py` | 本机编译 SML native cdylib 并放到 `engine/native/` |
| `audit_images.py` | 全站图片引用审计（只报告不改文件），退出码 1 可当门禁 |

## tests/ — 引擎自测（CI 门禁）

| 文件 | 职责 |
|---|---|
| `test_contracts.py` | 契约引擎自测（断言数动态计数，钉住错误码语义） |
| `test_sml_include.py` | include / 命名空间 / 契约桥接回归（`[B][D]` 组需 `sml.dll`，缺则 SKIP） |
| `test_render_safety.py` | 渲染安全回归（契约页转义 / 内联角色 / `--out` 守卫 / URL 白名单 / 双后端错误类型 / assets 改写） |
| `test_structure.py` | 产物结构断言（三栏/版心/零外链/摘要/导图，纯静态） |
| `test_images.py` | 图片引用自测（引用识别 / 坏图判定 / 外链门禁 / 审计退出码） |

## 其他

| 路径 | 说明 |
|---|---|
| `native/` | 原生后端载体：`sml.dll` / `libsml.so` / `libsml.dylib`（默认 gitignore；缺失时不含 `include` 的内容照常构建、含 `include` 的直接报错；详见 `docs/NATIVE.md`） |
| `prompts/summarize.md` | AI 摘要的输入输出约定（构建期离线步骤用） |
| `vendor/fontTools/` | vendored 的 fontTools（字体子集化用；许可见 `vendor/fontTools-LICENSE`） |
| `vendor/latex2mathml/` | vendored 的 latex2mathml（`$...$` → MathML） |

## 目录约定（站点根目录，默认 `<repo>/site`）

```
content/site.sml                 站点配置（导航、群信息、默认契约映射）
content/posts/<年>/[系列/]<短名>/index.(md|sml) + assets/   # 系列文章收进 <系列>/ 子目录
content/pages/*.sml              站文档（group + order 决定文档树）
content/topics/*.(md|sml)        主题词条（tags 相同标签文章自动归入）
content/members/*.sml            成员档案（同目录 <id>.jpg 自动作为头像）
content/services/*.sml           能力与合作黄页（纯展示：owner 必须是成员，contact 只引用其已公开 links）
content/projects/*.sml           项目（构建期抓仓库元数据）
content/resources/*.sml          资源条目
content/weekly/*.sml             周报
content/contracts/*.sml          内容契约（字段即文档）
theme/{index.html,css/*.css,js/*.js}   （拆成多文件；加载顺序以 index.html 的 link/script 序为准）
meta/repos.json                  元数据缓存（入库）
*.jpg                            群 logo（同时作为 favicon）
```

产物固定到 `<repo>/dist/`。

## 常见改动怎么做

- **加一个块类型**：`render/render.py` 的 `render()` 里加一个 `if t == "你的块"` 分支；再在 `site/content/contracts/blog.sml` 里加对应契约字段（若它是字段）。
- **加一个内容类型**（例如「活动」）：`content/` 里仿 `topics.py` 写一个 `build_xxx()` → 在 `build.py` 的 `_run()` 里调用 → 在 `pipeline/manifest.py` 写产物与 manifest 键 → `core/contract.py` 或契约文件补字段 → `site/theme/js/` 加路由与视图（挂到 `window.REC`，顺序写进 `index.html`）。
- **改错误码/校验**：只改 `core/contract.py`；契约语法在 `parse/sml.py` 的 `_parse_contract_body()`。
- **跨文件复用契约/数据**：内容里写 `include "_shared.sml" as blog` 或
  `include "../contracts/blog.sml" as blog`（路径相对本文件；允许根 = site/content，
  跨兄弟目录可以，逃出内容目录一律 `E-INCLUDE-003`）。只有文件入口 `load_doc()` 会展开，
  **需要 native**（靠临时扁平副本绕开 native 的「包含者目录」沙箱），缺失时构建直接失败。
  契约仍由 `core/contract.py` 校验；机制与已知限制见 `docs/ARCHITECTURE.md` §14 / §15。
- **改样式**：`site/theme/css/`（按职责分文件，顺序 = 原 style.css 的级联顺序；页面结构在 `site/theme/js/`，右侧正文由 `render.py` 产出）。

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
python engine/tests/test_contracts.py         # 契约自测
python engine/tests/test_sml_include.py       # include / 命名空间回归
python engine/tests/test_render_safety.py     # 渲染安全回归
python engine/tests/test_images.py            # 图片引用自测（含外链门禁反证）
python engine/tools/audit_images.py           # 全站图片审计（只报告）
python engine/cli.py build                    # 构建（含契约校验 + 外链图片门禁）
python engine/check.py                        # 产物自检（含图片不变量）
python engine/tests/test_structure.py         # 结构断言
python engine/cli.py preview                  # 本地看
```

要求 Python 3.8+（开发/CI 用 3.11）；渲染安全与结构断言要直接跑脚本
（`cli.py test` 只跑契约自测）。
