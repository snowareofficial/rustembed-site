---
title: "SML native 与 include（维护者）"
group: 规范
order: 5
---

这是维护者文档。普通作者不需要读；写文章、加数据条目仍然不需要 native。

## 两套后端

| 后端 | 用途 |
|---|---|
| builtin | 纯 Python 子集；没有 native 时的回退 |
| native | Rust `swsml 0.6.4`，支持 include / import / 完整 SML |

native 文件：

```text
Windows  sml.dll
Linux    libsml.so
macOS    libsml.dylib
```

默认放在 `engine/native/`，被 `.gitignore` 忽略。仓库里特意入库的只有 macOS arm64 的 `libsml.dylib` 和它的 `PROVENANCE.md`。

## 上游来源

```text
Gitee   https://gitee.com/snoware/sml
GitHub  https://github.com/snowareofficial/sml
tag     v0.6.4
```

CI 从 v0.6.4 构建，不 patch 上游。

## 本机编译

```bash
python engine/tools/native_build.py --sml-src /path/to/sml
```

脚本会跑 `cargo build --release -p swsml`，找到真实 target-dir，复制到 `engine/native/`，再加载验证版本。

常用参数：

```bash
--force       覆盖已有库
--locked      cargo build --locked
--out-dir     输出目录
--dry-run     只打印命令
```

需要 Rust/cargo；不需要 pip。

## include 预处理

只有 `.sml` 且顶层有 `include` / `import` 才走：

1. 从原始文件收集整个 include 闭包；
2. 剥掉 `@contract` / `@is`；
3. 展平到系统临时目录，把 include 改写成同级文件名；
4. native 只展开数据；
5. 契约由 Python 侧从原始文件收集并校验；
6. 删除临时目录。

允许 include 的范围是 `site/content`。越界、绝对路径、symlink 指外都会被拒绝。

支持：

```sml
include "contracts/blog.sml" as blog
@is blog.Resource
```

不支持（会明确报错）：

- glob / 正则；
- 挑键 `{a,b}`；
- 一行多个目标；
- 点分模块名；
- 被包含文件里自带 `@is`。

## 安全

构建机不会把 `secrets.*` 注入 native 编译步骤。已扫描 macOS dylib：没有令牌、密码、私钥或本机用户名。

本地 Windows DLL 可能包含：

```text
C:\Users\<用户名>\.rustup\...
```

这是 Rust panic 路径里的用户名，不是密钥；该 DLL 不入库。要分发本机 DLL，先做路径重映射。

## 常见错误

| 错误 | 处理 |
|---|---|
| `E-FEATURE-001` | 有 include 但没 native；装库或删 include |
| `E-INCLUDE-001` | 目标不存在 |
| `E-INCLUDE-002` | 循环 include |
| `E-INCLUDE-003` | 越出允许根 / 绝对路径 |
| `E-INCLUDE-012` | 不支持的 include 形态 |

VS Code 扩展（JS）不带回子文件契约表，编辑器里可能误报；以 `build` / `check` 为准。

完整说明见仓库 `docs/NATIVE.md`。
