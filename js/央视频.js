var rule = {
    title: '央视频',
    host: 'https://api.cntv.cn',
    searchable: 2,
    quickSearch: 0,
    filterable: 1,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://tv.cctv.com',
        'Accept': 'application/json, text/plain, */*',
    },
    timeout: 15000,
    // 注意: 央视频的「特别节目」(CHAL1460955953877151 + fc=特别节目) 上游接口恒返回
    // {"errcode":"1003"} —— 换 fc 用同一 channelid 正常,是上游的分类组合有问题,
    // 不是规则问题。该分类直接不收录。
    class_name: '栏目大全&纪录片&电视剧&动画片',
    class_url: 'column&documentary&drama&anime',
    url: '/list/getVideoAlbumList?channelid=fyclass&serviceId=tvcctv&t=json&p=fypage',
    searchUrl: 'https://search.cctv.com/ifsearch.php?page=fypage&qtext=**&sort=relevance&pageSize=20&type=video&vtime=-1&datepid=1&channel=&pageflag=0',
    // detail() 用 rule.detailUrl.replaceAll('fyid', vod_id) 生成二级 URL,
    // 二级 js: 里的 input 就是这个 URL —— 设为纯 fyid 即可让 input = 完整 vod_id
    detailUrl: 'fyid',
    // 辅助函数挂在 rule 上 —— 引擎里各解析函数的 eval 共享 rule 这个模块级变量
    预处理: `js:
    rule.CNTV = {
        CATE: {
            'column':      {id: '',                     fc: ''},
            'documentary': {id: 'CHAL1460955924871139', fc: '纪录片'},
            'drama':       {id: 'CHAL1460955853485115', fc: '电视剧'},
            'anime':       {id: 'CHAL1460955899450127', fc: '动画片'}
        },
        headers: function () {
            return {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tv.cctv.com',
                'Accept': 'application/json, text/plain, */*'
            };
        },
        get: function (path) {
            /* api.cntv.cn 有随机风控: 同一 URL 会间歇性返回 {"errcode":"1003"} */
            for (var attempt = 0; attempt < 6; attempt++) {
                try {
                    var txt = request('https://api.cntv.cn' + path, {headers: rule.CNTV.headers()});
                    var obj = JSON.parse(txt);
                    if (obj && obj.errcode === '1003') {
                        print('央视频风控拦截(' + (attempt + 1) + '),重试中...');
                        var until = (new Date()).getTime() + 1200;
                        while ((new Date()).getTime() < until) { }
                        continue;
                    }
                    return obj;
                } catch (e) {
                    print('央视频请求失败:' + e.message);
                    return null;
                }
            }
            print('央视频请求失败:连续被风控');
            return null;
        },
        /* vod_id 用 ~ 分隔(避免和引擎的 $ / @@ 冲突): ctid~sc~title~channel~brief~image~count~cate */
        pack: function (arr) {
            return arr.join('~');
        },
        unpack: function (s) {
            return s.split('~');
        }
    };
    `,
    // 一级: 分类列表
    一级: 'js:'
        + 'var cate = rule.CNTV.CATE[MY_CATE] || rule.CNTV.CATE["column"];'
        + 'var list = [];'
        + 'if (MY_CATE === "column") {'
        + '  var r = rule.CNTV.get("/lanmu/columnSearch?&fl=&fc=&cid=&p=" + MY_PAGE + "&n=20&serviceId=tvcctv&t=json");'
        + '  var docs = (r && r.response && r.response.docs) ? r.response.docs : [];'
        + '  for (var i = 0; i < docs.length; i++) {'
        + '    var it = docs[i];'
        + '    var lastV = it.lastVIDE || {};'
        + '    list.push({'
        + '      title: it.column_name || "",'
        + '      pic_url: it.column_logo || "",'
        + '      desc: it.channel_name || "",'
        + '      url: rule.CNTV.pack(["column", lastV.videoSharedCode || "", it.column_firstclass || "", it.column_name || "", it.channel_name || "", it.column_brief || "", it.column_logo || "", lastV.videoTitle || "", "栏目大全"])'
        + '    });'
        + '  }'
        + '} else {'
        + '  var r2 = rule.CNTV.get("/list/getVideoAlbumList?channelid=" + cate.id + "&fc=" + encodeURIComponent(cate.fc) + "&area=&letter=&n=24&serviceId=tvcctv&t=json&p=" + MY_PAGE);'
        + '  var arr = (r2 && r2.data && r2.data.list) ? r2.data.list : [];'
        + '  for (var j = 0; j < arr.length; j++) {'
        + '    var v = arr[j];'
        + '    list.push({'
        + '      title: v.title || "",'
        + '      pic_url: v.image || "",'
        + '      desc: (v.sc || "") + (v.year ? "·" + v.year : ""),'
        + '      url: rule.CNTV.pack([cate.id, v.id || "", v.sc || "", v.title || "", v.channel || "", v.brief || "", v.image || "", v.count || "", cate.fc])'
        + '    });'
        + '  }'
        + '}'
        + 'setResult(list);',
    // 二级: 详情 + 选集
    二级: 'js:'
        + '/* detailUrl:"fyid" 会把 vod_id 拼成完整 URL(input = https://api.cntv.cn/<vod_id>),'
        + '   先剥掉 host 前缀再拆字段 */'
        + 'var raw = String(input);'
        + 'var cut = raw.split("~")[0].lastIndexOf("/") + 1;'
        + 'var info = rule.CNTV.unpack(raw.substring(cut));'
        + 'var ctid = info[1] || "";'
        + 'var mode = (info[8] === "动画片") ? "1" : "0";'
        + 'var playUrls = [];'
        + 'var plays = [];'
        + 'var sName = ""; var sBrief = ""; var sLen = ""; var sVset = "";'
        + 'if (info[0] === "search") {'
        + '  /* 搜索结果: guid 本身就是播放 guid,那一期直接作为首集;'
        + '     再按 album_id 拉同专辑列表补选集(把该期排到最前) */'
        + '  var vi = rule.CNTV.get("/video/videoinfoByGuid?guid=" + ctid + "&serviceId=tvcctv");'
        + '  var aid = (vi && vi.album_id) ? vi.album_id : "";'
        + '  sName = (vi && vi.title) ? vi.title : info[3];'
        + '  sBrief = (vi && vi.brief) ? vi.brief : "";'
        + '  sLen = (vi && vi.len) ? vi.len : "";'
        + '  sVset = (vi && vi.vset_title) ? vi.vset_title : "";'
        + '  /* 搜索命中的那一期必须在最前 —— 它可能早于 album 前 100 条,'
        + '     所以直接把它作为首集,album 列表接在后面 */'
        + '  var self = {title: info[3] || "播放", guid: ctid};'
        + '  playUrls.push(self);'
        + '  if (aid) {'
        + '    var alb = rule.CNTV.get("/NewVideo/getVideoListByAlbumIdNew?id=" + aid + "&serviceId=tvcctv&p=1&n=100&mode=0&pub=1");'
        + '    if (alb && alb.data && alb.data.list) {'
        + '      var lst = alb.data.list;'
        + '      for (var q = 0; q < lst.length; q++) {'
        + '        if (lst[q].guid === ctid) { continue; }'
        + '        playUrls.push(lst[q]);'
        + '      }'
        + '    }'
        + '  }'
        + '} else {'
        + '  var album = rule.CNTV.get("/NewVideo/getVideoListByAlbumIdNew?id=" + ctid + "&serviceId=tvcctv&p=1&n=100&mode=" + mode + "&pub=1");'
        + '  if (album && album.errcode === "1001") {'
        + '    /* 栏目类: guid -> ctid -> 栏目选集 */'
        + '    var vi2 = rule.CNTV.get("/video/videoinfoByGuid?guid=" + ctid + "&serviceId=tvcctv");'
        + '    var realCtid = (vi2 && vi2.ctid) ? vi2.ctid : "";'
        + '    var col = rule.CNTV.get("/NewVideo/getVideoListByColumn?id=" + realCtid + "&d=&p=1&n=100&sort=desc&mode=0&serviceId=tvcctv&t=json");'
        + '    playUrls = (col && col.data && col.data.list) ? col.data.list : [];'
        + '  } else {'
        + '    playUrls = (album && album.data && album.data.list) ? album.data.list : [];'
        + '  }'
        + '}'
        + 'for (var k = 0; k < playUrls.length; k++) {'
        + '  var ep = playUrls[k];'
        + '  var title = (ep.title || ("第" + (ep.index || "?") + "集")).replace(/\\$/g, "");'
        + '  plays.push(title + "$" + (ep.guid || ""));'
        + '}'
        + 'VOD = {'
        + '  vod_id: input,'
        + '  vod_name: (info[0] === "search" && sName) ? sName : (info[3] || ""),'
        + '  vod_pic: info[6] || "",'
        + '  type_name: (info[0] === "search" && sVset) ? sVset : (info[2] || ""),'
        + '  vod_year: "",'
        + '  vod_area: "",'
        + '  vod_remarks: (info[0] === "search" && sLen) ? sLen : (info[7] ? ("共" + info[7] + "集") : (plays.length > 0 ? ("共" + plays.length + "集") : "")),'
        + '  vod_actor: "",'
        + '  vod_director: "",'
        + '  vod_content: (info[0] === "search" && sBrief) ? sBrief : (info[5] || ""),'
        + '  vod_play_from: plays.length > 0 ? "央视频" : "",'
        + '  vod_play_url: plays.join("#")'
        + '};',
    // 搜索: search.cctv.com/ifsearch.php 返回 JSON
    // 链路: ifsearch.php -> imglink 图片名提取 guid(=播放 guid) -> 详情/播放
    搜索: 'js:'
        + 'var r = null;'
        + 'try {'
        + '  r = JSON.parse(request("https://search.cctv.com/ifsearch.php?page=" + MY_PAGE'
        + '    + "&qtext=" + encodeURIComponent(KEY) + "&sort=relevance&pageSize=20&type=video"'
        + '    + "&vtime=-1&datepid=1&channel=&pageflag=0", {'
        + '    headers: {'
        + '      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",'
        + '      "Referer": "https://search.cctv.com/search.php"'
        + '    }'
        + '  }));'
        + '} catch (e) {'
        + '  print("央视频搜索失败:" + e.message);'
        + '}'
        + 'var arr = (r && r.list) ? r.list : [];'
        + 'var list = [];'
        + 'for (var i = 0; i < arr.length; i++) {'
        + '  var it = arr[i];'
        + '  /* guid 藏在封面图 URL 里: .../<32位hex>-1.jpg */'
        + '  var gm = /\\/([a-f0-9]{32})(-\\d+)?\\.jpg/i.exec(it.imglink || "");'
        + '  if (!gm) { continue; }'
        + '  var guid = gm[1];'
        + '  var name = String(it.title || "").replace(/<[^>]+>/g, "");'
        + '  var dur = it.durations ? Math.round(it.durations / 60) + "分钟" : "";'
        + '  list.push({'
        + '    title: name,'
        + '    pic_url: it.imglink || "",'
        + '    desc: (it.channel || "") + (dur ? "·" + dur : ""),'
        + '    url: rule.CNTV.pack(["search", guid, it.channel || "", name, "", it.imglink || "", "", "搜索"])'
        + '  });'
        + '}'
        + 'setResult(list);',
    // 播放: guid -> m3u8 直链
    lazy: 'js:'
        + 'var guid = input;'
        + 'input = {'
        + '  parse: 0,'
        + '  jx: 0,'
        + '  url: "https://cntv.playdreamer.cn/proxy/asp/hls/2000/0303000a/3/default/" + guid + "/2000.m3u8",'
        + '  header: JSON.stringify({'
        + '    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",'
        + '    "Referer": "https://tv.cctv.com",'
        + '    "Origin": "https://tv.cctv.com"'
        + '  })'
        + '};',
    play_parse: true,
    limit: 6,
};
