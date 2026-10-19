# 运维 / 发布

面向：有仓库与 Cloudflare 权限的维护者。目标：知道**东西在哪、怎么发、坏了怎么退**。

## 拓扑

```text
Gitee（权威源，PR 落地点）
├─ master   生产内容
├─ staging  预览内容
└─ code     engine/ + site/theme/ 代码

GitHub（镜像 + CI）
├─ master   代码与内容镜像
├─ preview  staging 构建产物
└─ pages    master 构建产物

Cloudflare Pages 项目 rustembed
├─ preview  → https://preview.rustembed.pages.dev/
└─ pages    → https://rustembed.swebase.cn/
```

Cloudflare 不直接跑构建，只托管 GitHub 上的 `preview` / `pages` 产物分支。

## 工作流

| 文件 | 作用 |
|---|---|
| `.github/workflows/publish-pages.yml` | 矩阵：Gitee `staging` → `preview`；Gitee `master` → `pages` |
| `.github/workflows/build.yml` | 构建/自检/字体解密；PR 门禁 |
| `.github/workflows/sync-code.yml` | 从 Gitee `code` 同步 `engine/`、`site/theme/`；GitHub 代码更新时跳过，防止回退 |
| `.github/workflows/sync-from-gitee.yml` | Gitee → GitHub 被动镜像，每 15 分钟；GitHub 不接受日常直接 push |

## 日常发布

### 预览

1. 内容 PR 合入 Gitee `staging`；
2. `publish-pages.yml` 的 staging 任务构建；
3. 产物推到 GitHub `preview`；
4. Cloudflare 预览更新。

### 生产

```text
Gitee staging --merge--> Gitee master
  → publish-pages 的 master 任务
  → GitHub pages
  → Cloudflare 生产
```

**没有单独的 promote 命令**；合并就是发布动作。

### 代码

```text
Gitee code → sync-code.yml → GitHub master → 构建
```

`sync-code` 有保护：GitHub 的 `engine/`、`site/theme/` 比 Gitee `code` 新时跳过覆盖，避免把本地修复冲掉。要强制同步时，先把 Gitee `code` 更新到最新。

## 密钥

GitHub Actions Secrets：

| 名称 | 用途 |
|---|---|
| `FONT_PASSWORD` | 解密 `site/fonts/misans-fonts.tar.gz.enc` |
| `GITEE_TOKEN` | 读取/同步 Gitee（按工作流需要） |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 构建期摘要（可选） |
| `GITHUB_TOKEN` | GitHub 内置，推送产物分支 |

规则：

- 令牌只放 Secrets，**不进仓库、不进日志、不写进文档**；
- GUI 的 Gitee 令牌只存本机钥匙串或内存；
- 字体密码只放本机 `site/fonts/FONT_PASSWORD.txt`（gitignore）和 CI Secret；
- 轮换令牌后，同步更新 GUI/CI，并撤销旧令牌。

## 字体

- 源字体不入库：`site/fonts/src/` 被 gitignore；
- 加密包 `site/fonts/misans-fonts.tar.gz.enc` 入库；
- CI 解密后用 fontTools 子集化，产物进 `dist/fonts/`；
- 当前字体：MiSans（正文）、XITS Math（公式默认）、STIX（`mathtext`/兜底）；
- `fontTools` 已 vendored，但 **woff2 还需要 `brotli` 压缩后端**；缺 brotli 时构建回退 woff，这是预期行为，不是字体损坏；
- 新增/替换字体后必须重新加密压缩包，否则 CI 拿不到源文件。

详细：[`FONTS.md`](FONTS.md)

## 产物与缓存

- 构建输出 `dist/`；
- Cloudflare 缓存通常跟随部署；HTML/JSON 默认不长期缓存；
- 字体 URL 没有内容 hash；如果换字体后用户仍看到旧字形，先硬刷新/无痕验证；
- 要长期缓存字体，应先给 URL 加内容 hash，再设 immutable。

## 发布前检查

```bash
python engine/cli.py build --offline
python engine/cli.py check
python engine/test_contracts.py
python engine/test_structure.py
node tests/smoke.js
```

线上验证：

```bash
curl -I https://preview.rustembed.pages.dev/
curl -s https://preview.rustembed.pages.dev/manifest.json | head
curl -I https://rustembed.swebase.cn/
```

看：

- 200；
- 文章/项目/成员数量符合预期；
- 字体 200，公式不是系统回退；
- 没有“黄页/旧文案”残留；
- 预览页面没有横向溢出。

## 回滚

### 内容回滚

```bash
git revert <bad-commit>
# 推回 staging 验证，再合 master
```

不要 `force push` 已发布的分支。

### 发布回滚

- Cloudflare Pages 面板可以回滚到上一个 deployment；
- 或把 `pages` 分支切回上一个构建提交，触发部署；
- 回滚后重新验证 manifest 和首页。

### 代码回滚

- GitHub master 回退后，重新触发发布；
- 如果 Gitee `code` 还是旧版，先确认 `sync-code` 不会把代码覆盖回去。

## 已知边界

- Gitee 侧没有工作流，PR 门禁只在 GitHub 镜像侧；
- `preview.rustembed.swebase.cn` 没有单独配置，staging 用 `preview.rustembed.pages.dev`；
- 紧急情况下可以用 `wrangler pages deploy dist --project-name rustembed --branch preview` 直传，但这是**临时**的，下一次 Git 流水线会覆盖；
- 直接推 `master` 会绕过预览，不要做。

## 相关

- 审稿：[`REVIEW.md`](REVIEW.md)
- 完整流程：[`WORKFLOW.md`](WORKFLOW.md)
- 部署历史：[`DEPLOY.md`](DEPLOY.md)
