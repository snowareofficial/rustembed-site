//! 命令行参数：`rec-blog [--site PATH] [--port N] [--no-open] [--desktop]`
//! 以及 `rec-blog update` / `rec-blog --version`。
//!
//! 参数解析单独成模块，便于 `cargo test` 直接覆盖（不真的起服务）。

use std::ffi::OsString;
use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "rec-blog",
    about = "rec-blog 写作台（内嵌 Web UI + 本地 API 反代）",
    disable_version_flag = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// 站点目录或仓库根目录都行（<p>/content 或 <p>/site/content）
    #[arg(long, value_name = "PATH", global = true)]
    pub site: Option<PathBuf>,

    /// 本地服务端口；0 = 让系统分配
    #[arg(long, default_value_t = 0)]
    pub port: u16,

    /// 启动后不自动打开浏览器
    #[arg(long)]
    pub no_open: bool,

    /// 用原生窗口打开（需要 --features desktop 编译；否则降级为浏览器）
    #[arg(long)]
    pub desktop: bool,

    /// 打印写作台版本与引擎 commit
    #[arg(long)]
    pub version: bool,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// 拉取引擎更新（git pull --ff-only），并提示重装写作台的命令
    Update,
    /// 打印写作台版本与引擎 commit
    Version,
}

/// 解析后的动作，main 只按这个分发。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Serve {
        site: Option<PathBuf>,
        port: u16,
        no_open: bool,
        desktop: bool,
    },
    Version {
        site: Option<PathBuf>,
    },
    Update {
        site: Option<PathBuf>,
    },
}

pub fn parse<I, T>(argv: I) -> Result<Action>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = Cli::try_parse_from(argv).map_err(|e| anyhow::anyhow!("{}", e))?;
    let action = match cli.command {
        Some(Command::Update) => Action::Update { site: cli.site },
        Some(Command::Version) => Action::Version { site: cli.site },
        None if cli.version => Action::Version { site: cli.site },
        None => Action::Serve {
            site: cli.site,
            port: cli.port,
            no_open: cli.no_open,
            desktop: cli.desktop,
        },
    };
    Ok(action)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(args: &[&str]) -> Action {
        parse(["rec-blog"].iter().chain(args.iter()).copied()).unwrap()
    }

    #[test]
    fn 默认参数_随机端口且自动打开() {
        assert_eq!(
            a(&[]),
            Action::Serve {
                site: None,
                port: 0,
                no_open: false,
                desktop: false
            }
        );
    }

    #[test]
    fn 端口与开关() {
        assert_eq!(
            a(&["--port", "8788", "--no-open", "--desktop"]),
            Action::Serve {
                site: None,
                port: 8788,
                no_open: true,
                desktop: true
            }
        );
    }

    #[test]
    fn 站点路径透传() {
        assert_eq!(
            a(&["--site", "D:/tmp/site"]),
            Action::Serve {
                site: Some(PathBuf::from("D:/tmp/site")),
                port: 0,
                no_open: false,
                desktop: false
            }
        );
    }

    #[test]
    fn 子命令与版本开关() {
        assert_eq!(a(&["update"]), Action::Update { site: None });
        assert_eq!(a(&["--version"]), Action::Version { site: None });
        assert_eq!(
            a(&["version", "--site", "D:/tmp/repo"]),
            Action::Version {
                site: Some(PathBuf::from("D:/tmp/repo"))
            }
        );
    }

    #[test]
    fn 非法参数报错而不是崩() {
        assert!(parse(["rec-blog", "--port", "not-a-number"]).is_err());
    }
}
