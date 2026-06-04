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
