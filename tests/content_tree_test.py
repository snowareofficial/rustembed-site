#!/usr/bin/env python3
"""目录树守卫回归：E-POST-001 / E-POST-003，以及「构建与 CLI 共用同一套路径约定」。

守卫在构建期（build_posts），check.py 只读 dist/，所以这里单独起临时站点
跑真实 build.py，只断言「构建失败 + 错误码」。绝不写真实 site/ 与 dist/。

跑法：python tests/content_tree_test.py
"""

import datetime as dt
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from engine.core import content_paths  # noqa: E402


class ContentTreeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="rec-blog-tree-test-"))
        content = cls.tmp / "content"
        (content / "posts" / "2026").mkdir(parents=True)
        (content / "contracts").mkdir()
        shutil.copy(REPO / "site" / "content" / "site.sml", content / "site.sml")
        shutil.copy(REPO / "site" / "content" / "contracts" / "blog.sml",
                    content / "contracts" / "blog.sml")
        shutil.copytree(REPO / "site" / "theme", cls.tmp / "theme")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def write_post(self, rel, extra=""):
        p = self.tmp / "content" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            '---\ntitle: "守卫用例"\nauthor: sal\ndate: 2026-10-01\ntags: [rust]\n'
            'summary: "目录树守卫"\n%s---\n\n正文。\n' % extra, encoding="utf-8")
        return p

    def build(self, out_name):
        return subprocess.run(
            [sys.executable, "engine/build.py", "--site", str(self.tmp),
             "--offline", "--out", str(self.tmp / out_name)],
            cwd=str(REPO), capture_output=True, text=True, encoding="utf-8",
            timeout=300)

    def test_系列文章摊平在年目录_报E_POST_003(self):
        p = self.write_post("posts/2026/flat-series-post/index.md",
                            "series:\n  id: demo-series\n  title: Demo\n  order: 1\n")
        try:
            b = self.build("dist-flat")
            output = b.stdout + b.stderr
            self.assertNotEqual(b.returncode, 0, output)
            self.assertIn("E-POST-003", output)
        finally:
            shutil.rmtree(p.parent, ignore_errors=True)

    def test_CLI新建系列文章的落点与构建发现一致(self):
        """cli new --series 必须落到 posts/<年>/<系列>/<短名>/index.md，
        且 content_paths.iter_posts 能发现它 —— 防止 CLI 与构建各写一套路径。"""
        series, slug = "demo-series", "cli-series-post"
        b = subprocess.run(
            [sys.executable, "engine/cli.py", "new", "CLI 系列文章",
             "--slug", slug, "--series", series, "--author", "sal",
             "--site", str(self.tmp)],
            cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(b.returncode, 0, b.stdout + b.stderr)
        year = str(dt.date.today().year)
        expected = (self.tmp / "content" / "posts" / year / series / slug / "index.md")
        self.assertTrue(expected.is_file(), b.stdout)
        found = {f for f, _rel in content_paths.iter_posts(self.tmp / "content" / "posts")}
        self.assertIn(expected, found)
        shutil.rmtree(expected.parent, ignore_errors=True)

    def test_正文不叫index_报E_POST_001(self):
        p = self.write_post("posts/2026/ok-post/index.md")
        stray = p.parent / "draft-notes.md"
        stray.write_text("正文\n", encoding="utf-8")
        try:
            b = self.build("dist-stray")
            output = b.stdout + b.stderr
            self.assertNotEqual(b.returncode, 0, output)
            self.assertIn("E-POST-001", output)
        finally:
            shutil.rmtree(p.parent, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
