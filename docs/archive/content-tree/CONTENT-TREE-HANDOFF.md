# 内容目录树重构（系列收进子目录）— 已完成

> 状态：**已完成（2026-10-28）**。目录移动、构建期守卫、CLI 脚手架、回归测试、文档都已落地；
> 本文保留为历史记录。改动已在 `engine/` 包化重构后迁到 `engine/content/posts.py`
> （守卫 `_guard_tree`）与 `engine/core/content_paths.py`（发现逻辑的唯一事实源）。

## 0. 一句话

`site/content/posts/2026/` 下有 36 个扁平同级目录，其中 `rust-learning-*`（20 篇）和
`hft-engineering-*`（13 篇）是系列，和独立文章混在一起，人眼完全看不出分组。
本次把系列文章收进系列子目录，并加**构建期守卫**防止再次摊平。

**硬约束：slug = 叶目录名，URL = `#/post/<slug>`。所以叶目录名一字不改 → slug/URL 零变更、外链不断。**

## 1. 分支与进度

- 分支：`refactor/content-tree`，基于 `origin/staging`（与 `feat/series-description` 那个已推 fork 的 PR **无关**，别混）。
- 本地未提交、未推送。
- 已完成：引擎发现逻辑改造 + 目录移动（35 篇）。
- 未完成：CLI/GUI 脚手架、文档路径约定、测试 fixture、守卫的自动化回归。
- 上次动作被手动中断（负向验证命令）；已把被遗留的半移动文章 `rust-learning-01-compile-basics`
  挪回 `posts/2026/rust-learning/`，当前树一致。

## 2. 关键调研结论（改之前必须知道）

- 文章发现入口：`engine/lib/build_pages.py` 的 `build_posts()`，原写死 `docs_in(CONTENT/"posts", "*/*/index.*")`
  —— **恰好两层**。有人插一层子目录，文章会**静默消失**（不报错、不收录、manifest/HTML/导航全少），
  `check.py` 也发现不了（它只校验「已进 manifest 的东西」）。
- `slug = f.parent.name`（叶目录名）；`year = f.parent.parent.name`（原来取上级目录名，插层后会被系列名污染）。
- assets 复制/改写（`build.py:294`、`build_assets._localize_assets`）与前端（只消费 manifest 的 slug）
  **都与目录深度无关**，不用改。
- `year` 只用于「独立文章」的导航按年分组（`build_manifest.py`），系列文章归组走 `series.id`，不依赖目录。

## 3. 已完成（未提交）

### 3.1 引擎 `engine/lib/build_pages.py`
- 顶部 import 增加 `PurePosixPath`。
- 新增 `_YEAR_NAME = re.compile(r"^\d{4}$")`。
- `build_posts()` 发现改为**深度无关**：`docs_in(posts_root, "*/**/index.*")`；
  跳过下划线目录（`_draft` 草稿等）；`year = rel0.parts[0]` 并做四位年份校验。
- 新增三条守卫（`rep.err`，错误码沿用 E- 风格）：
  - `E-POST-001`：`posts/**` 下出现非 `index.*` 的正文 → 会静默漏收，直接报错。
  - `E-POST-003`：带 `series` 的文章不在三层（`posts/<年>/<系列>/<文章>/`）→ 报错。
  - `E-POST-004`：同一系列散在多个目录名 → 报错（容忍跨年 `2026/系列` 与 `2027/系列`）。
  - `E-POST-002`：posts 第一层不是四位年份 → 报错。

### 3.2 目录移动（`git mv`，35 篇，叶名不变）
- `posts/2026/rust-learning/` ← 20 篇 `rust-learning-01..20-*`（系列 id `rust-learning`）
- `posts/2026/hft-embedded-linux-14/` ← 13 篇 `hft-engineering-01..13-*`（系列 id `hft-embedded-linux-14`）
- `posts/2026/rust-embedded-101/` ← `hello-rec`、`md-writing`（系列 id `rust-embedded-101`）
- 保持原位（独立文章）：`cortex-m-bringup`、`rustlings-tutorial`
- 校验：`python engine/build.py` → **37 篇**、无 E-POST 报错（树一致、守卫通过）。

## 4. 未完成（照做即可）

1. **`engine/cli.py`**
   - `cmd_list`：`281` 的 `glob("*/*/index.*")` 和 `294` 的 `f.parent.parent.name != args.year` 都要改成
     「相对 `posts` 的第一段」推导 year，并兼容 3 层。
   - `cmd_new`：`263` 模板、`265-266` 现在的 `--series` **只写 front matter、不建子目录**。
     应改为：给了 `--series` 就落 `posts/<year>/<series>/<slug>/index.(md|sml)`。
   - `491-492` 是第二处新建模板（gen/另一入口），同步。
2. **`engine/gui_api.py`**
   - `792` 新建模板 `content/posts/%d/%s/index.md`：若 `front_matter` 含 `series`（取 `series.id`），
     应落 `content/posts/<year>/<series_id>/<slug>/index.md`。
   - `750` 重命名 `dst = p.parent.parent / new_slug`：**对 2 层和 3 层都正确**（`parent.parent` 就是容器目录），
     核实过，**不用改**。
   - `1318` 草稿走 `posts/_draft/index.md`，被下划线目录过滤，不受影响。
3. **`tests/gui_api_test.py`**：`33` / `324` / `363` / `698` 的 `content/posts/2026/<slug>/` fixture 需同步到新路径。
4. **文档路径约定**（现在全写的是两层，需统一改成 `posts/<年>/[系列/]<短名>/` 并说明系列收进子目录）：
   - `AGENTS.md:64`、`README.md:57`、`engine/README.md:45`
   - `docs/WORKFLOW.md:39`、`docs/ARCHITECTURE.md:32`、`docs/GUI.md:62` 与 `:149`、
     `docs/GUI-FLOWS.md:98`、`docs/I18N.md:11`、`docs/EDIT-SITE-DATA.md:105`
   - `site/content/pages/repo-policy.md:43`
5. **守卫的自动化回归**（上一轮手工负向验证被中断，未完成）：
   - 建议加一个不依赖 `dist/` 的小测（守卫在构建期，`check.py` 只读 `dist/` 不合适）。
   - 用例：构造「系列文章被摊平在年目录」→ 期望 `build_posts` 报 `E-POST-003`；
     构造「正文不叫 index.*」→ 期望 `E-POST-001`。
6. 最后跑**提交前六连 + 前端三连**（见下）。

## 5. 当前工作区（`git status`）

- **本次任务**：`engine/lib/build_pages.py`（核心）+ 35 篇 rename（`site/content/posts/2026/…`）。
- **不是本次任务（别混进本 PR）**：`engine/gui_api.py`、`engine/lib/sml.py`、`engine/test_render_safety.py`
  —— 这是别人进行中的「报错行号偏 1」修复 WIP（`gui_api.py` 那处是 `build_preview` 的 assets 改写）。
  这三个文件我**没有改动意图**；提交本任务时只 `git add` 相关文件。
- `dist/` 已被重构后的构建覆盖（gitignore，正常）。

## 6. 验证命令

```
python engine/build.py            # 期望：37 篇，无 E-POST-*
python engine/check.py            # ALL PASS
python engine/test_structure.py   # STRUCTURE PASS
node tests/series_tag_test.js     # 系列合并 / 页脚 / [6] 系列简介
```

改完后跑完整门禁：
`test_contracts.py → test_sml_include.py → test_render_safety.py → build.py → check.py → test_structure.py`
以及前端四连 `series_tag_test.js / reading_controls_test.js / gui_dom_test.js / smoke.js`。

## 7. 风险与注意

- **别裸 `git push`**：本分支上游是 `origin/staging`，裸推会进共享 staging。提 PR 要走 `fork` + 分支，目标 `staging`。
- **叶目录名不可改**：它就是 slug / URL。若真要缩短（去掉 `rust-learning-` 前缀），需先给 front matter 加可选
  `slug:` 字段 + 重定向，属另一个任务，别顺手做。
- **产物 assets 按 slug 扁平**（`assets/posts/<slug>/`）：因为叶名全局唯一，暂不撞名；将来若缩短叶名要防跨系列同名覆盖。
- **系列子目录名 = 系列 id**（`new --series` 将按此创建）。注意 hft 的 id 是 `hft-embedded-linux-14`、目录前缀是
  `hft-engineering`，二者不一致；是否统一 id 命名是**待决问题**，本次没动数据。
- 回滚：`git reset --hard origin/staging` 会丢弃本次全部改动（含未提交），慎用；
  只想还原目录移动：`git checkout -- site/content/posts`。
