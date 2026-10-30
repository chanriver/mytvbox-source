// B 站（bilibili）爬蟲，純 QuickJS 實作，不依賴自帶 JAR。
// 使用方式：TVBox 設定檔以 "api": "https://你的域名/bili.js" 載入。

const API = "https://api.bilibili.com";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER_HOME = "https://www.bilibili.com";
const REFERER_SEARCH = "https://search.bilibili.com";
const REQUEST_TIMEOUT_MS = 15000;
const LIST_PAGE_SIZE = 20;

const CLASS_RANK = "v_rank";
const CLASS_POPULAR = "v_popular";
const CLASS_REGION = "v_region";
const CLASS_BANGUMI = "bangumi";
const CLASS_UP = "up";
const UP_PREFIX = "up_";
const SEASON_PREFIX = "s";

// WBI 換位表，共 64 項。
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
];

// Python urllib.parse.quote_plus 永不被轉義的字元。
const UNRESERVED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~";
// 二次轉義時額外保留的字元。
const SIGN_SAFE_CHARS = "!*'()";
// WBI 規範要求從參數值中移除的字元。
const SIGN_UNSAFE_CHARS = "!'()*";

const MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_CONSTANTS = (() => {
    const list = [];
    for (let index = 0; index < 64; index++) {
        list.push(Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296));
    }
    return list;
})();

// ---------- 字串與編碼工具 ----------

function stringValue(value) {
    return value === null || value === undefined ? "" : String(value);
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pad2(value) {
    return value < 10 ? "0" + value : String(value);
}

function hexByte(value) {
    const text = (value & 0xff).toString(16).toUpperCase();
    return text.length < 2 ? "0" + text : text;
}

function utf8Bytes(text) {
    const bytes = [];
    const source = stringValue(text);
    for (let index = 0; index < source.length; index++) {
        let code = source.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
            const next = source.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                index++;
            }
        }
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return bytes;
}

function quotePlus(text) {
    let result = "";
    for (const byte of utf8Bytes(text)) {
        const char = String.fromCharCode(byte);
        if (byte === 0x20) result += "+";
        else if (UNRESERVED_CHARS.indexOf(char) >= 0) result += char;
        else result += "%" + hexByte(byte);
    }
    return result;
}

function quoteExtra(text) {
    let result = "";
    for (const byte of utf8Bytes(text)) {
        const char = String.fromCharCode(byte);
        if (byte === 0x20) result += "%20";
        else if (UNRESERVED_CHARS.indexOf(char) >= 0 || SIGN_SAFE_CHARS.indexOf(char) >= 0) result += char;
        else result += "%" + hexByte(byte);
    }
    return result;
}

function stripSignUnsafe(text) {
    return stringValue(text).split("").filter((char) => SIGN_UNSAFE_CHARS.indexOf(char) < 0).join("");
}

function stripHtml(text) {
    const plain = stringValue(text)
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    return plain.replace(/\s+/g, " ").trim();
}

function safeLabel(text) {
    return stringValue(text).replace(/\$/g, "＄").replace(/#/g, "＃").trim();
}

function durationText(value) {
    const raw = stringValue(value).trim();
    if (!raw) return "";
    if (!/^\d+$/.test(raw)) return raw;
    const seconds = parseInt(raw, 10);
    if (seconds <= 0) return "";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return hours + ":" + pad2(minutes) + ":" + pad2(rest);
    return minutes + ":" + pad2(rest);
}

function toHttps(url) {
    const text = stringValue(url).trim();
    if (text.startsWith("http://")) return "https://" + text.slice(7);
    return text;
}

function toInt(value, fallback) {
    const parsed = parseInt(stringValue(value).trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- MD5（QuickJS 沒有 crypto，需自帶實作）----------

function md5Hex(text) {
    const bytes = utf8Bytes(text);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const low = bitLength >>> 0;
    const high = Math.floor(bitLength / 4294967296) >>> 0;
    bytes.push(low & 0xff, (low >>> 8) & 0xff, (low >>> 16) & 0xff, (low >>> 24) & 0xff);
    bytes.push(high & 0xff, (high >>> 8) & 0xff, (high >>> 16) & 0xff, (high >>> 24) & 0xff);

    let stateA = 0x67452301;
    let stateB = 0xefcdab89;
    let stateC = 0x98badcfe;
    let stateD = 0x10325476;
    const block = new Array(16);

    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let index = 0; index < 16; index++) {
            const position = offset + index * 4;
            block[index] = bytes[position] | (bytes[position + 1] << 8)
                | (bytes[position + 2] << 16) | (bytes[position + 3] << 24);
        }
        let roundA = stateA;
        let roundB = stateB;
        let roundC = stateC;
        let roundD = stateD;
        for (let index = 0; index < 64; index++) {
            let mix;
            let pick;
            if (index < 16) {
                mix = (roundB & roundC) | (~roundB & roundD);
                pick = index;
            } else if (index < 32) {
                mix = (roundD & roundB) | (~roundD & roundC);
                pick = (5 * index + 1) % 16;
            } else if (index < 48) {
                mix = roundB ^ roundC ^ roundD;
                pick = (3 * index + 5) % 16;
            } else {
                mix = roundC ^ (roundB | ~roundD);
                pick = (7 * index) % 16;
            }
            const sum = (mix + roundA + MD5_CONSTANTS[index] + block[pick]) >>> 0;
            const shift = MD5_SHIFTS[index];
            roundA = roundD;
            roundD = roundC;
            roundC = roundB;
            roundB = (roundB + (((sum << shift) | (sum >>> (32 - shift))) >>> 0)) >>> 0;
        }
        stateA = (stateA + roundA) >>> 0;
        stateB = (stateB + roundB) >>> 0;
        stateC = (stateC + roundC) >>> 0;
        stateD = (stateD + roundD) >>> 0;
    }

    return [stateA, stateB, stateC, stateD].map(hexWord).join("");
}

function hexWord(value) {
    let result = "";
    for (let index = 0; index < 4; index++) {
        result += hexByte((value >>> (index * 8)) & 0xff);
    }
    return result.toLowerCase();
}

// ---------- WBI 簽名 ----------

function imageKey(url) {
    const name = stringValue(url).slice(stringValue(url).lastIndexOf("/") + 1);
    const dot = name.indexOf(".");
    return dot < 0 ? name : name.slice(0, dot);
}

function mixinKeyOf(imgKey, subKey) {
    const raw = stringValue(imgKey) + stringValue(subKey);
    if (raw.length < 32) return "";
    let mixed = "";
    for (const index of MIXIN_KEY_ENC_TAB) mixed += raw.charAt(index);
    return mixed.slice(0, 32);
}

function buildSignedQuery(params, mixinKey, timestamp) {
    const merged = {};
    for (const key of Object.keys(params)) merged[key] = stringValue(params[key]);
    merged["wts"] = stringValue(timestamp);
    const keys = Object.keys(merged).sort();
    let plain = "";
    for (const key of keys) {
        if (plain.length > 0) plain += "&";
        plain += quotePlus(key) + "=" + quotePlus(stripSignUnsafe(merged[key]));
    }
    return plain + "&w_rid=" + md5Hex(plain + stringValue(mixinKey));
}

// ---------- 主程式 ----------

function createSpider(site = {}) {
    const siteKey = isObject(site) ? stringValue(site.key).trim() : "";
    let options = {};
    let cookie = "";
    let cookieSource = "";
    let cookiePromise = null;
    let mixinKeyCache = "";

    function init(ext) {
        options = parseOptions(ext);
        const raw = stringValue(options.cookie).trim();
        if (raw.startsWith("http")) {
            cookieSource = raw;
            cookie = "";
        } else {
            cookie = raw;
            cookieSource = "";
        }
        options.quality = toInt(options.quality, 64);
        options.search_type = stringValue(options.search_type || "video").trim() || "video";
        options.up_mid = stringValue(options.up_mid).trim();
        options.user_agent = stringValue(options.user_agent).trim() || DEFAULT_USER_AGENT;
    }

    function home(filter) {
        const classes = [
            {type_id: CLASS_RANK, type_name: "排行榜"},
            {type_id: CLASS_POPULAR, type_name: "热门"},
            {type_id: CLASS_REGION, type_name: "分区视频"},
            {type_id: CLASS_BANGUMI, type_name: "番剧"},
            {type_id: CLASS_UP, type_name: "UP主投稿"},
        ];
        if (options.up_mid) {
            classes.push({type_id: UP_PREFIX + options.up_mid, type_name: "投稿:" + options.up_mid});
        }
        const result = {class: classes};
        if (filter) {
            result.filters = {
                [CLASS_RANK]: rankFilters(),
                [CLASS_REGION]: regionFilters(),
                [CLASS_BANGUMI]: seasonFilters(),
                [CLASS_UP]: upFilters(),
            };
        }
        return result;
    }

    async function homeVod() {
        try {
            const body = await apiGet(`${API}/x/web-interface/popular?ps=${LIST_PAGE_SIZE}&pn=1`, REFERER_HOME);
            const list = arrayOf(body, "data", "list");
            return {list: list.map((item) => toVod(item))};
        } catch (error) {
            return {list: [], msg: "首页加载失败：" + errorMessage(error)};
        }
    }

    async function category(tid, pg, filter, extend) {
        const page = Math.max(1, toInt(pg, 1));
        const selected = isObject(extend) ? extend : {};
        try {
            if (tid === CLASS_RANK) return await rankContent(page, selected);
            if (tid === CLASS_POPULAR) return await popularContent(page);
            if (tid === CLASS_REGION) return await regionContent(page, selected);
            if (tid === CLASS_BANGUMI) return await seasonContent(page, selected);
            if (tid === CLASS_UP) return await upContent(page, selected, options.up_mid);
            if (tid.startsWith(UP_PREFIX)) return await upContent(page, selected, tid.slice(UP_PREFIX.length));
            return {list: [], page, pagecount: 1, limit: 0};
        } catch (error) {
            return {list: [], page, pagecount: 1, limit: 0, msg: "分类加载失败：" + errorMessage(error)};
        }
    }

    async function detail(id) {
        const ident = stringValue(id).trim();
        if (!ident) return {list: [], msg: "缺少影片 ID"};
        try {
            if (ident.startsWith(SEASON_PREFIX)) {
                return {list: [await seasonDetail(ident.slice(SEASON_PREFIX.length))]};
            }
            return {list: [await videoDetail(ident)]};
        } catch (error) {
            return {list: [], msg: "详情加载失败：" + errorMessage(error)};
        }
    }

    async function search(key, quick, pg) {
        const keyword = stringValue(key).trim();
        const page = Math.max(1, toInt(pg, 1));
        if (!keyword) return {list: [], page: 1, pagecount: 1, limit: 0};
        try {
            if (options.search_type === "bangumi") {
                try {
                    const result = await searchBangumi(keyword, page);
                    if (result.list.length) return result;
                } catch (error) {
                    // 番剧搜索接口常被风控拦截，回退到视频搜索。
                }
            }
            return await searchVideo(keyword, page);
        } catch (error) {
            return {list: [], page, pagecount: 1, limit: 0, msg: "搜索失败：" + errorMessage(error)};
        }
    }

    async function play(flag, id, vipFlags) {
        const raw = stringValue(id).trim();
        const separator = raw.indexOf("|");
        const bvid = separator < 0 ? raw : raw.slice(0, separator);
        const cid = separator < 0 ? "" : raw.slice(separator + 1);
        if (!bvid || !cid) return {parse: 0, msg: "无效的播放 ID"};
        try {
            const body = await apiGet(`${API}/x/player/playurl?bvid=${bvid}&cid=${cid}`
                + `&qn=${options.quality || 64}&fnval=0&fourk=1`, REFERER_HOME);
            const durl = arrayOf(body, "data", "durl");
            let url = "";
            if (durl.length) {
                url = stringValue(durl[0].url);
                if (!url && Array.isArray(durl[0].backup_url) && durl[0].backup_url.length) {
                    url = stringValue(durl[0].backup_url[0].url);
                }
            }
            if (!url) return {parse: 0, msg: "取得直链失败"};
            return {
                parse: 0,
                jx: 0,
                url,
                header: {"User-Agent": options.user_agent, "Referer": REFERER_HOME},
            };
        } catch (error) {
            return {parse: 0, msg: "播放地址获取失败：" + errorMessage(error)};
        }
    }

    function destroy() {
        cookiePromise = null;
        mixinKeyCache = "";
    }

    // 診斷用：回傳 MD5 / WBI 簽名的離線驗證結果。
    function selfTest() {
        return {
            md5: md5Hex("abc"),
            mixin_key: mixinKeyOf("7cd084941338484aae1ad9425b84077c", "4932caff0ff746eab6f01bf08b70ac45"),
            signed: buildSignedQuery(
                {mid: 1, pn: 1, ps: 30, order: "pubdate", platform: "web", web_location: 1550101},
                "ea1db124af3c7062474693fa704f4ff8",
                1700000000
            ),
            site_key: siteKey,
        };
    }

    // ---------- 各分類實作 ----------

    async function rankContent(page, selected) {
        const params = {
            rid: stringValue(selected.rid || "0"),
            type: stringValue(selected.type || "all"),
        };
        const query = await signedQuery(params);
        const body = await apiGet(`${API}/x/web-interface/ranking/v2?${query}`, REFERER_HOME);
        const list = arrayOf(body, "data", "list");
        return paged(list.map((item) => toVod(item)), page, 1, list.length);
    }

    async function popularContent(page) {
        const body = await apiGet(`${API}/x/web-interface/popular?ps=${LIST_PAGE_SIZE}&pn=${page}`, REFERER_HOME);
        const list = arrayOf(body, "data", "list");
        const pagecount = page + (list.length >= LIST_PAGE_SIZE ? 1 : 0);
        return paged(list.map((item) => toVod(item)), page, Math.max(1, pagecount), LIST_PAGE_SIZE);
    }

    async function regionContent(page, selected) {
        const rid = stringValue(selected.rid || "0");
        const body = await apiGet(`${API}/x/web-interface/newlist?rid=${rid}&pn=${page}&ps=${LIST_PAGE_SIZE}`, REFERER_HOME);
        const archives = arrayOf(body, "data", "archives");
        const info = isObject(body?.data?.page) ? body.data.page : {};
        const size = toInt(info.size, LIST_PAGE_SIZE);
        const total = toInt(info.count, 0);
        const pagecount = total > 0
            ? Math.max(1, Math.ceil(total / size))
            : page + (archives.length >= size ? 1 : 0);
        const result = paged(archives.map((item) => toVod(item)), page, Math.max(1, pagecount), size);
        if (total > 0) result.total = total;
        return result;
    }

    async function seasonContent(page, selected) {
        const seasonType = stringValue(selected.season_type || "1");
        const query = `type=1&status=-1&order=2&season_type=${seasonType}&area=-1&style_id=-1`
            + `&sort=-1&year=-1&platform=web&pagesize=${LIST_PAGE_SIZE}&page=${page}`;
        const body = await apiGet(`${API}/pgc/season/index/result?${query}`, REFERER_HOME);
        const list = arrayOf(body, "data", "list");
        const total = toInt(body?.data?.total, list.length);
        const pagecount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
        return paged(list.map((item) => toSeasonVod(item)), page, pagecount, LIST_PAGE_SIZE, total);
    }

    async function upContent(page, selected, fallbackMid) {
        const mid = stringValue(selected.mid || fallbackMid || "").trim();
        if (!mid) {
            return {list: [], page, pagecount: 1, limit: 0, msg: "请在 ext 中设置 up_mid"};
        }
        const params = {
            mid,
            ps: "30",
            tid: "0",
            pn: String(page),
            keyword: "",
            order: "pubdate",
            platform: "web",
            web_location: "1550101",
        };
        const query = await signedQuery(params);
        let body;
        try {
            body = await apiGet(`${API}/x/space/wbi/arc/search?${query}`, `https://space.bilibili.com/${mid}/video`);
        } catch (error) {
            return {list: [], page, pagecount: 1, limit: 0, msg: "UP主投稿受限：" + errorMessage(error) + "（需在 ext 帶 SESSDATA）"};
        }
        const vlist = arrayOf(body, "data", "list", "vlist");
        return paged(vlist.map((item) => toVod(item)), page, 1, vlist.length);
    }

    async function searchVideo(keyword, page) {
        const query = `search_type=video&keyword=${encodeURIComponent(keyword)}&order=totalrank&duration=0&page=${page}`;
        const body = await apiGet(`${API}/x/web-interface/search/type?${query}`, REFERER_SEARCH);
        const data = isObject(body?.data) ? body.data : {};
        const results = Array.isArray(data.result) ? data.result : [];
        const items = [];
        for (const entry of results) {
            const bvid = stringValue(entry?.bvid);
            if (!bvid) continue;
            items.push({
                vod_id: bvid,
                vod_name: stripHtml(entry.title) || bvid,
                vod_pic: toHttps(entry.pic),
                vod_remarks: stringValue(entry.author) + " · " + durationText(entry.duration),
                vod_year: "",
                vod_area: stringValue(entry.typename),
                vod_content: stripHtml(entry.description),
                style: {type: "rect", ratio: 1.78},
            });
        }
        const pagecount = Math.max(1, toInt(data.numPages, 1));
        const total = toInt(data.numResults, items.length);
        return paged(items, page, pagecount, LIST_PAGE_SIZE, total);
    }

    async function searchBangumi(keyword, page) {
        const query = `search_type=media_bangumi&keyword=${encodeURIComponent(keyword)}&page=${page}`;
        const body = await apiGet(`${API}/x/web-interface/search/type?${query}`, REFERER_SEARCH);
        const data = isObject(body?.data) ? body.data : {};
        const results = Array.isArray(data.result) ? data.result : [];
        const items = [];
        for (const entry of results) {
            const seasonId = stringValue(entry?.season_id) || stringValue(entry?.media_id);
            if (!seasonId) continue;
            items.push({
                vod_id: SEASON_PREFIX + seasonId,
                vod_name: stripHtml(entry.title) || ("番剧" + seasonId),
                vod_pic: toHttps(entry.cover),
                vod_remarks: stripHtml(entry.sub_title),
                vod_year: "",
                vod_area: "番剧",
                vod_content: stripHtml(entry.description),
                style: {type: "rect", ratio: 1.78},
            });
        }
        const pagecount = Math.max(1, toInt(data.numPages, 1));
        return paged(items, page, pagecount, LIST_PAGE_SIZE);
    }

    async function videoDetail(bvid) {
        /* view 接口常被风控返回 HTML(实测同 URL 连测 6 次仅 1 次成功),
           失败时回退到 /x/player/pagelist(实测 100% 可用) */
        let body = null;
        try {
            body = await apiGet(`${API}/x/web-interface/view?bvid=${bvid}`, REFERER_HOME);
        } catch (error) {
            body = null;
        }
        if (!isObject(body?.data)) {
            return await videoDetailFallback(bvid);
        }
        const data = isObject(body?.data) ? body.data : {};
        const owner = isObject(data.owner) ? data.owner : {};
        const episodes = [];
        const pages = Array.isArray(data.pages) ? data.pages : [];
        if (pages.length) {
            for (const entry of pages) {
                const cid = stringValue(entry?.cid);
                if (!cid) continue;
                const label = stringValue(entry.part) || stringValue(data.title) || ("P" + (entry.page || episodes.length + 1));
                episodes.push({label: "P" + (entry.page || episodes.length + 1) + " " + label, id: bvid + "|" + cid});
            }
        } else if (stringValue(data.cid)) {
            episodes.push({label: stringValue(data.title) || bvid, id: bvid + "|" + stringValue(data.cid)});
        }
        const playUrl = episodes.map((episode) => safeLabel(episode.label) + "$" + episode.id).join("#");
        return {
            vod_id: bvid,
            vod_name: stripHtml(data.title) || bvid,
            vod_pic: toHttps(data.pic),
            vod_remarks: stringValue(owner.name) + " · " + durationText(data.duration),
            vod_year: stringValue(data.pubdate).length > 4 ? stringValue(data.pubdate).slice(0, 4) : "",
            vod_area: stringValue(data.tname),
            vod_actor: stripHtml(owner.name),
            vod_director: "",
            vod_content: stripHtml(data.desc),
            vod_play_from: "B站",
            vod_play_url: playUrl,
        };
    }

    /* view 被风控时的回退实现: 用 pagelist 拿分P */
    async function videoDetailFallback(bvid) {
        const body = await apiGet(`${API}/x/player/pagelist?bvid=${bvid}`, REFERER_HOME);
        const pages = Array.isArray(body?.data) ? body.data : [];
        const episodes = [];
        for (const entry of pages) {
            const cid = stringValue(entry?.cid);
            if (!cid) continue;
            const part = stringValue(entry?.part);
            const label = part || ("P" + (entry?.page || episodes.length + 1));
            episodes.push({label: "P" + (entry?.page || episodes.length + 1) + " " + label, id: bvid + "|" + cid});
        }
        if (!episodes.length) {
            throw new Error("详情获取失败（view 与 pagelist 均不可用）");
        }
        const playUrl = episodes.map((episode) => safeLabel(episode.label) + "$" + episode.id).join("#");
        return {
            vod_id: bvid,
            vod_name: bvid,
            vod_pic: "",
            vod_remarks: episodes.length + "P",
            vod_year: "",
            vod_area: "",
            vod_actor: "",
            vod_director: "",
            vod_content: "",
            vod_play_from: "B站",
            vod_play_url: playUrl,
        };
    }

    async function seasonDetail(seasonId) {
        const body = await apiGet(`${API}/pgc/view/web/season?season_id=${seasonId}`, REFERER_HOME);
        const result = isObject(body?.result) ? body.result : {};
        const episodes = Array.isArray(result.episodes) ? result.episodes : [];
        const playUrl = [];
        for (const entry of episodes) {
            const cid = stringValue(entry?.cid);
            if (!cid) continue;
            const label = stringValue(entry.long_title) || stringValue(entry.title) || ("第" + (playUrl.length + 1) + "话");
            playUrl.push(safeLabel(label) + "$" + stringValue(entry.bvid) + "|" + cid);
        }
        return {
            vod_id: SEASON_PREFIX + seasonId,
            vod_name: stripHtml(result.title) || ("番剧" + seasonId),
            vod_pic: toHttps(result.cover),
            vod_remarks: stripHtml(result.evaluate),
            vod_year: "",
            vod_area: "番剧",
            vod_actor: "",
            vod_director: "",
            vod_content: stripHtml(result.evaluate),
            vod_play_from: "番剧",
            vod_play_url: playUrl.join("#"),
        };
    }

    // ---------- 內部工具 ----------

    function toVod(item) {
        const bvid = stringValue(item?.bvid);
        const owner = isObject(item?.owner) ? item.owner : {};
        return {
            vod_id: bvid,
            vod_name: stripHtml(item?.title) || bvid,
            vod_pic: toHttps(item?.pic),
            vod_remarks: stringValue(owner.name) + " · " + durationText(item?.duration),
            vod_year: "",
            vod_area: stringValue(item?.tname),
            vod_actor: stripHtml(owner.name),
            vod_content: stripHtml(item?.desc),
            style: {type: "rect", ratio: 1.78},
        };
    }

    function toSeasonVod(item) {
        const seasonId = stringValue(item?.season_id) || stringValue(item?.media_id);
        return {
            vod_id: SEASON_PREFIX + seasonId,
            vod_name: stripHtml(item?.title) || ("番剧" + seasonId),
            vod_pic: toHttps(item?.cover),
            vod_remarks: stripHtml(item?.index_show),
            vod_year: "",
            vod_area: "番剧",
            vod_content: stripHtml(item?.index_show),
            style: {type: "rect", ratio: 1.78},
        };
    }

    function paged(items, page, pagecount, limit, total) {
        const result = {list: items, page, pagecount: Math.max(1, pagecount), limit};
        if (total !== undefined && total !== null) result.total = total;
        return result;
    }

    function parseOptions(ext) {
        if (isObject(ext)) return ext;
        const text = stringValue(ext).trim();
        if (!text) return {};
        try {
            const parsed = JSON.parse(text);
            return isObject(parsed) ? parsed : {};
        } catch (error) {
            return {cookie: text};
        }
    }

    function arrayOf(root, first, second, third) {
        let current = root;
        for (const key of [first, second, third]) {
            if (key === undefined) continue;
            if (!isObject(current)) return [];
            current = current[key];
        }
        return Array.isArray(current) ? current : [];
    }

    function errorMessage(error) {
        if (!error) return "未知错误";
        return stringValue(error.message || error);
    }

    function buildHeaders(referer) {
        const headers = {"User-Agent": options.user_agent, "Referer": referer || REFERER_HOME};
        if (cookie) headers["Cookie"] = cookie;
        return headers;
    }

    async function fetchJson(url, referer) {
        const options = {headers: buildHeaders(referer), timeout: REQUEST_TIMEOUT_MS, callTimeout: REQUEST_TIMEOUT_MS};
        if (typeof net === "undefined" || !net) throw new Error("缺少 net 注入");
        if (typeof net.json === "function") return await net.json(url, options);
        const response = await net.http(url, Object.assign({method: "GET"}, options));
        if (response.error) throw new Error(stringValue(response.error));
        if (response.code < 200 || response.code >= 300) throw new Error("HTTP " + response.code);
        const text = typeof response.content === "string"
            ? response.content
            : new TextDecoder().decode(response.content);
        return JSON.parse(text);
    }

    async function apiGet(url, referer) {
        await readyCookie();
        const body = await fetchJson(url, referer);
        const code = toInt(body?.code, 0);
        if (code !== 0) {
            throw new Error("接口返回 " + code + "：" + stringValue(body?.message));
        }
        return body;
    }

    function readyCookie() {
        if (!cookiePromise) {
            cookiePromise = (async () => {
                if (cookieSource) {
                    try {
                        const config = await fetchJson(cookieSource, REFERER_HOME);
                        cookie = stringValue(config?.cookie ?? config?.data?.cookie).trim();
                    } catch (error) {
                        cookie = "";
                    }
                }
                if (cookie) return cookie;
                try {
                    const spi = await fetchJson(`${API}/x/frontend/finger/spi`, REFERER_HOME);
                    const buvid3 = stringValue(spi?.data?.b_3);
                    const buvid4 = stringValue(spi?.data?.b_4);
                    if (buvid3) cookie = `buvid3=${buvid3}; buvid4=${buvid4}`;
                } catch (error) {
                    cookie = "";
                }
                return cookie;
            })();
        }
        return cookiePromise;
    }

    async function signedQuery(params) {
        return buildSignedQuery(params, await loadMixinKey(), Math.floor(Date.now() / 1000));
    }

    async function loadMixinKey() {
        if (mixinKeyCache) return mixinKeyCache;
        const body = await fetchJson(`${API}/x/web-interface/nav`, REFERER_HOME);
        const wbi = isObject(body?.data?.wbi_img) ? body.data.wbi_img : {};
        mixinKeyCache = mixinKeyOf(imageKey(wbi.img_url), imageKey(wbi.sub_url));
        return mixinKeyCache;
    }

    function rankFilters() {
        return [
            {
                key: "rid", name: "分区", init: "0",
                value: [
                    {n: "全站", v: "0"}, {n: "动画", v: "1"}, {n: "音乐", v: "3"}, {n: "游戏", v: "4"},
                    {n: "娱乐", v: "5"}, {n: "科技", v: "36"}, {n: "数码", v: "188"}, {n: "运动", v: "234"},
                    {n: "汽车", v: "223"}, {n: "生活", v: "160"}, {n: "美食", v: "211"}, {n: "动物圈", v: "217"},
                    {n: "时尚", v: "155"}, {n: "影视", v: "181"},
                ],
            },
            {
                key: "type", name: "榜单", init: "all",
                value: [{n: "综合", v: "all"}, {n: "周榜", v: "weekly"}, {n: "新人", v: "rookie"}],
            },
        ];
    }

    function regionFilters() {
        return [
            {
                key: "rid", name: "分区", init: "1",
                value: [
                    {n: "推荐", v: "0"}, {n: "动画", v: "1"}, {n: "番剧", v: "13"}, {n: "国创", v: "167"},
                    {n: "音乐", v: "3"}, {n: "游戏", v: "4"}, {n: "娱乐", v: "5"}, {n: "科技", v: "36"},
                    {n: "数码", v: "188"}, {n: "运动", v: "234"}, {n: "汽车", v: "223"}, {n: "生活", v: "160"},
                    {n: "美食", v: "211"}, {n: "动物圈", v: "217"}, {n: "时尚", v: "155"}, {n: "影视", v: "181"},
                ],
            },
        ];
    }

    function seasonFilters() {
        return [
            {
                key: "season_type", name: "类型", init: "1",
                value: [
                    {n: "电视剧", v: "1"}, {n: "番剧", v: "2"}, {n: "纪录片", v: "3"},
                    {n: "综艺", v: "4"}, {n: "动画", v: "5"}, {n: "电影", v: "7"},
                ],
            },
        ];
    }

    function upFilters() {
        const mid = options.up_mid;
        return [
            {
                key: "mid", name: "UP主UID", init: mid,
                value: mid ? [{n: mid, v: mid}] : [{n: "请在ext设置", v: ""}],
            },
        ];
    }

    return {
        init,
        home,
        homeVod,
        category,
        detail,
        search,
        play,
        destroy,
        selfTest,
    };
}

export default createSpider;
