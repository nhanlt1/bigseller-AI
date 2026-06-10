/** Sửa lỗi OCR phổ biến từ PDF biểu phí Shopee (áp dụng trên chữ đã bỏ dấu) */
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

/**
 * Bỏ dấu + lowercase để so khớp danh mục (BigSeller/Shopee ↔ biểu phí).
 * Dùng chung cho runtime lookup và script sinh trường không dấu a1/a2/a3.
 */
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
