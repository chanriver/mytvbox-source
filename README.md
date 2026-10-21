# 自建 TVBox 源（TVBoxOSD / Cloudflare Pages）

> 个人使用的TVbox源文件


基于 `qist/tvbox` 的 `jsm.json` 整理而来的自用 TVBox 配置（本地副本已重命名为
`zlw-redmitv.json`），已补齐全部依赖文件，
可直接部署到 Cloudflare Pages，红米电视上用 TVBoxOSD 订阅即可。

原始配置本身**不能独立使用**——它引用了 38 个相对路径依赖文件
（`./jar/spider.jar`、`./lib/`、`./js/`、`./py/`、`./tvboxtv-25.txt`），
只有把整棵目录一起部署才能工作。本目录已经把它们全部就位。

## 当前规格

| 项目 | 数量 |
|---|---|
| 站点 | 62（33 个爬虫解析器经 jar 校验 100% 覆盖） |
| 可搜索 / 可筛选 / 快搜 | 78 / 34 / 43 |
| 播放解析接口 | 28 |
| 直播源 | 2 |
| 广告过滤规则 | 60 |
| DoH / 分流规则 | 5 / 19 |

`spider` 锁定的 md5 与实际 jar 一致，TVBox 下载后会通过完整性校验。

## 目录结构

```
（以下文件均在仓库根目录；Cloudflare Pages 输出目录填 `/`）
├── index.html               状态首页（浏览器打开可自检）
├── zlw-redmitv.json          主配置
├── jar/spider.jar           爬虫核心（含 77 个 csp_ 解析器）
├── lib/drpy2.min.js         drpy2 引擎
├── js/                      22 个 drpy 规则
├── py/                      6 个 Python 爬虫
└── tvboxtv-25.txt           IPv6 直播源（25 频道）
```

配置里所有路径都是**相对路径**（`./jar/spider.jar`），
TVBoxOSD 会以配置文件自身的 URL 为基准解析，
所以整套目录必须放在同一个域名下，不能拆开部署。

## 部署到 Cloudflare Pages

### 方式一：控制台拖拽（最快）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**
2. **Create application** → **Pages** → **Upload assets**
3. 项目名随意，例如 `my-tvbox`
4. 把**仓库里全部文件和文件夹**拖进去（根目录的 `zlw-redmitv.json`、`jar/`、`js/`、`py/`、`lib/`、`tvboxtv-25.txt` 都要带上，少一个就会有站点加载失败）
5. 部署完成后得到 `https://my-tvbox.pages.dev`

### 方式二：Wrangler CLI（可反复更新）

```bash
npm i -g wrangler
wrangler login

# 在仓库根目录执行
wrangler pages deploy . --project-name=my-tvbox
```

每次改完配置，重新跑一次 deploy 即可，几十秒生效。

### 方式三：接 GitHub 自动构建

把仓库推到 GitHub，Pages 项目里选 **Git** 连接，
构建命令留空（无需构建），**输出目录填 `/`**。
以后 `git push` 就自动更新。

> **注意**：`wrangler pages deploy` 的路径参数是**相对于当前工作目录**的，
> 要在仓库根目录执行，否则会传错内容。

## 红米电视上使用

1. 电视安装 **TVBoxOSD**（GitHub: `Takoboy/TVBoxOSD`，取最新 Release 的 APK）
2. 打开 App → **设置** → **配置地址**，填入：
   ```
   https://<你的域名>.pages.dev/zlw-redmitv.json
   ```
3. 保存并返回首页，App 会自动拉取配置和 `spider.jar`
4. 首次进入某个站点时如果提示加载失败，进入该站设置里点「刷新配置」重试

### 建议开启的 TVBoxOSD 设置

| 选项 | 建议值 | 原因 |
|---|---|---|
| 电视模式（TV 端） | 开启 | 自动跳过鼠标依赖的交互 |
| 自动换源 / 线路切换 | 开启 | 站点失效时可快速切换 |
| 硬件加速解码 | 开启 | 4K 视频更流畅 |
| 嗅探 / Sniffer | 按需 | 依赖解析接口播放时需要 |

## 自己改配置

`zlw-redmitv.json` 是纯 JSON，改完直接重新 deploy。常见调整：

**删掉不想要的站点** — 从 `sites` 数组里删对象即可，删完顺手确认没有别处引用它的 `ext` 文件。

**调广告过滤** — `ads` 是域名黑名单，加自己的：

```json
"ads": ["doubleclick.net", "mimg.0c1q0l.cn", "cnzz.com"]
```

**加播放解析** — 往 `parses` 里追加，注意别和已有的 `name`/`url` 重复：

```json
{ "name": "自建解析", "type": 0, "url": "https://你的解析/?url=" }
```

**更新爬虫内核** — 换掉 `jar/spider.jar`，然后把 `spider` 字段里的 md5 同步改掉：

```json
"spider": "./jar/spider.jar;md5;<新jar的md5>"
```

改完本地先验一下，避免电视端静默失败：

```powershell
(Get-FileHash .\jar\spider.jar -Algorithm MD5).Hash.ToLower()
```

md5 对不上时 TVBox 会拒绝加载或反复重下，表现为所有站点报错。

## 已做的定制清理

在上游原配置基础上，按使用需求移除了以下内容：

**境外电视台与境外影视**

| 移除项 | 说明 |
|---|---|
| 直播源 `live` | 第三方聚合列表，含 2209 个境外台（菲律宾、俄罗斯、西班牙、波兰、泰国、印尼等） |
| `ITalkBB • 外` | 自述「海外华人影视」 |
| `欧乐影院 • 外` | 自述「海外华人影视」 |
| `Anime1動畫` | `anime1.me`，日本动漫站 |

**教育类资源**

| 移除项 | 说明 |
|---|---|
| `少儿 • 教育` | B站少儿教育片单 |
| `小学 • 课堂` / `初中 • 课堂` / `高中 • 课堂` | B站同步课堂 |
| `急救 • 教学` | 急救教学教程 |

连带删除了上述站点独占的 7 个依赖文件（152 KB）：
`json/` 整个目录（4 个片单）、`js/Anime1動畫.js`、`py/ITalkBBTV.py`、`py/OleLive.py`。

保留说明：`咪咕` 与 `IPv6` 两个直播源为国内台（CCTV、各省卫视、地方台），
故予保留；`NT动漫`（ntdm.tv）为国内聚合站，未在境外范围内，故予保留。

## 已知限制

- **弹幕功能已移除**。原配置的 `danmaku` 指向 `http://127.0.0.1:9978`，
  要求 DanDanPlay 和 TVBox 同机运行，电视上不可能。要弹幕的话得自己在
  同设备跑 DanDanPlay，再把 `danmaku` 字段填回去。
- **B 站站点已去掉 cookie**。原配置依赖本机 cookie 文件换取高清晰度/会员内容，
  现在走免登录公开视频。需要会员内容得自备有效 cookie，填进 `ext.cookie`。
- **部分采集站会失效**。`csp_` 系列爬虫依赖目标站页面结构，
  上游站点改版后对应站点会失效，届时更新 jar 或删掉该站点即可。
- **`红果短剧.py` 有 243KB**，是里面最大的单个文件，拖拽部署时注意别漏。

## 来源、授权与致谢

本仓库是 `qist/tvbox` 的二次整理，**不含任何原创代码授权**。完整说明见 **[NOTICE.md](NOTICE.md)**。

- 原始配置：[`qist/tvbox`](https://github.com/qist/tvbox) 的 `jsm.json`
  （与你手上的文件 md5 完全一致：`e020f1cf5885003417f0c1a08d5917dd`）
- 爬虫内核 `jar/spider.jar`、`lib/drpy2.min.js`、`js/`、`py/`、`tvboxtv.txt`
  均取自同一仓库
- 播放器：[`Takoboy/TVBoxOSD`](https://github.com/Takoboy/TVBoxOSD)

### 授权状态（请务必留意）

上游 `qist/tvbox` **没有提供任何 LICENSE 文件**（GitHub API 返回 `license: null`），
按著作权默认规则等同于「保留所有权利」，即未授予再分发许可。

因此本仓库：

- **未对上游内容施加任何许可证**，不得被理解为 MIT / GPL / Apache；
- 上游 README 声明中明确写有「禁止商业用途」「禁止任何公众号、自媒体的转载发布」
  「请不要在中华人民共和国境内使用本仓库内容」；
- 若你要把本仓库公开，请先阅读 [NOTICE.md](NOTICE.md) 全文，
  并自行评估是否与上游声明冲突。

### 本仓库所做的修改

1. 移除 `danmaku` 字段（原指向 `http://127.0.0.1:9978` 本机代理，电视端无法工作）
2. 移除 11 个 B 站站点的本地 cookie 依赖（同上原因，改为免登录公开视频）
3. 去重：`ads` 118→60，`parses` 29→28
4. 补齐 38 个相对路径依赖，整理为独立可部署结构
5. 新增 `index.html` 状态首页、`README.md`、`NOTICE.md`、`.gitignore`

站点与解析接口的可用性由上游维护方决定。配置中收录的站点多为第三方采集源，
请自行判断内容合规性并仅作个人使用。

## 精简记录（2026-10-21）

原始配置 144 站，本仓库现为 **62 站**。逐类实测（域名连通性 / API 响应 / 内容抽样）后精简：

| 类别 | 前 | 后 | 说明 |
|---|---:|---:|---|
| 影视点播 | 41 | 10 | 同引擎只留一个（AppDrama×4 / XBPQ×2 / py×5 全部去重）；删 8 个确认失效站 |
| 4K 网盘 | 18 | 10 | PanWebShare×7 留 3 个镜像全活的；删 2 个死站 + 3 个无 host 内置站 |
| 网盘搜索 | 14 | 5 | 搜索盘留 3（百酷实测最强）/ 转存盘留 2（阿里、夸克）|
| 短剧 | 7 | 5 | 删河马（jar 内无 host）、星芽（503/404）|
| 采集站 | 15 | 5 | 保留资源池最大的 5 家（9.8 万–16.6 万条）；删 3 死 + 2 API 重复 + 1 WAF 阻断 + 3 资源量偏低 |
| 听书 | 9 | 4 | 删 3 个 drpy 死站 + 1 个与 drpy 版重复的 csp 版 |
| 官源 | 7 | 7 | 全部保留（均为公开搜索 API，免登录免会员）|
| 磁力 | 4 | 2 | 留 2 个外部可确认活的（迅雷吧、New6V）|
| 音频广播 | 7 | 3 | 去重 csp+drpy 双爬法（蜻蜓FM、DJ），删死站 A8 |
| 哔哩哔哩 | 7 | 3 | 6 个同 csp_Bili 只留合集；独立 spider 保留 BiliYS |
| 动漫 | 5 | 3 | 删 NT动漫（SSL 死）、番社（主页 989B 无内容）|
| 聚合 | 3 | 3 | 全部保留（内容差异化）|
| 戏曲曲艺 | 4 | 1 | 只留戏曲多多 |
| 教育 + 儿童 | 4 | 0 | 按需求全部删除 |

**直播源**：`tvboxtv.txt`（144 条，含大量移动 IPTV，电信出口全 403）→ **`tvboxtv-25.txt`**（25 条精选，实测 25/25 可播）

- 全部为电信 IPTV 的增量内容（景区实时 8 / 地方台 8 / 纪录自然 5 / 少数民族 2 / 少儿 2）
- 已删除 11 个不再被引用的爬虫脚本

站点清单见 [SITES.md](SITES.md) / [sites.csv](sites.csv)。

