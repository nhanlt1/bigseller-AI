import {
    countGridTitleChars,
    titleVisibleApprox,
} from './similar-products-scraper.js';

const NOT_FOUND_MESSAGE = 'Không tìm thấy vị trí hiển thị';

/** Nhãn ngắn gọn trên overlay highlight (và trong dòng vị trí panel). */
export function formatPositionHighlightLabel({ page, rank, gridVisible } = {}) {
    const p = page ?? '—';
    const r = rank ?? '—';
    const grid = String(gridVisible ?? '').trim();
    let text = `Trang ${p}, #${r}`;
    if (grid)
        text += ` — lưới: «${grid}»`;
    return text;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} myProductTitle
 * @returns {Record<string, unknown> | null}
 */
export function getMatchedResearchRow(rows, myProductTitle = '') {
    const query = String(myProductTitle ?? '').trim();
    if (!query)
        return null;
    let best = null;
    let bestScore = 0;
    for (const row of rows) {
        if (row.kind === 'Chính')
            continue;
        const score = titleMatchScore(query, String(row.title ?? ''));
        if (score > bestScore) {
            bestScore = score;
            best = row;
        }
    }
    const minScore = query.length < 10 ? 85 : 70;
    if (!best || bestScore < minScore)
        return null;
    return best;
}

function normalizeTitleForMatch(title) {
    return String(title ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function titleMatchScore(query, rowTitle) {
    const a = normalizeTitleForMatch(query);
    const b = normalizeTitleForMatch(rowTitle);
    if (!a || !b)
        return 0;
    if (a === b)
        return 100;
    if (b.startsWith(a) || a.startsWith(b))
        return 85;
    if (b.includes(a) || a.includes(b))
        return 70;
    return 0;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} myProductTitle
 * @param {{ shopLabel?: string }} [options]
 */
export function resolveMyProductDisplayPosition(rows, myProductTitle = '', options = {}) {
    const query = String(myProductTitle ?? '').trim();
    const shopLabel = String(options.shopLabel ?? '').trim();
    const blockTitle = shopLabel
        ? `VỊ TRÍ HIỂN THỊ SP — ${shopLabel}`
        : 'VỊ TRÍ HIỂN THỊ SP CỦA TÔI';

    if (!query) {
        return {
            found: false,
            empty: true,
            uiText: '',
            promptBlock: '',
            matchedRow: null,
            shopLabel,
        };
    }

    const best = getMatchedResearchRow(rows, query);
    if (!best) {
        return {
            found: false,
            empty: false,
            uiText: NOT_FOUND_MESSAGE,
            matchedRow: null,
            shopLabel,
            promptBlock: `=== ${blockTitle} (trong bảng kết quả đã thu thập) ===
Tên đã nhập: ${query}
${NOT_FOUND_MESSAGE}

Lưu ý cho phân tích: SP chưa khớp tên nào trong bảng đối thủ — có thể chưa nằm trong trang đã quét hoặc tên khác trên Shopee. Vẫn đề xuất tiêu đề tối ưu dựa trên đối thủ và tên người bán nhập.`,
        };
    }

    const gridVisible =
        String(best.titleVisibleApprox ?? '').trim() ||
        titleVisibleApprox(String(best.title ?? query));
    const letters =
        best.titleGridCharCount ??
        countGridTitleChars(gridVisible);
    const page = best.page ?? '—';
    const rank = best.rank ?? '—';
    const matchedTitle = String(best.title ?? '').trim();

    const prefix = shopLabel ? `${shopLabel}: ` : '';
    const uiText =
        `${prefix}Vị trí hiển thị: ${formatPositionHighlightLabel({ page, rank, gridVisible })}` +
        ' — bấm để xem trên trang';

    const promptBlock = `=== ${blockTitle} (trong bảng kết quả đã thu thập) ===
Trang: ${page}
Thứ tự trên trang (#): ${rank}
Đoạn tiêu đề hiện trên lưới Shopee: ${gridVisible || '—'}
Số ký tự (vùng lưới): ${letters}
Tên khớp trong bảng: ${matchedTitle}

Yêu cầu: phân tích vị trí #${rank} trang ${page} so với các SP phía trên (cùng trang/khác trang trong bảng); chỉ ra điểm mạnh/yếu của đoạn hiện lưới hiện tại và cách đặt tên để cạnh tranh tốt hơn.`;

    return {
        found: true,
        empty: false,
        uiText,
        promptBlock,
        page,
        rank,
        gridVisible,
        letters,
        matchedTitle,
        itemId: best.itemId ?? '',
        shopId: best.shopId ?? '',
        matchedRow: best,
        shopLabel,
    };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {Record<string, string>} titlesByShopId — shopId → tên SP
 * @param {{ shopId: string, brand: string }[]} shops
 */
export function resolveMultiProductDisplayPositions(rows, titlesByShopId, shops) {
    return shops.map((shop) => ({
        shop,
        title: String(titlesByShopId[shop.shopId] ?? '').trim(),
        position: resolveMyProductDisplayPosition(
            rows,
            titlesByShopId[shop.shopId] ?? '',
            { shopLabel: shop.brand },
        ),
    }));
}
