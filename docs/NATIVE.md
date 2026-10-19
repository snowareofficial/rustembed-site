# SML native 与 include（维护者）

面向维护者。作者只需要知道“写 Markdown / 数据条目”，不需要读这一页。

## 1. 两套后端

| 后端 | 实现 | 何时用 |
|---|---|---|
| `builtin` | `engine/lib/sml.py` 里的纯 Python 子集解析器 | 没有 native 库；普通内容 |
| `native` | Rust `swsml 0.6.4` → `sml.dll` / `libsml.so` / `libsml.dylib` | 需要 `include` / `import` / 完整 SML 能力 |

`engine/lib/_swsml.py` 是 vendored 的 ctypes 绑定；**不要就地改**，升级时以上游为准。

## 2. 库从哪里来

上游：

```text
Gitee   https://gitee.com/snoware/sml
GitHub  https://github.com/snowareofficial/sml
tag     v0.6.4
```

本机源码默认放在仓库同级：

```text
<repo>/../sml
```

产物：

| 平台 | 文件 |
|---|---|
| Windows | `sml.dll` |
| Linux | `libsml.so` |
| macOS | `libsml.dylib` |

`engine/native/` 默认被 `.gitignore`。当前特意入库的只有：

- `engine/native/libsml.dylib`：macOS arm64，CI `build-native-macos.yml` 构建；
- `engine/native/PROVENANCE.md`：来源、run id、SHA-256、许可。

Windows 本机 `sml.dll` 不入库；Linux `.so` 由 `include-native.yml` 在 CI 构建。

## 3. 本机编译

脚本：[`../engine/native_build.py`](../engine/native_build.py)

```bash
python engine/native_build.py --sml-src /path/to/sml
```

行为：

- 找 `rust/Cargo.toml`，跑 `cargo build --release -p swsml`；
- 通过 `cargo --message-format=json` 定位真实 target-dir（兼容被全局配置重定向到 D 盘）；
- 复制到 `engine/native/`；
- 加载并打印 `sml 0.6.4`；
- 默认不覆盖已有文件，内容不同要 `--force`。

```bash
--out-dir DIR   输出目录
--force         覆盖
--locked        cargo build --locked
--no-verify     不加载验证
--dry-run       只打印
```

需要 Rust/cargo；不要求 pip。

## 4. CI

| Workflow | 作用 |
|---|---|
| `.github/workflows/include-native.yml` | Ubuntu 构建 `libsml.so`，跑 include 回归；装不上就红 |
| `.github/workflows/build-native-macos.yml` | 手动构建 macOS arm64 `libsml.dylib`，上传 artifact |

CI 里 native 从 **SML v0.6.4 tag** 构建，不 patch 上游。  
发布站点时如果内容使用 include，`publish-pages` 必须先拿到 Linux native。

## 5. include 预处理

只有 `.sml` 且顶层有 `include` / `import` 才走：

```text
入口文件 + include 闭包
  → 剥掉 @contract/@is
  → 展平到系统临时目录（entry.sml + <hash>.sml）
  → 所有 include 改写成同级文件名
  → native load_file（只负责数据展开）
  → 契约由 bridge_contracts() 从原始文件收集，Python 校验
  → finally 删除临时目录
```

规则：

- 允许根 = `site/content`（`config.CONTENT`）；
- 目标必须在根内，绝对路径 / `..` 越界 / symlink 指外 → `E-INCLUDE-003`；
- 循环 → `E-INCLUDE-002`；缺文件 → `E-INCLUDE-001`，并尽量归因到 include 行；
- 深度 > 32 / 文件 > 64 → `E-INCLUDE-004`；
- 只支持 `include "路径"` / `include "路径" as ns`；glob / 正则 / 挑键 / 一行多目标 / 点分模块名 → 显式报错；
- 被包含文件里出现 `@is` → 明确报错（当前只校验入口的 `@is`）；
- 契约同名同字段静默去重；同名不同字段 → 报错（不使用语义不符的 E-CONTRACT-016）。

VS Code 扩展（JS）不带回子文件契约表，编辑器里可能误报；**以 `build` 为准**。

## 6. 安全与隐私

已扫描 `libsml.dylib`：

- 无 `sakeen` / `/Users/...` / `C:\Users\...`；
- 无 `gho_` / `ghp_` / `GITHUB_TOKEN` / `GITEE_TOKEN`；
- 无 `password` / `secret` / `PRIVATE KEY`；
- 只有 `parse_impl_tokens` 这类函数名含 `token`。

本地 Windows `sml.dll` 会包含：

```text
C:\Users\<用户名>\.rustup\toolchains\...
```

这是 Rust panic 路径里的用户名，不是密钥；该文件不入库。若要分发本机 DLL，先做：

```bash
RUSTFLAGS="--remap-path-prefix=$HOME=~" cargo build --release -p swsml
```

CI 的构建步骤没有注入 `secrets.*`；dylib 是从公开源码构建的公开产物。

复检：

```bash
strings engine/native/libsml.dylib | grep -Ei 'token|secret|password|gho_|ghp_|/Users/|sakeen'
```

## 7. 常见错误

| 错误 | 原因 / 处理 |
|---|---|
| `E-FEATURE-001` | 内容含 include，但没有 native；装库或删 include |
| `E-INCLUDE-001` | include 目标不存在；检查相对路径与大小写 |
| `E-INCLUDE-002` | 循环 include |
| `E-INCLUDE-003` | 越出 `site/content` 或绝对路径/symlink |
| `E-INCLUDE-004` | 嵌套/文件数超限 |
| `E-INCLUDE-012` | 不支持的 include 形态；改成单路径 |
| 构建过、编辑器红 | JS 扩展跨文件契约限制；以 build 为准 |
| macOS 加载失败 | 架构不匹配：arm64 dylib 不能给 Intel Mac |

## 8. 相关

- [`OPS.md`](OPS.md)：发布、密钥、回滚
- [`ARCHITECTURE.md`](ARCHITECTURE.md)：构建器与 include 细节
- [`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md)：数据维护
- [`../engine/README.md`](../engine/README.md)：文件职责
