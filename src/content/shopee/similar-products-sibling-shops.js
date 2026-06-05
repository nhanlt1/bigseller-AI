import {
    SIBLING_SHOPEE_SHOPS,
    resolveSiblingShopMeta,
} from '../../shared/shop-names.js';

/**
 * @param {Record<string, unknown>[]} rows
 */
export function collectSiblingShopPositions(rows) {
    /** @type {Map<string, { meta: ReturnType<typeof resolveSiblingShopMeta>, items: Record<string, unknown>[] }>} */
    const byShop = new Map();

    for (const shop of SIBLING_SHOPEE_SHOPS) {
        byShop.set(shop.shopId, { meta: shop, items: [] });
    }

    for (const row of rows) {
        const meta = resolveSiblingShopMeta(row.shopId);
        if (!meta)
            continue;
        const bucket = byShop.get(meta.shopId);
        if (!bucket)
            continue;
        bucket.items.push({
            page: row.page ?? '—',
            rank: row.rank ?? '—',
            title: String(row.title ?? '').trim(),
            titleVisibleApprox: String(row.titleVisibleApprox ?? '').trim(),
            itemId: String(row.itemId ?? '').trim(),
        });
    }

    const shops = SIBLING_SHOPEE_SHOPS.map((shop) => {
        const bucket = byShop.get(shop.shopId);
        const items = [...(bucket?.items ?? [])].sort((a, b) => {
            const pageA = Number.parseInt(String(a.page), 10) || 0;
            const pageB = Number.parseInt(String(b.page), 10) || 0;
            if (pageA !== pageB)
                return pageA - pageB;
            const rankA = Number.parseInt(String(a.rank), 10) || 0;
            const rankB = Number.parseInt(String(b.rank), 10) || 0;
            return rankA - rankB;
        });
        return { ...shop, items };
    });

    const presentShops = shops.filter((s) => s.items.length > 0);

    return {
        shops,
        presentShops,
        hasAny: presentShops.length > 0,
        hasBoth: presentShops.length >= 2,
    };
}

/**
 * @param {ReturnType<typeof collectSiblingShopPositions>} result
 */
export function buildSiblingShopPromptBlock(result) {
    if (!result?.hasAny)
        return '';

    const lines = [
        '=== SP CÙNG HỆ SHOP (Thiên Trang + Rosy Ruby) ===',
        'Trong bảng đối thủ có sản phẩm của shop cùng hệ:',
    ];

    for (const shop of result.presentShops) {
        lines.push(
            `- ${shop.brand} (${shop.account}, shopId ${shop.shopId}):`,
        );
        for (const item of shop.items) {
            const grid = item.titleVisibleApprox
                ? ` — lưới: «${item.titleVisibleApprox}»`
                : '';
            lines.push(
                `  • Trang ${item.page}, #${item.rank}: «${item.title}»${grid}`,
            );
        }
    }

    if (result.hasBoth) {
        lines.push(
            '',
            'Yêu cầu: đề xuất từ khóa / tiêu đề cho CẢ HAI shop (NPP VĂN PHÒNG PHẨM THIÊN TRANG và Rosy Ruby Stationery) sao cho bổ trợ nhau đẩy lên top kết quả tìm kiếm.',
            '- Phân tích vị trí từng shop trong bảng (trang, #) và đoạn tiêu đề hiện lưới.',
            '- Gợi ý chiến lược từ khóa chung + phân vai (tránh cannibalize khi có thể).',
            '- Mỗi shop: ít nhất 2 phương án tiêu đề ngắn gọn, ưu tiên từ khóa mua hàng ở đoạn đầu.',
        );
    }
    else {
        const only = result.presentShops[0];
        const missing = result.shops.find((s) => s.items.length === 0);
        lines.push(
            '',
            `Hiện chỉ thấy SP của ${only.brand} trong bảng${missing ? ` — chưa thấy ${missing.brand} (có thể nhập tên SP ở ô shop còn lại)` : ''}.`,
            'Vẫn đề xuất từ khóa/tiêu đề cho CẢ HAI thương hiệu cùng hệ (Thiên Trang + Rosy Ruby) để đẩy top chung.',
        );
    }

    return lines.join('\n');
}
