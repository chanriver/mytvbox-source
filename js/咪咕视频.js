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
    // 播放: 咪咕直链需 ddCalcu 签名, 交给壳子解析
    lazy: 'js:'
        + 'var pid = input;'
        + 'input = {'
        + '  parse: 1,'
        + '  jx: 1,'
        + '  play_parse: true,'
        + '  parse_type: "壳子超级解析",'
        + '  parse_source: "咪咕视频",'
        + '  url: "https://webapi.miguvideo.com/p/detail/" + pid,'
        + '  header: JSON.stringify({'
        + '    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",'
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
