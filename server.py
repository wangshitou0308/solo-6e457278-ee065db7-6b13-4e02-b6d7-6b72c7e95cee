#!/usr/bin/env python3
"""字幕节奏校准台 — 本地服务器

仅使用 Python 标准库：
  - http.server  提供静态文件与 JSON API
  - sqlite3      保存每个导入文件的本地草稿（时间轴修改）

启动：python3 server.py [端口]   默认 8000
然后浏览器打开 http://127.0.0.1:8000/
无需账号、密钥或任何外部服务。
"""
import json
import os
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get("SUBCAL_DB", os.path.join(BASE_DIR, "drafts.db"))

# 内置示例字幕：故意包含语速过快、停留过短、间隔过小、重叠等问题，
# 便于首次启动即可体验分析与自动顺延。
SAMPLE_SRT = """1
00:00:00,500 --> 00:00:02,800
欢迎来到字幕节奏校准台

2
00:00:02,850 --> 00:00:03,000
短

3
00:00:02,950 --> 00:00:05,000
这一条与上一条存在时间重叠需要处理

4
00:00:05,100 --> 00:00:06,000
这句话的语速非常快因为字数很多但停留时间非常短

5
00:00:06,050 --> 00:00:09,500
拖动时间轴上的色块边缘可以调整起止时间

6
00:00:09,520 --> 00:00:12,000
也可以整体平移，或用键盘方向键微调

7
00:00:12,100 --> 00:00:16,500
右侧列出了所有节奏问题，点击即可定位

8
00:00:16,600 --> 00:00:20,000
使用「自动顺延」可以一键生成保持顺序的修复方案

9
00:00:20,100 --> 00:00:23,000
确认差异预览后应用，最后导出成品字幕
"""

# 内置 WebVTT 示例：带逐词内联时间戳、说话人标签、类标签、ruby 注音与实体，
# 无需任何媒体即可体验词元轨道（M 键按模拟播放头依次标记）。
SAMPLE_VTT = """WEBVTT
Kind: captions

cue-1
00:00:00.500 --> 00:00:03.200
<v 小明>欢迎<00:00:01.000>使用<00:00:01.500>字幕<00:00:02.000>节奏<00:00:02.500>校准台</v>

cue-2
00:00:03.400 --> 00:00:06.500
<c.happy>选中<00:00:03.900>字幕<00:00:04.600>展开<00:00:05.100>词元<00:00:05.600>轨道</c>

cue-3
00:00:06.700 --> 00:00:10.800
播放时按 <00:00:07.600>M<00:00:08.200> 键<00:00:08.800>依次<00:00:09.400>标记<00:00:10.000>词元

cue-4
00:00:11.000 --> 00:00:15.200
<ruby>汉<rt>かん</rt>字<rt>じ</rt></ruby> 与<00:00:12.200>实体 &amp; <00:00:13.000>标签<00:00:13.600>都不<00:00:14.200>拆开

cue-5
00:00:15.500 --> 00:00:19.800
英文<00:00:16.200>单词 hello 与<00:00:17.600>数字串 12345 <00:00:19.000>同样完整

cue-6
00:00:20.000 --> 00:00:23.500
改动<00:00:20.800>区间时<00:00:21.600>比较<00:00:22.200>两种<00:00:22.800>方案
"""

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS drafts (
               key        TEXT PRIMARY KEY,
               filename   TEXT NOT NULL,
               format     TEXT NOT NULL,
               content    TEXT NOT NULL,
               updated_at REAL NOT NULL
           )"""
    )
    conn.commit()
    conn.close()


def db_get(key):
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            "SELECT key, filename, format, content, updated_at FROM drafts WHERE key = ?",
            (key,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "key": row[0],
        "filename": row[1],
        "format": row[2],
        "content": row[3],
        "updated_at": row[4],
    }


def db_save(key, filename, fmt, content):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """INSERT INTO drafts (key, filename, format, content, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 filename = excluded.filename,
                 format   = excluded.format,
                 content  = excluded.content,
                 updated_at = excluded.updated_at""",
            (key, filename, fmt, content, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def db_delete(key):
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.execute("DELETE FROM drafts WHERE key = ?", (key,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "SubCal/1.0"
    protocol_version = "HTTP/1.1"

    # 静默常见 404 之外的日志格式保持默认即可
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- 工具 ----------

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status)

    def _read_body(self, limit=10 * 1024 * 1024):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > limit:
            raise ValueError("请求体过大")
        return self.rfile.read(length)

    # ---------- 路由 ----------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            return self._send_json({"ok": True, "time": time.time()})
        if path == "/api/sample":
            kind = parse_qs(parsed.query).get("kind", ["srt"])[0]
            if kind == "vtt":
                return self._send_json({
                    "filename": "示例-逐词时间码.vtt",
                    "content": SAMPLE_VTT,
                })
            return self._send_json({
                "filename": "示例字幕.srt",
                "content": SAMPLE_SRT,
            })
        if path == "/api/draft":
            key = parse_qs(parsed.query).get("key", [""])[0]
            if not key:
                return self._send_error_json(400, "缺少 key 参数")
            draft = db_get(key)
            return self._send_json({"found": draft is not None, "draft": draft})
        if path == "/" or path == "/index.html":
            return self._serve_static("index.html")
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])
        return self._send_error_json(404, "未找到资源")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/draft":
            try:
                raw = self._read_body()
                data = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return self._send_error_json(400, "请求体不是合法 JSON")
            key = str(data.get("key") or "")[:128]
            filename = str(data.get("filename") or "")[:255]
            fmt = str(data.get("format") or "srt")[:8]
            content = data.get("content")
            if not key or not isinstance(content, str):
                return self._send_error_json(400, "缺少 key 或 content")
            if len(content) > 5 * 1024 * 1024:
                return self._send_error_json(413, "草稿内容过大")
            db_save(key, filename, fmt, content)
            return self._send_json({"ok": True, "updated_at": time.time()})
        return self._send_error_json(404, "未找到资源")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/draft":
            key = parse_qs(parsed.query).get("key", [""])[0]
            if not key:
                return self._send_error_json(400, "缺少 key 参数")
            removed = db_delete(key)
            return self._send_json({"ok": True, "removed": removed})
        return self._send_error_json(404, "未找到资源")

    # ---------- 静态文件 ----------

    def _serve_static(self, rel):
        # 防目录穿越
        rel = rel.replace("\\", "/").lstrip("/")
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(os.path.abspath(STATIC_DIR) + os.sep) and \
           full != os.path.abspath(STATIC_DIR):
            return self._send_error_json(403, "禁止访问")
        if not os.path.isfile(full):
            return self._send_error_json(404, "未找到资源")
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME_TYPES.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send_error_json(500, "读取文件失败")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("端口必须是数字", file=sys.stderr)
            sys.exit(2)
    port = int(os.environ.get("PORT", port))
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("字幕节奏校准台已启动：")
    print("  http://127.0.0.1:%d/" % port)
    print("草稿数据库：%s" % DB_PATH)
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
