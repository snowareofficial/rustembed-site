//! 原生窗口（`--features desktop`，M3 落地 Tauri 系统 WebView）。
//!
//! 未启用该特性时本模块是空的，`main.rs` 会直接打开浏览器。
//! M3 会把这里换成 Tauri（Windows WebView2 / macOS WKWebView），不打包 Chromium；
//! 二进制体积与系统依赖都由该特性承担，默认 `cargo install` 仍是浏览器模式。

#[cfg(feature = "desktop")]
pub fn open_window(url: &str) {
    // M3：换成 tauri::Builder + WebviewWindowBuilder。
    // 现在先复用浏览器打开，保证带该特性编译时行为一致、不静默失败。
    if let Err(e) = open::that(url) {
        eprintln!("打开窗口失败（{}）；请手动访问 {}", e, url);
    }
}
