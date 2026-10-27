# rec-blog · Rust嵌入式探讨

QQ 群「Rust嵌入式探讨」的共建博客。**内容写 Markdown（默认）或 SML**，构建期预渲染成静态页面，
托管在 Cloudflare Pages：`rustembed.swebase.cn`（生产）、`rustembed.pages.dev`（默认域名）。

> **第一次投稿？先看 [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)。**
> 写文章只需要 Markdown，不需要懂 SML；不想碰 git 也可以把稿子交给群管理代投。
> 模板在 [`templates/`](templates/)；按角色查文档看 [`docs/ROLES.md`](docs/ROLES.md)。

## 五分钟上手

要求 **Python 3.8+**（开发/CI 用 3.11；无需 pip 装任何东西，fontTools 已 vendored）。

```bash
python engine/cli.py new "文章标题" --tags rust,embedded --author sal   # 生成文章骨架
python engine/cli.py list --tag rust                       # 列文章
python engine/cli.py contracts                             # 终端里看契约字段表
python engine/cli.py build                                 # 构建（含契约校验）
python engine/cli.py test                                  # 契约自测
python engine/cli.py check                                 # 产物自检
python engine/cli.py preview                               # 构建 + 预览 http://127.0.0.1:8080/
```

投稿三步：fork → 在 `site/content/posts/<年份>/[系列/]<英文短名>/index.md` 写文章 → 提 PR。
不方便用 git 的，把稿子交给有仓库权限的群管理代投（署名仍是作者本人）。
**文档总索引见 [`docs/README.md`](docs/README.md)；目录地图见 [`docs/REPO-LAYOUT.md`](docs/REPO-LAYOUT.md)。
完整 git 写作流程与全链路验证见 [`docs/WORKFLOW.md`](docs/WORKFLOW.md)。**

## 目录结构

```
engine/                   工具体系（与本站内容无关，可整体复制给别的站点复用）
├─ build.py check.py preview.py cli.py    入口脚本（实现在下面各子包里）
├─ core/                  底层约定：config / paths / content_paths / contract / contracts /
│                          urls / report
├─ parse/                 SML 解析（sml.py + vendored _swsml.py）
├─ render/                render / markdown / mindmap / mathml
├─ content/               每种内容一个模块：posts / projects / members / quotes / topics /
│                          services / pages / 契约文档页，共用 loader
├─ pipeline/              产物层：assets / manifest / fonts
├─ tools/                 辅助脚本：ai_summarize / verify_parity / fonts_import /
│                          git_ready / native_build / audit_images
├─ tests/                 引擎自测：test_contracts / test_sml_include /
│                          test_render_safety / test_structure / test_images
├─ native/                SML 原生加速载体（sml.dll，已 gitignore；没有就回退内置解析器）
├─ prompts/summarize.md   AI 摘要的输入输出约定（构建期用，离线）
└─ vendor/                vendored fontTools / latex2mathml（构建期，不是 pip 依赖）
                          详见 engine/README.md（每个文件职责 + 常见改动怎么做）

archive/gui/             已弃用的写作台（2026-10-28 归档，只读；恢复步骤见其 README.md）
tests/                   验收脚本（Node：smoke.js / browser-check.js 等；Python：content_tree /
                          i18n / tech_aid）
deploy/                  自托管：entrypoint / build / rebuild / gitee-webhook / fonts-crypt
Dockerfile               自托管构建器镜像

site/                     本站点本身
├─ content/               内容：改这里就够了
│  ├─ site.sml            站点配置（站名、导航、公告、群信息、群规、大事记）
│  ├─ posts/<年>/[系列/]<短名>/   文章：index.md 或 index.sml，图片放同目录 assets/
│  ├─ pages/*.sml         站文档（投稿指南、写作速查、附件规则、创作制度、加入我们）
│  ├─ topics/*.(md|sml)   主题词条（同标签文章自动归入）
│  ├─ members/<id>.sml    成员档案（自愿制；同目录放 <id>.jpg 即自动作为头像）
│  ├─ services/<id>.sml   能力与合作黄页（纯展示）
│  ├─ projects/<id>.sml   项目（仓库元数据构建期自动抓取）
│  ├─ resources/<id>.sml  资源库
│  ├─ weekly/<期>.sml     周报 / 月刊
│  ├─ summaries/<slug>.json  可选：AI 摘要产物（没有则用构建期抽取式摘要）
│  └─ contracts/*.sml     内容契约（字段即文档）
├─ theme/                 前端壳（index.html + css/ + js/；顺序见 index.html，禁 CDN）
│  └─ fonts/             自托管字体（src/ 与 subset/ 均不入库；CI 用加密包 + FONT_PASSWORD
│                          解密，见 docs/FONTS.md）
├─ meta/repos.json        仓库元数据缓存
└─ *.jpg                  群 logo（同时作为站点 favicon）

docs/                     文档：参与者指南、架构、运维、字体；archive/ 放历史任务书
templates/                作者复制模板（post/resource/project/member/service）
dist/                     构建产物（gitignore）
```

## 两种写作格式

| | Markdown（默认） | SML（可选） |
|---|---|---|
| 文件 | `index.md` | `index.sml` |
| 适合 | 所有人，日常写文章 | 需要严格字段校验、定理/证明、片段复用 |
| 元数据 | front matter（YAML 子集） | 顶层字段 |
| 渲染结果 | 与 SML **完全一致**（同一套 HTML/CSS/章节树/导图/搜索索引） | 同左 |

速查：`site/content/pages/write-markdown.sml`、`site/content/pages/write-sml.sml`（页面内在站点上是「文档 → 写作」）。

## 制度与规范（都在站点「站文档」栏，Markdown 写的）

| 制度 | 说明 |
|---|---|
| 角色与权限 | 三层权限互不相干（QQ 群 ≠ 仓库 ≠ 发布）；谁能改什么、写权限怎么拿、怎么回收 |
| 仓库与分支 | 只有 `master`，所有改动走 PR；提交信息、PR 要求、命名与放置约定、密钥纪律 |
| 创作与审稿 | 投稿流程与 3 日 SLA、审稿标准、署名与许可、退稿与纠错、内容边界 |
| 下架与申诉 | 可先行下架的情形、作者主动下架、申诉时限与留档 |
| 附件规则 | 图片入库（2 MB / 20 张）、其余外链、审核项 |
| 隐私与数据 | 不接统计与广告、无 Cookie 追踪、成员联系方式授权、安全报告流程 |

面向管理者：`docs/GOVERNANCE.md`（制度索引 + 权限矩阵 + 制度修改程序 + 定期复核）；
面向投稿者：`CONTRIBUTING.md`（5 分钟上手 + 自检命令 + 三条硬规矩）。

## 内容契约（字段即文档）

`site/content/contracts/blog.sml` 定义各类型的字段、类型、必填与约束（字段行 `#` 后是说明）。
`site/content/site.sml` 的 `contracts { }` 把它们按内容类型设为默认，写文件时也可用 `@is 契约名` 显式指定。

- 校验失败报错**错误码 + 人话**：`[E-CONTRACT-003] 契约 BlogPost 缺少必填字段 summary（字符串）`
- 站点上「**文档 → 规范 → 内容契约**」页由契约自动生成 —— 改契约 = 改校验 = 改文档
- 临时放宽：`python engine/build.py --contract-loose`（只放宽「未声明字段」）

## 部署

Gitee 是权威源：<https://gitee.com/rustembed/site>（地址的唯一数据源是 `site/content/site.sml` 的 `repo_url`）；
第二个源 <https://gitee.com/snoware/sml-sitegen> 是同一份代码，作为 SML 的应用示例对外展示（`repo_mirror`）：

```bash
git push origin master     # 权威源（必做）
git push sitegen master    # 示例源（可选，推同一个提交）
```

`.github/workflows/sync-from-gitee.yml` 每 15 分钟把它单向镜像到 GitHub（GitHub 只做被动镜像，日常改动先推 Gitee）；
`publish-pages.yml` 定时构建并把静态产物强推到 **`pages` 分支**，Cloudflare Pages 直接取那个分支发布（不需要 CF token）。
`build.yml` 只做 PR/推送校验。
需要的 secret：`GITEE_USER` / `GITEE_TOKEN`（只读即可）、`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`；字体用 `FONT_PASSWORD` 解密加密包，AI 摘要用 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（都可选，缺了自动降级）。

也可以不用 Actions：**自建服务器（Docker 容器构建 + GLM 生成构建期摘要 + 发布）** 见 [`docs/SELF-HOST.md`](docs/SELF-HOST.md)，一条 Gitee Webhook 触发全链路。

## 许可

文章默认 `CC BY-NC-SA 4.0`（可在文章里用 `license` 覆盖），站点代码 MulanPSL-2。
许可文件：`LICENSE`（代码，MulanPSL-2）、`LICENSE-CONTENT`（内容，CC BY-NC-SA 4.0）、
`site/fonts/LICENSE-MiSans.txt`（自托管字体，随产物发布到 `dist/fonts/`）。
成员页展示的联系方式均为本人自愿提供并授权展示。
