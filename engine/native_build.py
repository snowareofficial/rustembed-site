#!/usr/bin/env python3
"""在本机编译 SML native cdylib，并放到 engine/native/。

用法：
    python engine/native_build.py --sml-src C:\\Users\\you\\Desktop\\sml
    python engine/native_build.py --sml-src ../sml --force

默认查找顺序：
    --sml-src > $SML_SRC > <repo>/../sml

依赖：
    Rust / cargo；不需要 pip。
    SML 源码目录需包含 rust/Cargo.toml（或直接指向 rust 目录）。
"""
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "engine"
DEFAULT_OUT = ENGINE / "native"


def lib_names():
    if os.name == "nt":
        return ["sml.dll", "libsml.dll"]
    if sys.platform == "darwin":
        return ["libsml.dylib"]
    return ["libsml.so", "sml"]


def find_source(arg):
    if arg:
        return Path(arg).expanduser().resolve()
    env = os.environ.get("SML_SRC")
    if env:
        return Path(env).expanduser().resolve()
    return (ROOT.parent / "sml").resolve()


def find_workspace(src):
    candidates = [src, src / "rust"]
    for c in candidates:
        if (c / "Cargo.toml").is_file():
            return c
    raise SystemExit(
        "找不到 SML 的 Cargo.toml：%s\n"
        "请用 --sml-src 指向含 rust/Cargo.toml 的 SML 源码目录。" % src
    )


def cargo_target_dir(workspace, cargo):
    """cargo 的 target 目录可能被 .cargo/config.toml 重定向（本项目就是）。"""
    try:
        out = subprocess.check_output(
            [cargo, "metadata", "--format-version", "1", "--no-deps"],
            cwd=str(workspace), text=True,
        )
        return Path(json.loads(out)["target_directory"]).resolve()
    except Exception:  # noqa: BLE001
        return workspace / "target"


def find_built(workspace, cargo):
    names = lib_names()
    roots = [
        workspace / "target",
        workspace.parent / "target",
        cargo_target_dir(workspace, cargo),
    ]
    env_target = os.environ.get("CARGO_TARGET_DIR")
    if env_target:
        roots.append(Path(env_target))
    for root in roots:
        for name in names:
            hits = [p for p in root.rglob(name) if p.is_file()]
            if hits:
                hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                return hits[0]
    return None


def build_artifact(cargo, workspace, locked=False):
    """跑 cargo build 并解析 --message-format=json，拿到真实 cdylib 路径。

    cargo 的 target-dir 可能被全局 config 重定向（本机就是 D:/snoware-target），
    不能只猜 workspace/target。
    """
    cmd = [cargo, "build", "--release", "-p", "swsml", "--message-format=json"]
    if locked:
        cmd.insert(2, "--locked")
    proc = subprocess.run(cmd, cwd=str(workspace), text=True,
                          encoding="utf-8", errors="replace",
                          stdout=subprocess.PIPE, check=True)
    wanted = set(lib_names())
    hits = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("reason") != "compiler-artifact":
            continue
        kinds = obj.get("target", {}).get("kind") or []
        if "cdylib" not in kinds:
            continue
        for name in obj.get("filenames") or []:
            p = Path(name)
            if p.name in wanted and p.is_file():
                hits.append(p)
    if hits:
        hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return hits[0]
    return None


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(path):
    sys.path.insert(0, str(ENGINE / "lib"))
    import _swsml  # noqa: E402

    _swsml.load_library(str(path))
    return _swsml.version()


def main():
    ap = argparse.ArgumentParser(description="本机编译 SML native cdylib")
    ap.add_argument("--sml-src", help="SML 源码目录（含 rust/Cargo.toml）")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT), help="输出目录，默认 engine/native")
    ap.add_argument("--force", action="store_true", help="覆盖已有同名库")
    ap.add_argument("--locked", action="store_true", help="cargo build --locked")
    ap.add_argument("--no-verify", action="store_true", help="不加载刚构建的库做验证")
    ap.add_argument("--dry-run", action="store_true", help="只打印将执行的命令")
    args = ap.parse_args()

    src = find_source(args.sml_src)
    workspace = find_workspace(src)
    cargo = shutil.which("cargo")
    if not cargo:
        raise SystemExit("找不到 cargo；先安装 Rust：https://rustup.rs/")

    cmd = [cargo, "build", "--release", "-p", "swsml"]
    if args.locked:
        cmd.insert(2, "--locked")

    print("平台 : %s %s" % (platform.system(), platform.machine()))
    print("源码 : %s" % workspace)
    print("命令 : %s" % " ".join(cmd))
    if args.dry_run:
        return 0

    built = build_artifact(cargo, workspace, locked=args.locked)
    if not built:
        built = find_built(workspace, cargo)
    if not built:
        raise SystemExit(
            "构建成功但找不到 cdylib（候选：%s）。\n"
            "若设置了 CARGO_TARGET_DIR，请确认产物在它的 release/ 下。" % ", ".join(lib_names())
        )

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / built.name
    if dest.exists() and not args.force:
        old, new = sha256(dest), sha256(built)
        if old == new:
            print("已是最新：%s" % dest)
            print("SHA-256: %s" % new)
            return 0
        raise SystemExit(
            "目标已存在且内容不同：%s\n用 --force 覆盖，或先备份。" % dest
        )

    shutil.copy2(built, dest)
    if os.name != "nt":
        dest.chmod(0o755)
    digest = sha256(dest)
    print("产物 : %s" % dest)
    print("大小 : %d bytes" % dest.stat().st_size)
    print("SHA-256: %s" % digest)

    if not args.no_verify:
        try:
            ver = verify(dest)
            print("验证 : 已加载，%s" % ver)
        except Exception as e:  # noqa: BLE001
            print("验证失败：%s" % e)
            print("库已复制，但当前进程加载失败；请检查架构/依赖。")
            return 1

    print("\n提示：engine/native/ 默认被 .gitignore；不要提交构建产物，除非明确要入库。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
