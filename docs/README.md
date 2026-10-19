# 文档索引

先按角色选，不用从头读。

## 参与者

| 文档 | 给谁 |
|---|---|
| [`ROLES.md`](ROLES.md) | 总入口：作者 / 数据维护 / 审稿 / 运维 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 写文章、模板、非 git 投稿 |
| [`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md) | 成员、项目、资源、互助、页面、导航 |
| [`REVIEW.md`](REVIEW.md) | 审稿清单、预览、打回、合并 |
| [`OPS.md`](OPS.md) | 分支、Cloudflare、密钥、字体、回滚 |

## 维护者

| 文档 | 内容 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 构建器、渲染、契约、目录约定 |
| [`WORKFLOW.md`](WORKFLOW.md) | 完整 git / CI / 发布流程 |
| [`DEPLOY.md`](DEPLOY.md) | 部署配置的历史细节 |
| [`FONTS.md`](FONTS.md) | 字体子集、加密包、许可 |
| [`GOVERNANCE.md`](GOVERNANCE.md) | 角色、权限、决策 |
| [`ROADMAP.md`](ROADMAP.md) | 路线图 |
| [`SELF-HOST.md`](SELF-HOST.md) | 自托管部署 |
| [`I18N.md`](I18N.md) | 多语言现状 |
| [`TECH-MUTUAL-AID.md`](TECH-MUTUAL-AID.md) | 技术互助的定位与文案 |
| [`REPO-LAYOUT.md`](REPO-LAYOUT.md) | 仓库目录地图、文件该放哪 |
| [`PLAN-SML-NATIVE.md`](PLAN-SML-NATIVE.md) | native include/契约改造的工作量与决策 |

## GUI

| 文档 | 内容 |
|---|---|
| [`GUI.md`](GUI.md) | GUI 设计 |
| [`GUI-FLOWS.md`](GUI-FLOWS.md) | 交互流程 |
| [`GUI-IMPLEMENT.md`](GUI-IMPLEMENT.md) | 已实现的结构与差异 |
| [`gui-mock/`](gui-mock/) | 视觉基准（HTML/PNG/CSS） |

## 归档

[`archive/`](archive/) 里是**已完成任务的任务书/交接记录**，不再维护：

- `archive/gui/`：GUI M1–M3 任务书与交接；
- `archive/p0/`：技术互助 P0 任务书与交接；
- `archive/i18n/`：i18n phase 1 任务书；
- `archive/audit/`：审计任务书。

归档文档里的路径可能已经变化；以当前代码和上面的活跃文档为准。

## 规则

- 新的**给人看的指南**放 `docs/` 根，并在本索引登记；
- 任务书、交接、一次性 prompt 放 `docs/archive/<主题>/`，不要堆在根目录；
- 代码/生成物不要放 `docs/`；
- 归档文档不要反向引用未归档的临时路径。
