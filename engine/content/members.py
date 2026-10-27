"""成员档案：content/members/<id>.sml → manifest.members（含头像本地化）。"""

import re
import urllib.request

from engine.core import contracts, urls
from engine.core.paths import CONTENT, ROOT
from engine.content.loader import as_list, check_req, docs_in, load2, pick
from engine.parse import sml

# 成员 links 的已知键。未知键不会被丢掉（前端回落到键名），但会构建期告警：
# 联系人的个数由键名决定，写错键名 = 给读者一个看不懂的标签。
KNOWN_MEMBER_LINK_KEYS = {"blog", "homepage", "github", "gitee", "gitee_org", "email"}

AVATAR_EXT = (".jpg", ".jpeg", ".png", ".webp")

AVATAR_CACHE = ROOT / "meta" / "avatars"   # 构建期下载的远端头像缓存（不入库）


def find_avatar(mid):
    """没写 avatar 字段时的自动发现：content/members/<id>.* → content/avatars/<id>.* → 站点根 <id>.*"""
    for d in (CONTENT / "members", CONTENT / "avatars", ROOT):
        for ext in AVATAR_EXT:
            p = d / (mid + ext)
            if p.exists():
                return p
    return None


def fetch_remote_avatar(rep, url, mid):
    """把远端头像下载到本地缓存，返回 Path；失败返回 None。

    站点运行时零外部请求：GitHub/Gitee 头像都在构建期本地化，
    不依赖访问者能连上 githubusercontent.com。
    """
    AVATAR_CACHE.mkdir(parents=True, exist_ok=True)
    for ext in AVATAR_EXT:
        p = AVATAR_CACHE / (mid + ext)
        if p.exists() and p.stat().st_size > 0:
            return p
    req = urllib.request.Request(url, headers={"User-Agent": "rec-blog-builder"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read(2 * 1024 * 1024 + 1)
            ctype = (r.headers.get("Content-Type") or "").lower()
    except Exception as e:  # noqa: BLE001
        rep.warn("avatar", "%s 下载失败（%s），改用占位图" % (mid, e))
        return None
    if len(data) > 2 * 1024 * 1024:
        rep.warn("avatar", "%s 超过 2 MB，已忽略" % mid)
        return None
    ext = ".jpg"
    for cand in AVATAR_EXT:
        if cand in ctype:
            ext = cand
            break
    else:
        m = re.search(r"\.(jpe?g|png|webp)(?:$|[?#])", url, re.I)
        if m:
            ext = "." + m.group(1).lower().replace("jpeg", "jpg")
    p = AVATAR_CACHE / (mid + ext)
    p.write_bytes(data)
    return p


def build_members(rep):
    out = []
    for f in docs_in(CONTENT / "members"):
        d, cs = load2(f)
        where = f.relative_to(ROOT).as_posix()
        contracts.register_contracts(rep, where, cs)
        if not contracts.apply_contract(rep, where, d, "member"):
            check_req(rep, "member", where, d)
        links = d.get("links") if isinstance(d.get("links"), dict) else {}
        for k in links:
            if not str(k).startswith("_") and str(k) not in KNOWN_MEMBER_LINK_KEYS:
                rep.warn(where, "links 里的键 `%s` 不在已知键里（%s）：前端只会显示这个键名本身，"
                         "确需新的联系方式请同步 contracts/blog.sml 的 MemberLinks "
                         "与 site/theme/js/core.js 的 CONTACT_LABEL" % (k, " / ".join(sorted(KNOWN_MEMBER_LINK_KEYS))))
        av = sml.as_str(d.get("avatar", ""))
        avatar = ""
        src = None
        if av.startswith(("http://", "https://")):
            # 远端头像：构建期下载到本地缓存，运行时不再直连（零外部请求）
            src = fetch_remote_avatar(rep, av, f.stem)
        else:
            if av:
                p = ROOT / av
                if p.exists():
                    src = p
                else:
                    rep.warn(where, "avatar 指向的文件不存在：%s" % av)
            if src is None:
                src = find_avatar(f.stem)
        if src is not None:
            avatar = "assets/members/%s%s" % (f.stem, src.suffix.lower())
        out.append({
            "id": f.stem,
            "name": sml.as_str(pick(d, ["name"], f.stem)),
            "avatar": avatar,
            "_avatar_src": str(src) if src else "",
            "signature": sml.as_str(d.get("signature", "")),
            "role": sml.as_str(d.get("role", "群友")),
            "skills": [sml.as_str(x) for x in as_list(d.get("skills"))],
            "links": {k: safe for k, v in links.items()
                      if not k.startswith("__") and (safe := urls.safe_url(sml.as_str(v)))},
            "joined": sml.as_str(d.get("joined", "")),
            "file": where,
        })
    return out
