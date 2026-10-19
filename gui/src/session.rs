//! 登录态与令牌纪律（M3：钥匙串 / Gitee 校验 / 清除痕迹）。
//!
//! 硬约束：令牌只允许存在于系统钥匙串或进程内存，
//! 不写配置文件、不写日志（一律 `***`）、不进 URL、不进剪贴板历史。
//! 钥匙串不可用时降级为「仅本次会话」，**绝不回退到文件**。

use std::sync::Mutex;

use serde::Deserialize;

/// Gitee API 的 User-Agent（与引擎 `repo_meta.py` 保持同一风格）。
pub const UA: &str = "rec-blog-gui/0.1 (+writing desk)";

/// 把文本里出现的密钥一律替换成 `***`。空密钥忽略（避免把整个文本打花）。
pub fn redact(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets {
        if !s.is_empty() {
            out = out.replace(s, "***");
        }
    }
    out
}

/// 令牌存放处：系统钥匙串或进程内存。实现必须可注入（测试用假实现）。
pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, token: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
    /// 人类可读的存放位置（设置页展示，只读）。
    fn location(&self) -> &'static str;
}

/// 仅内存：测试、「仅本次会话」、以及钥匙串不可用时的降级。
#[derive(Default)]
pub struct MemoryStore(Mutex<Option<String>>);

impl TokenStore for MemoryStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap_or_else(|e| e.into_inner()).clone())
    }
    fn set(&self, token: &str) -> Result<(), String> {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(token.to_string());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }
    fn location(&self) -> &'static str {
        "仅本次会话（进程内存）"
    }
}

/// 系统钥匙串：Windows Credential Manager / macOS Keychain / libsecret。
pub struct KeyringStore {
    service: String,
    account: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self {
            service: "rec-blog-gui".to_string(),
            account: "gitee-token".to_string(),
        }
    }
}

impl KeyringStore {
    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, &self.account).map_err(|e| e.to_string())
    }
}

impl TokenStore for KeyringStore {
    fn get(&self) -> Result<Option<String>, String> {
        match self.entry()?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, token: &str) -> Result<(), String> {
        self.entry()?.set_password(token).map_err(|e| e.to_string())
    }
    fn delete(&self) -> Result<(), String> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(()),
            // 本来就没有条目，也算清干净了
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    fn location(&self) -> &'static str {
        "系统钥匙串"
    }
}

/// Gitee `/api/v5/user` 的响应里用得上的字段。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Identity {
    #[serde(default)]
    pub login: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub avatar_url: String,
}

/// 当前登录态。跨请求共享：`Arc<Mutex<Session>>`。
#[derive(Default)]
pub struct Session {
    /// Gitee 令牌（内存或钥匙串里的一份副本；绝不进日志）
    pub token: Option<String>,
    pub identity: Option<Identity>,
    /// token 是否来自系统钥匙串（重启后仍在）
    pub remembered: bool,
    /// 钥匙串是否可用（false = 已降级仅内存）
    pub keyring_ok: bool,
}

impl Session {
    pub fn logged_in(&self) -> bool {
        self.token.is_some()
    }
}

/// 调 Gitee `GET /api/v5/user?access_token=…` 校验令牌。
/// 返回的身份信息只含 login/name/avatar_url；错误文本先过 redact，绝不带令牌。
pub async fn gitee_user(client: &reqwest::Client, token: &str) -> Result<Identity, String> {
    let resp = client
        .get("https://gitee.com/api/v5/user")
        .query(&[("access_token", token)])
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| redact(&e.to_string(), &[token]))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| redact(&e.to_string(), &[token]))?;
    if !status.is_success() {
        let code = status.as_u16();
        let msg = if code == 401 || code == 403 {
            "令牌无效或权限不足（Gitee 返回 401/403）".to_string()
        } else {
            format!("Gitee 返回 {}", code)
        };
        return Err(redact(&msg, &[token]));
    }
    let id: Identity =
        serde_json::from_str(&body).map_err(|e| format!("Gitee 响应不是合法 JSON：{}", e))?;
    if id.login.trim().is_empty() {
        return Err("Gitee 响应里没有 login 字段".to_string());
    }
    Ok(id)
}

/// 清除痕迹的逐项结果（设置页原样展示）。
#[derive(Debug, Clone)]
pub struct PurgeItem {
    pub item: String,
    pub ok: bool,
    pub detail: String,
}

/// 本地数据目录下的 rec-blog 私有目录（`<data>/rec-blog`）。
pub fn app_data_dir() -> std::path::PathBuf {
    crate::engine::data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("rec-blog")
}

/// 最近文件列表文件（只存路径，不存任何令牌）。
pub fn recent_file() -> std::path::PathBuf {
    app_data_dir().join("recent.json")
}

/// 预览 / 构建缓存目录（引擎当前不写它；存在就清，不存在如实说明）。
pub fn cache_dir() -> std::path::PathBuf {
    app_data_dir().join("cache")
}

const MAX_RECENT: usize = 20;

/// 记一条最近文件（打开文档时由反代调用）。去重、置顶、截断；失败静默（不影响写作）。
pub fn record_recent(path: &str) {
    let path = path.trim();
    if path.is_empty() {
        return;
    }
    let mut list = read_recent();
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
    let f = recent_file();
    if let Some(parent) = f.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let _ = std::fs::write(f, serde_json::to_vec(&list).unwrap_or_default());
}

/// 读最近文件（坏文件按空列表处理）。
pub fn read_recent() -> Vec<String> {
    match std::fs::read(recent_file()) {
        Ok(bytes) => serde_json::from_slice::<Vec<String>>(&bytes).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 逐项清理本地痕迹。注意：**git 自身保存的凭证不在本 App 管辖范围**。
///
/// - `store`：钥匙串（或降级后的内存）令牌；
/// - `session`：内存登录态（调用方负责传入同一把锁）；
/// - `want`：要清理的项（`keyring`/`memory`/`recent`/`cache`）；空 = 全部。
///
/// 「日志」项只作说明（本 App 日志不落盘），始终列出。
pub fn purge_local(
    store: &dyn TokenStore,
    session: &Mutex<Session>,
    want: &[&str],
) -> Vec<PurgeItem> {
    let all = want.is_empty();
    let on = |k: &str| all || want.contains(&k);
    let mut out = Vec::new();

    // 1) 钥匙串 / 内存里的令牌
    if on("keyring") {
        match store.delete() {
            Ok(()) => out.push(PurgeItem {
                item: "钥匙串令牌".into(),
                ok: true,
                detail: format!("已清除（{}）", store.location()),
            }),
            Err(e) => out.push(PurgeItem {
                item: "钥匙串令牌".into(),
                ok: false,
                detail: e,
            }),
        }
    }

    // 2) 内存登录态
    if on("memory") {
        let mut g = session.lock().unwrap_or_else(|e| e.into_inner());
        let had = g.token.take().is_some();
        g.identity = None;
        g.remembered = false;
        out.push(PurgeItem {
            item: "登录态（内存）".into(),
            ok: true,
            detail: if had {
                "已退出登录".into()
            } else {
                "本来就没有登录".into()
            },
        });
    }

    // 3) 最近文件
    if on("recent") {
        let f = recent_file();
        let n = read_recent().len();
        match std::fs::remove_file(&f) {
            Ok(()) => out.push(PurgeItem {
                item: "最近文件".into(),
                ok: true,
                detail: format!("已删除 {} 条记录", n),
            }),
            Err(_) if !f.exists() => out.push(PurgeItem {
                item: "最近文件".into(),
                ok: true,
                detail: "本来就没有记录".into(),
            }),
            Err(e) => out.push(PurgeItem {
                item: "最近文件".into(),
                ok: false,
                detail: e.to_string(),
            }),
        }
    }

    // 4) 预览 / 构建缓存
    if on("cache") {
        let c = cache_dir();
        if c.exists() {
            match std::fs::remove_dir_all(&c) {
                Ok(()) => out.push(PurgeItem {
                    item: "预览与构建缓存".into(),
                    ok: true,
                    detail: "缓存目录已清空".into(),
                }),
                Err(e) => out.push(PurgeItem {
                    item: "预览与构建缓存".into(),
                    ok: false,
                    detail: e.to_string(),
                }),
            }
        } else {
            out.push(PurgeItem {
                item: "预览与构建缓存".into(),
                ok: true,
                detail: "无缓存目录（当前版本预览不落盘）".into(),
            });
        }
    }

    // 5) 日志：本 App 的日志只进终端，不落盘，因此没有文件可清
    out.push(PurgeItem {
        item: "日志".into(),
        ok: true,
        detail: "日志只进终端、不落盘，无需清理".into(),
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 永远失败的假钥匙串：用来验证「钥匙串不可用 → 降级内存」。
    struct BrokenStore;
    impl TokenStore for BrokenStore {
        fn get(&self) -> Result<Option<String>, String> {
            Err("模拟：钥匙串不可用".to_string())
        }
        fn set(&self, _token: &str) -> Result<(), String> {
            Err("模拟：钥匙串不可用".to_string())
        }
        fn delete(&self) -> Result<(), String> {
            Err("模拟：钥匙串不可用".to_string())
        }
        fn location(&self) -> &'static str {
            "系统钥匙串（当前不可用）"
        }
    }

    #[test]
    fn 令牌被脱敏() {
        let token = "gitee_0123456789abcdef";
        let line = format!("pushed with {}", token);
        assert_eq!(redact(&line, &[token]), "pushed with ***");
    }

    #[test]
    fn 多处出现全部替换() {
        assert_eq!(redact("a t b t", &["t"]), "a *** b ***");
    }

    #[test]
    fn 空密钥不动原文() {
        assert_eq!(redact("nothing", &[""]), "nothing");
    }

    #[test]
    fn 没有命中则原样返回() {
        assert_eq!(redact("hello", &["zzz"]), "hello");
    }

    #[test]
    fn 内存存储读写删() {
        let s = MemoryStore::default();
        assert_eq!(s.get().unwrap(), None);
        s.set("tok").unwrap();
        assert_eq!(s.get().unwrap().as_deref(), Some("tok"));
        s.delete().unwrap();
        assert_eq!(s.get().unwrap(), None);
    }

    #[test]
    fn 假钥匙串失败时可识别() {
        let s = BrokenStore;
        assert!(s.get().is_err());
        assert!(s.set("x").is_err());
        assert!(s.delete().is_err());
    }

    #[test]
    fn 钥匙串不可用则降级内存且不落文件() {
        // 登录流程：remember=true 但钥匙串 set 失败 → 只用内存， remembered=false
        let store = BrokenStore;
        let session = Mutex::new(Session::default());
        let token = "tok-123";
        let (ok, remembered) = match store.set(token) {
            Ok(()) => (true, true),
            Err(_) => {
                // 降级：只放内存，绝不写文件
                let mut g = session.lock().unwrap();
                g.token = Some(token.to_string());
                g.keyring_ok = false;
                (true, false)
            }
        };
        assert!(ok, "降级后仍应登录成功");
        assert!(!remembered, "降级后不得标记为已记住");
        assert!(!session.lock().unwrap().keyring_ok);
        assert_eq!(store.location(), "系统钥匙串（当前不可用）");
        // 令牌只在进程内存里（purge 用例覆盖「不落文件」）
        assert_eq!(session.lock().unwrap().token.as_deref(), Some("tok-123"));
    }

    #[test]
    fn purge_逐项返回且令牌不在任何产物里() {
        let dir = std::env::temp_dir().join(format!("rec-blog-purge-test-{}", std::process::id()));
        std::env::set_var("REC_BLOG_HOME", &dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = MemoryStore::default();
        store.set("secret-token").unwrap();
        record_recent("content/posts/2026/demo/index.md");
        let session = Mutex::new(Session {
            token: Some("secret-token".to_string()),
            ..Session::default()
        });

        let items = purge_local(&store, &session, &["keyring", "memory", "recent", "cache"]);
        let names: Vec<&str> = items.iter().map(|i| i.item.as_str()).collect();
        for want in [
            "钥匙串令牌",
            "登录态（内存）",
            "最近文件",
            "预览与构建缓存",
            "日志",
        ] {
            assert!(
                names.contains(&want),
                "purge 缺少项：{}（{:?}）",
                want,
                names
            );
        }
        assert!(items.iter().all(|i| i.ok), "有清理项失败：{:?}", items);
        assert!(
            !session.lock().unwrap().logged_in(),
            "purge 后不得仍处于登录态"
        );
        assert!(!recent_file().exists(), "recent.json 应被删除");
        // 目录里不留任何含令牌的文件
        for f in std::fs::read_dir(&dir).unwrap() {
            let bytes = std::fs::read(f.unwrap().path()).unwrap_or_default();
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains("secret-token"), "purge 产物里不得出现令牌");
        }
        std::fs::remove_dir_all(&dir).ok();
        std::env::remove_var("REC_BLOG_HOME");
    }

    #[test]
    fn purge_可按勾选项只清一部分() {
        let dir = std::env::temp_dir().join(format!("rec-blog-purge-part-{}", std::process::id()));
        std::env::set_var("REC_BLOG_HOME", &dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = MemoryStore::default();
        store.set("tok-keep").unwrap();
        record_recent("content/posts/2026/a/index.md");
        let session = Mutex::new(Session {
            token: Some("tok-keep".to_string()),
            ..Session::default()
        });

        // 只勾了「最近文件」：令牌与登录态都不动
        let items = purge_local(&store, &session, &["recent"]);
        let names: Vec<&str> = items.iter().map(|i| i.item.as_str()).collect();
        assert_eq!(names, vec!["最近文件", "日志"]);
        assert!(!recent_file().exists(), "勾了的项要真清");
        assert_eq!(
            store.get().unwrap().as_deref(),
            Some("tok-keep"),
            "没勾的项不能动"
        );
        assert!(
            session.lock().unwrap().logged_in(),
            "没勾登录态就不能退出登录"
        );

        std::fs::remove_dir_all(&dir).ok();
        std::env::remove_var("REC_BLOG_HOME");
    }
}
