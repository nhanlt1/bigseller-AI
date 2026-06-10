/** Shop DTL — tìm SP trong shop trên shopee.vn/search?shop=… */
export const DTL_SHOP_SEARCH_ID = '512295107';

export function buildShopeeShopSearchUrl(keyword, shopId = DTL_SHOP_SEARCH_ID) {
    const url = new URL('https://shopee.vn/search');
    url.searchParams.set('keyword', String(keyword ?? '').trim());
    url.searchParams.set('shop', String(shopId ?? DTL_SHOP_SEARCH_ID).trim());
    return url.toString();
}

export function tabHasShopSearchParam(tabUrl, shopId = DTL_SHOP_SEARCH_ID) {
    try {
        const u = new URL(tabUrl ?? '');
        if (!u.hostname.includes('shopee.vn'))
            return false;
        return u.searchParams.get('shop') === String(shopId);
    }
    catch {
        return false;
    }
}
