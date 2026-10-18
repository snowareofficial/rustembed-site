#!/usr/bin/env python3
"""写作台 API 的回归测试（标准库，起真实服务，不碰真实站点内容）。

跑法：python tests/gui_api_test.py
要点：
- 用临时站点目录（site.sml + contracts + 一篇真文章）起服务，绝不写真实 content/；
- 保存纪律：无 BOM / LF / 末尾换行；非法路径 403；契约不过 422 且不写盘；
- 预览与构建同源；令牌不出现在日志里。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
