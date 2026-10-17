# engine/ — 可复用的工具体系

这套工具**不认识任何具体内容**，只依赖一套目录约定；换站点只需换 `site/`，换目录只需 `--site`。

## 文件职责（每个文件都不长，改之前看这里）

| 文件 | 职责 | 想改什么就来这 |
|---|---|---|
| `config.py` | 站点定位与路径约定 | 改目录名、加新内容目录 |
| `lib/sml.py` | SML 子集解析器（含片段 `&`、契约 `@contract`/`@is`） | 加语法、改解析行为 |
| `lib/markdown.py` | Markdown 子集渲染器（front matter、`:::note`） | 加 Markdown 语法 |
| `lib/render.py` | SML 块 → HTML（含内联角色、B 站视频白名单） | 加块类型、改 HTML 结构 |
| `lib/contract.py` | 契约校验（错误码对齐上游 sml-codes） | 加类型、改错误码文案 |
| `lib/mindmap.py` | 导图 SVG 生成（整齐树布局） | 改导图样式/布局 |
| `lib/repo_meta.py` | 仓库元数据抓取（GitHub/Gitee/Codeberg/Gitea）+ 缓存 | 加平台、改字段 |
| `build.py` | 构建主流程：校验 → manifest → 预渲染 → 索引/RSS/sitemap/llms/favicon | 加产物、改流程顺序 |
| `check.py` | 产物自检（不变量，CI 用） | 加你踩过的坑当断言 |
| `preview.py` | 本地静态服务（后台运行 + 日志） | 改端口/日志 |
| `cli.py` | 命令行入口：`new/list/contracts/build/check/test/preview` | 加子命令 |
| `test_contracts.py` | 契约引擎自测（19 项断言，钉住错误码语义） | 加断言 |
| `test_render_safety.py` | 渲染安全回归（契约页转义 / 内联角色 / 嵌套列表 / `--out` 守卫 / 6 个结构化块 / 代码块外壳 / assets 生成器） | 加你踩过的坑当用例 |
| `verify_parity.py` | MD ↔ SML 渲染一致性**证据脚本**（打印「一致 N / 不一致 M」，不一致时退出码 1）；CI 门禁在 `test_render_safety.py` §5，改对照表时两处同步 | 加对照用例 |
| `ai_summarize.py` | 构建期 AI 摘要：调 OpenAI 兼容网关（GLM-4.7-Flash），写 `site/content/summaries/<slug>.json`；失败自动退回抽取式 | 改提示词 / 换模型 |
| `fonts_import.py` | 从字体压缩包里挑权重到 `site/fonts/src/`（不整包解压） | 改权重匹配、加许可文件识别 |
| `vendor/fontTools/` | **vendored** 的 fontTools（字体子集化用；仓库组件，不依赖 pip）；许可见 `vendor/fontTools-LICENSE` | 升级时整体替换该目录 |

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
python engine/cli.py test       # 契约自测
python engine/cli.py build      # 构建（含契约校验）
python engine/cli.py check      # 产物自检
python engine/cli.py preview    # 本地看
```
