//! 内嵌 Web UI（`gui/assets`，构建期打进二进制）。
//!
//! Rust 不写界面：这里只负责按路径取出静态字节并猜 MIME。
//! 路径一律先过白名单，杜绝 `..` / 反斜杠 / 盘符等逃逸。

use include_dir::{include_dir, Dir};

pub static ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/assets");

/// 请求路径 → 资源名（纯映射，不查文件是否存在；便于单测）。
pub fn route_name(request: &str) -> Option<String> {
    let raw = request.split(['?', '#']).next().unwrap_or("");
    let raw = raw.trim_start_matches('/');
    let name = match raw {
        "" | "index" | "index.html" => "index.html",
        "login" => "login.html",
        "settings" => "settings.html",
        other => other,
    };
    if is_safe(name) {
        Some(name.to_string())
    } else {
        None
    }
}

/// 请求路径 → 实际存在的资源名；不安全或不存在返回 None。
pub fn resolve(request: &str) -> Option<String> {
    let name = route_name(request)?;
    if ASSETS.get_file(&name).is_some() {
        Some(name)
    } else {
        None
    }
}

/// 资源名白名单：只允许 `[A-Za-z0-9._-]` 的若干层路径段。
fn is_safe(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    if name.contains('\\') || name.contains('\0') || name.contains('%') {
        return false;
    }
    for seg in name.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return false;
        }
        if !seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        {
            return false;
        }
    }
    true
}

/// 取出资源字节。
pub fn bytes(name: &str) -> Option<&'static [u8]> {
    ASSETS.get_file(name).map(|f| f.contents())
}

/// MIME（只覆盖写作台自己会用到的几种）。
pub fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 根路径落到首页() {
        assert_eq!(route_name("/").as_deref(), Some("index.html"));
        assert_eq!(route_name("").as_deref(), Some("index.html"));
        assert_eq!(route_name("/index").as_deref(), Some("index.html"));
        // 首页一定存在（内嵌资源的一部分）
        assert_eq!(resolve("/").as_deref(), Some("index.html"));
    }

    #[test]
    fn 页面别名带查询串也能认() {
        assert_eq!(route_name("/login?back=/").as_deref(), Some("login.html"));
        assert_eq!(route_name("/settings#a").as_deref(), Some("settings.html"));
        assert_eq!(route_name("/app.js").as_deref(), Some("app.js"));
    }

    #[test]
    fn 逃逸路径全部拒绝() {
        for bad in [
            "/../AGENTS.md",
            "/../../etc/passwd",
            "/%2e%2e/secret",
            "/C:/Windows/win.ini",
            "/..\\engine",
            "/a/../../b",
            "/./index.html",
        ] {
            assert_eq!(resolve(bad), None, "{} 应当被拒绝", bad);
        }
    }

    #[test]
    fn 不存在的资源返回空() {
        assert_eq!(resolve("/nope.html"), None);
    }
}
