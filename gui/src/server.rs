//! 本地 HTTP 服务：静态资源（内嵌）+ 登录态接口 + `/api/*` 反代到 Python 引擎。
//!
//! 浏览器只访问这一个端口，因此同源、无 CORS。`X-GUI-Token` 由本进程注入，
//! 页面与外界都拿不到，也不进 URL。
//!
//! 令牌纪律（M3）：
//! - `/api/session`、`/api/whoami`、`/api/purge`、`/api/recent`、`/api/about` 由本进程直接处理
//!   （钥匙串与内存态只存在于这里，不过 Python）；
//! - 其余 `/api/*` 反代到 Python；**只有** `/api/pr`、`/api/delete`、`/api/rename`
//!   注入 `X-Gitee-Token`（来自当前登录态），其余接口不注入；
//! - Gitee 令牌不落盘、不进日志（错误文本先过 `redact`）、不进 URL。

use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::assets;
use crate::session::{self, PurgeItem, Session, TokenStore};

/// 反代目标前缀：`http://127.0.0.1:<python 端口>`
pub fn proxy_url(base: &str, path_and_query: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path_and_query)
}

/// 哪些反代路径需要携带 Gitee 令牌（写操作三件套）。
/// 纯函数，便于单测；新增写接口时在这里加一行。
pub fn needs_gitee_token(path: &str) -> bool {
    matches!(path, "/api/pr" | "/api/delete" | "/api/rename")
}

/// 百分号解码（反代 `/api/doc?path=` 记最近文件用；路径都是 ASCII，够用即可）。
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 从查询串里取 `path=`（记最近文件）。
fn query_path(query: Option<&str>) -> String {
    let q = query.unwrap_or("");
    for part in q.split('&') {
        if let Some(v) = part.strip_prefix("path=") {
            return percent_decode(v);
        }
    }
    String::new()
}

pub struct AppState {
    /// Python 引擎地址，形如 `http://127.0.0.1:53421`
    pub python_base: String,
    /// 会话密钥：只存在于进程内存与请求头，绝不落盘、绝不进日志
    pub token: String,
    pub client: reqwest::Client,
    /// 登录态（含 Gitee 令牌的内存副本）
    pub session: Mutex<Session>,
    /// 令牌存放处：系统钥匙串；不可用时调用方会传入降级实现
    pub store: Box<dyn session::TokenStore>,
    /// 引擎 commit（`/api/about` 展示）
    pub engine_commit: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/session", post(login).delete(logout))
        .route("/api/whoami", get(whoami))
        .route("/api/purge", post(purge))
        .route("/api/recent", get(recent_list))
        .route("/api/about", get(about))
        .route("/api/{*rest}", any(api_handler))
        .fallback(static_handler)
        .with_state(state)
}

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({"ok": false, "error": msg}))).into_response()
}

fn ok_json(value: serde_json::Value) -> Response {
    Json(value).into_response()
}

/// 静态资源：路径先过 `assets::resolve` 白名单，取不到就 404。
async fn static_handler(uri: Uri) -> Response {
    match assets::resolve(uri.path()) {
        Some(name) => match assets::bytes(&name) {
            Some(body) => Response::builder()
                .status(StatusCode::OK)
                .header(
                    axum::http::header::CONTENT_TYPE,
                    assets::content_type(&name),
                )
                .body(axum::body::Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// 反代：方法、路径、查询串、请求体原样转发，注入 `X-GUI-Token`；
/// 写操作三件套额外注入 `X-Gitee-Token`（未登录则不注入，由 Python 返回 401）。
async fn api_handler(
    State(state): State<Arc<AppState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let path_and_query = uri
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or_else(|| uri.path());
    let path = uri.path().to_string();
    let target = proxy_url(&state.python_base, path_and_query);

    // 最近文件：打开文档时记一笔（只存路径，不存令牌）
    if method == Method::GET && path == "/api/doc" {
        let rel = query_path(uri.query());
        if !rel.is_empty() {
            session::record_recent(&rel);
        }
    }

    let mut req = state.client.request(method, &target);
    req = req.header("x-gui-token", &state.token);
    if needs_gitee_token(&path) {
        let gitee = {
            let g = state.session.lock().unwrap_or_else(|e| e.into_inner());
            g.token.clone()
        };
        if let Some(t) = gitee {
            req = req.header("x-gitee-token", &t);
        }
    }
    if let Some(v) = headers.get(axum::http::header::CONTENT_TYPE) {
        req = req.header(axum::http::header::CONTENT_TYPE, v.as_bytes());
    }
    if let Some(v) = headers.get(axum::http::header::ACCEPT) {
        req = req.header(axum::http::header::ACCEPT, v.as_bytes());
    }
    if !body.is_empty() {
        req = req.body(body.to_vec());
    }

    match req.send().await {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let ctype = resp
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json; charset=utf-8")
                .to_string();
            match resp.bytes().await {
                Ok(b) => Response::builder()
                    .status(status)
                    .header(axum::http::header::CONTENT_TYPE, ctype)
                    .body(axum::body::Body::from(b))
                    .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()),
                Err(e) => {
                    (StatusCode::BAD_GATEWAY, format!("引擎响应读取失败：{}", e)).into_response()
                }
            }
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("无法连接引擎（{}）：{}", target, e),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------- 登录态接口

#[derive(Deserialize)]
struct LoginBody {
    token: String,
    #[serde(default)]
    remember: bool,
}

/// POST /api/session {token, remember}
/// - 先调 Gitee `GET /api/v5/user` 验证；失败 401，不保存；
/// - remember=true → 写系统钥匙串；失败 → 明确提示并降级仅内存（**不回退文件**）；
/// - remember=false → 只放进程内存。
async fn login(State(state): State<Arc<AppState>>, Json(body): Json<LoginBody>) -> Response {
    let token = body.token.trim().to_string();
    if token.is_empty() {
        return err(StatusCode::BAD_REQUEST, "令牌不能为空");
    }
    let id = match session::gitee_user(&state.client, &token).await {
        Ok(id) => id,
        Err(e) => return err(StatusCode::UNAUTHORIZED, &e),
    };

    let mut note = String::new();
    let mut stored = "memory";
    if body.remember {
        match state.store.set(&token) {
            Ok(()) => stored = "keyring",
            Err(e) => {
                note = format!(
                    "钥匙串不可用（{}），已降级为仅本次会话；令牌没有写进任何文件。",
                    e
                );
            }
        }
    }

    {
        let mut g = state.session.lock().unwrap_or_else(|e| e.into_inner());
        g.token = Some(token);
        g.identity = Some(id.clone());
        g.remembered = stored == "keyring";
        g.keyring_ok = stored == "keyring";
    }
    let location = if stored == "keyring" {
        state.store.location().to_string()
    } else {
        session::MemoryStore::default().location().to_string()
    };
    ok_json(json!({
        "ok": true,
        "login": id.login,
        "name": id.name,
        "avatar_url": id.avatar_url,
        "stored": stored,
        "location": location,
        "note": note,
    }))
}

/// GET /api/whoami：未登录 401；钥匙串恢复的令牌惰性验证一次。
async fn whoami(State(state): State<Arc<AppState>>) -> Response {
    let snapshot = {
        let g = state.session.lock().unwrap_or_else(|e| e.into_inner());
        (
            g.token.clone(),
            g.identity.clone(),
            g.remembered,
            g.logged_in(),
        )
    };
    if !snapshot.3 {
        return err(StatusCode::UNAUTHORIZED, "未登录");
    }
    if let Some(id) = snapshot.1 {
        return ok_json(json!({
            "ok": true, "login": id.login, "name": id.name,
            "avatar_url": id.avatar_url, "remembered": snapshot.2,
            "location": state.store.location(),
        }));
    }
    if let Some(t) = snapshot.0 {
        // 重启后从钥匙串恢复的令牌：验证一次拿到身份；过期就明说
        match session::gitee_user(&state.client, &t).await {
            Ok(id) => {
                {
                    let mut g = state.session.lock().unwrap_or_else(|e| e.into_inner());
                    g.identity = Some(id.clone());
                }
                return ok_json(json!({
                    "ok": true, "login": id.login, "name": id.name,
                    "avatar_url": id.avatar_url, "remembered": snapshot.2,
                    "location": state.store.location(),
                }));
            }
            Err(e) => return err(StatusCode::UNAUTHORIZED, &format!("{}；请重新登录", e)),
        }
    }
    err(StatusCode::UNAUTHORIZED, "未登录")
}

#[derive(Deserialize)]
struct PurgeQuery {
    #[serde(default)]
    purge: bool,
}

/// DELETE /api/session[?purge=true]：清内存；purge=true 才删钥匙串条目。
async fn logout(State(state): State<Arc<AppState>>, Query(q): Query<PurgeQuery>) -> Response {
    let had = {
        let mut g = state.session.lock().unwrap_or_else(|e| e.into_inner());
        let had = g.token.take().is_some();
        g.identity = None;
        g.remembered = false;
        had
    };
    let mut keyring_cleared = false;
    let mut keyring_error = String::new();
    if q.purge {
        match state.store.delete() {
            Ok(()) => keyring_cleared = true,
            Err(e) => keyring_error = e,
        }
    }
    ok_json(json!({
        "ok": true,
        "logged_out": had,
        "keyring_cleared": keyring_cleared,
        "keyring_error": keyring_error,
        "note": if q.purge {
            "已按请求清除钥匙串条目。"
        } else {
            "只清了内存；钥匙串条目保留（登出并清除请带 purge=true）。"
        },
    }))
}

/// POST /api/purge：按勾选项清理本地痕迹，返回 [{item, ok, detail}]。
/// 请求体可选：`{"items":["keyring","memory","recent","cache"]}`；不带 / 空 = 全部。
async fn purge(State(state): State<Arc<AppState>>, body: axum::body::Bytes) -> Response {
    let want: Vec<String> = if body.is_empty() {
        Vec::new()
    } else {
        match serde_json::from_slice::<serde_json::Value>(&body) {
            Ok(v) => v
                .get("items")
                .and_then(|i| i.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };
    let refs: Vec<&str> = want.iter().map(|s| s.as_str()).collect();
    let items: Vec<PurgeItem> = session::purge_local(state.store.as_ref(), &state.session, &refs);
    ok_json(json!({
        "ok": items.iter().all(|i| i.ok),
        "items": items.iter().map(|i| json!({
            "item": i.item, "ok": i.ok, "detail": i.detail
        })).collect::<Vec<_>>(),
        "note": "git 自身保存的凭证不在本 App 管辖范围。",
    }))
}

/// GET /api/recent：最近文件（只存路径）。
async fn recent_list() -> Response {
    ok_json(json!({"ok": true, "recent": session::read_recent()}))
}

/// GET /api/about：版本 / 引擎 commit / 桌面特性（设置页「关于」用）。
async fn about(State(state): State<Arc<AppState>>) -> Response {
    ok_json(json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "engine_commit": state.engine_commit,
        "desktop_feature": cfg!(feature = "desktop"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 反代地址拼接() {
        assert_eq!(
            proxy_url("http://127.0.0.1:1234", "/api/tree?type=post"),
            "http://127.0.0.1:1234/api/tree?type=post"
        );
        assert_eq!(
            proxy_url("http://127.0.0.1:1234/", "/api/doc"),
            "http://127.0.0.1:1234/api/doc"
        );
    }

    #[test]
    fn 写操作三件套才注入gitee令牌() {
        for yes in ["/api/pr", "/api/delete", "/api/rename"] {
            assert!(needs_gitee_token(yes), "{} 应注入", yes);
        }
        for no in [
            "/api/types",
            "/api/tree",
            "/api/doc",
            "/api/status",
            "/api/resources",
            "/api/validate",
            "/api/preview",
            "/api/new",
            "/api/asset",
            "/api/session",
            "/api/whoami",
            "/api/purge",
            "/api/recent",
            "/api/about",
        ] {
            assert!(!needs_gitee_token(no), "{} 不应注入", no);
        }
    }

    #[test]
    fn 查询串里取path并解码() {
        assert_eq!(
            query_path(Some("path=content/posts/2026/a/index.md")),
            "content/posts/2026/a/index.md"
        );
        assert_eq!(
            query_path(Some("path=content%2Fposts%2F2026%2Fa%2Findex.md")),
            "content/posts/2026/a/index.md"
        );
        assert_eq!(query_path(Some("type=post")), "");
        assert_eq!(query_path(None), "");
    }

    #[test]
    fn 百分号解码边界() {
        assert_eq!(percent_decode("%2F"), "/");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("abc"), "abc");
        assert_eq!(percent_decode("%zz"), "%zz"); // 非法十六进制原样留下
        assert_eq!(percent_decode("%2"), "%2"); // 截断的转义原样留下
    }
}
