/**
 * 咪咕播放地址端到端验证: 签名 -> m3u8 -> 第一个 .ts 分片
 * 用法: node tools/migu_verify.js <pID>
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36';
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

function curl(url, extra = []) {
    // 用 -D 把响应头写进 stdout 之前,再按最后一个空行切分 body
    const args = ['curl', '-sL', '-m', '25', '-D', '-',
        '-H', `User-Agent: ${UA}`, '-H', 'Referer: https://www.miguvideo.com', ...extra, url];
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // 最后一个 HTTP 状态行之后是 body
    const m = [...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)];
    const code = m.length ? m[m.length - 1][1] : '?';
    const loc = out.match(/^location:\s*(\S+)/im);
    // body 从最后一个 \r\n\r\n 之后开始
    const idx = out.lastIndexOf('\r\n\r\n');
    const body = idx >= 0 ? out.slice(idx + 4) : out;
    return { code, body, location: loc ? loc[1] : '' };
}

function dateString() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function ddCalcu(puData, programId) {
    const keys = 'cdabyzwxkl';
    const out = [];
    for (let i = 0; i < puData.length / 2; i++) {
        out.push(puData[puData.length - i - 1]);
        out.push(puData[i]);
        if (i === 1) out.push('v');
        else if (i === 2) out.push(keys[parseInt(dateString()[0])]);
        else if (i === 3) out.push(keys[programId[6]]);
        else if (i === 4) out.push('a');
    }
    return out.join('');
}

const pid = process.argv[2] || '968181177';
const rateType = process.argv[3] || '3';

const ts = Math.round(Date.now()).toString();
const av = '2600034600';
const sign = md5(md5(ts + pid + av.substring(0, 8)) + '2cac4f2c6c3346a5b34e085725ef7e33migu0000');
const playUrl = `https://play.miguvideo.com/playurl/v1/play/playurl?sign=${sign}&rateType=${rateType}`
    + `&contId=${pid}&timestamp=${ts}&salt=00000125&flvEnable=true&super4k=true`;

const hs = [
    '-H', `AppVersion: ${av}`,
    '-H', 'TerminalId: android',
    '-H', `X-UP-CLIENT-CHANNEL-ID: ${av}-99000-201600010010028`,
    '-H', 'appCode: miguvideo_default_android',
];

const r = curl(playUrl, hs);
console.log(`playurl HTTP ${r.code}`);
let d;
try { d = JSON.parse(r.body); } catch (e) { console.log('解析失败:', r.body.slice(0, 300)); process.exit(1); }
console.log(`  code=${d.code} rid=${d.rid} msg=${d.message}`);
const ui = (d.body || {}).urlInfo || {};
const raw = ui.url;
if (!raw) { console.log('  无 urlInfo'); process.exit(2); }
console.log(`  画质: ${ui.rateDesc} (rateType=${ui.rateType}) urlType=${ui.urlType}`);
const contId = ((d.body || {}).content || {}).contId || pid;
const puData = raw.split('&puData=')[1];
const signed = `${raw}&ddCalcu=${ddCalcu(puData, contId)}&sv=10004&ct=android`;
console.log(`  签名地址 ${signed.length} 字符`);

const m = curl(signed);
console.log(`\nm3u8 HTTP ${m.code} | ${m.body.length} bytes | #EXTM3U=${m.body.includes('#EXTM3U')}`);
const seg = m.body.split('\n').filter(l => l && !l.startsWith('#'))[0];
if (!seg) { console.log('  无分片'); process.exit(3); }
// 分片是相对 302 之后的最终节点 URL 解析的 —— 用最终 host + 目录拼接
const finalBase = (m.location || signed).split('?')[0].replace(/[^/]*$/, '');
const full = finalBase + seg.trim();
console.log(`  最终节点: ${finalBase}`);
console.log(`  分片 URL ${full.length} 字符`);

const s = curl(full);
console.log(`\n分片 HTTP ${s.code} | ${s.body.length} bytes | 首个字节=${s.body.slice(0, 4).replace(/[^\x20-\x7e]/g, '.')}`);
console.log(s.code === '200' && s.body.length > 1000 ? '✅ 分片可下载,播放链路完整' : '❌ 分片失败');
