---
title: "参与项目"
group: 参与
order: 10
---

这个站点不是“作者写给读者看”的单向博客，群友可以参与写作、整理数据、审稿和发布。下面按角色说明入口；不需要先懂 SML 或构建系统。

## 写文章

- 文章是 Markdown，放在：

  ```text
  site/content/posts/<年份>/<英文短名>/index.md
  ```

- 最小 front matter：

  ```yaml
  ---
  title: "文章标题"
  author: 你的成员id
  date: YYYY-MM-DD
  tags: [ rust, embedded ]
  summary: "一两句摘要"
  ---
  ```

- 图片放同目录 `assets/`，用 `![说明](assets/x.png)`。
- 本地预览：`python engine/cli.py preview`
- PR 目标分支是 `staging`，不是 `master`。
- 不会 git：把 Markdown 和图片发群里，由管理员代投，PR 注明原作者。

更完整的正文语法见 **Markdown 写作速查**。

## 一篇文章为什么是一个文件夹

不是故意复杂，而是让文章“自带资源、地址稳定”：

```text
posts/2026/board-bringup/
├─ index.md          正文 + front matter
├─ index.en.md       英文版（可选）
└─ assets/           这篇文章的图片、附件
```

好处：

1. **图片不串**：每篇文章的 `assets/` 独立，不会和别的文章重名；
2. **URL 稳定**：文件夹名就是 slug，标题改了 URL 不变；
3. **多语言同目录**：`index.md` + `index.en.md` 自动归为同一篇；
4. **附件/封面/草稿**可以跟文章放一起，不污染全局目录。

构建时不是手工维护列表，而是扫描：

```text
site/content/posts/<年份>/<slug>/index.md
```

然后按 `(年份, slug)` 分组、按日期排序，生成 `manifest.json`、文章页、标签页和搜索索引。**你不需要在某个“文章列表”里登记**；文件存在、契约通过，就会自动收录。

## 改站点数据

成员、项目、资源、互助、页面、导航都在 `site/content/`：

| 内容 | 路径 |
|---|---|
| 成员 | `members/<id>.sml` |
| 项目 | `projects/<英文短名>.sml` |
| 资源 | `resources/<英文短名>.sml` |
| 技术互助 | `services/<英文短名>.sml` |
| 独立页面 | `pages/*.md` 或 `*.sml` |
| 导航/群信息 | `site.sml` |

规则：

- 目录决定默认契约，不需要写 `@is`；
- 字段表：`python engine/cli.py contracts`，网页版见 **内容契约**（`#/page/contracts`）；
- 改完跑 `build --offline` 和 `check`；
- 文件名是 URL 的一部分，不要随意改已有条目名。

## 审稿

审稿人看四件事：

1. PR 的 base 是不是 `staging`；
2. preview 是否能打开、移动端是否溢出；
3. 内容/署名/引用/许可是否清楚；
4. `build`、`check`、结构测试是否通过。

具体清单和打回模板在仓库 `docs/REVIEW.md`；原则是：**意见要能直接执行**，不要只说“再改改”。

## 运维 / 发布

一句话版：

```text
Gitee staging → preview
Gitee staging 合并到 master → 生产
Gitee code → GitHub master（代码同步）
```

- 内容 PR 只进 `staging`；
- 生产发布 = 把 `staging` 合到 `master`；
- 密钥、字体加密包、Cloudflare、回滚细节在仓库 `docs/OPS.md`；
- 不把令牌/密码写进仓库。

## 参与方式

- 会 git：fork / 建分支 / PR 到 `staging`；
- 不会 git：把稿子发给群管理代投；
- 只想提意见：在群里说，或提 issue，不用改代码。

不需要“很会写”才能参与；校对、补图、整理资源、审稿都算。
