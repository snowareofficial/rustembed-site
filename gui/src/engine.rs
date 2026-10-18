//! 引擎目录发现、Python 版本检查、`GUI_PORT=` 握手解析。
//!
//! 引擎 = Python 侧的 `engine/`；站点 = 含 `content/` 的目录。
//! 目录发现的优先级：`--site` > `REC_BLOG_SITE` > `~/.local/share/rec-blog/repo`。

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Context, Result};

pub const DEFAULT_REPO_URL: &str = "https://gitee.com/rustembed/site.git";
pub const DEFAULT_DIR_NAME: &str = "rec-blog/repo";
pub const MIN_PYTHON: (u32, u32) = (3, 11);

/// 一个可用的引擎：仓库根（engine/ 的父目录）+ 站点目录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Engine {
    pub root: PathBuf,
    pub site: PathBuf,
}

impl Engine {
    /// `engine/gui.py` 的绝对路径。
    pub fn gui_py(&self) -> PathBuf {
        self.root.join("engine").join("gui.py")
    }
}

/// 本地数据目录：Windows 用 LOCALAPPDATA，其他用 XDG/HOME。
pub fn data_dir() -> Result<PathBuf> {
    if let Ok(v) = std::env::var("REC_BLOG_HOME") {
        return Ok(PathBuf::from(v));
    }
    #[cfg(windows)]
    if let Ok(v) = std::env::var("LOCALAPPDATA") {
        return Ok(PathBuf::from(v));
    }
    if let Ok(v) = std::env::var("XDG_DATA_HOME") {
        return Ok(PathBuf::from(v));
    }
    if let Ok(v) = std::env::var("HOME") {
        return Ok(PathBuf::from(v).join(".local").join("share"));
    }
    #[cfg(windows)]
    if let Ok(v) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(v).join("AppData").join("Local"));
    }
    Err(anyhow!(
        "无法确定本地数据目录；请用 --site 指定站点目录，或设置 REC_BLOG_SITE"
    ))
}

/// 默认引擎目录（`<data>/rec-blog/repo`）。
pub fn default_dir() -> Result<PathBuf> {
    Ok(data_dir()?.join(DEFAULT_DIR_NAME))
}

/// Windows 的 canonicalize 会带 `\\?\` 前缀，git 等外部命令认不出来，统一去掉。
fn simplify(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p
}

/// 判定一个目录是「站点目录」还是「仓库根」，两者都吃。
///
/// - `<p>/content` 且 `<p>/engine/gui.py` 存在 → 站点即仓库根；
/// - `<p>/site/content` → 仓库根；
/// - 只有 `<p>/content` → 纯站点目录，仓库根取父目录。
pub fn classify(path: &Path) -> Option<Engine> {
    let p = simplify(path.canonicalize().ok()?);
    if !p.is_dir() {
        return None;
    }
    if p.join("content").is_dir() && p.join("engine").join("gui.py").is_file() {
        return Some(Engine {
            root: p.clone(),
            site: p,
        });
    }
    if p.join("site").join("content").is_dir() {
        return Some(Engine {
            root: p.clone(),
            site: p.join("site"),
        });
    }
    if p.join("content").is_dir() {
        let root = p.parent()?.to_path_buf();
        return Some(Engine { root, site: p });
    }
    None
}

/// 克隆引擎仓库到 `dir`（首次运行）。失败要给得出人话与手动下载地址。
pub fn clone_repo(dir: &Path) -> Result<()> {
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("无法创建目录 {}", parent.display()))?;
    }
    let status = Command::new("git")
        .args(["clone", "--depth", "1", DEFAULT_REPO_URL])
        .arg(dir)
        .status()
        .context("执行 git 失败（本机装了 git 吗？）")?;
    if !status.success() {
        return Err(anyhow!(
            "克隆引擎失败（git 退出码 {:?}）。可手动下载 {} 的 zip 解压到 {}，再用 --site 指定。",
            status.code(),
            DEFAULT_REPO_URL,
            dir.display()
        ));
    }
    Ok(())
}

/// 定位引擎。`allow_clone` 为假时遇到默认目录缺失直接报错（--version/update 不该触发克隆）。
pub fn resolve(site: Option<PathBuf>, allow_clone: bool) -> Result<Engine> {
    if let Some(p) = site {
        return classify(&p).with_context(|| {
            format!(
                "{} 不像站点目录也不像仓库根（需要 <p>/content 或 <p>/site/content）",
                p.display()
            )
        });
    }
    if let Ok(env) = std::env::var("REC_BLOG_SITE") {
        let p = PathBuf::from(env);
        return classify(&p)
            .with_context(|| format!("REC_BLOG_SITE={} 不是可用的站点目录/仓库根", p.display()));
    }
    let dir = default_dir()?;
    if classify(&dir).is_none() {
        if !allow_clone {
            return Err(anyhow!(
                "默认引擎目录 {} 还不存在；先执行一次 `rec-blog` 自动克隆，或用 --site 指定。",
                dir.display()
            ));
        }
        println!("首次运行：正在克隆引擎到 {} …", dir.display());
        clone_repo(&dir)?;
    }
    classify(&dir)
        .with_context(|| format!("{} 里没有找到 site/content 或 engine/gui.py", dir.display()))
}

/// 找 Python：`python3` 优先，回退 `python`；返回 (可执行文件, (主,次,修订))。
pub fn find_python() -> Result<(String, (u32, u32, u32))> {
    for cand in ["python3", "python"] {
        let out = Command::new(cand).arg("--version").output();
        let Ok(out) = out else { continue };
        if !out.status.success() {
            continue;
        }
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        if let Some(v) = parse_python_version(&text) {
            if v.0 >= MIN_PYTHON.0 && (v.1 >= MIN_PYTHON.1 || v.0 > MIN_PYTHON.0) {
                return Ok((cand.to_string(), v));
            }
            return Err(anyhow!(
                "Python 版本过低：{}={}.{}.{}，写作台需要 >= {}.{}。请升级后再运行。",
                cand,
                v.0,
                v.1,
                v.2,
                MIN_PYTHON.0,
                MIN_PYTHON.1
            ));
        }
    }
    Err(anyhow!(
        "没有找到 python3/python（需要 >= {}.{}）。装好后重新运行 rec-blog。",
        MIN_PYTHON.0,
        MIN_PYTHON.1
    ))
}

/// 从 `Python 3.14.3` 这类输出里解析版本号。
pub fn parse_python_version(text: &str) -> Option<(u32, u32, u32)> {
    let rest = text.trim().strip_prefix("Python")?.trim();
    let mut it = rest.split('.');
    let major = it.next()?.trim().parse::<u32>().ok()?;
    let minor = it.next()?.trim().parse::<u32>().ok()?;
    let patch = it
        .next()
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    Some((major, minor, patch))
}

/// 解析引擎握手行 `GUI_PORT=<n>`；非法/0/越界返回 None。
pub fn parse_handshake(line: &str) -> Option<u16> {
    let rest = line.trim().strip_prefix("GUI_PORT=")?;
    let port: u32 = rest.trim().parse().ok()?;
    if port == 0 || port > u16::MAX as u32 {
        return None;
    }
    Some(port as u16)
}

/// 引擎 commit（`git -C <root> rev-parse --short HEAD`），失败返回 `-`。
pub fn engine_commit(root: &Path) -> String {
    let out = Command::new("git")
        .args(["-C"])
        .arg(root)
        .args(["rev-parse", "--short", "HEAD"])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => "-".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn tmp(name: &str) -> Tmp {
        let p =
            std::env::temp_dir().join(format!("rec-blog-gui-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }

    #[test]
    fn 握手行解析() {
        assert_eq!(parse_handshake("GUI_PORT=8788"), Some(8788));
        assert_eq!(parse_handshake("  GUI_PORT=1234  "), Some(1234));
        assert_eq!(parse_handshake("GUI_PORT=0"), None);
        assert_eq!(parse_handshake("GUI_PORT=70000"), None);
        assert_eq!(parse_handshake("GUI_PORT=abc"), None);
        assert_eq!(parse_handshake("ready"), None);
        assert_eq!(parse_handshake(""), None);
    }

    #[test]
    fn python_版本解析() {
        assert_eq!(parse_python_version("Python 3.14.3\n"), Some((3, 14, 3)));
        assert_eq!(parse_python_version("Python 3.11.0"), Some((3, 11, 0)));
        assert_eq!(parse_python_version("Python 3.10"), Some((3, 10, 0)));
        assert_eq!(parse_python_version("not python"), None);
    }

    #[test]
    fn 站点目录形态() {
        let t = tmp("sitedir");
        fs::create_dir_all(t.0.join("content")).unwrap();
        fs::create_dir_all(t.0.join("engine")).unwrap();
        fs::write(t.0.join("engine").join("gui.py"), "# gui\n").unwrap();
        let e = classify(&t.0).expect("应识别为站点即仓库根");
        let want = simplify(t.0.canonicalize().unwrap());
        assert_eq!(e.site, want);
        assert_eq!(e.root, want);
        assert!(e.gui_py().ends_with("gui.py"));
        // Windows 的 `\\?\` 前缀必须被去掉，否则 git 等外部命令认不出来
        assert!(!e.root.to_string_lossy().starts_with(r"\\?\"));
    }

    #[test]
    fn 仓库根形态() {
        let t = tmp("repo");
        fs::create_dir_all(t.0.join("site").join("content")).unwrap();
        fs::create_dir_all(t.0.join("engine")).unwrap();
        fs::write(t.0.join("engine").join("gui.py"), "# gui\n").unwrap();
        let e = classify(&t.0).expect("应识别为仓库根");
        assert_eq!(e.site, simplify(t.0.join("site").canonicalize().unwrap()));
        assert_eq!(e.root, simplify(t.0.canonicalize().unwrap()));
    }

    #[test]
    fn 非站点目录返回空() {
        let t = tmp("empty");
        assert!(classify(&t.0).is_none());
    }
}
