/**
 * pdfh/pdfa/pd 全局 shim —— 模拟 TVBox jar 侧注入的 HTML 解析函数
 *
 * 真实 jar (spider.jar) 内含 pdfh/pdfa 的 Java 实现,dex 里能搜到这两个符号。
 * drpy2.min.js 顶层 `const defaultParser = {pdfh: pdfh, pdfa: pdfa, pd: pd}`
 * 直接引用这三个全局,缺失就 ReferenceError。
 *
 * 这里用 cheerio 实现等价语义:
 *   pdfh(html, parse) -> 取第一个匹配元素的 text 或 html
 *   pdfa(html, parse) -> 取所有匹配元素
 *   pd(html, parse, base) -> 取属性
 * 解析表达式语法: "css选择器&&属性名" 或 "css选择器&&Text"/"&&Html"
 */
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseExpr(html, parse) {
    if (!parse || !parse.trim()) return { sel: '', opt: '' };
    let p = parse.trim();
    let opt = '';
    if (p.includes('&&')) {
        const parts = p.split('&&');
        opt = parts[parts.length - 1].trim();
        p = parts.slice(0, -1).join('&&').trim();
    }
    if (p === 'Text' || p === 'Html') { opt = p; p = 'body'; }
    if (p.startsWith('body&&')) p = p.slice(6);
    return { sel: p, opt };
}

async function makeShims() {
    let cheerio;
    try {
        const core = await import(path.join(__dirname, 'lib', 'drpy-core-lite.min.js'));
        cheerio = core.cheerio;
    } catch (e) {
        console.error('无法加载 cheerio:', e.message);
    }
    if (!cheerio) {
        globalThis.pdfh = () => '';
        globalThis.pdfa = () => [];
        globalThis.pd = () => '';
        return;
    }

    const load = (html) => (typeof html === 'string' ? cheerio.load(html) : null);

    globalThis.pdfh = (html, parse) => {
        const { sel, opt } = parseExpr(html, parse);
        if (!sel) return '';
        const $ = load(html);
        if (!$) return '';
        const el = $(sel).first();
        if (!el.length) return '';
        if (opt === 'Text') return el.text();
        if (opt === 'Html') return el.html();
        if (opt && opt !== 'Text' && opt !== 'Html') return el.attr(opt) || '';
        return el.text();
    };

    globalThis.pdfa = (html, parse) => {
        const { sel } = parseExpr(html, parse);
        if (!sel) return [];
        const $ = load(html);
        if (!$) return [];
        return $(sel).toArray();
    };

    globalThis.pd = (html, parse, base) => {
        const { sel, opt } = parseExpr(html, parse);
        if (!sel) return '';
        const $ = load(html);
        if (!$) return '';
        const el = $(sel).first();
        if (!el.length) return '';
        let v = opt && opt !== 'Text' && opt !== 'Html' ? (el.attr(opt) || '') : (el.attr('href') || el.attr('src') || el.text());
        if (base && v && !/^https?:/i.test(v) && !v.startsWith('//') && !v.startsWith('data:')) {
            try { v = new URL(v, base).href; } catch { /* keep raw */ }
        }
        return v;
    };
}

export default makeShims;

/**
 * joinUrl —— jar 侧注入的 URL 拼接全局
 * 引擎里 urljoin() 直接调 joinUrl(),缺失会在 init() 里抛
 * ReferenceError,导致后续 pre()(预处理)根本没执行。
 */
globalThis.joinUrl = function joinUrl(a, b) {
    if (!b) return a || '';
    if (/^[a-z]+:\/\//i.test(b)) return b;
    if (b.startsWith('//')) return (a || '').split('://')[0] + ':' + b;
    if (b.startsWith('/')) {
        const m = /^(https?:\/\/[^/]+)/i.exec(a || '');
        return m ? m[1] + b : b;
    }
    return (a || '').replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '');
};
