#!/usr/bin/env python3
"""
TVBox 源健康探测 + config.json 生成

用法:
    python3 refresh.py                # 探测并生成 config.json
    python3 refresh.py --probe-only   # 只探测,输出报告

在 GitHub Actions 里每天跑一次:死源自动剔除,活源自动补上。
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import ssl
import concurrent.futures

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "cms-sources.json")
SOURCES = os.path.join(HERE, "sources.json")
REPORT = os.path.join(HERE, "report.json")

UA_TVBOX = ("Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/91.0.4472.124 Mobile Safari/537.36")
HEADER = {
    "User-Agent": UA_TVBOX,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Connection": "close",
}

# 解析/带直连
TIMEOUT = 15
MAX_WORKERS = 12

# 候选源池:从公开 TVBox 配置仓库汇总
# 结构: {"name": 显示名, "api": CMS 接口地址}
DEFAULT_POOL = []


def load_pool():
    """优先读本地的 sources.json,否则用内置池。"""
    if os.path.exists(SOURCES):
        with open(SOURCES, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return [{"name": v.get("name", ""), "api": k} for k, v in data.items()]
        return data
    return DEFAULT_POOL


def http_get(url, headers=None, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers or HEADER)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_vod_names(body):
    """从 JSON 或 XML 里提取 vod_name。"""
    names = re.findall(r'"vod_name"\s*:\s*"([^"]*)"', body)
    if not names:
        names = re.findall(r"<vod_name>(.*?)</vod_name>", body, re.S)
    return names


def probe_alive(src):
    """列表接口是否可用。"""
    try:
        body = http_get(src["api"])
        names = parse_vod_names(body)
        if names:
            return {**src, "alive": True, "count": len(names)}
        return {**src, "alive": False, "count": 0, "reason": "no vod_name"}
    except Exception as e:
        return {**src, "alive": False, "count": 0, "reason": type(e).__name__}


def probe_search(src):
    """搜索接口是否可用(用一个小众关键词试探)。"""
    kw = urllib.parse.quote("庆余年")
    base = src["api"]
    sep = "&" if "?" in base else "?"
    url = f"{base}{sep}ac=list&wd={kw}"
    try:
        body = http_get(url)
        names = parse_vod_names(body)
        if names:
            return True, names[0]
        # 区分"站点禁搜索"和"真的没这个片"
        if re.search(r"暂不支持搜索|不支持搜索|not support", body, re.I):
            return False, "nosupport"
        return False, "empty"
    except Exception as e:
        return False, type(e).__name__


def clean_name(raw, fallback):
    name = re.sub(r"^[\d]+[-_\s]*", "", raw or "").strip()
    return name or fallback


def build_config(results):
    sites, seen_names = [], {}
    for r in results:
        if not r.get("alive"):
            continue
        host = urllib.parse.urlparse(r["api"]).netloc or "src"
        base = clean_name(r.get("name"), host)
        # 同名去重:同名加序号
        n = seen_names.get(base, 0)
        seen_names[base] = n + 1
        disp = base if n == 0 else f"{base}{n+1}"
        sites.append({
            "key": f"s{n}_{re.sub(r'[^0-9A-Za-z一-鿿]', '', base)[:10]}",
            "name": disp,
            "type": 3,
            "api": r["api"],
            "searchable": 1 if r.get("searchable") else 0,
            "quickSearch": 1 if r.get("searchable") else 0,
            "filterable": 1,
            "changeable": 1,
            "header": HEADER,
            "timeout": 10000,
            "retry": 2,
            "ext": "",
        })

    return {
        "spider": ("https://gitee.com/q215613905/TVBoxOS/raw/main/JAR/XC.jar;md5;"
                   "e53eb37c4dc9c3ce1c8ee0c9943a024"),
        "wallpaper": "https://picsum.photos/1920/1080/?blur=2",
        "sites": sites,
        "lives": [],
        "parses": [{
            "name": "默认解析", "type": 0, "url": "https://jx.xmflv.com/?url=",
            "ext": {"flag": ["qq", "qiyi", "mgtv", "youku", "letv", "sohu", "xigua", "cntv"],
                    "header": {"User-Agent": "Mozilla/5.0"}},
        }],
        "flags": ["youku", "qq", "iqiyi", "iqiyi2", "letv", "sohu", "tudou",
                  "pptv", "mgtv", "wasu", "bilibili", "renrenmi"],
    }


def main():
    probe_only = "--probe-only" in sys.argv
    pool = load_pool()
    if not pool:
        print("!! 没有源池,先放一个 sources.json", file=sys.stderr)
        return 1

    print(f"探测 {len(pool)} 个源 ...", flush=True)
    t0 = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        alive = list(ex.map(probe_alive, pool))

    live = [a for a in alive if a["alive"]]
    dead = [a for a in alive if not a["alive"]]
    print(f"  存活 {len(live)} / 失效 {len(dead)}  ({time.time()-t0:.1f}s)")

    print("检测搜索能力 ...", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        search_results = list(ex.map(lambda s: probe_search(s), live))
    for s, (ok, info) in zip(live, search_results):
        s["searchable"] = ok
        s["search_info"] = info
    searchable = [s for s in live if s.get("searchable")]
    print(f"  可搜索 {len(searchable)} / {len(live)}")

    cfg = build_config(live)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"  -> {CONFIG}  ({len(cfg['sites'])} sites)")

    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump({
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "total": len(pool), "alive": len(live), "dead": len(dead),
            "searchable": len(searchable),
            "alive_sources": alive, "dead_sources": dead,
        }, f, ensure_ascii=False, indent=2)
    print(f"  -> {REPORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
