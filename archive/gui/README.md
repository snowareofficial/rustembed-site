# 写作台（GUI）归档

**状态：已弃用，只读归档。** 归档日期：2026-10-28。

写作台是「Rust 启动器 + 内嵌 Web UI + Python 本地 API」的桌面写作客户端。
2026-10-28 起暂停维护，代码与文档整体移入本目录，仓库根不再有 `gui/`、
`Cargo.toml`，`engine/` 也不再带 `gui.py` / `gui_api.py`。

## 目录

```text
archive/gui/
├─ rust/                  Rust 启动器（原 gui/，含 assets/ 内嵌 UI、icons/）
├─ engine/                Python 本地 API（原 engine/gui.py、engine/gui_api.py）
├─ tests/                 gui_api_test.py / gui_dom_test.js
├─ workspace/             原仓库根 Cargo.toml / Cargo.lock（members=["gui"]）
└─ docs/
   ├─ GUI.md              用法与架构
   ├─ GUI-FLOWS.md        交互流程
   ├─ GUI-IMPLEMENT.md    实现约束（写作台红线）
   ├─ gui-mock/           视觉基准（HTML/PNG/CSS）
   └─ task/               原 docs/archive/gui/：M1–M3 任务书与交接
```

## 归档时的已知问题

- **`engine/gui_api.py` 含未完成改动**：`build_preview` 里对 `build._localize_assets`
  的调用是另一条任务的半成品，归档前没有验证过。恢复时先看 `docs/task/GUI-HANDOFF.md`，
  再决定保留还是回退。
- `gui_api.py` 的 `doc_files()` / `api_new()` 已按内容树约定（`posts/<年>/[系列/]<短名>/`）
  改过，但归档后不再随引擎演进。

## 恢复步骤

归档是按「原路径」摆放的，恢复 = 搬回去 + 补两处：

1. `git mv archive/gui/rust gui`；
2. `git mv archive/gui/engine/gui.py archive/gui/engine/gui_api.py engine/`；
3. `git mv archive/gui/tests/* tests/`；
4. `git mv archive/gui/docs/GUI*.md docs/`、`git mv archive/gui/docs/gui-mock docs/`；
5. 仓库根恢复 Rust workspace：`git mv archive/gui/workspace/Cargo.toml archive/gui/workspace/Cargo.lock .`；
6. 前端测试入口（`tests/theme-files.js` 等）与 `.gitignore` 的 `gui/target/`、`gui/gen/` 一并恢复。

注意 Rust 启动器把引擎路径写死为 `<仓库根>/engine/gui.py`（见 `rust/src/engine.rs`），
所以第 2 步不能省；`engine/gui.py` 自带的 `sys.path` 插入也依赖它和 `engine/` 同级。
