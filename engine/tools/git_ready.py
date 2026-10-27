#!/usr/bin/env python3
"""入库前检查 / 提交（不推送 —— Gitee 需要交互式密码，push 由人来做）。

    python engine/tools/git_ready.py                      # 只检查：状态、待入库文件、大文件、忽略规则
    python engine/tools/git_ready.py --commit "docs: …"   # 暂存全部改动并提交（不 push）
    python engine/tools/git_ready.py --commit-file msg.txt

检查项：
  1. 待入库文件里有没有超过阈值的（默认 500 KB 警告、5 MB 报错）；
  2. dist/、__pycache__、*.zip、字体源文件、.preview.log 是否确实被忽略；
  3. 工作区是否有未跟踪的大目录（避免漏 add 或误 add）。
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from engine.core import config  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

WARN_BYTES = 500 * 1024
BAD_BYTES = 5 * 1024 * 1024
MUST_IGNORE = ["dist/", "__pycache__/", "*.zip", ".preview.log",
               "site/fonts/src/", "*.ttf", "*.otf"]


def git(*args, check=False):
    p = subprocess.run(["git", "--no-pager"] + list(args), cwd=str(config.REPO),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise SystemExit("git %s 失败：%s" % (" ".join(args), (p.stderr or "").strip()))
    return (p.stdout or "").strip()


def show():
    print("== 仓库状态 ==")
    print("分支：%s" % (git("rev-parse", "--abbrev-ref", "HEAD") or "(无提交)"))
    remotes = git("remote", "-v")
    print("远端：\n%s" % (remotes or "  （未配置；Gitee 是权威源，建议 name=origin）"))
    log = git("log", "--oneline", "-5")
    print("最近提交：\n%s" % ("\n".join("  " + x for x in log.splitlines()) or "  （无）"))
    print()


def check():
    show()
    print("== 忽略规则 ==")
    ign = (config.REPO / ".gitignore").read_text(encoding="utf-8") if (config.REPO / ".gitignore").exists() else ""
    for pat in MUST_IGNORE:
        print("  %s %s" % ("✔" if pat in ign else "✘", pat))
    for probe in ("dist", "MiSans.zip", ".preview.log", "site/fonts/src"):
        r = subprocess.run(["git", "check-ignore", "-q", probe], cwd=str(config.REPO))
        print("  %s 实际忽略：%s" % ("✔" if r.returncode == 0 else "✘", probe))
    print()

    print("== 待入库文件 ==")
    raw = git("status", "--porcelain", "--untracked-files=all")
    entries = [l for l in raw.splitlines() if l.strip()]
    files = []
    for line in entries:
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ")[-1]
        p = config.REPO / path
        files.append((line[:2].strip(), path, p.stat().st_size if p.is_file() else 0))
    files.sort(key=lambda x: -x[2])
    warns = [f for f in files if WARN_BYTES <= f[2] < BAD_BYTES]
    bads = [f for f in files if f[2] >= BAD_BYTES]
    print("  共 %d 项改动" % len(files))
    for st, path, size in files[:25]:
        print("   %-3s %9s  %s" % (st, ("%.1f MB" % (size / 1024 / 1024)) if size >= 1024 * 1024
                                   else ("%.0f KB" % (size / 1024) if size else "-"), path))
    if len(files) > 25:
        print("   … 另有 %d 项" % (len(files) - 25))
    for st, path, size in warns:
        print("   ! 偏大（>500 KB）：%s（%.0f KB）" % (path, size / 1024))
    for st, path, size in bads:
        print("   ✘ 过大（>5 MB）：%s（%.1f MB）—— 不要提交，检查 .gitignore" % (path, size / 1024 / 1024))
    print()

    print("== 已被跟踪但应忽略的文件（需 git rm --cached）==")
    tracked = git("ls-files").splitlines()
    offenders = [t for t in tracked
                 if t.startswith("dist/") or "__pycache__" in t or t.endswith((".zip", ".ttf", ".otf"))
                 or t == ".preview.log"]
    print("  " + ("\n  ".join(offenders) if offenders else "无"))
    print()

    if bads:
        print("结论：有超大文件，先处理再提交。")
        return 1
    print("结论：可以提交。" + ("（有偏大文件，确认是内容需要再提交）" if warns else ""))
    return 0


def commit(message_file=None, message=None):
    git("add", "-A", check=True)
    staged = git("diff", "--cached", "--stat")
    if not staged:
        print("没有需要提交的改动。")
        return 0
    print("== 将提交 ==")
    print(staged)
    if message_file:
        return subprocess.call(["git", "commit", "-F", message_file], cwd=str(config.REPO))
    msg = message or "chore: 站点结构与内容更新"
    # Windows 下用临时文件传消息，避免 PowerShell 引号/重定向问题
    tmp = config.REPO / ".git" / "COMMIT_MSG.tmp"
    tmp.write_text(msg, encoding="utf-8")
    rc = subprocess.call(["git", "commit", "-F", str(tmp)], cwd=str(config.REPO))
    tmp.unlink(missing_ok=True)
    if rc == 0:
        print("\n已提交：%s" % git("log", "--oneline", "-1"))
        print("下一步由人手动推送：git push origin <分支>   （Gitee 需要交互式密码）")
    return rc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", nargs="?", const="", default=None, metavar="MESSAGE",
                    help="暂存全部改动并提交（不 push）")
    ap.add_argument("--commit-file", default="", help="从文件读取提交信息")
    args = ap.parse_args()

    rc = check()
    if rc != 0:
        return rc
    if args.commit is not None or args.commit_file:
        return commit(message_file=args.commit_file or None, message=args.commit or None)
    print("\n要提交：python engine/tools/git_ready.py --commit \"docs: 说明\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
