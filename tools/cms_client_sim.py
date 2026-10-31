#!/usr/bin/env python3
"""
模拟 TVBox/影视仓 客户端加载一个 type:0 (CMS) 源的完整流程。

按 CMS/MacCMS 协议:
  1. GET {api}?ac=videolist        -> 分类 (JSON 数组 或 XML)
  2. GET {api}?ac=videolist&t=<分类>&pg=1   或   ?ac=list&t=<分类>
  3. GET {api}?ac=list&wd=<关键词>  -> 搜索
  4. GET {api}?ac=detail&ids=<id>  -> 详情 + 选集
  5. 播放: 解析 vod_play_url 的 "标题$url#标题$url"

客户端从配置里读 categories 时会跳过第 1 步 —— 两种都测。
"""
import json
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.3.194:3150/api.php/provide/vod/at/xml/"
UA = ("Mozilla/5.0 (Linux; Android 9; SM-G973F) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
TIMEOUT = 15


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Referer": "https://www.bilibili.com/"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def parse_videolist(raw):
    """分类可能是 JSON 数组, 也可能是 XML —— 都试。"""
    txt = raw.decode("utf-8", "replace").strip()
    if txt.startswith("[") or txt.startswith("{"):
        try:
            d = json.loads(txt)
            if isinstance(d, dict):
                d = d.get("class") or d.get("data") or []
            out = []
            for c in d:
                if isinstance(c, dict):
                    out.append((str(c.get("type_id", "")), str(c.get("type_name", ""))))
            return out, "JSON"
        except json.JSONDecodeError:
            pass
    # XML 兜底
    try:
        root = ET.fromstring(txt)
    except ET.ParseError:
        return [], "无法解析"
    out = []
    for v in root.findall("video"):
        out.append((v.findtext("vod_id") or "", v.findtext("vod_name") or ""))
    return out, "XML"


def parse_list(raw):
    txt = raw.decode("utf-8", "replace").strip()
    if txt.startswith("[") or txt.startswith("{"):
        try:
            d = json.loads(txt)
            return d.get("list") or d.get("data") or []
        except json.JSONDecodeError:
            pass
    try:
        root = ET.fromstring(txt)
    except ET.ParseError:
        return []
    out = []
    for v in root.findall("video"):
        out.append({
            "vod_id": v.findtext("vod_id") or "",
            "vod_name": v.findtext("vod_name") or "",
            "vod_pic": v.findtext("vod_pic") or "",
            "vod_remarks": v.findtext("vod_remarks") or "",
            "vod_play_from": v.findtext("vod_play_from") or "",
            "vod_play_url": v.findtext("vod_play_url") or "",
        })
    return out


print(f"源: {API}\n")

# 1) 分类
cats, kind = parse_videolist(get(f"{API}?ac=videolist"))
print(f"[1] ac=videolist -> {kind}, {len(cats)} 个分类")
if not cats:
    print("    ❌ 拿不到分类 -> 客户端不会有 tab")
    sys.exit(1)
for tid, tname in cats[:6]:
    print(f"    - {tname} (type_id={tid})")

# 2) 列表: 两种请求形式都试
first_id = first_name = None
for tparam in ("videolist&t=", "list&t="):
    url = f"{API}?ac={tparam}{urllib.parse.quote(cats[0][1])}&pg=1"
    try:
        items = parse_list(get(url))
    except Exception as e:
        print(f"[2] ac={tparam} 失败: {e}")
        continue
    print(f"[2] ac={tparam}{cats[0][1]} -> {len(items)} 条")
    if items and not first_id:
        first_id = items[0]["vod_id"]
        first_name = items[0]["vod_name"]
        for it in items[:3]:
            print(f"    - {it['vod_name']}  [{it['vod_remarks']}]")

if not first_id:
    print("    ❌ 列表拿不到")
    sys.exit(1)

# 3) 搜索
items = parse_list(get(f"{API}?ac=list&wd={urllib.parse.quote(first_name)}"))
print(f"[3] 搜索 {first_name} -> {len(items)} 条")

# 4) 详情
det = parse_list(get(f"{API}?ac=detail&ids={urllib.parse.quote(first_id)}"))
print(f"[4] 详情 -> {len(det)} 条")
if det:
    d = det[0]
    eps = [e for e in (d["vod_play_url"] or "").split("#") if e]
    print(f"    {d['vod_name']} | {d['vod_remarks']} | from={d['vod_play_from']}")
    print(f"    选集 {len(eps)} 集")
    if eps:
        title, url = eps[0].split("$", 1)
        print(f"    首集: {title}")
        print(f"    地址: {url}")
        # 5) 播放地址可达性
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-65535"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                head = r.read(16)
                print(f"    ▶ 播放: HTTP {r.status}, {r.headers.get('Content-Type')}, 头={head!r}")
        except Exception as e:
            print(f"    ▶ 播放失败: {e}")

print("\n✅ 客户端流程走通")
