# native 预编译产物

本目录通常被 `.gitignore` 忽略；下面这份是**特意入库**的 macOS arm64 版本。

| 项 | 值 |
|---|---|
| 文件 | `libsml.dylib` |
| 平台 | macOS arm64（Apple Silicon） |
| 架构 | Mach-O 64-bit arm64 |
| 上游 | SML `v0.6.4`，`cargo build --release -p swsml` |
| GitHub Actions | run `39301294043`（`build-native-macos.yml`） |
| SHA-256 | `c5608fbecd35c66d1f0f99c21223fb460a775de0ae6a019823e2b5170d566ec6` |
| 许可 | MulanPSL-2.0（随 SML 上游） |

用途：让 macOS arm64 上的 `include` 走 native 文件入口；其他平台继续用各自的 `.dll` / `.so` 或 builtin 回退。

## 更新方式

```bash
gh workflow run build-native-macos.yml --repo snowareofficial/rustembed-site
gh run download <run-id> --repo snowareofficial/rustembed-site -n sml-native-macos-arm64
git add -f engine/native/libsml.dylib
```
