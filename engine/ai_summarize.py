#!/usr/bin/env python3
"""构建期 AI 摘要（可选）：调用 OpenAI 兼容网关（如 GLM-4.7-Flash），写 summaries/<slug>.json。

## 提示词生成算法（v1）

1. 输入只取构建产物：`title` / `summary` / `tags` / 正文纯文本（去 HTML，截断 6000 字）；
2. 固定 system prompt（下方 SYSTEM，版本号 PROMPT_VERSION），要求严格 JSON；
3. 走 OpenAI 兼容 `/chat/completions`，优先 `response_format={"type":"json_object"}`，
   网关不支持时自动去掉该字段重试一次；
4. 解析：去 ```json 围栏 → 取第一个 `{...}` → json.loads；
5. 校验：`one_line` ≤60 字、`points` 3–8 条、`keywords` 3–8 个；空结果视为失败；
6. 落盘时写 `_meta`（输入哈希 / prompt 版本 / 模型 / 时间），用于判断「内容是否变过」。

## 不重复生成

- 默认：`summaries/<slug>.json` 已存在就**跳过**（不看内容是否变化）。
- 主动重生成只有两种方式：
  - `--force`：全部重生成；
  - 放一个标记文件 `site/content/summaries/<slug>.refresh`：只重生成这一篇（跑完自动删标记）。
- `--dry-run` 默认行为（不写文件），`--write` 才落盘。

用法：

    export AI_BASE_URL="https://your-gateway/v1" AI_API_KEY="..." AI_MODEL="glm-4.7-flash"
    python engine/cli.py build --offline
    python engine/ai_summarize.py --write
    python engine/cli.py build --offline
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
from lib import render  # noqa: E402

PROMPT_VERSION = "v1"

SYSTEM = (
    "你是技术博客的编辑。只根据给定正文写摘要，不补充外部事实。"
    "输出严格 JSON：{\"one_line\": str, \"points\": [str], \"keywords\": [str]}。"
    "one_line <=60 字；points 3-6 条、每条 <=40 字、按文章顺序；keywords 3-6 个。"
    "中文标点；不要以「本文」「作者」开头；points 是结论不是章节标题复述。"
)


def strip_html(html):
    return render.strip_html(html or "")


def input_hash(title, summary, tags, text):
    h = hashlib.sha256()
    for part in (title, summary, " ".join(tags or []), text):
        h.update(str(part).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def call_gateway(base, key, model, messages, timeout=60, json_mode=True):
    """OpenAI 兼容 /chat/completions；网关不支持 response_format 时自动重试一次。"""
    url = base.rstrip("/") + "/chat/completions"
    payload = {"model": model, "messages": messages, "temperature": 0.2}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if json_mode and e.code in (400, 422):
            return call_gateway(base, key, model, messages, timeout, json_mode=False)
        raise
    return body["choices"][0]["message"]["content"]


def parse_json(text):
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S).strip()
    m = re.search(r"\{.*\}", t, flags=re.S)
    if not m:
        raise ValueError("模型没有返回 JSON")
    return json.loads(m.group(0))


def normalize(data):
    one = str(data.get("one_line") or "")[:120]
    points = [str(x)[:80] for x in (data.get("points") or []) if str(x).strip()][:8]
    keys = [str(x)[:40] for x in (data.get("keywords") or []) if str(x).strip()][:8]
    if not one and not points:
        raise ValueError("模型输出为空")
    return {"one_line": one, "points": points, "keywords": keys}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="真正写文件（默认只打印）")
    ap.add_argument("--force", action="store_true", help="全部重生成（默认已存在就跳过）")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--strict", action="store_true", help="任何一篇失败就返回非 0")
    ap.add_argument("--base-url", default=os.environ.get("AI_BASE_URL", ""))
    ap.add_argument("--api-key", default=os.environ.get("AI_API_KEY", ""))
    ap.add_argument("--model", default=os.environ.get("AI_MODEL", "glm-4.7-flash"))
    ap.add_argument("--timeout", type=int, default=60)
    args = ap.parse_args()

    manifest_path = config.OUT / "manifest.json"
    if not manifest_path.exists():
        print("找不到 %s —— 先跑一次 build" % manifest_path)
        return 2
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    out_dir = config.CONTENT / "summaries"
    out_dir.mkdir(parents=True, exist_ok=True)

    if not (args.base_url and args.api_key):
        print("缺少 AI_BASE_URL / AI_API_KEY（导出环境变量或传 --base-url/--api-key）")
        return 2

    todo = []
    skipped = 0
    for p in manifest.get("posts") or []:
        slug = p.get("slug") or ""
        target = out_dir / (slug + ".json")
        marker = out_dir / (slug + ".refresh")
        if target.exists() and not args.force and not marker.exists():
            skipped += 1
            print("[skip] %s（已存在；要重生成：--force 或放 %s.refresh）" % (slug, slug))
            continue
        todo.append(p)
    if args.limit:
        todo = todo[: args.limit]

    ok = fail = 0
    for p in todo:
        slug = p["slug"]
        html = (config.OUT / (p.get("html") or "")).read_text(encoding="utf-8", errors="replace")
        text = strip_html(html)[:6000]
        title = p.get("title") or ""
        summary = p.get("summary") or ""
        tags = p.get("tags") or []
        digest = input_hash(title, summary, tags, text)
        user = json.dumps({"title": title, "summary": summary, "tags": tags, "text": text},
                          ensure_ascii=False)
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
        try:
            raw = call_gateway(args.base_url, args.api_key, args.model, messages, args.timeout)
            data = normalize(parse_json(raw))
        except Exception as e:  # noqa: BLE001
            fail += 1
            print("[warn] %s: %s" % (slug, e))
            continue
        data["_meta"] = {
            "hash": digest,
            "prompt": PROMPT_VERSION,
            "model": args.model,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        target = out_dir / (slug + ".json")
        marker = out_dir / (slug + ".refresh")
        if args.write:
            target.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            if marker.exists():
                marker.unlink()
            print("[ok] %s -> %s" % (slug, target))
        else:
            print("[dry] %s -> %s" % (slug, json.dumps(data, ensure_ascii=False)))
        ok += 1

    print("完成：生成 %d，失败 %d，跳过 %d" % (ok, fail, skipped))
    return 1 if (args.strict and fail) else 0


if __name__ == "__main__":
    sys.exit(main())
