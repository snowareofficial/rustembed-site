//! 登录态与令牌纪律（M1 只有脱敏；钥匙串 / Gitee 校验在 M3 落地）。
//!
//! 硬约束：令牌只允许存在于系统钥匙串或进程内存，
//! 不写配置文件、不写日志（一律 `***`）、不进 URL、不进剪贴板历史。

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
