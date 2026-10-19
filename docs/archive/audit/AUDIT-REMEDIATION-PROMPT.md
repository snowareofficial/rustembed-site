# 审计修复任务（独立任务提示词）

> 给另一个 coding agent 的独立任务，不要和 GUI 实现混在一起。
> 目标：把历史审计报告里的问题逐条核实、修掉仍然存在的，并留下证据。
> 当前仓库 HEAD 基线：`c4600ba`（已含 URL 白名单与 AGENTS 索引更新）。

```text
你在 rec-blog 仓库做一次「审计修复」，独立于 GUI 实现任务。
仓库根目录：C:\Users\sakeen\Desktop\rec-blog

先读：
1. AGENTS.md（仓库约束、双 SML 后端、测试纪律）
2. docs/ARCHITECTURE.md、docs/DEPLOY.md
3. 审计材料：若本机可读 C:\Users\sakeen\Documents\deepseek-harness\default-workspace\audit\report.md，
   先通读；读不到就按下面「已知清单」逐条核实，不要凭空发挥。
4. 当前代码：engine/、site/theme/、tests/、.github/workflows/

## 一、已知问题与当前状态（先核实，不要重复修）

A. URL 协议白名单（审计第 2 条）
   - 已在 c4600ba 修复：新增 engine/lib/urls.py；
     render 的 {link:}/SML a,img（含 shot/gallery）与 Markdown 链接/图片全部过白名单；
     build 清洗 projects(repo/homepage)、members.links、resources.url、pages.group_link、
     site.avatar/repo_url、group.join_url。
   - 你的任务：核实是否还有遗漏出口，例如：
     * ref 锚点、video/poster、srcset、CSS url()、feed/sitemap 里的用户 URL；
     * GUI 返回的 preview HTML / 附件 / 资源链接（只读检查，不要改 gui/）；
     * markdown 的自动链接、图片 caption 里的链接。
   - 若发现遗漏：补 safe_url + 测试；不要放宽白名单。

B. 文档漂移（审计第 3 条）
   - 已在 c4600ba 更新 AGENTS.md（gui/、tests/、deploy/、Cargo、Dockerfile、
     ai_summarize.py、vendor/、mathml/summary/urls、公式支持等）。
   - 你的任务：核对 README.md、CONTRIBUTING.md、docs/*.md 的目录/命令/链接是否仍漂移；
     以当前仓库实际文件为准，缺什么补什么，不写不存在的文件。

C. 历史审计里仍可能存在的项（逐条实测，标记 fixed / open / false-positive）
   1) 契约名拼进 HTML 属性未转义（build_contract_page）——现有测试 [1] 覆盖，核实；
   2) 内联角色双重转义（{link:}/{math:}/{strong:}/{term:} 的 & < >）——测试 [2] 覆盖，核实；
   3) Markdown 嵌套列表输出 repr / TypeError——测试 [3] 覆盖，核实；
   4) src="assets/ 全局字符串替换改写代码块——检查是否仍在，若在改为只替换 img 属性；
   5) --out 无守卫 / clean_out 清空任意目录——核实 guard_out 是否覆盖所有入口；
   6) SML 异常类型不受控（SmlError 未接）——核实 CLI 是否统一转人话；
   7) LICENSE / LICENSE-CONTENT / 字体许可——核实文件存在且随产物发布；
   8) CI 是否真正跑 test + check（不是 --warn-only）——核实 .github/workflows/；
   9) 依赖声明 / Python 最低版本（3.8+）是否写明——核实 README/文档；
   10) 测试断言计数器与代码脱节——跑一遍，数字对得上即可。

D. 新审计（截图里的两条）就是 A + B；不要把它们当成新问题重开。

## 二、工作方式

1. 先输出核查表：编号 / 结论（fixed|open|false-positive）/ 证据（文件:行 或 测试输出）。
2. 只修 open 的项；每项一个独立 commit（fix(security)/fix(engine)/docs:），
   不要顺手重构、不要改内容文件、不要动 GUI 实现。
3. 每个修复必须带回归测试；测试放在 engine/test_render_safety.py 或
   tests/ 下，优先标准库、零依赖。
4. 修完跑完整验收，贴完整输出。
5. 产出 docs/AUDIT-REMEDIATION.md：核查表 + 修复说明 + 未修项与原因。

## 三、边界（重要）

- 不要修改 hy4 正在写的文件：gui/**、Cargo.toml、Cargo.lock、
  engine/gui.py、engine/gui_api.py。需要 GUI 配合的，写进文档交给 GUI 任务。
- 不要改 site/content 的正文来绕开问题；契约字段变更要先改 docs/GUI-IMPLEMENT-PROMPT.md
  或 AGENTS.md，并说明理由。
- 不要引入 pip / Node / 第三方 CDN；只用标准库。
- 保存文件 UTF-8 无 BOM、LF；不要 force push、不要直接推 master。
- 契约 loose 只写头部：@contract Name loose { ... }。

## 四、验收（全绿才算完）

python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python engine/cli.py build --offline
python engine/cli.py check
python tests/gui_api_test.py        # 若该文件已存在；不存在则跳过并注明
python -m compileall -q engine

另外自查：
- grep -R "javascript:" dist/ 应为空；
- 用 urls.safe_url 的单元用例覆盖 http/https/mailto/#/相对路径/拒绝 javascript:data://；
- AGENTS.md 里不再出现“没有 URL 协议白名单”这类过期描述。

## 五、交付

- 代码 + 测试 + docs/AUDIT-REMEDIATION.md；
- 最终回复：核查表摘要、open 项修复列表、验收输出、仍未修项及原因。
```
