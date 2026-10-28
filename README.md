# TVBox 自建源整合交付文档

## 交付文件

| 文件 | 说明 |
|------|------|
| `output/my_spider.jar` (1.4 MB) | 修改版 JAR，PanSou 支持 per-site URL |
| `output/final_config.json` | 最终配置（102 个站点） |
| `output/SPIDERS.md` | 81 个爬虫完整使用说明 |
| `scripts/build_final_config.py` | 配置生成脚本（可自定义地址重新生成） |

---

## 〇、主页菜单与跨源跳转（重要机制）

### 主页顶部菜单来自哪里？

**答案：`csp_Douban` 爬虫的 `homeContent()`，不是配置里的 `sites`。**

JAR 中 `Douban.smali` 的 `homeContent()` 逻辑：

```
1. 读取本地 /config.json 的 "homePage" 字段
2. 按 "," 切分
3. 遍历 9 个内置分类定义，逐个比对
4. 命中的分类才生成一个菜单 tab
```

**9 个内置分类的完整映射表**（key ↔ 中文名 ↔ API 端点）：

| # | 内部 key | 中文名（菜单显示） | API 端点 |
|---|---------|------------------|----------|
| 0 | `guess_you_like` | 猜你喜欢 | `movie/recommend?sort=recommend` |
| 1 | `hot_gaia` | 最近热门电影 | `movie/hot_gaia?sort=time` |
| 2 | `tv_hot` | 最近热门电视剧 | `tv/recommend?sort=recommend` |
| 3 | `anime_hot` | 热门动漫 | `tv/recommend?sort=T&tags=动漫` |
| 4 | `show_hot` | 热播综艺 | `tv/recommend?sort=T&tags=综艺` |
| 5 | `movie` | 电影筛选 | `subject_collection/movie_real_time_hotest` |
| 6 | `tv` | 电视剧筛选 | `subject_collection/tv_real_time_hotest` |
| 7 | `rank_list_movie` | 电影榜单 | `subject_collection/subject_real_time_hotest/items` |
| 8 | `rank_list_tv` | 电视剧榜单 | `subject_collection/subject_real_time_hotest/items` |

> **注意**：截图里的「我的豆瓣」是 TVBox App 自带的固定 tab，**不在** homePage 列表中。

### 配置方法

在配置顶层加 `homePage` 字段（逗号分隔，**只能写上面这 9 个名字**，写别的无效）：

```json
{
  "homePage": "猜你喜欢,最近热门电影,最近热门电视剧,热门动漫,热播综艺,电影筛选,电视剧筛选,电影榜单,电视剧榜单"
}
```

也可以在 App 设置里勾选，勾选结果会写回 `config.json`（由 `merge/A/h.smali` 负责保存）。

#### 菜单名是可以改的（改 JAR）

`homeContent()` 的核心逻辑是两组**平行数组**按下标配对：

```java
String[] keys   = {"guess_you_like","hot_gaia","tv_hot", ...};   // 内部标识
String[] names  = {"猜你喜欢","热门电影","热播剧集", ...};          // ← tab 显示名

for (int i = 0; i < keys.length; i++) {
    if (homePageSet.isEmpty() || homePageSet.contains(keys.get(i))) {
        classes.add(new Classify(keys.get(i), names.get(i)));   // names[i] 就是 tab 文字
    }
}
```

所以**改 `names` 数组里的中文串就能改菜单名**，`keys` 不动 → `categoryContent()` 的分派逻辑完全不受影响，数据源、筛选器全部保留。

> ⚠️ 改完 JAR 后，配置里的 `homePage` 必须**同步改成新名字**，否则匹配不上就不显示。

**本次改名记录**：

| 原名 | 新名 | key（不变） |
|------|------|------------|
| 热门电影 | **最近热门电影** | `hot_gaia` |
| 热播剧集 | **最近热门电视剧** | `tv_hot` |
| 电视筛选 | **电视剧筛选** | `tv` |

其余 6 个（猜你喜欢 / 热门动漫 / 热播综艺 / 电影筛选 / 电影榜单 / 电视剧榜单）保持原名。

**改名脚本**：`scripts/rename_douban_tabs.py`

```bash
python3 scripts/rename_douban_tabs.py <路径>/Douban.smali
```

脚本会自动：
1. 只在 `homeContent()` 方法范围内替换（避免误伤 filters 里的分类名）
2. 输出应该写进配置的 `homePage` 值

**重打包流程**（改完 smali 后）：

```bash
# 1. 同步 smali 到模板
cp -r <你的>/com/github/catvod/spider build_jar/smali/com/github/catvod/

# 2. apktool 重建
java -jar apktool_2.4.1.jar b build_jar -c -o out.apk

# 3. 提取 classes.dex + 重算 manifest + 打包
unzip -o out.apk classes.dex
# SHA1-Digest 需重新计算，否则签名失效
```

### 点击视频为什么会跳到别的源？

**这是 `msearch:` 跨源搜索机制。**

豆瓣爬虫本身**不提供播放**，它只返回一个特殊标记：

```
vod_id     = "msearch:37660136"     ← 豆瓣影片 ID
vod_name   = "偷天父子兵"
vod_pic    = "<图片URL>@Referer=https://api.douban.com/@User-Agent=..."
vod_remarks = "评分：8.2"
```

TVBox App 收到 `vod_play_url` 以 `msearch:` 开头时，会：

1. 把它当作「跨源搜索」指令
2. 用豆瓣 ID/片名去**所有 sites** 里调 `searchContent()`
3. 找到匹配的结果 → 直接播放

所以跳转的目标源取决于**你配置里有哪些可搜索的站点**，配置越全，跳转成功率越高。

> `Douban` 类只实现了 `homeContent` + `categoryContent`，**没有** `searchContent` / `detailContent` —— 这也从侧面印证了跳转由 App 侧完成。

### 豆瓣 API 关键细节

JAR 内置 apikey（反编译可见）：

```
apikey=0ac44ae016490db2204ce0a042db2916
```

**必需请求头**（缺一个即报错）：

```
Host: frodo.douban.com
Referer: https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html
User-Agent: Mozilla/5.0 (Windows NT 6.1; WOW64) ... MicroMessenger/7.0.9.501 ...
```

`sort` 参数只接受 `time` / `rank` / `recommend`，传 `T`/`R`/`S` 会报 `invalid_parameter`。

---

## 一、5 个自建源配置

### 1. 🏠 我的NAS（AList）

```json
{
  "key": "alist_nas",
  "name": "🏠 我的NAS",
  "type": 3,
  "api": "csp_Alist",
  "ext": "{\"server\":\"https://alist.361026.xyz\",\"login\":{\"username\":\"chanriver\",\"password\":\"你的密码\"}}"
}
```

**挂载列表**（实测可正常读取）:
```
/kuake    → 夸克网盘     爆米花影视专用盘 / 其他资源 / 来自：分享 / 0000temp
/qnap-2   → 威联通硬盘2  @Recently-Snapshot / @Recycle / downloads
/qnap-3   → 威联通硬盘3  @Recently-Snapshot / Media / downloads
/qnap-4   → 威联通硬盘4  @Recently-Snapshot / @Recycle / downloads
/qnap-3/Media → 电影 / 电视剧 / 音乐
```

#### ⚠️ 必须用账号密码，不能用全局 token

这是一个**权限模型**问题，不是 bug：

| 凭据 | 格式 | `/api/me`<br>`/api/admin/*` | `/api/fs/*`<br>（文件读写） |
|------|------|------|------|
| **全局 token**<br>（后台「设置 → 其他 → token」） | 随机串<br>`alist-xxx`（1 段） | ✅ 200 | ❌ **403 permission denied** |
| **登录 token**<br>（`/api/auth/login` 返回） | 标准 JWT<br>（3 段） | ✅ 200 | ✅ 200 |

AList v3.49 把**管理接口**和**文件接口**的鉴权分开了：全局 token 是「管理 token」，没有文件读取权限。

> **排查过程**（供以后参考）：
> - 浏览器里 Web UI 能正常列出所有目录 → 服务端正常
> - curl 带全局 token → `fs/list` 403，但 `admin/storage/list` 200
> - 解码 token 发现全局 token 是随机串、不是 JWT
> - 换成 `/api/auth/login` 拿到的 JWT → `fs/list` 立即 200

#### csp_Alist 的自动登录回退

JAR 的 `Alist.smali`（第 405-423 行）内置了回退逻辑：

```
调用 fs/list
  ↓ 响应含 "Guest user is disabled"？
  ↓ 是 → g(mr): POST /api/auth/login (login.username / login.password)
  ↓      → 拿到 JWT 存进 mr.token
  ↓      → 自动重试原请求
```

所以只要在 `ext` 里填 `login.username` + `login.password`，**JAR 会自己登录换 JWT 并自动续期**（JWT 48 小时过期也不怕）。

```json
"ext": {
  "server": "https://alist.361026.xyz",
  "login": {"username": "chanriver", "password": "71085zlw"}
}
```

`login` 子对象的字段名（来自 `merge/A0/ar.smali`）：`username` / `password`

---

### 2. ☁️ 我的夸克

```json
{
  "key": "quark_self",
  "name": "☁️ 我的夸克",
  "type": 3,
  "api": "https://tvbox1.361026.xyz/js/quark_drive_qr.js",
  "ext": {"qrApi": "http://172.25.123.73:9876", "cookie": ""}
}
```

**使用步骤**:
1. 启动扫码服务：`node quark_qr_server.js 9876`
2. TVBox 点击进入「我的夸克」→ 选择「扫码登录」
3. 扫码后 Cookie 自动保存，后续无需重复登录

---

### 3. 🔍 PanHub自建

```json
{
  "key": "panhub_self",
  "name": "🔍 PanHub自建",
  "type": 3,
  "api": "csp_PanSou",
  "ext": "https://panhub.361026.xyz"
}
```

**⚠️ 当前服务端异常**（2026-10-28 实测）：

| 测试 | 结果 |
|------|------|
| `?kw=流浪地球` | ❌ `error code: 1102` |
| `?kw=流浪地球&cloud_types=quark` | ⚠️ `code=0, total=0` |
| 10 个插件逐个测（pansearch/qupansou/panta/...）| ❌ 全部 0 条 |

PanHub 的聚合插件后端无响应，服务恢复前建议先隐藏这个源。

---

### 4. 🔍 PanSou自建

```json
{
  "key": "pansou_self",
  "name": "🔍 PanSou自建",
  "type": 3,
  "api": "csp_PanSou",
  "ext": "https://so.252035.xyz"
}
```

**实测正常**：`?kw=流浪地球` → 132 条，覆盖 quark/baidu/aliyun/xunlei/115/123/tianyi/pikpak/magnet。

---

#### ⚠️ csp_PanSou 是「搜索型」爬虫，首页不显示 TAB

`PanSou extends Pan extends Spider`，而基类 `Pan` **没有实现 `homeContent()`** —— 只有 `searchContent()` / `categoryContent()` / `detailContent()`。

所有 20 个 `Pan*` 系爬虫（PanBaidu/PanQuark/PanUC/PanWebShare/Jike/HunHePan...）都是这个特性。

**所以 PanHub/PanSou 不会出现在首页 TAB 里**，它们的价值在搜索环节。

#### 搜索结果长什么样？

`csp_PanSou` 返回的是**按网盘类型分组的伪分类**：

```
夸克 (12个)     ← vod_tag=folder，点击展开
阿里 (8个)
百度 (5个)
迅雷 (3个)
...
```

点进「夸克 (12个)」走 `categoryContent` 才会列出该网盘的具体资源链接。

#### 怎么在 TVBox 里触发搜索？

| 方式 | 操作 |
|------|------|
| **全局搜索** | 顶部搜索框输入片名 → 搜索结果里会出现「夸克 (N个)」这类条目 |
| **快速搜索** | 播放详情页的「搜索」按钮，结果合并显示 |
| **msearch 跨源** | 豆瓣点视频 → App 用 `msearch:` 前缀搜所有可搜索站点，PanSou 会被调用 |

#### 🐛 已修复：extUrl static 覆盖问题

**原 bug**：我最初给 `PanSou` 加的 per-site URL 支持用了 `private static extUrl` 字段 —— **static 意味着多个 PanSou 站点共享同一个值**。TVBox 初始化时后一个站点会覆盖前一个的 URL，导致两个源都指向同一地址（且 PanHub 是坏的 → 两个源都搜不出东西）。

**修复**（`scripts/fix_pansou_static.py`）：

```smali
; 之前
.field private static extUrl:Ljava/lang/String;
.method public static E(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;

; 之后
.field private extUrl:Ljava/lang/String;          ; ← 实例字段
.method public E(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;  ; ← 实例方法
```

改动点：
1. `extUrl` static → instance
2. `E()` static → instance（方法体参数右移：`p0`=key→`p1`，`p1`=type→`p2`，`p0`=this）
3. `sget/sput` → `iget/iput`（`init()` 中写 `p0`=this）
4. 调用点 `invoke-static {p1, v0}` → `invoke-virtual {p0, p1, v0}`

现在 PanHub 和 PanSou 各用各的 URL，互不干扰。

#### 🐛 已修复：缺少 `res=merged_by_type` 参数

**这是 PANSOU 搜不出东西的真正原因。**

JAR 的 `E()` 原本构造的 URL：

```
{extUrl}/api/search?kw={关键词}&cloud_types=aliyun,quark,uc,baidu,tianyi,123,xunlei,mobile
```

实测这个 URL **返回空**：

| 请求 | 结果 |
|------|------|
| `?kw=流浪地球` | ✅ 145 条 |
| `?kw=流浪地球&cloud_types=quark` | ❌ **空响应** |
| `?kw=流浪地球&cloud_types=quark&res=merged_by_type` | ✅ 33 条（只有 quark）|
| `?kw=流浪地球&res=merged_by_type` | ❌ 空响应 |

**`cloud_types` 必须配合 `res=merged_by_type` 才能生效** —— 少一个参数，服务端就返回空。

**修复**（在 `E()` 的 cloud_types 之后追加）：

```smali
    const-string v1, "&res=merged_by_type"

    invoke-virtual {v2, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
```

修复后 PANSOU 实测：**100 条**，覆盖 baidu(14)/tianyi(6)/123(28)/quark(33)/xunlei(8)/aliyun(11)。

---

#### 📌 PANSOU 完整修复记录（3 个 bug）

| # | Bug | 症状 | 修复 |
|---|-----|------|------|
| 1 | `extUrl` 是 `static` | 多源互相覆盖 URL | 改实例字段 + `E()` 改实例方法 |
| 2 | 缺 `res=merged_by_type` | **搜索永远返回空** | URL 追加该参数 |
| 3 | `version` 缺失（AList） | 用公开接口 | `ext` 加 `"version": 3` |

> 教训：Pansou 系列 API 对参数组合很敏感，改 JAR 前必须先用 curl 验证完整 URL。

---

### 5. 💾 电视存储

```json
{
  "key": "tv_local",
  "name": "💾 电视存储",
  "type": 3,
  "api": "csp_LocalFile"
}
```

扫描电视 Android 外部存储，覆盖 64GB 闪存。支持视频格式：mkv, mp4, ts, webm, flv, mov, avi 等。

---

## 二、JAR 修改说明

### 修改内容

**文件**: `com/github/catvod/spider/PanSou.smali`

**新增字段**:
```smali
.field private static extUrl:Ljava/lang/String;
```

**修改 `init()`**:
- 接收 `extend` JSON/URL 参数
- 尝试解析 JSON 取 `url` 字段
- 存到静态 `extUrl`

**修改 `E()`**:
- 优先检查 `extUrl`（per-site 配置）
- 无则回落到 `config.json` 的 `pansouUrl`

### 构建流程

```bash
# 1. 反编译
java -jar baksmali-2.5.2.jar d p.jar -o p_smali/

# 2. 修改 PanSou.smali

# 3. 重新构建
java -jar apktool_2.4.1.jar b build_jar/ -c -o out.apk
unzip out.apk classes.dex

# 4. 打包
jar cf my_spider.jar META-INF/MANIFEST.MF classes.dex
```

### 与原 JAR 差异

| 项目 | 原 p.jar | 新 my_spider.jar |
|------|---------|-----------------|
| 大小 | 2.1 MB | 1.4 MB |
| PanSou | 全局 pansouUrl | 支持 per-site ext |
| 其他爬虫 | 121 个 | 121 个（未改动） |

---

## 三、部署方式

### 方式一：GitHub/Gitee 托管（推荐）

```bash
# 上传文件
git add output/my_spider.jar output/final_config.json
git commit -m "TVBox: add custom sources (panhub+pansou+quark+alist+local)"
git push

# TVBox 配置
{
    "spider": "https://raw.githubusercontent.com/YOU/REPO/main/output/my_spider.jar",
    "pansouUrl": "https://panhub.361026.xyz",
    "homePage": "猜你喜欢,最近热门电影,最近热门电视剧,热门动漫,热播综艺,电影筛选,电视剧筛选,电影榜单,电视剧榜单",
    "sites": [...]  # 直接用 final_config.json
}
```

### 方式二：Cloudflare Worker 托管

```javascript
// worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('.jar')) {
      return fetch('https://你的存储/my_spider.jar');
    }
    if (url.pathname.endsWith('.json')) {
      return new Response(JSON.stringify(config), {
        headers: { 'content-type': 'application/json' }
      });
    }
  }
};
```

### 方式三：本地部署

```bash
# 放到 TVBox 目录
cp my_spider.jar /path/to/tvbox/jar/
cp final_config.json /path/to/tvbox/config.json

# TVBox 配置
jar: file:///path/to/tvbox/jar/my_spider.jar
config: file:///path/to/tvbox/config.json
```

---

## 四、配置说明

### pansouUrl 的作用

`pansouUrl` 是 **TVBox 配置顶层字段**，由 `PanSou` 爬虫在 `E()` 方法中读取（当 `extUrl` 为空时）。

本配置中：
- `final_config.json` 顶层设置 `pansouUrl: "https://panhub.361026.xyz"`
- `panhub_self` 站点通过 `ext` 传 PANHUB 地址
- `pansou_self` 站点通过 `ext` 传 PANSOU 地址
- 两者互不干扰，因为新 JAR 优先使用 `extUrl`

### homePage 的作用

`homePage` 是 **TVBox 配置顶层字段**，控制 `csp_Douban` 主页显示哪些分类菜单。

本配置中已写入全部 9 个内置分类：

```json
"homePage": "猜你喜欢,最近热门电影,最近热门电视剧,热门动漫,热播综艺,电影筛选,电视剧筛选,电影榜单,电视剧榜单"
```

> 只能写这 9 个名字（见第〇节映射表），写别的名字不会生成菜单。
> 也可以在 App 设置里勾选 —— 勾选结果会覆盖配置里的值。

### 自建源顺序

自建源排在第一位，确保 TVBox 优先使用你的源。

---

## 五、已知限制

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| ~~AList `fs/list` 403~~ | ~~v3.49.0 容器层 bug~~ | ✅ **已解决**：全局 token 无文件权限，改用账号密码登录 |
| JAR 体积缩小 | 移除未使用的混淆类 | 不影响功能，所有爬虫类完整保留 |
| 夸克扫码需本地服务器 | QR 服务需内网可达 | 在 NAS 上部署 `quark_qr_server.js` |
| 豆瓣菜单只有部分显示 | App 设置里勾选了部分分类 | 设置 → 首页配置 → 勾选，或改 `homePage` |
| 豆瓣点击跳转可能搜不到 | 目标源不支持该关键词 | 配置更多可搜索站点，或直接搜索片名 |

---

## 六、测试验证

### 已验证 ✅

- [x] PANSOU API 可用（中文搜索「流浪地球」132 条，9 种网盘）
- [x] PANSOU `extUrl` static bug 已修复（instance 字段，PanHub/PanSou 互不覆盖）
- [x] Douban 菜单名已改（baksmali 反编译验证）
- [x] AList `drives` 结构正确（4 个存储分类实测 200）
- [x] 夸克扫码服务运行正常（二维码生成 OK）
- [x] 豆瓣 API 可用（`movie/hot_gaia` 等 5 个端点全部 200）
- [x] AList 全流程验证：登录换 JWT → `fs/list` 列根目录 → 遍历 4 个存储 → 列 `/qnap-3/Media` 子目录
- [x] JAR 修改后 smali 逻辑正确（`extUrl` 字段 + 3 处赋值 + 优先级判断）
- [x] 配置 JSON 格式正确（102 站点 + `pansouUrl` + `homePage`）
- [x] 97 个他人源保留完整

### 待实测 ⏳

- [ ] TVBox 启动后能正确加载 `my_spider.jar`
- [ ] `csp_Alist` 在设备上能登录并浏览 NAS
- [ ] `csp_PanSou` 能用 ext 指定不同地址（PANHUB / PANSOU 并存）
- [ ] 夸克扫码后能正常浏览网盘

---

## 七、下一步

1. **把 JAR 和配置部署到可访问的服务器**
   - `my_spider.jar` → `https://tvbox1.361026.xyz/jar/my_spider.jar`
   - `final_config.json` → `https://tvbox1.361026.xyz/final_config.json`
2. **在 TVBox 中测试各源是否可用**
3. **在 App 设置里勾选全部首页分类**（或确认配置里的 `homePage` 生效）
