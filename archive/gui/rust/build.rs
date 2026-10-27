fn main() {
    // 只有 desktop 特性才需要 Tauri 的构建期上下文（tauri.conf.json）。
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
