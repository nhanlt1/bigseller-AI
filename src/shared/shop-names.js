/**
 * Tên gian hàng theo shop Shopee (subaccount) / BigSeller (select cửa hàng).
 */

/** Shopee: class subaccount-name — id → tên thương hiệu trong mô tả */
export const SHOPEE_SHOP_ID_TO_BRAND = {
    hangtieudung02: 'NPP VĂN PHÒNG PHẨM THIÊN TRANG',
    vpp_rosyruby: 'Rosy Ruby Stationery',
};

/** Mọi biến thể tên cần gỡ khỏi mô tả gốc trước khi gửi AI */
const SHOP_NAME_ALIASES = [
    'NPP VĂN PHÒNG PHẨM THIÊN TRANG',
    'NPP Van Phong Pham Thien Trang',
    'Rosy Ruby Stationery',
    'Rosy Ruby',
    '(Ngọc) Rosy Ruby Stationery',
    '(Ngoc) Rosy Ruby Stationery',
];

const BIGSELLER_SHOP_SELECTORS = [
    '.page_edit_item .ant-select-selection-selected-value',
    '.ant-select-selection-selected-value',
];

const SHOPEE_SUBACCOUNT_SELECTORS = [
    'span.subaccount-name',
    '.subaccount-name',
];

/** Bỏ tiền tố kiểu "(Ngọc) " trên tên gian BigSeller */
export function normalizeBigsellerShopLabel(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    return text.replace(/^\([^)]{1,48}\)\s*/, '').trim();
}

export function readBigsellerShopBrand(root = document) {
    for (const sel of BIGSELLER_SHOP_SELECTORS) {
        const el = root.querySelector(sel);
        const raw = el?.textContent?.trim() ?? el?.getAttribute('title')?.trim();
        if (!raw || !/[a-zA-ZÀ-ỹ0-9]/.test(raw)) continue;
        const name = normalizeBigsellerShopLabel(raw);
        if (name) return name;
    }
    return '';
}

export function readShopeeShopId(root = document) {
    for (const sel of SHOPEE_SUBACCOUNT_SELECTORS) {
        const el = root.querySelector(sel);
        const id = el?.textContent?.trim();
        if (id) return id;
    }
    return '';
}

export function resolveShopeeShopBrand(shopId) {
    if (!shopId) return '';
    const key = shopId.trim().toLowerCase();
    return SHOPEE_SHOP_ID_TO_BRAND[key] ?? '';
}

export function resolveShopBrandName(platform, root = document) {
    if (platform === 'bigseller') return readBigsellerShopBrand(root);
    if (platform === 'shopee') {
        const id = readShopeeShopId(root);
        return resolveShopeeShopBrand(id);
    }
    return '';
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Gỡ mọi tên gian hàng đã khai báo khỏi mô tả gốc (AI chỉ dùng shopName trong prompt). */
export function stripShopNamesFromDescription(description) {
    let text = String(description ?? '');
    const names = [...SHOP_NAME_ALIASES].sort((a, b) => b.length - a.length);
    for (const name of names) {
        if (!name.trim()) continue;
        const re = new RegExp(escapeRegExp(name), 'gi');
        text = text.replace(re, ' ');
    }
    text = text.replace(/\(\s*Ngọc\s*\)\s*/gi, ' ');
    text = text.replace(/\(\s*Ngoc\s*\)\s*/gi, ' ');
    return text
        .split('\n')
        .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Chuẩn bị title/description + tên gian cho prompt Gemini.
 * @param {{ title: string, description: string }} product
 * @param {'bigseller' | 'shopee'} platform
 */
export function buildPromptProductContext(product, platform) {
    const shopName = resolveShopBrandName(platform);
    const description = stripShopNamesFromDescription(product.description ?? '');
    return {
        title: product.title ?? '',
        description,
        shopName,
    };
}
