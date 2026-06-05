import { SIBLING_SHOPEE_SHOPS } from '../../shared/shop-names.js';
import { rowsToTsv } from '../../shared/table-export.js';
import { stripDeprecatedPromptSections } from '../../shared/storage.js';
import {
    buildSiblingShopPromptBlock,
    collectSiblingShopPositions,
} from './similar-products-sibling-shops.js';
import { resolveMultiProductDisplayPositions } from './similar-products-title-position.js';

/** Cột đưa vào prompt Gemini (tập trung đặt tên + ngữ cảnh giá/bán) */
export const TITLE_RESEARCH_PROMPT_COLUMNS = [
    { key: 'title', label: 'Tên đầy đủ' },
    { key: 'titleVisibleApprox', label: 'Đoạn hiện lưới' },
    { key: 'titleGridCharCount', label: 'Số ký tự lưới' },
    { key: 'priceText', label: 'Giá KM' },
    { key: 'discountDisplay', label: 'Giảm' },
    { key: 'ratingDisplay', label: 'Đánh giá' },
    { key: 'soldText', label: 'Đã bán' },
];

const TITLE_RESEARCH_OUTPUT_RULES_BASE = `---
ĐẦU RA (không JSON):
1) Từ khóa vàng: liệt kê 5-8 cụm khách hay gõ Shopee, kèm lý do ngắn.
2) Mẫu đối thủ: 3-5 tên SP tương tự bán tốt — trích nguyên văn đoạn đầu tiêu đề họ gom từ khóa thế nào.
3) Đề xuất tiêu đề: đúng 5 phương án (đánh số 1-5), mỗi phương án gồm:
   - Tiêu đề đầy đủ (≤120 ký tự)
   - Đoạn hiện trên lưới (trích từ tiêu đề đề xuất) — in nghiêng hoặc trong ngoặc
   - Ghi chú 1 dòng: vì sao phương án này cạnh tranh được
4) Khuyến nghị: chọn 1 phương án tốt nhất và 2 việc nên tránh khi đặt tên loại SP này.`;

const TITLE_RESEARCH_OUTPUT_RULES_DUAL_SHOP = `
5) Shop cùng hệ (Thiên Trang + Rosy Ruby): đề xuất tiêu đề riêng cho TỪNG shop (mỗi shop 2-3 phương án), giải thích cách từ khóa bổ trợ nhau đẩy lên top — không copy y nguyên giữa hai shop.`;

function countFilledTitles(titlesByShopId) {
    return SIBLING_SHOPEE_SHOPS.filter((s) =>
        String(titlesByShopId[s.shopId] ?? '').trim(),
    ).length;
}

function buildOutputRules(siblingResult, titlesByShopId, filledSlotCount) {
    const dual =
        siblingResult?.hasAny ||
        filledSlotCount >= 2 ||
        countFilledTitles(titlesByShopId) >= 2;
    if (dual)
        return TITLE_RESEARCH_OUTPUT_RULES_BASE + TITLE_RESEARCH_OUTPUT_RULES_DUAL_SHOP;
    return TITLE_RESEARCH_OUTPUT_RULES_BASE;
}

function buildProductsSection(titlesByShopId, filledSlotCount = 0) {
    const lines = ['=== SẢN PHẨM CẦN TỐI ƯU (2 shop cùng hệ) ==='];
    for (const shop of SIBLING_SHOPEE_SHOPS) {
        const title = String(titlesByShopId[shop.shopId] ?? '').trim();
        lines.push(
            `- ${shop.brand} (${shop.account}, shopId ${shop.shopId}): ${title || '(chưa nhập tên SP)'}`,
        );
    }
    const filled = Math.max(filledSlotCount, countFilledTitles(titlesByShopId));
    if (filled >= 2) {
        lines.push(
            '',
            'Yêu cầu: tối ưu tiêu đề cho CẢ HAI sản phẩm trên cùng lúc — kể cả shop chưa xuất hiện trong bảng kết quả.',
        );
    }
    else if (filled === 1) {
        lines.push(
            '',
            'Gợi ý: nhập thêm tên SP thứ hai để Gemini đề xuất cho cả hai shop (tự nhận shop theo SP khớp trong bảng).',
        );
    }
    return lines.join('\n');
}

function buildPositionBlocks(rows, titlesByShopId) {
    const entries = resolveMultiProductDisplayPositions(
        rows,
        titlesByShopId,
        SIBLING_SHOPEE_SHOPS,
    );
    const blocks = entries
        .filter((e) => e.title && e.position.promptBlock)
        .map((e) => e.position.promptBlock);
    if (blocks.length)
        return blocks.join('\n\n');
    return `=== VỊ TRÍ HIỂN THỊ (trong bảng kết quả đã thu thập) ===
(Chưa nhập tên SP — nhập tên ở các ô «Tên sản phẩm của tôi» để xác định vị trí trong bảng.)`;
}

/**
 * @param {Record<string, unknown>[]} rows — dòng bảng SP tương tự
 * @param {Record<string, string>} [titlesByShopId] — shopId → tên SP (tự gán theo SP khớp bảng)
 * @param {{ filledSlotCount?: number }} [options]
 */
export function buildSimilarProductsTitleResearchPrompt(
    rows,
    titlesByShopId = {},
    options = {},
) {
    const filledSlotCount =
        options.filledSlotCount ?? countFilledTitles(titlesByShopId);
    const similar = rows.filter(
        (r) => r.kind === 'Tương tự' || r.kind === 'Kết quả',
    );
    const tableTsv = rowsToTsv(similar, TITLE_RESEARCH_PROMPT_COLUMNS);
    const siblingResult = collectSiblingShopPositions(rows);
    const siblingBlock = buildSiblingShopPromptBlock(siblingResult);
    const productsSection = buildProductsSection(titlesByShopId, filledSlotCount);
    const positionBlock = buildPositionBlocks(rows, titlesByShopId);
    const siblingSection = siblingBlock ? `\n${siblingBlock}\n` : '';
    const filledCount = countFilledTitles(titlesByShopId);
    const dualHint =
        siblingResult.hasAny || filledCount >= 2
            ? '- Có SP shop cùng hệ hoặc đã nhập 2 tên SP — ưu tiên tối ưu từ khóa cho cả hai thương hiệu, kể cả shop chưa có trong bảng.'
            : '';

    return stripDeprecatedPromptSections(`Bạn là chuyên gia SEO Shopee Việt Nam. Nhiệm vụ: nghiên cứu và đề xuất TIÊU ĐỀ sản phẩm dựa trên dữ liệu đối thủ (SP tương tự) bên dưới.

${productsSection}

${positionBlock}
${siblingSection}
=== DỮ LIỆU BẢNG (${similar.length} SP tương tự) ===
${tableTsv}

=== YÊU CẦU PHÂN TÍCH ===
- Đọc toàn bộ tên SP tương tự: từ khóa lặp lại, cách gom model/combo, đoạn đầu tiêu đề trên lưới.
- So sánh giá KM và lượt bán để ưu tiên học từ listing có đánh giá/đã bán tốt (không copy y nguyên).
- Đề xuất tiêu đề: ưu tiên từ khóa mua hàng ở đoạn đầu, dễ đọc trên lưới.
- Không bịa thương hiệu/model không có trong tên SP đã nhập hoặc bảng; không dùng Freeship/Hot/Top/Rẻ nhất.
${dualHint}

${buildOutputRules(siblingResult, titlesByShopId, filledSlotCount)}`);
}
