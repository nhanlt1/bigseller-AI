/**
 * Parse giá VND viết tắt trong popup tính giá.
 * VD: 55k → 55000, 26,7k → 26700, 55.000 → 55000
 */
export function parsePriceInput(raw) {
    if (raw == null)
        return 0;
    if (typeof raw === 'number')
        return Number.isFinite(raw) ? Math.round(raw) : 0;
    let s = String(raw).trim().toLowerCase();
    if (!s)
        return 0;
    s = s.replace(/[₫đ]/g, '').replace(/\s+/g, '');
    const kMatch = s.match(/^([\d.,]+)k$/);
    if (kMatch)
        return Math.round(parseDecimalPart(kMatch[1]) * 1000);
    return Math.round(parsePlainVnd(s));
}

function parseDecimalPart(part) {
    const s = part.trim();
    if (!s)
        return 0;
    if (/^\d+,\d+$/.test(s))
        return Number.parseFloat(s.replace(',', '.')) || 0;
    if (/^\d{1,3}(\.\d{3})+$/.test(s))
        return Number.parseFloat(s.replace(/\./g, '')) || 0;
    return Number.parseFloat(s.replace(/,/g, '')) || 0;
}

function parsePlainVnd(s) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s))
        return Number.parseFloat(s.replace(/\./g, '')) || 0;
    if (/^\d{1,3}(,\d{3})+$/.test(s))
        return Number.parseFloat(s.replace(/,/g, '')) || 0;
    if (/^\d+,\d{1,2}$/.test(s))
        return Number.parseFloat(s.replace(',', '.')) || 0;
    const digits = s.replace(/[^\d]/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
}

/** Chuẩn hóa ô nhập sau blur — hiển thị số nguyên VND */
export function formatPriceInputValue(raw) {
    const n = parsePriceInput(raw);
    if (!String(raw ?? '').trim())
        return '';
    return n > 0 ? String(n) : '';
}
