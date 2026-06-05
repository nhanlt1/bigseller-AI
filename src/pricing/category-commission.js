import feeData from './data/shopee-category-fees.data.js';

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

/** BigSeller thường chỉ hiện tên lá (vd "Bút Chì") — so khớp cat2/cat3 trong biểu phí */
function lookupLeafFuzzy(parts) {
    const leaf = parts[parts.length - 1]?.trim() ?? '';
    if (!leaf)
        return null;
    let best = null;
    for (const row of feeData.rows) {
        for (const field of [row.cat3, row.cat2].filter(Boolean)) {
            const sim = similarity(leaf, field);
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
    const items = form.querySelectorAll('.page_edit_item');
    return items[2] ?? null;
}

/** Ô combobox danh mục (300px) — anchor badge phí cố định */
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

/** Đọc danh mục trên form sửa SP BigSeller */
export function readBigsellerProductCategoryPath(root = document) {
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
