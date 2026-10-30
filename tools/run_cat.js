/**
 * 测 cat/QuickJS 格式的 spider 规则(如 js/bili.js)
 * 模拟 TVBox 影视仓的 spider 环境: 注入 net.http / net.json / globalThis
 *
 * 用法: node tools/run_cat.js <spider.js> [extJSON]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

function curlRaw(url, headers = {}, method = 'GET', body = null) {
    const args = ['-sL', '-m', '25'];
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined || v === null) continue;
        args.push('-H', `${k}: ${v}`);
    }
    if (body) args.push('-X', method, '--data-binary', body);
    if (PROXY) args.push('--proxy', PROXY);
    args.push(url);
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { content: out, code: 0, error: '' };
}

// TVBox 注入的 net 对象
globalThis.net = {
    http: async (url, opts = {}) => {
        try {
            const r = curlRaw(url, opts.headers || {}, opts.method || 'GET', opts.body);
            return { content: r.content, code: 200, headers: {} };
        } catch (e) {
            return { content: '', code: 0, error: e.message };
        }
    },
    json: async (url, opts = {}) => {
        const r = await globalThis.net.http(url, opts);
        try {
            return JSON.parse(r.content);
        } catch (e) {
            throw new Error('非 JSON 响应: ' + String(r.content).slice(0, 120));
        }
    },
};

const spiderPath = process.argv[2];
const extJson = process.argv[3] || '{}';
if (!spiderPath) { console.error('用法: node tools/run_cat.js <spider.js> [extJSON]'); process.exit(1); }

const src = fs.readFileSync(spiderPath, 'utf8');
// 去掉 export default 改成导出到全局
const mod = src.replace(/export\s+default\s+/, 'globalThis.__factory = ');
new Function(mod)();
const factory = globalThis.__factory;
// createSpider(site) 返回 spider 实例
const spider = typeof factory === 'function' ? factory({ key: 'test' }) : factory;

console.log(`规则: ${path.basename(spiderPath)} (${src.length} 字节)`);
spider.init(extJson);
console.log(`ext: ${extJson}`);

const home = spider.home(true);
console.log(`\n[home] ${home.class.length} 个分类`);
home.class.forEach(c => console.log(`   - ${c.type_name} (${c.type_id})`));
if (home.filters) {
    for (const [k, v] of Object.entries(home.filters)) {
        console.log(`   筛选 ${k}: ${v.length} 组, 首组 ${v[0].name} = ${v[0].value.length} 项`);
    }
}

const cat = await spider.category(home.class[0].type_id, '1', {}, {});
console.log(`\n[category ${home.class[0].type_name}] ${(cat.list || []).length} 条`);
(cat.list || []).slice(0, 4).forEach(v =>
    console.log(`   ▸ ${v.vod_name}  [${v.vod_remarks || ''}] ${String(v.vod_id).slice(0, 40)}`));

if ((cat.list || []).length) {
    const det = await spider.detail(cat.list[0].vod_id);
    const v = (det.list || [])[0];
    console.log(`\n[detail] ${(det.list || []).length} 条`);
    if (v) {
        const eps = (v.vod_play_url || '').split('#').filter(Boolean);
        console.log(`   ${v.vod_name} | ${eps.length} 集 | ${v.vod_remarks || ''}`);
        console.log(`   首集: ${eps[0]}`);
        const playId = eps[0]?.split('$').pop();
        const play = await spider.play(v.vod_play_from, playId, []);
        console.log(`   播放: parse=${play.parse} jx=${play.jx} url=${String(play.url).slice(0, 100)}`);
        if (play.url) {
            // 只取前 64KB —— MP4 可能上百 MB,全量拉会超时
            try {
                const r = execFileSync('curl', ['-sL', '-m', '20', '-r', '0-65535', '-o', '/dev/null',
                    '-w', '%{http_code} %{size_download} %{content_type}',
                    '-H', `User-Agent: ${play.header?.['User-Agent'] || 'Mozilla/5.0'}`,
                    '-H', `Referer: ${play.header?.['Referer'] || 'https://www.bilibili.com'}`,
                    play.url], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
                console.log(`   ▶ 实测播放: ${r}`);
            } catch (e) {
                console.log(`   ▶ 实测播放失败: ${e.message.slice(0, 80)}`);
            }
        }
    }
}

const s = await spider.search('庆余年', false, '1');
console.log(`\n[search 庆余年] ${(s.list || []).length} 条`);
(s.list || []).slice(0, 3).forEach(v => console.log(`   ▸ ${v.vod_name}`));
