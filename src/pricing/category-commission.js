import feeData from './data/shopee-category-fees.json' with { type: 'json' };

/** Sửa lỗi OCR phổ biến từ PDF biểu phí Shopee */
const OCR_TOKEN_FIXES = [
    [/\bthick\b/g, 'thich'],
    [/\bsuur\b/g, 'suu'],
    [/\bsuu\s*tam\b/g, 'suu tam'],
    [/\bluru\b/g, 'luu'],
    [/\bluru\s*niem\b/g, 'luu niem'],
    [/\bniêm\b/g, 'niem'],
    [/\bmagy\b/g, 'may'],
    [/\bdiên\b/g, 'dien'],
    [/\bthoaai\b/g, 'thoai'],
];

/** Bỏ dấu + lowercase để so khớp OCR/PDF lệch chữ */
export function normalizeCategoryText(value) {
    if (!value)
        return '';
    let s = value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/&/g, ' & ')
        .replace(/\s+/g, ' ')
        .trim();
    for (const [re, rep] of OCR_TOKEN_FIXES)
        s = s.replace(re, rep);
    return s.replace(/\s+/g, ' ').trim();
}

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

function similarity(a, b) {
    const na = normalizeCategoryText(a);
    const nb = normalizeCategoryText(b);
    if (!na || !nb)
        return 0;
    if (na === nb)
        return 1;
    const maxLen = Math.max(na.length, nb.length);
    return 1 - levenshtein(na, nb) / maxLen;
}

const FUZZY_MIN = 0.82;

export function parseCategoryPath(text) {
    const raw = (text ?? '').trim();
    if (!raw)
        return { raw, parts: [] };
    const parts = raw
        .split(/\s*>\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
    return { raw, parts };
}

function rowKey(parts) {
    return parts.map(normalizeCategoryText).join('|');
}

function buildIndex(rows) {
    const byPath = new Map();
    for (const row of rows) {
        const parts = [row.cat1, row.cat2, row.cat3].filter(Boolean);
        const key = rowKey(parts);
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
        const rParts = [row.cat1, row.cat2, row.cat3].filter(Boolean);
        if (rParts.length !== parts.length)
            continue;
        let score = 0;
        let ok = true;
        for (let i = 0; i < parts.length; i++) {
            const sim = similarity(parts[i], rParts[i]);
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
        if (n1.includes(fb.match))
            return { rate: fb.rate, ratePct: fb.rate * 100, match: 'l1-fallback' };
    }
    return null;
}

/**
 * @param {string} categoryPath — ví dụ "Sở thích & Sưu tầm > Quà Lưu Niệm > Móc khóa"
 */
export function lookupCategoryCommission(categoryPath) {
    const { raw, parts } = parseCategoryPath(categoryPath);
    if (parts.length === 0) {
        return { raw, rate: null, ratePct: null, match: 'none', parts };
    }
    for (let len = parts.length; len >= 1; len--) {
        const key = rowKey(parts.slice(0, len));
        const hit = pathIndex.get(key);
        if (hit) {
            return {
                raw,
                parts,
                rate: hit.rate,
                ratePct: hit.ratePct,
                match: len === parts.length ? 'exact' : `prefix-${len}`,
                stt: hit.stt,
            };
        }
    }
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
    const fb = lookupL1Fallback(parts);
    if (fb) {
        return { raw, parts, rate: fb.rate, ratePct: fb.ratePct, match: fb.match };
    }
    return { raw, parts, rate: null, ratePct: null, match: 'none' };
}

/** Đọc danh mục trên form sản phẩm Shopee Seller Center */
export function readShopeeProductCategoryPath(root = document) {
    const el =
        root.querySelector('.product-category-text') ??
        root.querySelector('.product-category-box-inner');
    const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return text.includes('>') ? text : '';
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
