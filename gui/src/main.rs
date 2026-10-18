//! rec-blog 写作台启动器。
//!
//! Rust 只做外壳与系统能力：参数、引擎发现、进程守护、内嵌 UI 托管、
//! `/api/*` 反代、打开窗口。**解析 / 渲染 / 契约 / 构建全部由 Python 引擎完成。**

mod args;
mod assets;
mod engine;
mod server;
mod session;

#[cfg(feature = "desktop")]
mod desktop;

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// 等引擎握手的最长时间（Python 启动 + 导入引擎）。
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);
/// 引擎 stderr 保留的尾部行数，用于崩溃时给人看。
const STDERR_TAIL: usize = 40;

#[tokio::main]
async fn main() -> Result<()> {
    let action = args::parse(std::env::args_os())?;
    match action {
        args::Action::Version { site } => print_version(site),
        args::Action::Update { site } => update(site)?,
        args::Action::Serve {
            site,
            port,
            no_open,
            desktop,
        } => serve(site, port, no_open, desktop).await?,
    }
    Ok(())
}

/// `--version`：写作台版本 + 引擎 commit（拿不到引擎就打 `-`）。
fn print_version(site: Option<PathBuf>) {
    let commit = match engine::resolve(site, false) {
        Ok(e) => engine::engine_commit(&e.root),
        Err(_) => "-".to_string(),
    };
    println!(
        "rec-blog {} · 引擎 commit {}",
        env!("CARGO_PKG_VERSION"),
        commit
    );
}

/// `update`：只拉引擎（git pull --ff-only），二进制要自己重装。
fn update(site: Option<PathBuf>) -> Result<()> {
    let eng = engine::resolve(site, false)?;
    let status = std::process::Command::new("git")
        .args(["-C"])
        .arg(&eng.root)
        .args(["pull", "--ff-only"])
        .status()
        .context("执行 git pull 失败（本机装了 git 吗？）")?;
    if !status.success() {
        return Err(anyhow!(
            "git pull 失败（退出码 {:?}）。若引擎目录有本地改动，先处理干净再更新。",
            status.code()
        ));
    }
    println!("引擎已更新到 {}", engine::engine_commit(&eng.root));
    println!("写作台二进制不会自动重装，请执行：");
    println!("  cargo install --force --git https://gitee.com/rustembed/site --branch master rec-blog-gui");
    Ok(())
}

async fn serve(site: Option<PathBuf>, port: u16, no_open: bool, desktop: bool) -> Result<()> {
    let eng = engine::resolve(site, true)?;
    let (python, ver) = engine::find_python()?;
    let gui_py = eng.gui_py();
    if !gui_py.is_file() {
        return Err(anyhow!(
            "引擎里没有 {}；执行 `rec-blog update` 更新引擎。",
            gui_py.display()
        ));
    }
    println!(
        "写作台 · 引擎 {} · Python {}.{}.{}",
        eng.root.display(),
        ver.0,
        ver.1,
        ver.2
    );

    // 会话密钥：只走环境变量与内存，绝不出现在 argv（进程列表可见）。
    let token = random_token();
    let mut child = Command::new(&python)
        .arg(&gui_py)
        .arg("--port")
        .arg("0")
        .env("GUI_TOKEN", &token)
        .env("REC_BLOG_SITE", &eng.site)
        .current_dir(&eng.root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("启动 {} 失败", gui_py.display()))?;

    let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = Arc::clone(&tail);
        let token_for_log = token.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[engine] {}", session::redact(&line, &[&token_for_log]));
                let mut g = tail.lock().await;
                if g.len() >= STDERR_TAIL {
                    g.pop_front();
                }
                g.push_back(line);
            }
        });
    }

    let stdout = child.stdout.take().context("拿不到引擎 stdout")?;
    let py_port =
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, wait_handshake(stdout, &token)).await {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => return stop(child, tail, e).await,
            Err(_) => {
                return stop(
                    child,
                    tail,
                    anyhow!("等待引擎握手超时（{} 秒）", HANDSHAKE_TIMEOUT.as_secs()),
                )
                .await
            }
        };
    println!("引擎已就绪（Python 侧端口 {}）", py_port);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .with_context(|| format!("绑定 127.0.0.1:{} 失败", port))?;
    let addr = listener.local_addr()?;

    let state = Arc::new(server::AppState {
        python_base: format!("http://127.0.0.1:{}", py_port),
        token: token.clone(),
        client: reqwest::Client::new(),
    });

    println!("写作台已就绪： http://{}", addr);
    if !no_open {
        open_ui(&format!("http://{}", addr), desktop);
    }

    let served = axum::serve(listener, server::router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await;

    let mut child = child;
    let _ = child.kill().await;
    served.context("本地服务异常退出")?;
    Ok(())
}

/// 读引擎 stdout，直到出现 `GUI_PORT=<n>`。
async fn wait_handshake<R: AsyncRead + Unpin>(stdout: R, token: &str) -> Result<u16> {
    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await.context("读引擎 stdout 失败")? {
        if let Some(p) = engine::parse_handshake(&line) {
            return Ok(p);
        }
        println!("[engine] {}", session::redact(&line, &[token]));
    }
    Err(anyhow!("引擎进程提前退出，没有打印 GUI_PORT"))
}

/// 出错退出：杀掉子进程并把引擎 stderr 尾部打给人看。
async fn stop(
    mut child: Child,
    tail: Arc<Mutex<VecDeque<String>>>,
    err: anyhow::Error,
) -> Result<()> {
    let _ = child.kill().await;
    let g = tail.lock().await;
    if !g.is_empty() {
        eprintln!("--- 引擎输出（尾部） ---");
        for line in g.iter() {
            eprintln!("{}", line);
        }
    }
    Err(err)
}

/// 随机会话密钥（32 位字母数字）。
fn random_token() -> String {
    use rand::distributions::Alphanumeric;
    use rand::Rng;
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/// 打开界面：`desktop` 特性下走原生窗口，否则浏览器。
fn open_ui(url: &str, desktop: bool) {
    if desktop {
        #[cfg(feature = "desktop")]
        {
            crate::desktop::open_window(url);
            return;
        }
        #[cfg(not(feature = "desktop"))]
        {
            eprintln!("提示：本二进制未编译 desktop 特性（cargo install --features desktop），改用浏览器打开。");
        }
    }
    if let Err(e) = open::that(url) {
        eprintln!("打开浏览器失败（{}）；请手动访问 {}", e, url);
    }
}
