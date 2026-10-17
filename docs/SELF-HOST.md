# 自建服务器链路（容器构建 + AI 摘要 + 发布）

适用于：Gitee 是权威源，服务器负责构建与发布；GitHub Actions 可以继续做 PR 门禁，也可以完全不用。

```
作者 ──push──► Gitee（权威源）
                  │ Webhook（Push / master）
                  ▼
        服务器: deploy/gitee-webhook.py
                  │  git reset --hard origin/master
                  ▼
        Docker 容器: engine/cli.py build --offline
                  │  可选: ai_summarize.py → GLM-4.7-Flash（构建期一次）
                  ▼
              dist/ ──► wrangler pages deploy ──► Cloudflare Pages
                  └────► 或 nginx/Caddy 直接 serve（DEPLOY=none）
```

要点：**构建器零 pip 依赖**（fontTools 已 vendored），容器只装 Python；
站点运行时仍然零第三方请求，AI 只在构建期调用一次。

---

## 1. 服务器一次性准备

```bash
# 基础
apt install -y docker.io git python3
# 可选：发布到 Cloudflare
npm i -g wrangler && wrangler login        # 或配 CLOUDFLARE_API_TOKEN

# 构建专用 checkout（只读语义：不要在这里改文件）
git clone https://gitee.com/rustembed/site.git /srv/rec-blog
cd /srv/rec-blog

# MiSans 源字体不入库，需要在服务器上放一份（构建期子集化）
# 方式 A：把 MiSans.zip 放到仓库根，导入一次
python3 engine/fonts_import.py MiSans.zip --weights Regular,Bold
# 方式 B：直接把 MiSans-Regular.ttf / MiSans-Bold.ttf 放进 site/fonts/src/
```

Docker 镜像首次构建（之后改代码会自动重建）：

```bash
docker build -t rec-blog-builder:latest .
```

## 2. 手动跑一遍（先验证再挂 webhook）

```bash
cd /srv/rec-blog
export AI_BASE_URL="https://你的网关/v1"
export AI_API_KEY="sk-..."
export AI_MODEL="glm-4.7-flash"
bash deploy/rebuild.sh          # 拉取 → 容器构建（含 AI 摘要）→ wrangler 发布
# 只想看产物、不发布：
DEPLOY=none bash deploy/rebuild.sh
```

容器内实际执行的是 `deploy/entrypoint.sh`：

1. `build`（离线，不抓仓库元数据）
2. 有 `AI_BASE_URL/AI_API_KEY` → `ai_summarize.py --write`（失败不阻断）→ 再 `build`
3. `check` + `test_structure.py`（不过就退出非 0）

## 3. Webhook 服务

```bash
sudo cp deploy/rec-blog-webhook.service /etc/systemd/system/
# 编辑 /etc/systemd/system/rec-blog-webhook.service：token、AI_*、路径
sudo systemctl daemon-reload
sudo systemctl enable --now rec-blog-webhook
curl -s 127.0.0.1:8787/healthz
```

Gitee 仓库 → 管理 → Webhook → 添加：

| 项 | 值 |
|---|---|
| URL | `https://hooks.你的域名/webhook`（反代到 `127.0.0.1:8787`） |
| 密码 | 与 `GITEE_WEBHOOK_TOKEN` 相同 |
| 事件 | Push（分支 `master`） |

反代示例（Caddy，自动 HTTPS）：

```
hooks.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

推送后看日志：`journalctl -u rec-blog-webhook -f`。

## 4. 不发布到 Cloudflare（直接自己托管）

```bash
DEPLOY=none bash deploy/rebuild.sh
# 然后让 nginx 指向 /srv/rec-blog/dist
```

```nginx
server {
    listen 443 ssl http2;
    server_name rec-blog.example.com;
    root /srv/rec-blog/dist;
    index index.html;

    # 与构建期生成的 dist/_headers 对齐：文本一律 UTF-8
    charset utf-8;
    location = /llms.txt      { types { } default_type "text/plain; charset=utf-8"; }
    location = /llms-full.txt { types { } default_type "text/plain; charset=utf-8"; }
    location / { try_files $uri $uri/ /index.html; }
}
```

> 注意：这是 hash 路由站点，`try_files ... /index.html` 是必须的；
> 不要把 `dist/` 和源码混在同一个 web 根。

## 5. 回滚

```bash
cd /srv/rec-blog
git reset --hard <上一个提交>
DEPLOY=none bash deploy/rebuild.sh     # 或正常发布
```

Cloudflare 侧也可以在面板 Deployments → 选旧版本 → Rollback。

## 5.5 AI 摘要缓存

`site/content/summaries/` 已加入 `.gitignore`：

- 服务器首次构建会为每篇文章调用一次网关并落盘；之后 `git reset --hard` **不会删除**这些文件（ignored），
  `ai_summarize.py` 默认跳过已存在的摘要 → **只有新文章才花 token**。
- 想强制重生成：`python engine/ai_summarize.py --write --force`。
- 若希望摘要随仓库分发（换服务器不用重跑），把该目录从 `.gitignore` 移除并提交即可。

## 6. 验收清单

```bash
curl -s 127.0.0.1:8787/healthz                 # {"ok":true,...}
bash deploy/build.sh && ls dist/index.html     # 产物存在
curl -I https://rec-blog.swebase.cn/llms.txt   # 200 + text/plain; charset=utf-8
curl -I https://rec-blog.swebase.cn/feed.xml
```

## 7. 安全与纪律

- Webhook 只监听 `127.0.0.1`，对外必须走 HTTPS 反代；`GITEE_WEBHOOK_TOKEN` 不要进仓库。
- 服务器 checkout 是**构建副本**：`rebuild.sh` 会 `git reset --hard`，别在上面改文件。
- 容器不加 `--privileged`、不挂 docker socket；只需要读源码、写 `dist/`。
- AI key 只存在服务器的 systemd 环境里，构建产物里不会出现 key；摘要内容会写进仓库的 `site/content/summaries/`（可选是否提交）。
- 想同时保留 GitHub Actions 的 PR 门禁：让 Actions 只跑校验（`build.yml` 的 deploy 步骤加 `if: false`），发布交给服务器即可。
