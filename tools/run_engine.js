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
globalThis.local = {
    get: async (url) => {
        const r = await fetch(url);
        return { content: await r.text(), headers: Object.fromEntries(r.headers) };
    }
};

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

function curlSync(url, obj = {}) {
    // 注意: api.cntv.cn 有随机风控(间歇性返回 errcode 1003),
    // 规则内部已做重试,这里不再额外加间隔,避免拖慢测试
    const args = ['-sSL', '--max-time', String(Math.ceil((obj.timeout || 15000) / 1000)), '-w', '\\n__HDR__%{http_code}'];
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
    return { content, headers: { 'content-type': 'application/json', status: String(code) } };
}

globalThis.req = (url, obj = {}) => curlSync(url, obj);
globalThis.log = (...a) => console.log(...a);
globalThis.print = (...a) => console.log(...a);

const { default: makeShims } = await import('./pdfh_shim.js');
await makeShims();

const DRPY = (await import(ENGINE)).default;

const rulePath = process.argv[2];
if (!rulePath) { console.error('用法: node run_engine.js <规则.js路径>'); process.exit(1); }
const ruleSrc = fs.readFileSync(rulePath, 'utf8');

console.log(`规则: ${path.basename(rulePath)}`);
console.log(`引擎: ${ENGINE}`);
console.log();

DRPY.init(ruleSrc);
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
                try {
                    const r = await fetch(p.url, { headers: { 'User-Agent': 'Mozilla/5.0', ...(JSON.parse(p.header || '{}')) }, redirect: 'follow' });
                    const t = await r.text();
                    console.log(`   ▶ 实测播放: HTTP ${r.status}, ${t.length} bytes, m3u8=${t.includes('#EXTM3U')}`);
                } catch (e) { console.log(`   ▶ 实测播放失败: ${e.message}`); }
            }
        }
    }
}

// search
show('search 庆余年', DRPY.search('庆余年', false, '1'));
process.exit(0);
