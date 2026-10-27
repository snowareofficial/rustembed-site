# 构建 / 预览性能（perf/build-preview，2026-10-21）

先测量、再优化；人类看得懂优先于花活。本文记录基线、做了什么、验证结果，
以及**没做什么、为什么**。

测量环境：Windows（仓库在 Desktop 下）、Python 3.14.3（CPython，msys2 构建）、
`python engine/build.py --offline --timing`。产物 152 个文件（37 篇文章）。

## 1. 基线（origin/staging）

| 场景 | 时间 |
|---|---|
| 冷构建（dist 不存在） | **48.2s** |
| 热构建（dist 已是最新） | **39.7s**（同样全删全写） |

分阶段（冷构建 `--timing`）：

| 阶段 | 时间 | 占比 |
|---|---|---|
| 文章（37 篇解析 + 渲染） | 5.5s | 11% |
| 写 HTML 产物（含 `clean_out`） | 16.5s | 34% |
| fonts/shell/head（含主题/头像复制 + 壳注入） | 26.5s | 55% |
| 其余（契约/manifest/search/llms/feed/…） | < 0.5s | — |

## 2. 根因：不是 Python 慢，是「删 + 写」被实时扫描拖住

同一份 152 文件的删除操作，实测：

| 位置 | 耗时 |
|---|---|
| 系统 temp 目录 | 0.39s |
| 仓库目录（Desktop 下） | **17.4s**（44 倍） |

Windows Defender 对仓库内文件的删除/写入做实时扫描；而**读内容比对只要 0.09s**。
原来的「先 `clean_out` 全删、再全写」每次构建都要付两遍扫描钱。
另：字体 stamp 的签名里含 `built_at`，导致每次构建都判定子集过期、重新子集化 + 全量复制。

## 3. 做了什么

1. **`Out` 产物收集器**（`engine/build.py`）：构建期只记账（`put_text` / `put_copy` /
   `put_copy_dir`），最后 `flush()` 一次落盘：
   - 删掉 dist 里**不在本次清单**的文件（孤儿，如上版本的旧文章）；
   - 文本内容与 dist 现有文件相同 → **跳过写**；
   - 复制按 `(size, mtime_ns)` 与 dist 现有文件相同 → **跳过复制**；
   - 逐项删除容忍失败（预览服务可能持有句柄）。
   `clean_out()` 保留给外部/调试用，常规构建不再调用。
2. **壳注入改为纯函数**：`inject_shell()` / `inject_head()` 直接读主题源
   `site/theme/index.html`、返回文本，不再读写 dist 里的副本
   （主题复制排除 `index.html`，否则会把注入后的版本盖回去）。
3. **字体 stamp 去掉 `built_at`**：签名只算站点内容，同样的内容不再触发重新子集化
   （`site_fonts_sig()` 改走 `site_text(manifest)`，不再含 `built_at`）。
4. **MathML memo**（`engine/render/mathml.py`）：`render()` 按 `(表达式, display)` 缓存
   latex2mathml 结果，进程内有效。351 次调用 → 286 个唯一串（命中 ~18%）。
   全命中时文章阶段 5.15s → 1.80s；站内公式去重越高收益越大。

## 4. 优化后

| 场景 | 时间 | 对比 |
|---|---|---|
| 冷构建 | **9.0s** | 48.2s → 9.0s（−81%） |
| 热构建 | **8.1s** | 39.7s → 8.1s（−80%） |
| 写 HTML 产物 | 0.27s（写 3 / 跳 148 / 孤儿 1） | 16.5s → 0.27s |
| fonts/shell/head | 1.55s | 26.5s → 1.55s |
| 单篇改动重建 | 落盘 8 个文件，其余 143 个跳过 | 原来 152 个全写 |

分阶段（热构建 `--timing`）：文章 5.29s（65.6%）/ fonts·shell·head 1.55s /
写 HTML 产物 0.27s / 其余 < 0.3s，合计 8.05s。
文章阶段现在是唯一大头，其中公式转换已缓存，剩余是 Markdown 子集解析。

## 5. 验证

- **dist 全量对比**：用固定 `BUILT_AT=2026-10-21T00:00:00+00:00` 在
  origin/staging 与本分支各构建一次，152 个文件 **sha1 逐字节一致**
  （`built_at` 本来就不该进内容签名）。
- 门禁全绿：`test_contracts` / `test_sml_include` / `test_render_safety` /
  `build` / `check` / `test_structure` / `smoke` / `series_tag` /
  `reading_controls` / `browser-check`（`gui_dom` 已随写作台归档）。

## 6. 没做的，与原因

| 项 | 原因 |
|---|---|
| **ProcessPool 并行文章渲染** | 预估收益 ~2.5s（37 篇均分非公式部分），但要跨进程传 `Report` 错误/告警、SML native 句柄，并保持 posts 顺序确定；复杂度与风险远大于 30% 总时长的收益。原则是「不为并行而并行、CPU 密集实测有收益才做」——本次实测不匹配，留档。 |
| **网络 IO 线程池（repo_meta/头像）** | 本次只测 `--offline`，联网抓取路径未实测。要先把联网基线测出来再决定，不做无测量的并行。 |
| **异步重写构建主流程** | 构建主流程没有可并发的网络 IO 密集段；为「异步」重写只会伤害可读性与可调试性。 |
| **PyPy** | 本机未安装，兼容性与收益都无法实测；按规则（收益 <20% 或不兼容就不切换）不切。 |
| **CPython JIT（3.13+ experimental）** | 本机 `sys._jit.is_available()` 为 `False`（msys2 构建未编入 JIT，需要 `--enable-experimental-jit` 专用构建），收益无法实测。不切换；即便将来测出收益，也只作可选实验，不进 CI 必需路径。 |
| **跨构建磁盘缓存（解析/渲染结果落盘）** | 与 `Out.flush` 的「跳过未变」收益重叠（热构建已 8s），且要设计 engine 版本/契约/summaries/resources 的失效键；当前更值的下一步是内容侧的公式去重（见 §3.4），不是缓存工程。 |

## 7. 复现

```bash
python engine/build.py --offline --timing     # 分阶段计时
# 单篇改动只重建变更文档：改任意一篇 → 重建 → 看「落盘：写入 8 / 跳过未变 143」
# 优化前后 dist 对比：固定 BUILT_AT 后两边各构建一次，逐文件 sha1
```
