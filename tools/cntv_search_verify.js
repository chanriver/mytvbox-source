/**
 * 央视频搜索链路验证:
 *   ifsearch.php (JSON) -> imglink 提 guid -> videoinfoByGuid -> pid -> m3u8
 */
import { execFileSync } from 'child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curl(url, extraHeaders = {}) {
    const args = ['-s', '-m', '25', '-A', UA, '-H', 'Referer: https://tv.cctv.com'];
    for (const [k, v] of Object.entries(extraHeaders)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const kw = process.argv[2] || '庆余年';
const page = process.argv[3] || '1';

const su = `https://search.cctv.com/ifsearch.php?page=${page}&qtext=${encodeURIComponent(kw)}&sort=relevance&pageSize=20&type=video&vtime=-1&datepid=1&channel=&pageflag=0`;
console.log('搜索:', su);
const s = JSON.parse(curl(su, { Referer: 'https://search.cctv.com/search.php' }));
console.log(`total=${s.total} totalpage=${s.totalpage} list=${s.list.length}`);

const strip = (t) => String(t || '').replace(/<[^>]+>/g, '');

let ok = 0;
for (const it of s.list.slice(0, 5)) {
    const gm = /\/([a-f0-9]{32})(-\d+)?\.jpg/i.exec(it.imglink || '');
    if (!gm) { console.log(`  ✗ 无法从 imglink 提 guid: ${it.imglink}`); continue; }
    const guid = gm[1];
    let info;
    try {
        info = JSON.parse(curl(`https://api.cntv.cn/video/videoinfoByGuid?guid=${guid}&serviceId=tvcctv`));
    } catch (e) { console.log(`  ✗ videoinfoByGuid 失败: ${e.message}`); continue; }
    if (!info || !info.pid) { console.log(`  ✗ 无 pid`); continue; }

    const pid = info.pid;
    const m3u8 = `https://cntv.playdreamer.cn/proxy/asp/hls/2000/0303000a/3/default/${pid}/2000.m3u8`;
    let code = '?', size = '?';
    try {
        const r = execFileSync('curl', ['-s', '-m', '20', '-o', '/dev/null',
            '-w', '%{http_code} %{size_download}', '-A', UA,
            '-H', 'Referer: https://tv.cctv.com', '-H', 'Origin: https://tv.cctv.com', m3u8],
            { encoding: 'utf8' });
        [code, size] = r.split(' ');
    } catch (e) { code = 'ERR'; }

    console.log(`  ✅ ${strip(it.title).slice(0, 38)}`);
    console.log(`     guid=${guid} pid=${pid}`);
    console.log(`     专辑=${info.vset_title || '-'} / ${info.channel || '-'} | 时长=${info.len || '-'} | album=${info.album_id || '-'}`);
    console.log(`     m3u8 HTTP ${code} ${size} bytes`);
    if (code === '200') ok++;
}
console.log(`\n播放可用: ${ok}/5`);
