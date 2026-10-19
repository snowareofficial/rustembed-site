# SML native / include 改造：决策与工作量

状态：**待办，不在群测前上线**  
目标：让 rec-blog 复用 SML Rust 参考实现的 include / namespace / `@contract` / `@is` 语义，而不是继续维护一套不一致的 Python 子集。

## 规范依据

SML 的规范就是教科书，不是“没定义”：

- `C:\Users\sakeen\Desktop\sml\site\content\zh\book\ch04-include.md` §4.4–4.7
  - 命名空间隔离契约/片段；
  - 外部引用必须 `ns.Contract`；
  - Rust/C/C++/Lua 解析前展开 include；JS 不带回子文件契约表；
  - include/namespace/implicit-ns 默认开启。
- `C:\Users\sakeen\Desktop\sml\site\content\zh\book\ch05-contract.md`
  - 契约类型、默认值、枚举、范围、组合。

## 现状

| 实现 | include | 跨文件契约 |
|---|---|---|
| Rust `sml.dll 0.6.4` | ✅ `load_file` | ✅ `@is ns.Resource` |
| VS Code 扩展（JS） | ✅ 导航 | ❌ 已知不带回子文件契约表 |
| rec-blog 引擎 | ❌ 内容入口拒绝 | ❌ `_strip_directives` 剥离 + 文本入口 |

rec-blog 的路径：

```text
load_doc() → parse_doc(text) → loads(text)    # 文本入口，不展开 include
_strip_directives() → 自己的 Python 契约层
_include_guard() → 内容含 include 直接报错
```

native 文件入口 `_native_load_doc()` 已经存在，但没有被调用。

## 决策

**复用 native，删掉自建的 include/契约语义。**

原则：

1. 语言语义以 Rust 参考实现 + 教科书为准；
2. rec-blog 只保留自己的**业务校验**（URL、日期、图片路径、附件规则）；
3. 不新增 SML 指令，不修改 vendored `_swsml.py` / `sml.dll`；
4. native 缺失时，旧内容仍可构建；含 include 的内容明确报错，不静默降级。

## 最大风险：类型系统不一致

Rust 契约：

```sml
url: url     # 被当作“url 契约”的块
```

rec-blog 契约：

```sml
url: url     # 内置标量，校验 http(s)
```

两条路：

- **A（推荐）**：native 契约用 `str`，rec-blog 在解析后做 URL/日期/路径校验；
- **B**：给 native 契约增加内置类型（语言级改动，另开任务）；
- **C**：保留 Python 契约层，只让 native 做 include 展开（需要拿到展开后的 AST/token，当前绑定不直接暴露）。

## 工作量

| 阶段 | 内容 | 人日 |
|---|---|---|
| 0 探针 | native `load_file` 验证 include/namespace/@is，确认返回值与错误 | 0.5–1 |
| 1 入口 | `load_doc` 接 native 文件入口；保留文本入口 | 1–2 |
| 2 契约 | 显式 `@is` 与 `site.sml` 默认映射的优先级；避免双重校验 | 1–2 |
| 3 类型 | `url/date/image` 与 native 类型映射/后校验 | 1–3 |
| 4 安全 | include 路径逃逸、循环、深度、错误码 | 0.5–1 |
| 5 测试 | fixture、错误场景、现有内容回归、产物对比 | 1–2 |
| 6 文档 | ARCHITECTURE / AGENTS / 迁移说明 | 0.5 |
| **合计** |  | **5.5–11.5** |

参考：

- 只做探针 + 结论：0.5–1 天；
- MVP（include + namespace 能跑，类型先用 str）：2–3 天；
- 生产可用（类型/安全/回归/文档）：**1–2 周**；
- VS Code JS 扩展另算：3–5 天（不推荐用 companion 扩展，因为它消不掉原扩展红字）。

## 上线建议

**群测前不要做这个改造。**

- 现在：模板不写 `@is`、不写 include；靠目录默认映射，0 风险；
- 群测后：先做 0.5 天探针，确认 native 能拿到什么；
- 有真实投稿需求：再做 2–3 天 MVP；
- 稳定后再补类型/安全/扩展。

## 验收（改造时）

1. 新 fixture：
   - `include "contracts/blog.sml" as blog` + `@is blog.Resource` 通过；
   - 未知契约、缺文件、循环 include、重复契约、越界路径各自报错；
2. 现有：
   - `build --offline`、`check`、`test_contracts`、`test_render_safety`、`test_structure`、`smoke` 全绿；
   - 现有 4 篇文章/页面/成员/项目/互助数量与 URL 不变；
   - URL/日期/图片/附件校验仍有测试。
3. 错误必须带文件名 + 行号 + 错误码；
4. native 缺失时旧内容可构建，include 内容给出可操作错误。

## 相关

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md)
- [`REPO-LAYOUT.md`](REPO-LAYOUT.md)
