// 注意事项:此源仅支持 影视TV 及 爱佬版tvbox最新版
// 注意事项:此源仅支持 影视TV 及 爱佬版tvbox最新版
// 注意事项:此源仅支持 影视TV 及 爱佬版tvbox最新版
// 3个set-Cookie

var rule = {
	title:'Anime1动畫',
	host:'https://anime1.me',
	url: '/fyclass',
	detailUrl:'/?cat=fyid',
	searchUrl: 'https://anime1.me/?s=**',
	searchable:2,
	quickSearch:0,
	headers:{'User-Agent': 'PC_UA'},
	timeout:20000,
    class_name:'連載中&2024&2023&2022&2021&2020&2019&2018&更早',
    class_url:'連載中&2024&2023&2022&2021&2020&2019&2018&2017',
	play_parse:true,
	play_json:[{'re':'*','json':{'parse':0,'jx':0}}],
	lazy:`js:
		/* input = base64(data-apireq JSON),由二级的 data-apireq 属性解析而来。
		   data-apireq 形如 {c:catId, e:集标识, t:时间戳, p:分P, s:签名},
		   是 anime1 服务端算好的签名,直接 POST 给 v.anime1.me/api 换直链。
		   返回 {s:[{src}]} + 3 个 set-Cookie(e/p/h),带上才能拉到视频。 */
		var apireq = input;
		try { apireq = base64Decode(input); } catch (e) {}
		var apiurl = 'https://v.anime1.me/api';
		var html = request(apiurl, {
			headers: {
				'Referer': HOST,
			},
			body: 'd=' + apireq,
			method: 'POST',
			withHeaders: true
		});
		let json = JSON.parse(html);
		/* withHeaders 时引擎把响应包成 {body, set-cookie, ...},
		   body 可能是对象也可能是字符串;不带 headers 时直接就是 {s:[{src}]} */
		let body = json.body !== undefined ? json.body : json;
		if (typeof body === 'string') { body = JSON.parse(body); }
		let setCk = Object.keys(json).filter(it => it.toLowerCase() === 'set-cookie');
		let cookie = setCk ? json[setCk] : '';
		if (Array.isArray(cookie)) {
			cookie = cookie.join(';');
		}
		cookie = String(cookie).split(';').filter(function(it) {
			return ['e', 'p', 'h'].includes(it.split('=')[0])
		}).join(';');
		var purl = body.s[0].src;
		if (purl.startsWith('//')) {
			purl = 'https:' + purl
		}
		input = {
			jx: 0,
			url: purl,
			parse: 0,
			header: JSON.stringify({
				'referer': HOST,
				'Cookie': cookie,
				'user-agent': PC_UA
			}),
		}
	`,
	limit:6,
	推荐: `js:
		var d = [];
		function stripHtmlTag(src) {
			/* 不用正则:规则里的反斜杠会被引擎吃掉一层,
			   /<\/?[^>]+(>|$)/g 会变成 /</?[^>]+(>|$)/g 而报语法错 */
			var out = String(src).split('<').join('');
			out = out.split('>').join('');
			out = out.split('&nbsp;').join(' ');
			out = out.split('&#39;').join("'");
			out = out.split('&quot;').join('"');
			out = out.split('&amp;').join('&');
			return out.replace(/[ ]{2,}/g, ' ').trim();
		}
		/* 老 API 域名 d1zquzjgwo9yb.cloudfront.net 已下线,
		   现在用 anime1.me/animelist.json:
		   数组格式 [id, 剧名, 连载状态, 年份, 季度, ""],
		   id 对应详情页 https://anime1.me/?cat=<id> */
		var timestamp = new Date().getTime();
		var json = request('https://anime1.me/animelist.json?_=' + timestamp);
		var list = JSON.parse(json);
		var playKeys = list.filter(function(x) {
			if (MY_CATE === '連載中') return x[2] && x[2].indexOf('連載中') >= 0;
			else if (MY_CATE === '更早') return parseInt(x[3]) < 2017;
			else return x[3] == MY_CATE;
		});
		playKeys.forEach(function(it) {
			d.push({
				title: stripHtmlTag(it[1]),
				img: 'https://sta.anicdn.com/playerImg/8.jpg',
				desc: (it[2] || '') + (it[3] ? ' ' + it[3] : ''),
				url: 'https://anime1.me/?cat=' + it[0],
			});
		});
		setResult(d);
	`,
	一级: `js:
		var d = [];
		function stripHtmlTag(src) {
			/* 不用正则:规则里的反斜杠会被引擎吃掉一层,
			   /<\/?[^>]+(>|$)/g 会变成 /</?[^>]+(>|$)/g 而报语法错 */
			var out = String(src).split('<').join('');
			out = out.split('>').join('');
			out = out.split('&nbsp;').join(' ');
			out = out.split('&#39;').join("'");
			out = out.split('&quot;').join('"');
			out = out.split('&amp;').join('&');
			return out.replace(/[ ]{2,}/g, ' ').trim();
		}
		/* 老 API 域名 d1zquzjgwo9yb.cloudfront.net 已下线,
		   现在用 anime1.me/animelist.json:
		   数组格式 [id, 剧名, 连载状态, 年份, 季度, ""],
		   id 对应详情页 https://anime1.me/?cat=<id> */
		var timestamp = new Date().getTime();
		var json = request('https://anime1.me/animelist.json?_=' + timestamp);
		var list = JSON.parse(json);
		var playKeys = list.filter(function(x) {
			if (MY_CATE === '連載中') return x[2] && x[2].indexOf('連載中') >= 0;
			else if (MY_CATE === '更早') return parseInt(x[3]) < 2017;
			else return x[3] == MY_CATE;
		});
		playKeys.forEach(function(it) {
			d.push({
				title: stripHtmlTag(it[1]),
				img: 'https://sta.anicdn.com/playerImg/8.jpg',
				desc: (it[2] || '') + (it[3] ? ' ' + it[3] : ''),
				url: 'https://anime1.me/?cat=' + it[0],
			});
		});
		setResult(d);
	`,
	二级: `js:
		/* anime1 详情页 (?cat=<id>) 里每个 <video data-apireq="..."> 对应一集。
		   data-apireq 是服务端算好的签名 JSON:
		     {c:catId, e:集标识, t:时间戳, p:分P, s:签名}
		   播放时拿它 POST 到 v.anime1.me/api 换真实直链。 */
		var d = [];
		var html = request(input);
		var re = /data-apireq="([^"]+)"/g;
		var m;
		var eps = [];
		while ((m = re.exec(html)) !== null) {
			var raw = m[1];
			try { raw = decodeURIComponent(raw); } catch (e) {}
			var obj = null;
			try { obj = JSON.parse(raw); } catch (e2) { continue; }
			if (obj && obj.c) {
				/* 集号从 data-apireq 旁边的 [NN] 文本里取:
				   页面按新到旧排列,标题形如 "暗部共生少女 [04]" */
				/* 规则里的反斜杠会被引擎吃掉一层,正则里不能用 \s \d \[,
				   所以集号/日期都用 indexOf + 切片提取 */
				var ctx = html.substring(Math.max(0, m.index - 500), m.index + 200);
				var no = 0;
				var lb = ctx.lastIndexOf('[');
				var rb = ctx.indexOf(']', lb);
				if (lb >= 0 && rb > lb) {
					var numStr = ctx.substring(lb + 1, rb);
					var onlyDigits = true;
					for (var ci = 0; ci < numStr.length; ci++) {
						var cc = numStr.charCodeAt(ci);
						if (cc < 48 || cc > 57) { onlyDigits = false; break; }
					}
					if (onlyDigits && numStr.length <= 3) { no = parseInt(numStr); }
				}
				obj._no = no;
				/* 日期:扫 YYYY-MM-DD 形态(4位数字 + '-' + 2位 + '-' + 2位) */
				var dt = '';
				for (var di = 0; di < ctx.length - 10; di++) {
					var dch = ctx.charCodeAt(di);
					if (dch < 48 || dch > 57) { continue; }
					if (ctx.charAt(di + 4) !== '-' || ctx.charAt(di + 7) !== '-') { continue; }
					var ok = true;
					for (var dj = 0; dj < 10; dj++) {
						if (dj === 4 || dj === 7) { continue; }
						var dcc = ctx.charCodeAt(di + dj);
						if (dcc < 48 || dcc > 57) { ok = false; break; }
					}
					if (ok) { dt = ctx.substring(di, di + 10); break; }
				}
				eps.push(obj);
			}
		}
		/* 按集号升序 —— 页面是新到旧排的 */
		eps.sort(function(a, b) { return (a._no || 0) - (b._no || 0); });
		/* 页面标题里的集数(如 "[13]")是总数,集标识 e 是 "4b"/"3b" 这种 */
		var title = '';
		var h2a = html.indexOf('<h2 class="entry-title">');
		var h2b = html.indexOf('</h2>', h2a);
		if (h2a >= 0 && h2b > h2a) {
			/* h2 里是 <a href=...>剧名</a>,取 a 标签内的文本。
			   注意 inner 开头就是 <h2 class="entry-title">,第一个 '>' 是 h2 自己的,
			   所以要从 <a 之后找 '>'。 */
			var inner = html.substring(h2a, h2b);
			var aIdx = inner.indexOf('<a ');
			var aStart = aIdx >= 0 ? inner.indexOf('>', aIdx) : -1;
			var aEnd = inner.lastIndexOf('</a>');
			if (aStart >= 0 && aEnd > aStart) {
				title = inner.substring(aStart + 1, aEnd).trim();
			} else {
				title = inner.replace(/<[^>]+>/g, '').trim();
			}
		}
		var pic = '';
		var pm = html.match(/poster="([^"]+)"/);
		if (pm) { pic = pm[1]; }
		/* 播放 id 用 base64(data-apireq JSON):
		   引擎 playParse 会先 base64Decode(不含 http 的字符串)再 decodeURIComponent,
		   所以 base64 正好能被引擎原样还原,lazy 里再解一次即可。 */
		for (var i = 0; i < eps.length; i++) {
			var e = eps[i];
			var label = e._no ? ('第' + e._no + '集') : ('第' + (i + 1) + '集');
			if (e._date) { label = label + ' (' + e._date + ')'; }
			d.push({
				title: label,
				pic_url: pic,
				url: base64Encode(JSON.stringify({c: e.c, e: e.e, t: e.t, p: e.p, s: e.s}))
			});
		}
		VOD = {
			vod_id: input,
			vod_name: title || 'Anime1',
			vod_pic: pic,
			vod_remarks: eps.length + '集',
			vod_play_from: 'Anime1',
			vod_play_url: d.map(function(x) { return x.title + '$' + x.url; }).join('#')
		};
	`,
	搜索: `js:
		var d = [];
		function stripHtmlTag(src) {
			/* 不用正则:规则里的反斜杠会被引擎吃掉一层,
			   /<\/?[^>]+(>|$)/g 会变成 /</?[^>]+(>|$)/g 而报语法错 */
			var out = String(src).split('<').join('');
			out = out.split('>').join('');
			out = out.split('&nbsp;').join(' ');
			out = out.split('&#39;').join("'");
			out = out.split('&quot;').join('"');
			out = out.split('&amp;').join('&');
			return out.replace(/[ ]{2,}/g, ' ').trim();
		}
		var timestamp = new Date().getTime();
		var json = request('https://anime1.me/animelist.json?_=' + timestamp);
		var list = JSON.parse(json);
		var kw = String(KEY || '').toLowerCase();
		list.forEach(function(it) {
			if (kw && stripHtmlTag(it[1]).toLowerCase().indexOf(kw) < 0) return;
			d.push({
				title: stripHtmlTag(it[1]),
				img: 'https://sta.anicdn.com/playerImg/8.jpg',
				desc: (it[2] || '') + (it[3] ? ' ' + it[3] : ''),
				url: 'https://anime1.me/?cat=' + it[0],
			});
		});
		setResult(d);
	`,
};
