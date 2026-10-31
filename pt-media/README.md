# NAS 片库 —— TVBox 源

把 NAS 上 MoviePilot 整理出来的剧集库暴露成 TVBox 可订阅的站点。

## 组成

| 位置 | 作用 |
|---|---|
| `pt_media.py` | 服务本体(CMS/MacCMS XML + 视频流),零依赖,只用 Python 标准库 |
| 线上容器 | `pt-media`,host 网络,`restart=unless-stopped` |
| 持久位置 | `/share/docker/MoviePilot-V3/config/pt-media/pt_media.py`(挂在 MoviePilot 的持久卷,容器重建不丢) |

## 部署

```bash
docker run -d --name pt-media \
  --restart unless-stopped \
  --network host \
  -v /share/docker/MoviePilot-V3/config/pt-media:/app:ro \
  -v /share/PT/Media:/media:ro \
  -v /share/PT/downloads:/downloadsmedia:ro \
  -e PT_MEDIA_ROOT=/media \
  -e PT_MEDIA_DOWNLOAD_ROOT=/downloadsmedia \
  -e PT_MEDIA_PORT=3150 \
  -e PT_MEDIA_BASE=http://192.168.3.194:3150 \
  python:3.12-slim python3 /app/pt_media.py
```

## 端点

```
GET /api.php/provide/vod/at/xml/?ac=videolist            -> 分类
GET /api.php/provide/vod/at/xml/?ac=videolist&t=<分类>   -> 该分类下的剧
GET /api.php/provide/vod/at/xml/?ac=list&wd=<关键词>     -> 搜索
GET /api.php/provide/vod/at/xml/?ac=detail&ids=<id>      -> 详情 + 选集
GET /img/<show_id>/<name>                                -> 海报 / 剧照
GET /stream/<episode_id>                                 -> 视频流(支持 HTTP Range)
```

## 客户端注册

`zlwtv.json` 里作为 `type: 0`(CMS 直通)站点:

```json
{
  "key": "pt_media",
  "name": "💾 NAS 片库",
  "type": 0,
  "api": "http://192.168.3.194:3150/api.php/provide/vod/at/xml/",
  "searchable": 1,
  "quickSearch": 1,
  "filterable": 0,
  "changeable": 0,
  "timeout": 15000,
  "retry": 2
}
```

## 实现要点(踩过的坑)

- **剧集 id 必须稳定**。用目录路径的 md5,不能用 `hash()` ——
  Python 对 str 的 hash 带 `PYTHONHASHSEED` 随机化,进程重启后同一个
  目录会得到不同的 id,客户端缓存的 `vod_id` 全部失效。
- **`vod_pic` / `vod_play_url` 必须是绝对地址**。相对路径客户端拉不到图、播不了。
- **视频软链指向容器内路径**。`/PT/Media` 里的 `.mp4` 是软链,目标在
  `/downloadsmedia/...`,容器要挂同名卷(`/share/PT/downloads:/downloadsmedia`)
  才能解析。
- **元数据来自 Kodi NFO**。`tvshow.nfo` 给剧名/年份/评分/类型/演职员/简介,
  每集的 `S01E01.nfo` 给该集的真实标题和单集简介。
- **Range 要正确实现**。客户端拖进度条依赖它;越界要返回 206 并截断到文件末尾,
  完全越界返回 416。
