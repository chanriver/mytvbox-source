/**
 * 用仓库真实引擎 lib/drpy2.min.js 测试规则 —— 模拟 TVBox 的调用路径
 * 用法: node run_engine.js <规则.js路径>
 *
 * 关键点:
 *  - 引擎通过 init(ext) 加载规则,ext 可以是文件内容字符串
 *  - request() 走全局 req() —— 这里用 node fetch 实现
 *  - 引擎本身不依赖 pdfh(那是 jar 侧注入的),规则若用 js: 就不需要
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE = path.join(__dirname, 'lib', 'drpy2.min.js');

// ---- 全局: 模拟 TVBox/jar 环境 ----
globalThis.env = { isNew: true, isJS: true, isPy: false, isCF: false, isFF: false, isIOS: false, isAndroid: true, isTV: true };
globalThis.EXT = {};
globalThis.Env = globalThis.env;
/* 注意: 不要在这里定义 globalThis.local ——
   jar 侧的 local 是 KV 存储 (get/set/del),有些规则(如优酷)用它做反爬缓存。
   真实 KV shim 在 tools/pdfh_shim.js 里提供。 */

const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const NO_PROXY = process.env.NO_PROXY || '';
function needsProxy(u) {
    if (!PROXY) return false;
    try {
        const host = new URL(u).hostname;
        if (NO_PROXY.split(',').map(s => s.trim()).some(n => n && (host === n || host.endsWith(n)))) return false;
        return true;
    } catch { return false; }
}
// jar 的 req() 是同步阻塞的原生调用,返回 {content, headers}
// 引擎里 `let res = req(url, obj)` 没有 await —— 必须同步实现
// node 的 fetch 是异步的,所以用 execFileSync 跑 curl 来保持同步语义
import { execFileSync } from 'child_process';

let lastReqAt = 0;
let reqSeq = 0;

function curlSync(url, obj = {}) {
    // 注意: api.cntv.cn 有随机风控(间歇性返回 errcode 1003),
    // 规则内部已做重试,这里不再额外加间隔,避免拖慢测试
    const hdrFile = '/tmp/_req_hdr_' + process.pid + '_' + (reqSeq++);
    const args = ['-sSL', '--max-time', String(Math.ceil((obj.timeout || 15000) / 1000)),
        '-D', hdrFile, '-w', '\\n__HDR__%{http_code}'];
    const headers = obj.headers || {};
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined || v === null) continue;
        args.push('-H', `${k}: ${v}`);
    }
    const body = obj.body ?? obj.data;
    if (body) {
        args.push('-X', obj.method || 'POST');
        args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body));
    }
    const proxy = needsProxy(url) ? PROXY : '';
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const idx = out.lastIndexOf('\n__HDR__');
    const content = idx >= 0 ? out.slice(0, idx) : out;
    const code = idx >= 0 ? parseInt(out.slice(idx + 8).trim(), 10) : 0;

    /* jar 的 req() 返回 {content, headers},headers 含 set-cookie 等响应头。
       withHeaders 的规则(咪咕/anime1)靠它拿 cookie —— 这里必须真解析。 */
    const hdrs = { 'content-type': 'application/json', status: String(code) };
    try {
        const head = fs.readFileSync(hdrFile, 'utf8');
        // 可能有多个 header 块(重定向),取最后一个
        const blocks = head.split(/\r?\n\r?\n/).filter(b => b.trim());
        const lastBlock = blocks[blocks.length - 1] || '';
        for (const line of lastBlock.split(/\r?\n/)) {
            const c = line.indexOf(':');
            if (c <= 0) continue;
            const k = line.slice(0, c).trim();
            const v = line.slice(c + 1).trim();
            const lk = k.toLowerCase();
            if (lk === 'set-cookie') {
                if (!hdrs['set-cookie']) hdrs['set-cookie'] = [];
                hdrs['set-cookie'].push(v);
            } else {
                hdrs[lk] = v;
            }
        }
    } catch (e) { /* 无 header 文件就跳过 */ }
    try { fs.unlinkSync(hdrFile); } catch (e) {}
    return { content, headers: hdrs };
}

globalThis.req = (url, obj = {}) => curlSync(url, obj);
globalThis.log = (...a) => console.log(...a);
globalThis.print = (...a) => {
    const msg = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
    // 规则 debug 输出可能很大(整页 HTML / 整个 JSON),超长就截断
    if (msg.length > 400) {
        console.log(msg.slice(0, 400) + ` ...[截断,共${msg.length}字符]`);
        return;
    }
    console.log(msg);
};

const { default: makeShims } = await import('./pdfh_shim.js');
await makeShims();

const DRPY = (await import(ENGINE)).default;

const rulePath = process.argv[2];
if (!rulePath) { console.error('用法: node run_engine.js <规则.js路径>'); process.exit(1); }
const ruleSrc = fs.readFileSync(rulePath, 'utf8');

console.log(`规则: ${path.basename(rulePath)}`);
console.log(`引擎: ${ENGINE}`);
console.log();

/* 引擎 init 时会把整个 rule 对象 dump 出来(优酷规则有几十万字),
   太占屏幕 —— 这里临时把 console.log 静音,只留我们的输出 */
const _realLog = console.log;
console.log = () => {};
DRPY.init(ruleSrc);
console.log = _realLog;
console.log(`站点名: ${DRPY.getRule('title')}`);
console.log();

function show(label, obj) {
    if (!obj) { console.log(`[${label}] 空`); return null; }
    let d = obj;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { console.log(`[${label}] 非JSON: ${d.slice(0,200)}`); return null; } }
    if (d && d.list) {
        console.log(`[${label}] ${d.list.length} 条`);
        d.list.slice(0, 4).forEach(v => console.log(`   ▸ ${v.vod_name}  [${v.vod_remarks || ''}] ${String(v.vod_id).slice(0, 50)}`));
        return d;
    }
    console.log(`[${label}] ${JSON.stringify(d).slice(0, 300)}`);
    return d;
}

// 实测播放: 用 curl 拉前 64KB —— fetch 是异步且不吃代理,MP4/m3u8 动辄上百 MB
function probePlay(p) {
    try {
        const h = JSON.parse(p.header || '{}');
        const args = ['-sL', '--max-time', '20', '-r', '0-65535', '-o', '/tmp/_probe.bin',
            '-w', '%{http_code} %{size_download} %{content_type}'];
        for (const [k, v] of Object.entries(h)) {
            if (v === undefined || v === null) continue;
            args.push('-H', `${k}: ${v}`);
        }
        const proxy = needsProxy(p.url) ? PROXY : '';
        if (proxy) args.push('--proxy', proxy);
        args.push(p.url);
        const r = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        let head = '';
        try { head = fs.readFileSync('/tmp/_probe.bin').slice(0, 16).toString('latin1'); } catch {}
        console.log(`   ▶ 实测播放: HTTP ${r} | 头部="${head.replace(/[^\x20-\x7e]/g, '.')}"`);
    } catch (e) {
        console.log(`   ▶ 实测播放失败: ${e.message.slice(0, 90)}`);
    }
}

// home
const home = show('home', DRPY.home({ filter: {} }));
const classes = (home?.class || []);
console.log(`[home] 分类 ${classes.length} 个`);
classes.slice(0, 8).forEach(c => console.log(`   - ${c.type_name} (${c.type_id})`));
console.log();

// category
let cat = null;
if (classes.length) {
    const c = classes[Math.min(1, classes.length - 1)];
    cat = show(`category ${c.type_name}`, DRPY.category(c.type_id, '1', {}, {}));
    if (cat?.list?.length) {
        const det = show('detail', DRPY.detail(cat.list[0].vod_id));
        const v = det?.list?.[0];
        if (v) {
            const eps = (v.vod_play_url || '').split('#').filter(Boolean);
            console.log(`   详情: ${v.vod_name} | ${eps.length} 集 | from=${v.vod_play_from}`);
            console.log(`   首集: ${eps[0]}`);
            const playId = eps[0]?.split('$').pop();
            const play = DRPY.play(v.vod_play_from, playId, []);
            let p = play;
            if (typeof p === 'string') { try { p = JSON.parse(p); } catch {} }
            console.log(`   播放: parse=${p?.parse} jx=${p?.jx} url=${String(p?.url).slice(0, 110)}`);
            if (p?.url && (p.parse === 0 || p.parse === undefined)) {
                probePlay(p);
            }
        }
    }
}

// search
const kw = process.argv[3] || '庆余年';
const sr = show(`search ${kw}`, DRPY.search(kw, false, '1'));
if (sr?.list?.length) {
    const v0 = sr.list[0];
    console.log(`   -- 搜索项详情: ${v0.vod_name}`);
    const sdet = show('   detail(搜索项)', DRPY.detail(v0.vod_id));
    const sv = sdet?.list?.[0];
    if (sv) {
        const seps = (sv.vod_play_url || '').split('#').filter(Boolean);
        console.log(`   详情: ${sv.vod_name} | ${seps.length} 集 | from=${sv.vod_play_from}`);
        console.log(`   首集: ${seps[0]}`);
        const splayId = seps[0]?.split('$').pop();
        const sp = DRPY.play(sv.vod_play_from, splayId, []);
        let sp2 = sp;
        if (typeof sp2 === 'string') { try { sp2 = JSON.parse(sp2); } catch {} }
        console.log(`   播放: parse=${sp2?.parse} jx=${sp2?.jx} url=${String(sp2?.url).slice(0, 110)}`);
        if (sp2?.url && (sp2.parse === 0 || sp2.parse === undefined)) probePlay(sp2);
    }
}
process.exit(0);
