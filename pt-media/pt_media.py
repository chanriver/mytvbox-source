#!/usr/bin/env python3
"""
PT Media —— 自建 TVBox 源(CMS/MacCMS XML 协议)

把 NAS 上 MoviePilot 整理出来的剧集库(/media,Kodi NFO 格式)暴露成
TVBox 能订阅的站点:

  GET /api.php/provide/vod/at/xml/?ac=videolist        -> 分类
  GET /api.php/provide/vod/at/xml/?ac=list&wd=<kw>     -> 搜索
  GET /api.php/provide/vod/at/xml/?ac=detail&ids=<id>  -> 详情+选集
  GET /api.php/provide/vod/at/xml/?ac=videolist&t=<id> -> 某分类列表

  GET /img/<show_id>/<name>       -> 海报/剧照
  GET /stream/<episode_id>        -> 视频流(支持 HTTP Range)

部署: 跑在能看到 /media 和 /downloadsmedia 的容器里(host 网络),
      MoviePilot 容器已经挂好这两个卷。

零依赖,只用标准库。
"""
import os
import re
import json
import time
import html
import hashlib
import socket
import threading
import urllib.parse
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---- 配置 ----
MEDIA_ROOT = os.environ.get("PT_MEDIA_ROOT", "/media")
# 视频软链的目标根目录(容器内路径);MoviePilot 挂的是 /downloadsmedia
DOWNLOAD_ROOT = os.environ.get("PT_DOWNLOAD_ROOT", "/downloadsmedia")
PORT = int(os.environ.get("PT_MEDIA_PORT", "3150"))
CACHE_TTL = int(os.environ.get("PT_MEDIA_CACHE_TTL", "60"))
# 对外可达的基址 —— 图片和播放 URL 必须是绝对的,客户端才拉得到
PUBLIC_BASE = os.environ.get("PT_MEDIA_BASE", "http://192.168.3.194:3150").rstrip("/")

VIDEO_EXT = (".mp4", ".mkv", ".avi", ".ts", ".mov", ".wmv", ".flv", ".m4v", ".rmvb")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")

# 分类 = /media 下的第一层目录(电视剧/电影/...)
SHOW_ID_PREFIX = "ptm:"


# ---- 扫描 ----
class Lib:
    """扫描 /media 下的剧集目录,解析 Kodi NFO,缓存结果。"""

    def __init__(self):
        self.lock = threading.Lock()
        self.cache = None          # {shows: [...], cats: [...], at: ts}
        self.episodes = {}         # episode_id -> 绝对路径

    # --- 单集 NFO 解析 ---
    @staticmethod
    def _read_nfo(path):
        if not path or not os.path.isfile(path):
            return {}
        try:
            root = ET.parse(path).getroot()
        except Exception:
            return {}
        out = {}
        for tag in ("title", "plot", "outline", "year", "rating", "premiered",
                    "aired", "country", "studio", "mpaa", "status"):
            v = root.findtext(tag)
            if v:
                out[tag] = v.strip()
        genres = [g.text.strip() for g in root.findall("genre") if g.text]
        if genres:
            out["genre"] = genres
        directors = []
        for d in root.findall("director"):
            nm = d.text.strip() if d.text else ""
            if nm:
                directors.append(nm)
        if directors:
            out["director"] = directors
        actors = []
        for a in root.findall("actor"):
            nm = a.findtext("name")
            if nm:
                actors.append({"name": nm.strip(),
                               "role": (a.findtext("role") or "").strip(),
                               "thumb": (a.findtext("thumb") or "").strip()})
        if actors:
            out["actor"] = actors
        tmdb = root.findtext("tmdbid")
        if tmdb:
            out["tmdbid"] = tmdb.strip()
        return out

    @staticmethod
    def _episode_num(name):
        """从文件名解析 S01E03 / 第 3 集 / 03"""
        m = re.search(r"S(\d{1,2})E(\d{1,3})", name, re.I)
        if m:
            return int(m.group(1)), int(m.group(2))
        m = re.search(r"第\s*(\d+)\s*集", name)
        if m:
            return 1, int(m.group(1))
        m = re.search(r"(\d{2})[.\s]", name)
        if m:
            return 1, int(m.group(1))
        return 1, 0

    def _scan_show(self, show_dir):
        """一个含 tvshow.nfo 的目录 = 一部剧"""
        tvshow = self._read_nfo(os.path.join(show_dir, "tvshow.nfo"))
        title = tvshow.get("title") or os.path.basename(show_dir).split(" (")[0]

        # 收集剧集
        eps = []
        for dp, dn, fn in os.walk(show_dir):
            for f in sorted(fn):
                if f.lower().endswith(VIDEO_EXT):
                    eps.append((dp, f))
        eps.sort(key=lambda x: self._episode_num(x[1]))

        # 海报候选
        posters = {}
        for dp, dn, fn in os.walk(show_dir):
            depth = os.path.relpath(dp, show_dir).count(os.sep)
            if depth > 1:
                continue
            for f in fn:
                if f.lower().endswith(IMAGE_EXT):
                    posters.setdefault(f.lower(), os.path.join(dp, f))

        def pick(*names):
            for n in names:
                if n in posters:
                    return posters[n]
            return ""

        poster = pick("poster.jpg", "season01-poster.jpg", "folder.jpg", "cover.jpg")
        backdrop = pick("fanart.jpg", "backdrop.jpg", "show4kbackground.jpg")
        thumb = pick("thumb.jpg", "landscape.jpg")

        episodes = []
        for i, (dp, f) in enumerate(eps):
            full = os.path.join(dp, f)
            real = os.path.realpath(full)
            # 软链目标可能在 DOWNLOAD_ROOT 下(容器内路径),映射回宿主可读路径
            real = self._map_download(real)
            eid = f"pte:{len(episodes)}"
            self.episodes[eid] = real
            s, e = self._episode_num(f)
            enfo = self._read_nfo(os.path.join(dp, os.path.splitext(f)[0] + ".nfo"))
            title_ep = enfo.get("title") or f"第{e}集"
            episodes.append({
                "id": eid,
                "name": title_ep,
                "num": e or (i + 1),
                "season": s,
                "path": full,
                "real": real,
                "size": self._size(real),
                "plot": enfo.get("plot", ""),
                "thumb": self._rel_img(show_dir, os.path.join(dp, os.path.splitext(f)[0] + ".jpg")),
                "rating": enfo.get("rating", ""),
                "aired": enfo.get("aired", ""),
            })

        sid = SHOW_ID_PREFIX + self._stable_id(show_dir)
        return {
            "id": sid,
            "dir": show_dir,
            "title": title,
            "year": tvshow.get("year", ""),
            "rating": tvshow.get("rating", ""),
            "plot": tvshow.get("plot", "") or tvshow.get("outline", ""),
            "genre": tvshow.get("genre", []),
            "director": tvshow.get("director", []),
            "actor": tvshow.get("actor", []),
            "country": tvshow.get("country", ""),
            "studio": tvshow.get("studio", ""),
            "premiered": tvshow.get("premiered", ""),
            "poster": self._rel_img(show_dir, poster),
            "backdrop": self._rel_img(show_dir, backdrop),
            "thumb": self._rel_img(show_dir, thumb),
            "episodes": episodes,
        }

    @staticmethod
    def _stable_id(path):
        """稳定的目录 id。

        不能用 hash():Python 对 str 的 hash 带 PYTHONHASHSEED 随机化,
        进程重启后同一个目录会得到不同的 id,客户端缓存的 vod_id 全部失效。
        """
        return hashlib.md5(path.encode("utf-8")).hexdigest()[:10]

    @staticmethod
    def _map_download(real):
        """把容器内软链目标映射成容器内真实可读路径"""
        # real 已经是 realpath;若指向 /downloadsmedia 下则原样保留
        return real

    @staticmethod
    def _size(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0

    def _rel_img(self, show_dir, path):
        """图片路径转成绝对 URL —— 客户端要能直接拉图,相对路径不行"""
        if not path or not os.path.isfile(path):
            return ""
        base = os.path.basename(path)
        sid = SHOW_ID_PREFIX + self._stable_id(show_dir)
        return f"{PUBLIC_BASE}/img/{sid}/{urllib.parse.quote(base)}"

    def scan(self):
        with self.lock:
            if self.cache and (time.time() - self.cache["at"]) < CACHE_TTL:
                return self.cache
            shows = []
            self.episodes = {}
            if os.path.isdir(MEDIA_ROOT):
                for dp, dn, fn in os.walk(MEDIA_ROOT):
                    if "tvshow.nfo" in fn:
                        try:
                            shows.append(self._scan_show(dp))
                        except Exception as e:
                            print(f"[scan] {dp}: {e}", flush=True)
                        dn[:] = []  # 不再往下递归(剧集目录里不会有子剧集)
            cats = {}
            for s in shows:
                rel = os.path.relpath(s["dir"], MEDIA_ROOT)
                parts = rel.split(os.sep)
                cat = parts[0] if len(parts) > 1 else "其他"
                cats.setdefault(cat, []).append(s)
            self.cache = {"shows": shows, "cats": cats, "at": time.time()}
            print(f"[scan] {len(shows)} 部剧 / {len(cats)} 个分类", flush=True)
            return self.cache


LIB = Lib()


# ---- XML 输出 ----
def esc(s):
    return html.escape(str(s or ""), quote=False)


def vod_xml(items):
    out = ['<?xml version="1.0" encoding="utf-8"?>', "<list>"]
    for it in items:
        out.append("<video>")
        out.append(f'<vod_id>{esc(it["id"])}</vod_id>')
        out.append(f'<vod_name>{esc(it["name"])}</vod_name>')
        out.append(f'<vod_pic>{esc(it.get("pic", ""))}</vod_pic>')
        if it.get("sub"):
            out.append(f'<vod_sub>{esc(it["sub"])}</vod_sub>')
        if it.get("remarks"):
            out.append(f'<vod_remarks>{esc(it["remarks"])}</vod_remarks>')
        if it.get("year"):
            out.append(f'<vod_year>{esc(it["year"])}</vod_year>')
        if it.get("area"):
            out.append(f'<vod_area>{esc(it["area"])}</vod_area>')
        if it.get("type"):
            out.append(f'<vod_class>{esc(it["type"])}</vod_class>')
        if it.get("actor"):
            out.append(f'<vod_actor>{esc(it["actor"])}</vod_actor>')
        if it.get("director"):
            out.append(f'<vod_director>{esc(it["director"])}</vod_director>')
        if it.get("content"):
            out.append(f'<vod_content>{esc(it["content"])}</vod_content>')
        if it.get("play_from"):
            out.append(f'<vod_play_from>{esc(it["play_from"])}</vod_play_from>')
        if it.get("play_url"):
            out.append(f'<vod_play_url>{esc(it["play_url"])}</vod_play_url>')
        out.append("</video>")
    out.append("</list>")
    return "\n".join(out)


def show_to_vod(s):
    """剧集 -> CMS video 节点"""
    eps = s["episodes"]
    plays = []
    for e in eps:
        # TVBox 的 $ 分隔: 标题$url —— url 必须是绝对地址
        plays.append(f"{e['name']}${PUBLIC_BASE}/stream/{e['id']}")
    return {
        "id": s["id"],
        "name": s["title"],
        "pic": s["poster"] or s["thumb"] or s["backdrop"],
        "sub": "",
        "remarks": f"{len(eps)}集" if eps else "无资源",
        "year": s["year"],
        "area": s["country"],
        "type": "/".join(s["genre"]) if s["genre"] else "",
        "actor": ", ".join(a["name"] for a in s["actor"]) if s["actor"] else "",
        "director": ", ".join(s["director"]) if s["director"] else "",
        "content": s["plot"],
        "play_from": "NAS",
        "play_url": "#".join(plays),
    }


# ---- HTTP ----
class Handler(BaseHTTPRequestHandler):
    server_version = "PTMedia/1.0"

    def log_message(self, fmt, *args):
        pass  # 静默

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if path.startswith("/api.php/provide/vod"):
                return self._cms(qs)
            if path.startswith("/img/"):
                return self._img(path)
            if path.startswith("/stream/"):
                return self._stream(path)
            if path in ("/", "/index.html"):
                return self._send(200, self._index())
            return self._send(404, "not found")
        except Exception as e:
            return self._send(500, f"error: {e}")

    # --- CMS ---
    def _cms(self, qs):
        ac = (qs.get("ac") or ["list"])[0]
        data = LIB.scan()

        if ac == "videolist":
            # 带 t= 就是列某分类
            t = (qs.get("t") or [""])[0]
            if t:
                shows = data["cats"].get(t, [])
                return self._send(200, vod_xml([show_to_vod(s) for s in shows]),
                                  "text/xml; charset=utf-8")
            # 无 t -> 返回分类列表
            items = []
            for cat, shows in data["cats"].items():
                items.append({
                    "id": cat, "name": cat, "pic": "", "sub": "",
                    "remarks": f"{len(shows)}部", "year": "", "area": "",
                    "type": "", "actor": "", "director": "", "content": "",
                    "play_from": "", "play_url": "",
                })
            return self._send(200, vod_xml(items), "text/xml; charset=utf-8")

        if ac == "detail":
            ids = (qs.get("ids") or [""])[0]
            target = None
            for s in data["shows"]:
                if s["id"] == ids:
                    target = s
                    break
            if not target:
                return self._send(200, vod_xml([]), "text/xml; charset=utf-8")
            return self._send(200, vod_xml([show_to_vod(target)]),
                              "text/xml; charset=utf-8")

        # ac=list  -> 搜索
        wd = (qs.get("wd") or [""])[0].strip()
        if wd:
            w = wd.lower()
            matched = [s for s in data["shows"]
                       if w in s["title"].lower()
                       or w in s["plot"].lower()
                       or any(w in g.lower() for g in s["genre"])
                       or any(w in a["name"].lower() for a in s["actor"])]
        else:
            matched = data["shows"]
        return self._send(200, vod_xml([show_to_vod(s) for s in matched]),
                          "text/xml; charset=utf-8")

    # --- 图片 ---
    def _img(self, path):
        # /img/<sid>/<name>
        parts = path.split("/")
        if len(parts) < 4:
            return self._send(404, "bad img path")
        sid = parts[2]
        name = parts[3]
        data = LIB.scan()
        target = None
        for s in data["shows"]:
            if s["id"] == sid:
                target = s
                break
        if not target:
            return self._send(404, "no show")
        # 在剧集目录里找同名图片
        for dp, dn, fn in os.walk(target["dir"]):
            if name in fn:
                fp = os.path.join(dp, name)
                try:
                    with open(fp, "rb") as f:
                        data_bytes = f.read()
                except OSError:
                    break
                ctype = "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "image/png"
                return self._send(200, data_bytes, ctype)
        return self._send(404, "no image")

    # --- 视频流 ---
    def _stream(self, path):
        eid = path[len("/stream/"):]
        real = LIB.episodes.get(eid)
        if not real or not os.path.isfile(real):
            return self._send(404, "no episode")
        size = os.path.getsize(real)
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = int(m.group(2))
                if end >= size:
                    end = size - 1
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                code = 206
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            with open(real, "rb") as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(1024 * 512, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f"[stream] {e}", flush=True)

    def _index(self):
        data = LIB.scan()
        rows = "".join(
            f"<tr><td>{esc(s['title'])}</td><td>{esc(s['year'])}</td>"
            f"<td>{len(s['episodes'])}</td><td>{esc(s['plot'][:60])}</td></tr>"
            for s in data["shows"])
        return (f"<h1>PT Media TVBox 源</h1>"
                f"<p>剧集 {len(data['shows'])} 部 / 分类 {len(data['cats'])} 个</p>"
                f"<table border=1 cellpadding=4>{rows}</table>"
                f"<p>CMS: /api.php/provide/vod/at/xml/?ac=list</p>")


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print(f"[pt-media] 监听 0.0.0.0:{PORT}  media={MEDIA_ROOT}", flush=True)
    LIB.scan()
    srv.serve_forever()


if __name__ == "__main__":
    main()
