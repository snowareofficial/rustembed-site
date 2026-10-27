//! 原生窗口（`--features desktop`，Tauri 系统 WebView）。
//!
//! Windows 用 WebView2、macOS 用 WKWebView，都不打包 Chromium；
//! 二进制体积与系统依赖都由该特性承担，默认 `cargo install` 仍是浏览器模式。
//!
//! 窗口指向本地 axum 服务（`http://127.0.0.1:<port>`），API 与静态资源仍走
//! `server.rs`，这里只负责「用系统 WebView 打开」这一件事。

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 打开原生窗口并阻塞到窗口关闭。
pub fn open_window(url: &str) -> anyhow::Result<()> {
    let parsed: url::Url = url
        .parse()
        .map_err(|e| anyhow::anyhow!("地址解析失败（{}）：{}", url, e))?;
    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("rec-blog 写作台")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("Tauri 运行失败：{}", e))
}
