# 部署方案

```
作者/管理员 ──push──► Gitee（权威源）
                        │  每 6 小时单向镜像（sync-from-gitee.yml）
                        ▼
                     GitHub 镜像 ──Actions──► python engine/build.py ──► dist/
                                                       │
                                              wrangler pages deploy
                                                       ▼
                                    Cloudflare Pages ──► rec-blog.swebase.cn
                                                     └─► rust-embed.swebase.cn（别名）
```

> **两条发布路径，二选一或并存：**
> - GitHub Actions（本文下半部分）：镜像 → Actions → Cloudflare Pages；
> - **自建服务器（容器构建 + AI 摘要）**：Gitee Webhook → 服务器容器 → `wrangler pages deploy` 或 nginx，
>   见 [`SELF-HOST.md`](SELF-HOST.md)。

## 0. 首次初始化清单（按顺序做一次）

**Gitee（权威源，接受 PR）**

1. 建仓库 `gitee.com/rustembed/site`，**公开**（否则群友无法 fork/提 PR）；
2. 填仓库简介与主页链接（站点域名），勾选 Issue；
3. 邀请成员：`管理 → 仓库成员管理 → 邀请用户`，按制度给角色
   - 群主 → `管理员`（Owner 级）
   - 管理员 → `开发者`（Developer）
   - 贡献者 → `开发者`
   - 群友 → 不邀请（走 fork + PR）
4. 若你的 Gitee 版本提供**保护分支**：把 `master` 设为受保护，禁止直接推送、要求 PR
   （版本差异较大，以仓库「管理」页实际可选项为准；没有该功能时以制度约束代替）；
5. 建标签：`内容投稿` `制度建议` `站点故障` `附件问题` `待讨论`；
6. PR / Issue 模板已在仓库里（`.gitee/PULL_REQUEST_TEMPLATE.md`、`.gitee/ISSUE_TEMPLATE.md`），无需配置。

**GitHub（只读镜像 + 构建）**

7. 建镜像仓库（可私有），加入 secrets：`GITEE_USER`、`GITEE_TOKEN`（只读令牌）、
   `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；
8. 确认 Actions 权限：`Settings → Actions → General → Workflow permissions` 选 **Read and write**；
9. 首次同步：`Actions → 从 Gitee 同步镜像 → Run workflow`（**先确认 Gitee 已有内容**，否则镜像为空）。

**Cloudflare Pages（发布）**

10. 建项目 `rec-blog`（首次 `wrangler pages deploy` 会自动创建）；
11. 绑定域名：`rec-blog.swebase.cn`（主）、`rust-embed.swebase.cn`（别名）；
12. API Token 权限最小化：仅 `Cloudflare Pages: Edit` + 对应账号。

**发布前自检（本地）**

```bash
python engine/cli.py test && python engine/cli.py build && python engine/cli.py check
```

## 0.5 两个源（同一份代码）

| remote | 地址 | 角色 |
|---|---|---|
| `origin` | `https://gitee.com/rustembed/site.git` | **权威源**：所有改动先推这里 |
| `sitegen` | `https://gitee.com/snoware/sml-sitegen.git` | 第二个源：同一份代码，作为 SML 的应用示例对外展示 |

```bash
git push origin master     # 必做（权威源）
git push sitegen master    # 可选：让示例源跟上（同一个提交，不需要重新提交）
```

两个源内容一致，不需要分别维护；提交信息与历史也相同。若只推了一个，另一个只是暂时落后，补推即可。

GitHub 侧仍是只读镜像 + 构建发布，与这两个 Gitee 源无关。

## 1. 仓库

- 权威源：`https://gitee.com/rustembed/site`，**所有改动先推这里**（GitHub 只读镜像，不回写）。
  仓库地址的唯一数据源是 `site/content/site.sml` 的 `repo_url`；改地址时先改这里，再同步本文档与 `.github/`、`.gitee/` 模板。
- 镜像：`.github/workflows/sync-from-gitee.yml`，每 6 小时 + 手动触发；检测到 GitHub 上有 Gitee 没有的提交会**中止告警**，只有手动触发并勾 `force` 才丢弃。

需要配置的 Actions secrets：

| secret | 用途 |
|---|---|
| `GITEE_USER` / `GITEE_TOKEN` | 从 Gitee 拉取（建议只读令牌） |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | 发布到 Cloudflare Pages |

## 2. Cloudflare Pages

1. 建项目 `rec-blog`（首次 `wrangler pages deploy` 会自动创建）；
2. 绑定域名：`rec-blog.swebase.cn`（主）与 `rust-embed.swebase.cn`（别名）指向同一项目；
3. 若 DNS 不在 Cloudflare 托管，用 CNAME 指到 `<project>.pages.dev`；
4. 构建命令与产物目录由 Actions 负责（`python engine/build.py` + 上传 `dist`），CF 侧不需要再设构建命令。

## 3. 构建产物

`dist/` 里除站点本体外还有：`manifest.json`（前端唯一数据源）、`search-index.json`、
`sitemap.xml`、`feed.xml`、`map.svg` 与各页 `*.map.svg`（导图）、
`llms.txt`（给 AI 读的站点索引）、`llms-full.txt`（全部文章正文纯文本）。

`meta/repos.json` 是仓库元数据缓存，**随提交入库**：抓取失败时回退到它，构建不会因此中断。

## 4. 回滚

- 内容回滚：`git revert` 或 `git checkout` 到目标提交后重新推送（Gitee 权威 → 镜像 → 自动重发布）。
- 产物回滚：Cloudflare Pages 控制台的 Deployments 里可把历史版本设为当前。
- 紧急下架单篇：把该文章的 `draft: true` 推上去（比删除更好，便于后续恢复），或在群里先撤回外链。

## 5. 本地验证（发布前必跑）

```bash
python engine/build.py         # 构建（含契约校验）
python engine/test_contracts.py
python engine/check.py         # 产物自检
python engine/preview.py       # http://127.0.0.1:8080/
```

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| Actions 里构建失败 | 本地跑同一条命令复现；契约错误会带 `E-CONTRACT-xxx` 与文件路径 |
| 元数据抓取失败 | 正常降级（用缓存/只显示链接）；检查网络或仓库地址 |
| 镜像中止 | 说明 GitHub 上有独有提交，先在 Gitee 补齐；确认丢弃再手动 `force` |
| 页面 404 | 站点是 hash 路由，入口只有根路径 + `#/…`；确认文件确实在 `dist/` |
| 中文乱码 | 构建脚本输出已统一 UTF-8；终端仍乱码属控制台代码页问题，不影响产物 |
