"""一言：content/quotes/<成员 id>/quotes.sml → manifest.quotes。"""

from engine.core import contracts
from engine.core.paths import CONTENT, ROOT
from engine.content.loader import as_list, load2
from engine.parse import sml

QUOTES_DIR = CONTENT / "quotes"           # content/quotes/<成员 id>/quotes.sml
QUOTES_PER_MEMBER = 3                     # 每人最多 3 条
QUOTES_TOTAL = 60                         # 全站最多 60 条


def build_quotes(rep, members):
    """收录「一言」：content/quotes/<成员 id>/quotes.sml → manifest.quotes。

    契约之外的硬约束：
      · 只收**有成员档案**的人的句子 —— 句子署的是真人，凭空出現的成员 id 没处溯源；
      · 每人最多 3 条、全站最多 60 条，超出部分构建期丢并告警（提纯——句子多了就稀释）；
      · 一条都不收录时返回空表，前端会连按钮都不渲染：绝不编造句子填版面。
    """
    if not QUOTES_DIR.is_dir():
        return []
    known = {m["id"]: m for m in members}
    out = []
    for d in sorted(p for p in QUOTES_DIR.iterdir() if p.is_dir()):
        f = d / "quotes.sml"
        where = f.relative_to(ROOT).as_posix()
        mid = d.name
        if not f.exists():
            rep.warn(where, "目录里没有 quotes.sml（约定：content/quotes/<成员 id>/quotes.sml）")
            continue
        if mid not in known:
            rep.warn(where, "没有对应的成员档案 content/members/%s.sml，整份不收录" % mid)
            continue
        data, cs = load2(f)
        contracts.register_contracts(rep, where, cs)
        kept = []
        for row in as_list(data.get("quotes")):
            if not isinstance(row, dict):
                continue
            text = sml.as_str(row.get("text", "")).strip()
            if not text:
                continue
            kept.append({
                "member": mid,
                "name": known[mid].get("name") or mid,
                "text": text,
                "source": sml.as_str(row.get("source", "")).strip(),
            })
        if len(kept) > QUOTES_PER_MEMBER:
            rep.warn(where, "%s 录了 %d 条，超过每人 %d 条，只保留前 %d 条"
                     % (mid, len(kept), QUOTES_PER_MEMBER, QUOTES_PER_MEMBER))
            kept = kept[:QUOTES_PER_MEMBER]
        out.extend(kept)
    if len(out) > QUOTES_TOTAL:
        rep.warn("quotes", "共 %d 条，超过上限 %d 条，后面的不进 manifest"
                 % (len(out), QUOTES_TOTAL))
        out = out[:QUOTES_TOTAL]
    return out
