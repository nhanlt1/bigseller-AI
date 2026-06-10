import feeData from './data/shopee-category-fees.data.js';
import { normalizeCategoryText } from './category-normalize.js';

export { normalizeCategoryText };

function levenshtein(a, b) {
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
            row[j - 1] = prev;
            prev = next;
        }
        row[b.length] = prev;
    }
    return row[b.length];
}

/** So khớp phần tử user (raw) với trường không dấu đã tính sẵn trong data (a1/a2/a3) */
function similarityToNorm(rawUser, normRow) {
    const na = normalizeCategoryText(rawUser);
    const nb = normRow ?? '';
    if (!na || !nb)
        return 0;
    if (na === nb)
        return 1;
    const maxLen = Math.max(na.length, nb.length);
    return 1 - levenshtein(na, nb) / maxLen;
}

const FUZZY_MIN = 0.82;
/** Biểu phí Shopee PDF: tối đa cat1 / cat2 / cat3 */
const FEE_MAX_DEPTH = 3;

/** BigSeller đôi khi để nguyên `&gt;` / `&amp;` trong textContent thay vì ký tự thật. */
export function decodeHtmlEntities(text) {
    if (!text)
        return '';
    if (!/[&][#a-z0-9]+;?/i.test(text))
        return text;
    if (typeof document !== 'undefined') {
        const el = document.createElement('textarea');
        el.innerHTML = text;
        return el.value;
    }
    return text
        .replace(/&gt;/gi, '>')
        .replace(/&lt;/gi, '<')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

export function parseCategoryPath(text) {
    const raw = decodeHtmlEntities((text ?? '').trim()).replace(/\s+/g, ' ');
    if (!raw)
        return { raw: '', parts: [] };
    const parts = raw
        .split(/\s*(?:>|&gt;|›|→)\s*/i)
        .map((p) => decodeHtmlEntities(p.trim()))
        .filter(Boolean);
    return { raw, parts };
}

function rowKey(parts) {
    return parts.map(normalizeCategoryText).join('|');
}

/** cat1/cat2/cat3 trong data đã là chữ không dấu + lowercase */
function rowNormParts(row) {
    return [row.cat1, row.cat2, row.cat3].filter(Boolean);
}

function buildIndex(rows) {
    const byPath = new Map();
    for (const row of rows) {
        const parts = rowNormParts(row);
        const key = parts.join('|');
        if (!key)
            continue;
        const existing = byPath.get(key);
        if (!existing || parts.length >= existing.parts.length) {
            byPath.set(key, { rate: row.rate, ratePct: row.ratePct, parts, stt: row.stt });
        }
    }
    return byPath;
}

const pathIndex = buildIndex(feeData.rows);

function fuzzyLookup(parts) {
    let best = null;
    for (const row of feeData.rows) {
        const rParts = rowNormParts(row);
        if (rParts.length !== parts.length)
            continue;
        let score = 0;
        let ok = true;
        for (let i = 0; i < parts.length; i++) {
            const sim = similarityToNorm(parts[i], rParts[i]);
            if (sim < FUZZY_MIN) {
                ok = false;
                break;
            }
            score += sim;
        }
        if (!ok)
            continue;
        score /= parts.length;
        if (!best || score > best.score) {
            best = { rate: row.rate, ratePct: row.ratePct, stt: row.stt, score };
        }
    }
    return best;
}

function lookupL1Fallback(parts) {
    const n1 = normalizeCategoryText(parts[0] ?? '');
    for (const fb of feeData.l1Fallbacks) {
        // fb.match đã là chữ không dấu (sinh sẵn trong data)
        if (n1.includes(fb.match))
            return { rate: fb.rate, ratePct: fb.rate * 100, match: 'l1-fallback' };
    }
    return null;
}

/** Độ dài prefix thử: từ cụ thể → rộng; breadcrumb >3 cấp chỉ dò 3 cấp đầu (phí gắn ở cat3, không có cấp 4). */
function getPrefixLengths(parts) {
    const n = parts.length;
    const maxLen = Math.min(n, FEE_MAX_DEPTH);
    const lengths = [];
    for (let len = maxLen; len >= 1; len--)
        lengths.push(len);
    return lengths;
}

/** Dò breadcrumb trái → phải: thử prefix dài nhất trước, exact rồi fuzzy từng bước. */
function lookupPrefixWalk(parts) {
    for (const len of getPrefixLengths(parts)) {
        const slice = parts.slice(0, len);
        const hit = pathIndex.get(rowKey(slice));
        if (hit) {
            return {
                rate: hit.rate,
                ratePct: hit.ratePct,
                stt: hit.stt,
                match: len === parts.length ? 'exact' : `prefix-${len}`,
                prefixLen: len,
            };
        }
        const fuzzy = fuzzyLookup(slice);
        if (fuzzy) {
            return {
                rate: fuzzy.rate,
                ratePct: fuzzy.ratePct,
                stt: fuzzy.stt,
                score: fuzzy.score,
                match: `prefix-fuzzy-${len}`,
                prefixLen: len,
            };
        }
    }
    return null;
}

/** BigSeller thường chỉ hiện tên lá (vd "Bút Chì") — so khớp cat2/cat3 trong biểu phí */
function lookupLeafFuzzy(parts) {
    const leaf = parts[parts.length - 1]?.trim() ?? '';
    if (!leaf)
        return null;
    let best = null;
    for (const row of feeData.rows) {
        for (const field of [row.cat3, row.cat2].filter(Boolean)) {
            const sim = similarityToNorm(leaf, field);
            if (sim < FUZZY_MIN)
                continue;
            if (!best || sim > best.score) {
                best = {
                    rate: row.rate,
                    ratePct: row.ratePct,
                    stt: row.stt,
                    score: sim,
                };
            }
        }
    }
    return best;
}

/**
 * @param {string} categoryPath — ví dụ "Sở thích & Sưu tầm > Quà Lưu Niệm > Móc khóa"
 */
export function lookupCategoryCommission(categoryPath) {
    const { raw, parts } = parseCategoryPath(categoryPath);
    if (parts.length === 0) {
        return { raw, rate: null, ratePct: null, match: 'none', parts };
    }
    const prefixHit = lookupPrefixWalk(parts);
    if (prefixHit) {
        return {
            raw,
            parts,
            rate: prefixHit.rate,
            ratePct: prefixHit.ratePct,
            match: prefixHit.match,
            stt: prefixHit.stt,
            score: prefixHit.score,
            prefixLen: prefixHit.prefixLen,
        };
    }
    if (parts.length <= FEE_MAX_DEPTH) {
        const fuzzy = fuzzyLookup(parts);
        if (fuzzy) {
            return {
                raw,
                parts,
                rate: fuzzy.rate,
                ratePct: fuzzy.ratePct,
                match: 'fuzzy',
                stt: fuzzy.stt,
                score: fuzzy.score,
            };
        }
    }
    if (parts.length === 1) {
        const leaf = lookupLeafFuzzy(parts);
        if (leaf) {
            return {
                raw,
                parts,
                rate: leaf.rate,
                ratePct: leaf.ratePct,
                match: 'leaf-fuzzy',
                stt: leaf.stt,
                score: leaf.score,
            };
        }
    }
    const fb = lookupL1Fallback(parts);
    if (fb) {
        return { raw, parts, rate: fb.rate, ratePct: fb.ratePct, match: fb.match };
    }
    return { raw, parts, rate: null, ratePct: null, match: 'none' };
}

const CATEGORY_SELECT_SKIP = /^(chọn|select|tất cả|all|--|-)$/i;

function readAntSelectParts(container) {
    const seen = new Set();
    const parts = [];
    for (const el of container.querySelectorAll(
        '.ant-select-selection__rendered, .ant-select-selection-selected-value',
    )) {
        const t = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (!t || CATEGORY_SELECT_SKIP.test(t) || seen.has(t))
            continue;
        seen.add(t);
        parts.push(t);
    }
    return parts;
}

const BREADCRUMB_SKIP = /^(shopee|trang chủ|home|mall)$/i;

function readShopeeBreadcrumbCategoryPath(root) {
    const breadcrumb =
        root.querySelector('.page-product__breadcrumb') ??
        root.querySelector('nav[aria-label="breadcrumb"]') ??
        root.querySelector('[class*="breadcrumb"]');
    if (!breadcrumb)
        return '';
    const parts = [...breadcrumb.querySelectorAll('a, span, .breadcrumb__link')]
        .map((n) => n.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter((t) => t && !BREADCRUMB_SKIP.test(t));
    const deduped = parts.filter((t, i) => i === 0 || t !== parts[i - 1]);
    return deduped.length >= 2 ? deduped.join(' > ') : '';
}

/** Đọc danh mục Shopee Seller Center hoặc breadcrumb trang SP buyer */
export function readShopeeProductCategoryPath(root = document) {
    const el =
        root.querySelector('.product-category-text') ??
        root.querySelector('.product-category-box-inner');
    const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text.includes('>'))
        return text;
    return readShopeeBreadcrumbCategoryPath(root);
}

/**
 * Dòng danh mục SP BigSeller: `page_edit_item` thứ 3 (index 2) trong form card đầu.
 * DOM: `.com_card.mb_20` → `form.ant-form-inline` → `.page_edit_item[2]` → `.ant-select-selection--single`
 */
export function getBigsellerCategoryFormItem(root = document) {
    const cardBody =
        root.querySelector('.page_edit .com_card.mb_20 .com_card_body') ??
        root.querySelector('.page_edit .com_card .com_card_body');
    const form =
        cardBody?.querySelector('form.ant-form-inline') ??
        cardBody?.querySelector('form.ant-form');
    if (!form)
        return null;
    for (const item of form.querySelectorAll('.page_edit_item')) {
        const title =
            item.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (/danh\s*mục|ngành\s*hàng|category/i.test(title))
            return item;
    }
    const items = form.querySelectorAll('.page_edit_item');
    return items[2] ?? items[1] ?? null;
}

function extractCategoryTextFromEl(el) {
    if (!el)
        return '';
    let text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if ((!text || (!text.includes('>') && !/>|&gt;/i.test(text))) && el.innerHTML) {
        const fromHtml = el.innerHTML
            .replace(/<br\s*\/?>/gi, ' > ')
            .replace(/<[^>]+>/g, '');
        const decoded = decodeHtmlEntities(fromHtml).replace(/\s+/g, ' ').trim();
        if (decoded.length > text.length)
            text = decoded;
    }
    return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

/** BigSeller có 2 `[autoid=category_text]` — div rỗng trước, breadcrumb đầy đủ sau. */
function pickBestCategoryTextEl(scope) {
    if (!scope)
        return null;
    const candidates = [
        ...scope.querySelectorAll('[autoid="category_text"]'),
        ...scope.querySelectorAll('.category.mt_5.f_gray'),
        ...scope.querySelectorAll('.category.mt_5'),
    ];
    const seen = new Set();
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
        if (seen.has(el))
            continue;
        seen.add(el);
        const text = extractCategoryTextFromEl(el);
        if (!text || CATEGORY_SELECT_SKIP.test(text))
            continue;
        let score = text.length;
        if (/>|&gt;|›|→/i.test(text))
            score += 1000;
        if (el.classList.contains('f_gray'))
            score += 100;
        if (score > bestScore) {
            bestScore = score;
            best = el;
        }
    }
    return best;
}

/**
 * Dòng danh mục read-only trên form sửa SP BigSeller (vd. "Văn Phòng Phẩm > Bút Các Loại > Bút Chì").
 * DOM: `.page_edit_item[Danh mục] .content [autoid="category_text"].category.mt_5.f_gray`
 */
export function getBigsellerCategoryTextEl(root = document) {
    const item = getBigsellerCategoryFormItem(root);
    return (
        pickBestCategoryTextEl(item) ??
        pickBestCategoryTextEl(root.querySelector('.page_edit'))
    );
}

/** Ô combobox danh mục (300px) — fallback anchor badge khi không có category_text */
export function getBigsellerCategorySelectionEl(root = document) {
    const item = getBigsellerCategoryFormItem(root);
    if (!item)
        return null;
    return (
        item.querySelector(
            '.ant-select-selection.ant-select-selection--single[role="combobox"]',
        ) ??
        item.querySelector('.w_300.ant-select .ant-select-selection--single') ??
        item.querySelector('.ant-select-selection--single')
    );
}

function readBigsellerCategoryTextPath(root = document) {
    const el = getBigsellerCategoryTextEl(root);
    const text = extractCategoryTextFromEl(el);
    if (!text || CATEGORY_SELECT_SKIP.test(text))
        return '';
    return text;
}

/** Đọc danh mục trên form sửa SP BigSeller */
export function readBigsellerProductCategoryPath(root = document) {
    const fromText = readBigsellerCategoryTextPath(root);
    if (fromText)
        return fromText;
    const item = getBigsellerCategoryFormItem(root);
    if (item) {
        const parts = readAntSelectParts(item);
        if (parts.length)
            return parts.join(' > ');
        const combo = getBigsellerCategorySelectionEl(root);
        const leaf = combo?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (leaf && !CATEGORY_SELECT_SKIP.test(leaf))
            return leaf;
    }
    const items = root.querySelectorAll(
        '.page_edit .com_card_body .page_edit_item, .page_edit .page_edit_item',
    );
    let bestParts = [];
    for (const el of items) {
        const parts = readAntSelectParts(el);
        if (!parts.length)
            continue;
        const label =
            el.querySelector('.ant-form-item-label, label')?.textContent ?? '';
        if (/danh\s*mục|ngành\s*hàng|category/i.test(label))
            return parts.join(' > ');
        if (parts.length >= 2 && parts.length >= bestParts.length)
            bestParts = parts;
    }
    if (bestParts.length)
        return bestParts.join(' > ');
    return '';
}

/** Shopee hoặc BigSeller — dùng cho popup $ và badge phí */
export function readProductCategoryPath(root = document) {
    return (
        readShopeeProductCategoryPath(root) ||
        readBigsellerProductCategoryPath(root)
    );
}

export function formatCommissionPercent(rate) {
    if (rate == null || !Number.isFinite(rate))
        return null;
    const pct = rate * 100;
    const rounded = Math.round(pct * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`;
}

export function getCategoryFeeMeta() {
    return feeData.meta;
}
