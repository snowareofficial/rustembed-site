# 参与者文档

按你的角色选入口，不用从头读 engine。

| 角色 | 先读 | 你会做什么 |
|---|---|---|
| 写文章 / 投稿 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Markdown、front matter、PR |
| 改站点数据 | [`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md) | 成员、项目、资源、互助、页面、导航 |
| 审稿 | [`REVIEW.md`](REVIEW.md) | 看预览、查契约、给修改意见、合并 |
| 运维 / 发布 | [`OPS.md`](OPS.md) | 分支、Cloudflare、密钥、回滚 |
| 维护引擎 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | 构建器、渲染、契约、字体 |
| 接手的 AI / 维护者 | [`../AGENTS.md`](../AGENTS.md) | 仓库边界、验证命令、工作习惯 |

## 一条内容从写到上线

```text
作者写 Markdown / 数据条目
  → PR 到 staging
  → CI 构建 preview
  → 审稿人看预览、查契约
  → 合并 staging
  → 维护者把 staging 合到 master
  → CI 构建生产 pages
```

## 三条硬规则

1. **内容 PR 只进 `staging`，不直接推 `master`**；
2. **不把令牌、密码、私钥写进仓库**；
3. **改完至少跑一遍**：

```bash
python engine/cli.py build --offline
python engine/cli.py check
```

构建不过，预览和发布都不会过。

## 文档地图

| 文档 | 内容 |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 写作、模板、非 git 投稿 |
| [`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md) | `site/content` 下各类数据怎么改 |
| [`REVIEW.md`](REVIEW.md) | 审稿清单与合并流程 |
| [`OPS.md`](OPS.md) | 部署、密钥、字体、回滚 |
| [`WORKFLOW.md`](WORKFLOW.md) | 完整分支 / CI / 发布细节 |
| [`DEPLOY.md`](DEPLOY.md) | 部署配置的历史说明 |
| [`FONTS.md`](FONTS.md) | 字体子集与加密包 |
| [`GOVERNANCE.md`](GOVERNANCE.md) | 角色、权限、决策 |
