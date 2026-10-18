# 路线图 / 需求池

状态：`已做` / `进行中` / `待定`。开工前确认范围，避免返工。

## 已做（2026-09-19 第四轮：字体与资源库）

- [x] 字体支持：MiSans 自托管 + 构建期子集化（**实测 15.4 MB 源字体 → 约 254 KB 子集**）；
      `engine/fonts_import.py` 从压缩包挑权重；源字体与子集均不入库，CI/自托管用
      `site/fonts/misans-fonts.tar.gz.enc` 加密包 + `FONT_PASSWORD` 解密（见 docs/FONTS.md）；
      缺 brotli 自动退化为 woff
- [x] 字体使用说明与许可要点：`docs/FONTS.md`；隐私页补「静态资源自托管、不请求第三方 CDN」
- [x] 资源库升级：`kind: tool/repo/framework` 且 url 是仓库时自动抓 stars / 语言 / 许可 / 最近更新

## 已做（2026-09-19 第三轮：制度层面）

- [x] 制度文档库（Markdown）：角色与权限、仓库与分支、创作与审稿、下架与申诉
- [x] 规范与隐私：附件规则（MD 版）、隐私与数据（含安全报告流程）
- [x] 仓库侧机器可读制度：`CONTRIBUTING.md`、`.gitee/` 与 `.github/` 的 PR / Issue 模板
- [x] 权限矩阵（群友 / 贡献者 / 管理员 / 群主 × Gitee / GitHub / CF Pages）写入制度页与 `docs/GOVERNANCE.md`
- [x] 首次初始化清单（Gitee 建库与授权、GitHub secrets、CF Pages 域名）写入 `docs/DEPLOY.md`

## 已做（2026-09-19 第二轮）

- [x] 结构拆分：`engine/`（可复用工具）与 `site/`（本站内容+主题），站点根可用 `--site` 切换
- [x] 主题词条 `content/topics/*`：定义 + 同标签文章自动归入 + 相关词条 + 词条导图
- [x] 成员页：头像（`content/members/<id>.jpg` 自动识别或 avatar 字段/外链）、筛选、文章/项目计数、联系方式中文标签、个人主页完整化
- [x] 群 logo 同时作为站点 favicon 与 webmanifest 图标；静态壳注入描述/OG 元信息
- [x] 文章库按年分段 + 每年折叠展开（大量文章时更好翻）
- [x] 工具侧文档 `engine/README.md`（文件职责 + 常见改动步骤 + 复用方式）

## 已做

- [x] 内容双格式：Markdown（默认）与 SML，同一渲染出口（样式/章节树/导图/搜索共用）
- [x] 内容契约 `@contract` / `@is`：错误码 + 人话；自动生成「站文档 → 规范 → 内容契约」页
- [x] 导图目录：站点树与每页章节树的 SVG，节点可点击跳转
- [x] 仓库元数据（stars / forks / 语言 / 许可 / 最近更新）：GitHub、Gitee、Codeberg、自建 Gitea
- [x] 附件规则：图片入库（体积/数量上限、存在性校验）+ 其余外链
- [x] AI 可读文档：`llms.txt`（索引）与 `llms-full.txt`（正文纯文本）
- [x] 命令行工具：`python engine/cli.py new|list|contracts|build|check|test|preview`
- [x] 导航去重：导航只在左栏；顶栏只留品牌、搜索、加群
- [x] 文章库（年份/标签筛选 + 分页加载）、文章知识（系列/标签/作者索引）
- [x] 站文档（原「文档」）、加入我们（含 QQ 群链接）
- [x] 100+ 篇的左栏策略：系列与年份默认折叠、标题过滤框、年份内超 50 篇折叠
- [x] 部署方案：`docs/DEPLOY.md`

## 待定 / 待细化

- [x] 主题词条（`site/content/topics/`，同标签自动归入 + 相关词条 + 词条导图）
- [ ] 是否把「资源库」并进文章知识做成统一知识库视图（词条 ↔ 资源互链）——待确认
- [ ] 项目与文章的关联：项目详情页内嵌「相关文章」（现在只有成员页反向聚合）
- [ ] 资源库升级第二步：资源条目也抓仓库元数据（当 url 是仓库时）、按标签筛选已做、加「提交资源」流程
- [ ] 全文搜索升级：现在是构建期 JSON + 子串匹配；文章多了以后是否上 `MiniSearch`/倒排索引
- [ ] 人读文档：把站文档拆成「5 分钟上手 / 深入」两层，每篇控制在 1 屏
- [ ] 创作制度落地细则：写权限申请流程、审稿轮值与记录（是否入站文档）
- [ ] 站内讨论：仍不做评论（引流回 QQ 群），但可考虑「文章 → 群内话题」回链
- [ ] 多语言（英文版）与非 Rust 主题栏目：待内容量与需求出现后再决定

## 兼容性说明（Markdown ↔ SML）

| 能力 | Markdown | SML |
|---|---|---|
| 元数据 | front matter（YAML 子集） | 顶层字段 |
| 标题/章节锚点 | `##` 等 | `topic` / `section` + `label` |
| 代码块 | 围栏 ``` | `code { lang text }` |
| 表格 | GFM 表格 | `table { head rows }` |
| 列表 | `-` / `1.`（一层嵌套） | `ul` / `ol { items: [...] }` |
| 引用 | `>` | `quote` |
| 图片 | `![alt](assets/x.png "图注")` | `img { src alt caption }` |
| 提示框 | `:::note` / `:::tip` / `:::warn` | `note` / `tip` / `warn` |
| B 站视频 | 单独一行 BV 号 | `video { bvid }` 或顶部 `video:` |
| 定理/证明/公式 | 无（用引用代替） | `theorem` / `proof` / `math` |
| 内联角色 | 支持 | 支持 |
| 片段复用 | 无 | `@frag { }` + `&frag` |
| 字段契约 | 支持（同一套契约） | 支持 |
| 附件/系列/许可 | 支持（front matter） | 支持（顶层字段） |

结论：日常写作两条路等价；需要定理/证明/片段复用时选 SML。差异只在这里记录一处，避免文档漂移。
