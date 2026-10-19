# P0 技术互助改名 / 授权声明 —— 移交文档（2026-10-19）

> 给下一个接手的人：本文件报告 P0 的**当前进度、验收输出、残留问题与待办**。
> 任务书：`docs/P0-TECH-MUTUAL-AID-PROMPT.md`；定位与文案：`docs/TECH-MUTUAL-AID.md`。
> 基线 `c2b83b8`；P0 改动已提交（`0af91d8` / `304ed52`），本文保留过程记录；
> 后续状态以 `git log` 与工作区为准。

## 1. 已完成（已提交：`0af91d8` / `304ed52`）

| 文件 | 内容 |
|---|---|
| `site/theme/app.js` | TYPE_LABEL.services →「技术互助」；搜索 chips「黄页」→「互助」；成员页统计「黄页 N」→「互助 N」；nav 描述、列表页标题/说明（顶部加「这里只做技术互助与能力互补，不涉及设备买卖、报价与商务对接。」）、详情页 crumb、空态「没有这条互助」、主页/成员页小节标题；卡片与详情分区改「能帮上什么 / 想一起做什么」；rate 标签 →「协作方式（不谈价格）」；状态新增 `SERVICE_STATUS_LABEL`（active→可协作，paused→暂缓），`statusBadge(v, map)` 加了可选映射参数，只对互助条目生效（项目状态词不受影响）；条目底部声明改「本站只展示这条信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。」；`buildFooter()` 保留构建期注入的 `license-notice*` span（否则会被 clear() 抹掉） |
| `engine/build.py` | 摘要/契约注释/llms.txt/站图/搜索类型「黄页」→「互助|技术互助」；`SERVICE_DISCLAIMER` 改为新措辞（仍含 check.py 钉住的五个短语）；新增 `LICENSE_NOTICE`（三行授权声明，原文见 TECH-MUTUAL-AID.md §2）+ `FOOTER_TAG`，`inject_shell()` 注入 `index.html` 的 `<footer id="footer">`，找不到占位会 `rep.warn`；`site_text()` 显式收进 `LICENSE_NOTICE`（字体子集不漏字） |
| `site/content/services/pcb-emc-review.sml` | 顶部注释 →「技术互助示例」；rate →「远程评审；需要寄样板时走快递；时间与方式私聊，不谈价格」；wants →「小批量硬件一起做 / 固件移植交流」；正文「报酬与周期」→「时间与方式」，topic 标题「合作方式」→「协作方式」 |
| `docs/ARCHITECTURE.md` | 「能力与合作黄页」/「黄页」→「技术互助」（2 处） |

## 2. 验收输出（已跑，全绿）

```
python engine/cli.py build --offline
  -- 技术互助 / 1 条
  字体子集 3 个，共 283 KB（MiSans, STIX Two Math）
  [warn] fonts: 缺 brotli（woff2 压缩），子集改用 woff   ← 既有告警，与本任务无关
  产物：dist（文章 4 / 项目 2 / 成员 2 / 互助 1）
python engine/cli.py check  → ALL PASS
python engine/test_contracts.py     → ALL PASS（5 契约，21 断言）
python engine/test_render_safety.py → 187 项 ALL PASS
python engine/test_structure.py     → 91 条 STRUCTURE PASS
node tests/smoke.js                 → SMOKE PASS（services / service 详情路由都跑过）
```

必需文案已全部进产物：`技术互助`、`能帮上什么`、`想一起做什么`、`协作方式（不谈价格）`、
`可协作/暂缓`、顶部定位句、条目底部声明（dist/app.js、index.html、manifest.json、服务片段均命中）。
无字体漏字告警（site_text 已收新文案）。

## 3. 残留问题：dist 里仍有「黄页」（7 个文件，全部可归因到**不在授权清单**的源文件）

```
dist/llms.txt / manifest.json / map.svg / search-index.json / pages/yellow-pages.html(.map.svg)
  ← 根因：site/content/pages/yellow-pages.md（整页《能力与合作黄页制度》，
    标题与正文都在渲染产物里）
dist/style.css
  ← 根因：site/theme/style.css:423 的注释「/* 黄页：三段式… */」（theme 原样拷贝进 dist）
```

这两处不在本任务「只改这些」清单里（style.css 明确「不要改」）。**建议**（需所有权确认后再动）：

1. `site/content/pages/yellow-pages.md` → 改名/改写为《技术互助制度》，与站点文案对齐（顺带把
   `yellow-pages` 文件名换掉会影响 URL `#/page/yellow-pages`，若改名需在页面里留旧锚点跳转或接受链接失效）；
2. `site/theme/style.css` 注释「黄页：三段式」→「技术互助：三段式」（纯注释，零样式风险）；
3. `engine/check.py` 的报错文案与汇总行仍写「黄页 N」（不进 dist，纯日志口径，顺手可改）；
4. `AGENTS.md`、`README.md`、`docs/WORKFLOW.md`、`engine/README.md`、`site/content/contracts/blog.sml`
   注释里的「黄页」同属文档/注释口径，建议一次性清掉。

在以上落地前，「dist 全文无『黄页』」的验收只能按**白名单**断言（见 §4 的测试要求）。

## 4. 待办（接手人做）

1. **新增 `tests/tech_aid_test.py`（只读断言，标准库 unittest，仿 `tests/i18n_test.py` 的结构）**：
   - dist/index.html 含三行授权声明（`license-notice` / `-members` / `-site` 三个 span）；
   - dist/manifest.json 的 services 条目含 `rate`（协作方式文案）、`wants`（无商业词）；
   - dist/services/pcb-emc-review.html 含「协作方式」「时间与方式双方自行约定」，
     且**不含**「按板计费」「报酬」「报价」；
   - dist 渲染类产物（app.js、manifest.json、services/*.html）无「黄页」；
     `dist/style.css` 与 `dist/pages/yellow-pages.*` 作为**已知残留白名单**列出，
     其它文件再出现「黄页」一律 FAIL（§3 落地后把白名单删掉）；
   - 字体子集不漏字：用 `engine/vendor/fontTools` 打开 `dist/fonts/*.woff`，
     断言 LICENSE_NOTICE 的每个非 ASCII 字符都在 cmap 里（无子集文件时 skipTest）。
2. 把 §2 的验收输出贴进提交说明或 PR。
3. **两条 commit（只本地提交，不 push、不 force、不碰 master）**：
   - `git add site/theme/app.js engine/build.py docs/ARCHITECTURE.md tests/tech_aid_test.py`
     → `feat(site): 技术互助文案与授权声明`
   - `git add site/content/services/pcb-emc-review.sml`
     → `content(services): 示例改为协作方式`
4. §3 的两处残留拿到所有权后跟进（另开 commit）。

## 5. 边界与红线（改之前再读一遍）

- 没动的东西：`gui/**`、`engine/gui*.py`、`site/content/posts/**`、
  `site/content/contracts/blog.sml`（**rate 字段保留**，契约零变更）、`site/theme/style.css`、
  路由（仍是 `#/services`、`#/service/<id>`）、布局结构（只换文案与标签）。
- `build.py` 的 `guard_out()`、`.github/` 勿改；保存内容文件保持 UTF-8 无 BOM、LF、末尾换行。
- 提交前五连：`test_contracts.py` → `test_render_safety.py` → `build.py` → `check.py` →
  `test_structure.py`（全绿才算完成）；JS 侧再跑 `node tests/smoke.js`。
- 注意 hy3 在并行改 `site/theme`：提交前 `git status` 确认自己只 add 上面列的文件，
  别把别人的工作区改动卷进 commit。
