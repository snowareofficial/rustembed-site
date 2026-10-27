# 文章摘要（构建期 AI 步骤）

给 AI 用的固定约定。产物落到 `site/content/summaries/<slug>.json`，
下次 `python engine/cli.py build` 会自动采用，并在页面上标注「AI · 构建期」。

## 算法（v1，实现见 engine/tools/ai_summarize.py）

1. 输入只取构建产物：`title` / `summary` / `tags` / 正文纯文本（去 HTML，截断 6000 字）；
2. 固定 system prompt + 严格 JSON 要求；
3. `POST {AI_BASE_URL}/chat/completions`，优先 `response_format={"type":"json_object"}`，
   网关不支持时去掉该字段重试；
4. 解析：去 ```json 围栏 → 取第一个 `{...}` → `json.loads`；
5. 校验：`one_line` ≤60 字、`points` 3–8 条、`keywords` 3–8 个；空结果算失败；
6. 落盘带 `_meta`：`hash`（输入哈希）/ `prompt`（版本）/ `model` / `at`。

## 不重复生成

- `summaries/<slug>.json` 已存在 → **默认跳过**；
- 主动重生成：`--force`（全部）或放 `site/content/summaries/<slug>.refresh`（单篇，跑完自动删）；
- CI 里用 `actions/cache` 缓存该目录，新文章才调用网关。

## 输入

```json
{
  "title": "文章标题",
  "summary": "作者写的一句话摘要（可能为空）",
  "tags": ["标签"],
  "text": "正文纯文本（构建期已去标签，最多 4000 字）"
}
```

## 输出（严格 JSON，不要 Markdown 代码块）

```json
{
  "one_line": "一句话摘要，<=60 字，说清这篇解决什么问题",
  "points": ["3–6 条要点，每条 <=40 字，按文章顺序"],
  "keywords": ["3–6 个关键词，优先复用 tags"]
}
```

## 约束

- 只根据输入写，不补充外部事实；不确定就不写。
- 中文标点；不要「本文」「作者」这类空话开头。
- 要点是给扫读者看的结论，不是章节标题的复述。
- 失败/超时就不要写文件：构建会退回抽取式摘要（章节标题 + tags），不会阻塞发布。

## 调用方式（示例，二选一）

```bash
# CLI 批处理：把每篇的输入喂给模型，输出写回 summaries/<slug>.json
python engine/cli.py list --json > /tmp/posts.json
```

```python
# 或在自己的脚本里：
import json, pathlib
from engine.lib import summary  # 只读，不联网
post = {...}                    # 至少要有 slug/title/summary/tags/words/toc
# 调模型 -> data，然后：
pathlib.Path("site/content/summaries", post["slug"] + ".json").write_text(
    json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
```

> 站点本身**不联网、不在运行时调用 AI**：摘要只在构建期生成，页面零第三方请求。
