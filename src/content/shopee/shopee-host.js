/** Host được bật nút tính giá ($) */
export function isShopeePricingHost(url = location.href) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'shopee.vn' || host.endsWith('.shopee.vn');
    }
    catch {
        return /banhang\.shopee\.(vn|com)/i.test(url);
    }
}

/** Kênh người bán — đối soát đơn, form SP, danh mục phí */
export function isShopeeSellerCenterHost(url = location.href) {
    return /banhang\.shopee\.(vn|com)/i.test(url);
}

/** Trang tìm sản phẩm tương tự (consumer Shopee) */
export function isShopeeSimilarProductsUrl(url = location.href) {
    try {
        const path = new URL(url).pathname.toLowerCase();
        return path.includes('find_similar_products');
    }
    catch {
        return /find_similar_products/i.test(url);
    }
}

/** Trang kết quả tìm kiếm Shopee — ?keyword=... */
export function isShopeeSearchUrl(url = location.href) {
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/+$/, '').toLowerCase();
        if (path !== '/search')
            return false;
        return !!u.searchParams.get('keyword')?.trim();
    }
    catch {
        return /\/search\b/i.test(url) && /[?&]keyword=/i.test(url);
    }
}

/** Trang dùng được panel Nghiên cứu SP (tương tự + tìm kiếm) */
export function isShopeeProductResearchUrl(url = location.href) {
    return isShopeeSimilarProductsUrl(url) || isShopeeSearchUrl(url);
}
