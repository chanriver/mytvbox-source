var rule = {
    title: '咪咕视频',
    host: 'https://webapi.miguvideo.com',
    searchable: 2,
    quickSearch: 0,
    filterable: 1,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
        'Referer': 'https://www.miguvideo.com',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
    },
    timeout: 15000,
    class_name: '电影&剧集&动漫&少儿&纪录&综艺',
    class_url: '1000&1001&1007&601382&1002&1005',
    url: '/search/v3/category?&pageStart=fypage&pageNum=21&contDisplayType=fyclass&mediaYear=**',
    searchUrl: 'https://jadeite.migu.cn/search/v3/open-search',
    // detail() 用 rule.detailUrl.replaceAll('fyid', vod_id) 生成二级 URL,
    // 二级 js: 里的 input 就是这个 URL —— 设为纯 fyid 即可让 input = 完整 vod_id
    // (引擎会 urljoin(host, detailUrl),所以 input 形如 https://webapi.miguvideo.com/<id>)
    detailUrl: 'fyid',
    // 播放走真实直链(已带 ddCalcu 签名),不需要解析器,也不需要嗅探。
    // 引擎在 play_json 为空时会强制 jx:0/parse:1 覆盖 lazy 的设置,
    // 所以用 play_json 数组显式声明 parse:0/jx:0。
    play_json: [{
        re: '*',
        json: {parse: 0, jx: 0}
    }],
    预处理: `js:
    rule.MIGU = {
        headers: function () {
            return {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
                'Referer': 'https://www.miguvideo.com',
                'Accept': 'application/json, text/plain, */*'
            };
        },
        get: function (url) {
            try {
                return JSON.parse(request(url, {headers: rule.MIGU.headers()}));
            } catch (e) {
                print('咪咕请求失败:' + e.message);
                return null;
            }
        },
        post: function (url, bodyObj) {
            try {
                return JSON.parse(request(url, {
                    method: 'POST',
                    body: JSON.stringify(bodyObj),
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
                        'Referer': 'https://www.miguvideo.com',
                        'Accept': 'application/json, text/plain, */*',
                        'Content-Type': 'application/json'
                    }
                }));
            } catch (e) {
                print('咪咕POST失败:' + e.message);
                return null;
            }
        },
        pic: function (p) {
            return (p && p.pics && p.pics.highResolutionV) ? p.pics.highResolutionV : "";
        },
        /* 取当天 YYYYMMDD */
        dateString: function () {
            var d = new Date();
            return "" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
        },
        /* 咪咕 ddCalcu 加密 (旧版 720p 算法)
           来源: akiralereal/iptv extractors/migu/ddCalcuURL.js */
        ddCalcu: function (puData, programId) {
            var keys = "cdabyzwxkl";
            var out = [];
            for (var i = 0; i < puData.length / 2; i++) {
                out.push(puData[puData.length - i - 1]);
                out.push(puData[i]);
                if (i === 1) { out.push("v"); }
                else if (i === 2) { out.push(keys[parseInt(rule.MIGU.dateString()[0])]); }
                else if (i === 3) { out.push(keys[programId[6]]); }
                else if (i === 4) { out.push("a"); }
            }
            return out.join("");
        },
        /* pID -> 真实 m3u8 直链 (带 ddCalcu 签名)
           端点是 play.miguvideo.com/playurl/v1/play/playurl
           sign = md5( md5(timestamp + pid + appVersion[0:8]) + "2cac4f2c6c3346a5b34e085725ef7e33migu" + salt[0:4] )
           来源: akiralereal/iptv extractors/migu/androidURL.js */
        playUrl: function (pid, rateType) {
            try {
                var ts = Math.round(new Date().getTime()).toString();
                var av = "2600034600";
                var md5_1 = CryptoJS.MD5(ts + pid + av.substring(0, 8)).toString();
                var salt = "00000125";
                var suffix = "2cac4f2c6c3346a5b34e085725ef7e33migu" + salt.substring(0, 4);
                var sign = CryptoJS.MD5(md5_1 + suffix).toString();
                var url = "https://play.miguvideo.com/playurl/v1/play/playurl?sign=" + sign
                    + "&rateType=" + rateType + "&contId=" + pid + "&timestamp=" + ts
                    + "&salt=" + salt + "&flvEnable=true&super4k=true";
                var resp = request(url, {
                    headers: {
                        'AppVersion': av,
                        'TerminalId': 'android',
                        'X-UP-CLIENT-CHANNEL-ID': av + '-99000-201600010010028',
                        'appCode': 'miguvideo_default_android',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                        'Referer': 'https://www.miguvideo.com'
                    }
                });
                var data = JSON.parse(resp);
                var body = data.body || {};
                var raw = (body.urlInfo || {}).url;
                if (!raw) {
                    print('咪咕播放地址获取失败:' + (data.message || data.rid || "未知"));
                    return "";
                }
                var contId = (body.content && body.content.contId) || pid;
                if (raw.indexOf("&puData=") < 0) { return raw; }
                var puData = raw.split("&puData=")[1];
                return raw + "&ddCalcu=" + rule.MIGU.ddCalcu(puData, contId) + "&sv=10004&ct=android";
            } catch (e) {
                print('咪咕播放地址异常:' + e.message);
                return "";
            }
        }
    };
    `,
    // 一级: 分类列表 (contDisplayType 传 fyclass)
    一级: 'js:'
        + 'var url = "https://jadeite.migu.cn/search/v3/category?&pageStart=" + MY_PAGE + "&pageNum=21&contDisplayType=" + MY_CATE + "&mediaYear=" + ((MY_FL && MY_FL["年代"]) ? MY_FL["年代"] : "");'
        + 'var r = rule.MIGU.get(url);'
        + 'var arr = (r && r.body && r.body.data) ? r.body.data : [];'
        + 'var list = [];'
        + 'for (var i = 0; i < arr.length; i++) {'
        + '  var v = arr[i];'
        + '  list.push({'
        + '    title: v.name || "",'
        + '    pic_url: rule.MIGU.pic(v),'
        + '    desc: v.rightDownTip || "推荐",'
        + '    url: v.pID || ""'
        + '  });'
        + '}'
        + 'setResult(list);',
    // 二级: 详情 + 选集
    二级: 'js:'
        + 'var pid = input.substring(input.lastIndexOf("/") + 1);'
        + 'var r = rule.MIGU.get("https://webapi.miguvideo.com/gateway/program-dynamic/v3/cont/dynamic-cdn/" + pid + "/1");'
        + 'var data = (r && r.body && r.body.data) ? r.body.data : null;'
        + 'if (!data) { VOD = {vod_id: pid, vod_name: "未知", vod_play_from: "", vod_play_url: ""}; } else {'
        + '  var plays = [];'
        + '  var eps = data.datas;'
        + '  if (eps && eps.length) {'
        + '    for (var i = 0; i < eps.length; i++) {'
        + '      var e = eps[i];'
        + '      plays.push((e.name || ("第" + (e.index || "?") + "集")) + "$" + e.pID);'
        + '    }'
        + '  } else if (data.playing) {'
        + '    plays.push((data.playing.name || "播放") + "$" + data.playing.pID);'
        + '  }'
        + '  VOD = {'
        + '    vod_id: pid,'
        + '    vod_name: data.name || "",'
        + '    vod_pic: (data.pics && (data.pics.verticalV || data.pics.horizontalV || data.pics.bigV)) ? (data.pics.verticalV || data.pics.horizontalV || data.pics.bigV) : (data.image || ""),'
        + '    type_name: data.contentStyle || "",'
        + '    vod_year: data.year || "",'
        + '    vod_area: data.area || "",'
        + '    vod_remarks: (data.contentStyle || "") + " 评分 " + (data.score || "未知"),'
        + '    vod_actor: data.actor || "",'
        + '    vod_director: data.director || "",'
        + '    vod_content: data.detail || "",'
        + '    vod_play_from: plays.length > 0 ? "咪咕" : "",'
        + '    vod_play_url: plays.join("#")'
        + '  };'
        + '}',
    // 搜索 (POST)
    搜索: 'js:'
        + 'var r = rule.MIGU.post("https://jadeite.migu.cn/search/v3/open-search", {k: KEY, pageIdx: String(MY_PAGE)});'
        + 'var arr = (r && r.body && r.body.shortMediaAssetList) ? r.body.shortMediaAssetList : [];'
        + 'var list = [];'
        + 'for (var i = 0; i < arr.length; i++) {'
        + '  var v = arr[i];'
        + '  list.push({'
        + '    title: v.name || "",'
        + '    pic_url: rule.MIGU.pic(v),'
        + '    desc: v.contentType || "推荐",'
        + '    url: v.pID || ""'
        + '  });'
        + '}'
        + 'setResult(list);',
    // 播放: pID -> 带 ddCalcu 签名的真实 m3u8 直链
    lazy: 'js:'
        + 'var pid = input;'
        + 'var playUrl = rule.MIGU.playUrl(pid, 3);'
        + 'input = {'
        + '  parse: 0,'
        + '  jx: 0,'
        + '  url: playUrl,'
        + '  header: JSON.stringify({'
        + '    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",'
        + '    "Referer": "https://www.miguvideo.com",'
        + '    "Origin": "https://www.miguvideo.com"'
        + '  })'
        + '};',
    play_parse: true,
    limit: 6,
    filter: {
        '1000': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2024', 'v': '2024'}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}, {'n': '2019', 'v': '2019'}, {'n': '2018', 'v': '2018'}]}],
        '1001': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2025', 'v': '2025'}, {'n': '2024', 'v': '2024'}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}, {'n': '2019', 'v': '2019'}]}],
        '1002': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}]}],
        '1005': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}]}],
        '1007': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}]}],
        '601382': [{'key': '年代', 'name': '年代', 'value': [{'n': '全部', 'v': ''}, {'n': '2023', 'v': '2023'}, {'n': '2022', 'v': '2022'}, {'n': '2021', 'v': '2021'}, {'n': '2020', 'v': '2020'}]}],
    },
};
