#!/usr/bin/env python3
"""写作台 API 的回归测试（标准库，起真实服务，不碰真实站点内容）。

跑法：python tests/gui_api_test.py
要点：
- 用临时站点目录（site.sml + contracts + 一篇真文章）起服务，绝不写真实 content/；
- 保存纪律：无 BOM / LF / 末尾换行；非法路径 403；契约不过 422 且不写盘；
- 预览与构建同源；令牌不出现在日志里。
"""

import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENGINE = REPO / "engine"
TOKEN = "test-token-abc123"
POST_REL = "content/posts/2026/md-writing/index.md"


def req(port, path, method="GET", payload=None, token=TOKEN):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("X-GUI-Token", token)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        e.close()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw}


class GuiApiTest(unittest.TestCase):
    server = None
    port = 0
    tmp = None
    log_path = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="rec-blog-gui-test-"))
        content = cls.tmp / "content"
        (content / "contracts").mkdir(parents=True)
        (content / "posts" / "2026").mkdir(parents=True)
        shutil.copy(REPO / "site" / "content" / "site.sml", content / "site.sml")
        shutil.copy(REPO / "site" / "content" / "contracts" / "blog.sml",
                    content / "contracts" / "blog.sml")
        src = REPO / "site" / POST_REL          # POST_REL 是站点相对路径
        dst = cls.tmp / POST_REL
        dst.parent.mkdir(parents=True)
        shutil.copy(src, dst)
        cls.original = src.read_bytes()

        # 资源库：原样拷一份（「坏链接资源」只在 test_13 里临时造，免得污染构建用例）
        cls.res_dir = content / "resources"
        cls.res_dir.mkdir(parents=True)
        for f in sorted((REPO / "site" / "content" / "resources").glob("*.sml")):
            shutil.copy(f, cls.res_dir / f.name)
        cls.res_ids = sorted(p.stem for p in cls.res_dir.glob("*.sml"))
        # 构建用例要跑 build.py，缺 theme/ 会直接失败
        if not (cls.tmp / "theme").exists():
            shutil.copytree(REPO / "site" / "theme", cls.tmp / "theme")

        cls.log_path = cls.tmp / "server.log"
        env = dict(os.environ, GUI_TOKEN=TOKEN, REC_BLOG_SITE=str(cls.tmp),
                   PYTHONIOENCODING="utf-8")
        log = open(cls.log_path, "w", encoding="utf-8")
        cls.log = log
        cls.server = subprocess.Popen(
            [sys.executable, "engine/gui.py", "--port", "0"],
            cwd=str(REPO), env=env, stdout=subprocess.PIPE, stderr=log,
            text=True, encoding="utf-8")
        line = cls.server.stdout.readline().strip()
        assert line.startswith("GUI_PORT="), "握手失败：%r" % line
        cls.port = int(line.split("=", 1)[1])

    @classmethod
    def tearDownClass(cls):
        if cls.server:
            cls.server.terminate()
            try:
                cls.server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                cls.server.kill()
        cls.log.close()

    def post_path(self):
        return self.tmp / POST_REL

    # ---------------------------------------------------------------- 用例
    def test_01_类型接口带契约字段(self):
        status, body = req(self.port, "/api/types")
        self.assertEqual(status, 200)
        post = [t for t in body if t["type"] == "post"][0]
        self.assertEqual(post["contract"], "BlogPost")
        names = {f["name"] for f in post["fields"]}
        self.assertTrue({"title", "author", "date", "tags", "summary"} <= names)
        summary = [f for f in post["fields"] if f["name"] == "summary"][0]
        self.assertTrue(summary["required"])

    def test_02_树里有文章且带草稿标记(self):
        status, body = req(self.port, "/api/tree")
        self.assertEqual(status, 200)
        posts = [x for x in body if x["type"] == "post"]
        self.assertTrue(posts)
        self.assertEqual(posts[0]["path"], POST_REL)
        self.assertIn("draft", posts[0])

    def test_03_越界路径一律403(self):
        for bad in ("../../etc/passwd", "content/../../etc/passwd", "/etc/passwd"):
            status, _body = req(self.port, "/api/doc?path=" + bad)
            self.assertEqual(status, 403, bad)
            status, _body = req(self.port, "/api/doc", "PUT", {"path": bad, "body": "x"})
            self.assertEqual(status, 403, bad)

    def test_04_保存无BOM且LF且末尾换行(self):
        status, doc = req(self.port, "/api/doc?path=" + POST_REL)
        self.assertEqual(status, 200)
        fm = doc["front_matter"]
        body = "\ufeff正文前面带一个 BOM\r\n第二行\r\n"
        try:
            status, res = req(self.port, "/api/doc", "PUT",
                              {"path": POST_REL, "front_matter": fm, "body": body})
            self.assertEqual(status, 200, res)
            raw = self.post_path().read_bytes()
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), "落盘不能有 BOM")
            text = raw.decode("utf-8")
            self.assertNotIn("\r\n", text)
            self.assertTrue(text.endswith("\n"))
            self.assertNotIn("\ufeff", text)
        finally:
            # 还原，别污染后面的用例
            self.post_path().write_bytes(self.original)

    def test_05_缺必填字段422且不写盘(self):
        status, doc = req(self.port, "/api/doc?path=" + POST_REL)
        self.assertEqual(status, 200)
        before = self.post_path().read_bytes()
        fm = dict(doc["front_matter"])
        fm.pop("summary", None)
        status, res = req(self.port, "/api/doc", "PUT",
                          {"path": POST_REL, "front_matter": fm, "body": doc["body"]})
        self.assertEqual(status, 422)
        self.assertTrue(res["errors"])
        self.assertEqual(res["errors"][0]["field"], "summary")
        self.assertEqual(self.post_path().read_bytes(), before, "422 时不能写盘")

    def test_06_预览与构建同源(self):
        status, doc = req(self.port, "/api/doc?path=" + POST_REL)
        self.assertEqual(status, 200)
        status, prev = req(self.port, "/api/preview", "POST", {
            "path": POST_REL, "front_matter": doc["front_matter"], "body": doc["body"]})
        self.assertEqual(status, 200, prev)
        self.assertTrue(prev["html"].strip())
        self.assertGreater(prev["words"], 0)

        # 与构建出口直接比对（同源）
        sys.path.insert(0, str(ENGINE))
        sys.path.insert(0, str(ENGINE / "lib"))
        os.environ["REC_BLOG_SITE"] = str(self.tmp)
        import build
        d, _cs = build.load2(self.post_path())
        expect, _toc = build.render_body(d, build.render.Ctx(), 1)
        self.assertEqual(prev["html"].strip(), expect.strip())

        # 若 dist 已构建，再和真实产物比一处片段（防止前端/构建分叉）
        dist = REPO / "dist" / "p" / "md-writing.html"
        if dist.exists():
            page = dist.read_text(encoding="utf-8")
            marker = '<h3 id="为什么不用逼你学-sml">'
            self.assertIn(marker, page)
            self.assertIn(marker, prev["html"])

    def test_07_新建slug非法被拒合法不落盘(self):
        status, res = req(self.port, "/api/new", "POST",
                          {"type": "post", "title": "T", "slug": "Bad_Slug"})
        self.assertEqual(status, 422)
        status, res = req(self.port, "/api/new", "POST",
                          {"type": "post", "title": "冒烟文章", "slug": "smoke-x",
                           "author": "sal", "tags": ["rust"], "draft": True})
        self.assertEqual(status, 200, res)
        self.assertTrue(res["path"].endswith("/smoke-x/index.md"))
        self.assertFalse(res["written"], "新建不落盘，首次保存才写")
        self.assertFalse((self.tmp / "content" / res["path"]).exists())

    def test_08_无令牌401(self):
        status, _body = req(self.port, "/api/types", token=None)
        self.assertEqual(status, 401)
        status, _body = req(self.port, "/api/tree", token="wrong-token")
        self.assertEqual(status, 401)

    def test_09_日志里没有令牌(self):
        status, _body = req(self.port, "/api/types")
        self.assertEqual(status, 200)
        self.log.flush()
        text = self.log_path.read_text(encoding="utf-8")
        self.assertTrue(text.strip(), "日志应该有请求记录")
        self.assertNotIn(TOKEN, text)

    def test_10_状态接口返回分支与改动(self):
        status, body = req(self.port, "/api/status")
        self.assertEqual(status, 200)
        self.assertIn("branch", body)
        self.assertIn("dirty", body)


    # ---------------------------------------------------------------- M2 用例
    def png_bytes(self, w=1, h=1):
        raw = b"".join(b"\x00" + b"\x00" * (w * 3) for _ in range(h))
        def chunk(tag, data):
            body = tag + data
            return (struct.pack(">I", len(data)) + body
                    + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))
        return (b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw))
                + chunk(b"IEND", b""))

    def test_11_图片上传_文件名清洗与去重(self):
        data = self.png_bytes(4, 3)
        b64 = base64.b64encode(data).decode("ascii")
        s, res = req(self.port, "/api/asset", "POST",
                     {"path": POST_REL, "name": "My Photo!.png", "data_base64": b64})
        self.assertEqual(s, 200, res)
        self.assertEqual(res["name"], "my-photo.png")           # 文件名清洗
        self.assertTrue(res["url"].startswith("assets/"))
        self.assertEqual(res["markdown"], "![my-photo](assets/my-photo.png)")
        self.assertEqual(res["width"], 4)
        self.assertEqual(res["height"], 3)
        saved = self.tmp / "content" / "posts" / "2026" / "md-writing" / "assets" / "my-photo.png"
        self.assertTrue(saved.exists())
        # 同内容再传一次 → 复用同一个文件，不存第二份
        s2, res2 = req(self.port, "/api/asset", "POST",
                       {"path": POST_REL, "name": "My Photo!.png", "data_base64": b64})
        self.assertEqual(s2, 200)
        self.assertEqual(res2["name"], "my-photo.png")
        self.assertEqual(len(list(saved.parent.glob("*.png"))), 1)
        shutil.rmtree(saved.parent, ignore_errors=True)

    def test_12_图片上传_超限与非图片被拒(self):
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024 + 10)
        s, res = req(self.port, "/api/asset", "POST",
                     {"path": POST_REL, "name": "big.png",
                      "data_base64": base64.b64encode(big).decode("ascii")})
        self.assertEqual(s, 413, res)
        s, res = req(self.port, "/api/asset", "POST",
                     {"path": POST_REL, "name": "a.png",
                      "data_base64": base64.b64encode(b"hello world").decode("ascii")})
        self.assertEqual(s, 415, res)
        s, res = req(self.port, "/api/asset", "POST",
                     {"path": POST_REL, "name": "a.png", "data_base64": "!!!not-base64"})
        self.assertEqual(s, 400, res)
        assets = self.tmp / "content" / "posts" / "2026" / "md-writing" / "assets"
        self.assertFalse(assets.exists() and (assets / "big.png").exists(),
                         "被拒的图片不能落盘")

    def test_13_资源列表_过滤与提取码(self):
        bad_file = self.res_dir / "bad-url.sml"
        bad_file.write_text(
            'title: "坏链接资源"\nkind: tool\nurl: "javascript:alert(1)"\ncode: abcd\n'
            'folder: "示例"\ntags: [bad]\n', encoding="utf-8")
        try:
            s, rows = req(self.port, "/api/resources")
            self.assertEqual(s, 200)
            self.assertTrue(rows)
            for r in rows:
                self.assertIn("code", r)
            bad = [r for r in rows if r["id"] == "bad-url"]
            self.assertTrue(bad, rows)
            self.assertEqual(bad[0]["url"], "")            # javascript: 被清空
            self.assertTrue(bad[0]["url_blocked"])
            self.assertEqual(bad[0]["code"], "abcd")       # 提取码只当文本
            # 按类型 / 文件夹 / 关键字过滤
            kinds = {r["kind"] for r in rows if r["kind"]}
            if kinds:
                k = sorted(kinds)[0]
                s, filtered = req(self.port, "/api/resources?kind=" + k)
                self.assertEqual(s, 200)
                self.assertTrue(filtered)
                self.assertTrue(all(r["kind"] == k for r in filtered))
            s, by_q = req(self.port, "/api/resources?q=" + urllib.parse.quote("坏链接"))
            self.assertEqual(s, 200)
            self.assertEqual([r["id"] for r in by_q], ["bad-url"])
            s, by_folder = req(self.port, "/api/resources?folder=" + urllib.parse.quote("示例"))
            self.assertEqual(s, 200)
            self.assertEqual([r["id"] for r in by_folder], ["bad-url"])
        finally:
            bad_file.unlink(missing_ok=True)

    def test_14_构建解析resource附件(self):
        res_id = "tmp-res"
        res_file = self.res_dir / (res_id + ".sml")
        want_url = "https://example.com/book.pdf"
        # 临时资源：带提取码，便于验证「资源改了附件跟着变」
        res_file.write_text(
            'title: "临时资源"\nkind: book\nurl: "%s"\ncode: abcd\nfolder: "临时"\n'
            'tags: [tmp]\nnote: "用于 M2 回归"\n' % want_url, encoding="utf-8")
        # 临时文章：附件只写 resource 引用（没有 url / code）
        post_rel = "content/posts/2026/res-attach/index.md"
        post = self.tmp / post_rel
        post.parent.mkdir(parents=True, exist_ok=True)
        post.write_text(
            "---\ntitle: 资源附件\nauthor: sal\ndate: 2026-10-19\ntags: [rust]\n"
            "summary: 验证 resource 解析\nattachments:\n"
            "  - name: 附件\n    kind: link\n    resource: %s\n---\n\n正文。\n" % res_id,
            encoding="utf-8")
        try:
            out = self.tmp / "dist"
            b = subprocess.run(
                [sys.executable, "engine/build.py", "--site", str(self.tmp),
                 "--offline", "--out", str(out)],
                cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=300)
            self.assertEqual(b.returncode, 0, b.stdout + b.stderr)
            man = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            got = [p for p in man["posts"] if p["slug"] == "res-attach"]
            self.assertTrue(got, "构建产物里没有这篇文章")
            atts = got[0]["attachments"]
            self.assertEqual(len(atts), 1, atts)
            self.assertEqual(atts[0]["url"], want_url)
            self.assertEqual(atts[0]["code"], "abcd")
            self.assertNotIn("javascript", json.dumps(atts, ensure_ascii=False))
            # 资源改了，附件跟着变（引用 id 的意义就在这）
            res_file.write_text(res_file.read_text(encoding="utf-8")
                                .replace("abcd", "zzz9"), encoding="utf-8")
            b2 = subprocess.run(
                [sys.executable, "engine/build.py", "--site", str(self.tmp),
                 "--offline", "--out", str(out)],
                cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=300)
            self.assertEqual(b2.returncode, 0, b2.stdout + b2.stderr)
            man2 = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            atts2 = [p for p in man2["posts"] if p["slug"] == "res-attach"][0]["attachments"]
            self.assertEqual(atts2[0]["code"], "zzz9")
        finally:
            shutil.rmtree(post.parent, ignore_errors=True)
            res_file.unlink(missing_ok=True)

    def test_15_构建_资源不存在就失败(self):
        post_rel = "content/posts/2026/bad-attach/index.md"
        post = self.tmp / post_rel
        post.parent.mkdir(parents=True, exist_ok=True)
        post.write_text(
            "---\ntitle: 坏附件\nauthor: sal\ndate: 2026-10-19\ntags: [rust]\n"
            "summary: 引用不存在的资源\nattachments:\n"
            "  - name: 附件\n    kind: link\n    resource: nope-not-here\n---\n\n正文。\n",
            encoding="utf-8")
        try:
            out = self.tmp / "dist-bad"
            b = subprocess.run(
                [sys.executable, "engine/build.py", "--site", str(self.tmp),
                 "--offline", "--out", str(out)],
                cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=300)
            self.assertNotEqual(b.returncode, 0, "引用不存在的资源必须让构建失败")
            self.assertIn("nope-not-here", b.stdout + b.stderr)
        finally:
            shutil.rmtree(post.parent, ignore_errors=True)

    def test_16_删除要确认_确认对了才删(self):
        rel = "content/topics/tmp-del.md"
        f = self.tmp / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text('---\ntitle: "待删"\nsummary: "x"\n---\n\n正文。\n', encoding="utf-8")
        s, res = req(self.port, "/api/delete", "POST", {"path": rel, "confirm": "错了"})
        self.assertEqual(s, 400, res)
        self.assertTrue(f.exists(), "确认不匹配时不能删")
        s, res = req(self.port, "/api/delete", "POST", {"path": rel, "confirm": "tmp-del"})
        self.assertEqual(s, 200, res)
        self.assertFalse(f.exists(), "确认匹配后应删除")

    def test_17_重命名改短名(self):
        rel = "content/topics/tmp-mv.md"
        f = self.tmp / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text('---\ntitle: "待改名"\nsummary: "x"\n---\n\n正文。\n', encoding="utf-8")
        s, res = req(self.port, "/api/rename", "POST", {"path": rel, "slug": "Bad_Slug"})
        self.assertEqual(s, 422, res)
        s, res = req(self.port, "/api/rename", "POST", {"path": rel, "slug": "tmp-moved"})
        self.assertEqual(s, 200, res)
        self.assertEqual(res["path"], "content/topics/tmp-moved.md")
        self.assertTrue((self.tmp / "content/topics/tmp-moved.md").exists())
        self.assertFalse(f.exists())

    def test_18_外部改动后保存返回409(self):
        rel = "content/topics/tmp-conflict.md"
        f = self.tmp / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text('---\ntitle: "原文"\nsummary: "x"\n---\n\n正文。\n', encoding="utf-8")
        s, doc = req(self.port, "/api/doc?path=" + rel)
        self.assertEqual(s, 200)
        base = doc["hash"]
        self.assertTrue(base)
        f.write_text('---\ntitle: "别人改过"\nsummary: "x"\n---\n\n被外部改了。\n', encoding="utf-8")
        s, res = req(self.port, "/api/doc", "PUT", {
            "path": rel, "base_hash": base,
            "front_matter": {"title": "我的版本", "summary": "x"}, "body": "我的正文\n"})
        self.assertEqual(s, 409, res)
        self.assertEqual(res.get("code"), "E-CONFLICT")
        self.assertIn("别人改过", f.read_text(encoding="utf-8"), "409 时不能覆盖磁盘内容")
        # 拿到新 hash 后再存 → 成功
        s2, fresh = req(self.port, "/api/doc?path=" + rel)
        s, res = req(self.port, "/api/doc", "PUT", {
            "path": rel, "base_hash": fresh["hash"],
            "front_matter": {"title": "我的版本", "summary": "x"}, "body": "我的正文\n"})
        self.assertEqual(s, 200, res)
        self.assertIn("我的正文", f.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
