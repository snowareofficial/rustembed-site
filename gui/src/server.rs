//! 本地 HTTP 服务：静态资源（内嵌）+ `/api/*` 反代到 Python 引擎。
//!
//! 浏览器只访问这一个端口，因此同源、无 CORS。`X-GUI-Token` 由本进程注入，
//! 页面与外界都拿不到，也不进 URL。

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::header::{ACCEPT, CONTENT_TYPE};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;

use crate::assets;

/// 反代目标前缀：`http://127.0.0.1:<python 端口>`
pub fn proxy_url(base: &str, path_and_query: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path_and_query)
}

pub struct AppState {
    /// Python 引擎地址，形如 `http://127.0.0.1:53421`
    pub python_base: String,
    /// 会话密钥：只存在于进程内存与请求头，绝不落盘、绝不进日志
    pub token: String,
    pub client: reqwest::Client,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/{*rest}", any(api_handler))
        .fallback(static_handler)
        .with_state(state)
}

/// 静态资源：路径先过 `assets::resolve` 白名单，取不到就 404。
async fn static_handler(uri: Uri) -> Response {
    match assets::resolve(uri.path()) {
        Some(name) => match assets::bytes(&name) {
            Some(body) => Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, assets::content_type(&name))
                .body(Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// 反代：方法、路径、查询串、请求体原样转发，注入 `X-GUI-Token`。
async fn api_handler(
    State(state): State<Arc<AppState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let path_and_query = uri
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or_else(|| uri.path());
    let target = proxy_url(&state.python_base, path_and_query);

    let mut req = state.client.request(method, &target);
    req = req.header("x-gui-token", &state.token);
    if let Some(v) = headers.get(CONTENT_TYPE) {
        req = req.header(CONTENT_TYPE, v.as_bytes());
    }
    if let Some(v) = headers.get(ACCEPT) {
        req = req.header(ACCEPT, v.as_bytes());
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
                .get(CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json; charset=utf-8")
                .to_string();
            match resp.bytes().await {
                Ok(b) => Response::builder()
                    .status(status)
                    .header(CONTENT_TYPE, ctype)
                    .body(Body::from(b))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
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
}
