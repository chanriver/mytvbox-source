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
    /* cheerio:
       - 仓库 lib/drpy-core-lite.min.js 导出的 cheerio 只是 {jinja2, jp},不是 HTML 解析器
       - 电视端有 jar 侧注入的 pdfh/pdfa/pd,不需要真 cheerio
       - 本地测试要真解析能力,从 tools/node/node_modules 装一份(开发依赖) */
    let cheerio;
    try {
        const req = (await import('module')).createRequire(import.meta.url);
        const c = req(path.join(__dirname, 'node', 'node_modules', 'cheerio'));
        cheerio = c;
    } catch (e) {
        console.error('无法加载 cheerio(需在 tools/node 下 npm install cheerio):', e.message);
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
/**
 * local —— jar 侧注入的 KV 存储 (TVBox 的 local.get/set/del/clear)
 * 优酷规则里用它做反爬缓存,缺失会报 "local.set is not a function"
 */
if (!globalThis.local || typeof globalThis.local.set !== 'function') {
    const _store = new Map();
    /* jar 侧 local 是单键 KV: local.get(k, dflt) / local.set(k, v)
       但引擎的 getItem/setItem 走的是 local.get(RKEY, k) / local.set(RKEY, k, v)
       —— 那是 (命名空间, 键, 值) 三参数形式。
       这里两种都支持: 参数个数 >=3 走命名空间模式, 否则单键模式。 */
    /* jar 侧 local 是单键 KV: local.get(k) / local.set(k, v)
       但引擎的 getItem/setItem 走 local.get(RKEY, k) / local.set(RKEY, k, v)
       —— (命名空间, 键, 值) 三参数形式,而 jar 的 local 根本没有这个签名,
       结果是优酷这类规则用 getItem/setItem 存的分页 session 永远取不到。
       这里两套都支持:
         1 参数 -> local.get(key)
         2 参数 -> 先试 "ns::key",再试 "key"(兼容 jar 的 (k, dflt) 语义)
         3 参数 -> 命名空间模式 */
    const nsKey = (a, b) => `${a}::${b}`;
    globalThis.local = {
        get: (a, b, c) => {
            if (c !== undefined) {
                const k = nsKey(a, b);
                return _store.has(k) ? _store.get(k) : '';
            }
            if (b !== undefined) {
                const k1 = nsKey(a, b);
                if (_store.has(k1)) return _store.get(k1);
                if (_store.has(String(a))) return _store.get(String(a));
                return b;
            }
            return _store.has(String(a)) ? _store.get(String(a)) : '';
        },
        set: (a, b, c) => {
            if (c !== undefined) { _store.set(nsKey(a, b), c); return c; }
            _store.set(String(a), b);
            return b;
        },
        del: (a, b) => {
            if (b !== undefined) { _store.delete(nsKey(a, b)); _store.delete(String(a)); }
            else _store.delete(String(a));
        },
        delete: (a, b) => { globalThis.local.del(a, b); },
        clear: () => { _store.clear(); },
        keys: () => Array.from(_store.keys()),
    };
}

/**
 * getItem / setItem / clearItem
 *
 * 引擎里的实现是:
 *   function setItem(k, v) { local.set(RKEY, k, v) }
 *   function getItem(k, v) { return local.get(RKEY, k) || v }
 *   function clearItem(k) { local.delete(RKEY, k) }
 *
 * 但 jar 侧 local 是单键 KV: local.get(k) / local.set(k, v),
 * 所以引擎这两参数调用在 jar 上拿不到东西(或拿到别的键)。
 * 规则里优酷就用 getItem/setItem 存分页 session,拿不到会导致翻页失效。
 * 这里按 (RKEY, key) 命名空间实现,和引擎意图一致。
 */
if (false) { /* 引擎自带 getItem/setItem/clearItem,靠上面的 local 兼容层修正 */
    const _nsStore = new Map();
    globalThis.getItem = (k, dflt) => {
        const ns = globalThis.RKEY || '_drpy_';
        const map = _nsStore.get(ns) || new Map();
        return map.has(String(k)) ? map.get(String(k)) : (dflt !== undefined ? dflt : '');
    };
    globalThis.setItem = (k, v) => {
        const ns = globalThis.RKEY || '_drpy_';
        if (!_nsStore.has(ns)) _nsStore.set(ns, new Map());
        _nsStore.get(ns).set(String(k), v);
        console.log(`规则${ns}设置${k} => ${v}`);
        return v;
    };
    globalThis.clearItem = (k) => {
        const ns = globalThis.RKEY || '_drpy_';
        const map = _nsStore.get(ns);
        if (map) map.delete(String(k));
    };
}

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
