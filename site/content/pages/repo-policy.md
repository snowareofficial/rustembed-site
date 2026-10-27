---
title: "仓库与分支制度"
group: 制度
order: 2
---

## 分支模型（保持极简）

只有一个长期分支 `master`。**所有改动都经 PR**，包括管理员自己的改动——例外只有：修正错别字、修失效链接、紧急下架。

- 个人改动：`feat/<简短说明>`、`fix/<简短说明>`、`content/<文章短名>`
- 禁止：`git push --force` 到 `master`、直接删除他人提交、把 `dist/` 提交进仓库
- 一次 PR 只做一件事：一篇文章 / 一处制度改动 / 一个功能点

## 提交信息

格式：`类型: 说明`，类型用 `feat` / `fix` / `docs` / `content` / `chore` / `refactor`。

```
content: 新增文章《probe-rs 上手》
docs: 角色与权限制度补充权限回收条款
fix: 修正附件体积上限描述错误
chore: 更新仓库元数据缓存
```

说明用中文写清楚「做了什么」，不要写「update」「修改」这类无信息量的内容。

## PR 要求

PR 描述里必须有：

1. **改了什么**（一句话）；
2. **为什么**（制度类改动必填）；
3. **自检结果**：本地跑过 `python engine/cli.py test && python engine/cli.py build && python engine/cli.py check`；
4. 涉及新字段时：说明是否同步改了契约（`site/content/contracts/`）。

审核：至少 1 名管理员通过；机械性改动（错字、链接）可由 1 人快速合并。目标响应时间 **3 个工作日**。

## 内容与文件的放置约定

| 内容 | 位置 |
|---|---|
| 文章 | `site/content/posts/<年>/[系列/]<英文短名>/index.md`（或 `.sml`），图片同目录 `assets/` |
| 站文档 / 制度 | `site/content/pages/*.md`（`group` + `order` 决定归组与顺序） |
| 主题词条 | `site/content/topics/*.md` |
| 成员档案 | `site/content/members/<id>.sml`（头像同名 `<id>.jpg`） |
| 项目 / 资源 / 周报 | `site/content/projects|resources|weekly/` |
| 契约 | `site/content/contracts/*.sml`（只有管理员改） |
| 引擎与主题 | `engine/`、`site/theme/`（只有管理员改） |

命名：目录与文件名一律**小写英文 + 连字符**，不用中文与空格（中文标题写在 `title` 字段里）。

## 标签与流程状态

Issue 标签：`内容投稿` / `制度建议` / `站点故障` / `附件问题` / `待讨论`。
状态流转：`待处理 → 审核中 → 已合并 / 需修改 / 不采纳`；「不采纳」必须写理由。

## 密钥与安全

- CF Pages Token、Gitee Token 只存在于 GitHub Secrets 与管理员的本地环境，**不进仓库、不进群聊、不贴截图**；
- 任何人发现密钥可能泄露，立即在群里通知管理员，管理员当天轮换；
- 站点不接入第三方统计与广告脚本（见「隐私与数据」）。

## 发布与回滚

发布链路：Gitee `master` →（每 6 小时单向镜像）→ GitHub → Actions 构建 → Cloudflare Pages。
回滚、紧急下架、故障处理步骤见 `docs/DEPLOY.md`（仓库内 `docs/`，仅面向开发者）。
