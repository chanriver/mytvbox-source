/**
 * 批量回归测试: 对 js/ 下所有 drpy2 老格式规则跑一遍
 * 用法: node tools/batch_test.js [文件名过滤]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filter = process.argv[2] || '';

const files = fs.readdirSync(path.join(__dirname, 'js'))
    .filter(f => f.endsWith('.js') && !f.includes('bili'))
    .filter(f => !filter || f.includes(filter));

console.log(`待测 ${files.length} 个规则: ${files.join(', ')}\n`);

const results = [];
for (const f of files) {
    const p = path.join(__dirname, 'js', f);
    const proc = (await import('child_process')).spawnSync('node',
        [path.join(__dirname, 'tools', 'run_engine.js'), p],
        { encoding: 'utf8', timeout: 200000, env: process.env });
    const out = (proc.stdout || '') + (proc.stderr || '');

    const cat = out.match(/\[category[^\n]*?(\d+)\s*条/);
    const det = out.match(/\[detail[^\n]*?(\d+)\s*条/);
    const det2 = out.match(/详情:[^|]*\|\s*(\d+)\s*集/);
    const search = out.match(/\[search[^\n]*?(\d+)\s*条/);
    const play = out.match(/实测播放[:：]\s*HTTP\s*(\d+)/);
    const err = out.match(/(SyntaxError[^\n]*|Error:\s*[^\n]{0,90})/);

    const r = {
        file: f,
        cat: cat ? +cat[1] : null,
        det: det ? +det[1] : (det2 ? +det2[1] : null),
        search: search ? +search[1] : null,
        play: play ? play[1] : null,
        err: err ? err[1].slice(0, 70) : null,
        raw: out,
    };
    results.push(r);
    const ok = r.cat && r.det;
    console.log(`${ok ? '✅' : '❌'} ${f.padEnd(18)} 分类=${String(r.cat ?? '-').padEnd(5)} 详情=${String(r.det ?? '-').padEnd(5)} 搜索=${String(r.search ?? '-').padEnd(5)} 播放=${r.play ?? '-'}`);
    if (r.err) console.log(`     ⚠ ${r.err}`);
}

fs.writeFileSync('/opt/data/cache/scratch/batch_results.json', JSON.stringify(results, null, 1));
console.log('\n结果已存 /opt/data/cache/scratch/batch_results.json');
