import { SIBLING_SHOPEE_SHOPS } from '../../shared/shop-names.js';
import { rowsToTsv } from '../../shared/table-export.js';
import { stripDeprecatedPromptSections } from '../../shared/storage.js';
import {
    buildSiblingShopPromptBlock,
    collectSiblingShopPositions,
} from './similar-products-sibling-shops.js';
import { deriveTitlesByShopFromList } from './similar-products-my-titles.js';
import {
    resolveProductDisplayPositionsForTitles,
} from './similar-products-title-position.js';

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

const TITLE_RESEARCH_OUTPUT_RULES_MULTI = `
5) Nhiều sản phẩm / shop cùng hệ: đề xuất tiêu đề riêng cho TỪNG SP đã nhập (mỗi SP 2-3 phương án nếu có ≥2 SP), giải thích cách từ khóa bổ trợ nhau — không copy y nguyên giữa các SP.`;

function countFilledTitles(titlesByShopId) {
    return SIBLING_SHOPEE_SHOPS.filter((s) =>
        String(titlesByShopId[s.shopId] ?? '').trim(),
    ).length;
}

function buildOutputRules(siblingResult, productTitleCount, titlesByShopId) {
    const multi =
        siblingResult?.hasAny ||
        productTitleCount >= 2 ||
        countFilledTitles(titlesByShopId) >= 2;
    if (multi)
        return TITLE_RESEARCH_OUTPUT_RULES_BASE + TITLE_RESEARCH_OUTPUT_RULES_MULTI;
    return TITLE_RESEARCH_OUTPUT_RULES_BASE;
}

function shopLabelForTitle(title, titlesByShopId) {
    const shop = SIBLING_SHOPEE_SHOPS.find(
        (s) => String(titlesByShopId[s.shopId] ?? '').trim() === title,
    );
    return shop?.brand ?? '';
}

function buildProductsSection(productTitles, titlesByShopId) {
    const titles = productTitles
        .map((t) => String(t ?? '').trim())
        .filter(Boolean);
    const lines = ['=== SẢN PHẨM CẦN TỐI ƯU ==='];
    if (!titles.length) {
        lines.push('(Chưa nhập tên SP — dán tên vào ô bên dưới «Tên sản phẩm của tôi»)');
    }
    else {
        titles.forEach((title, i) => {
            const brand = shopLabelForTitle(title, titlesByShopId);
            const suffix = brand ? ` (${brand})` : '';
            lines.push(`${i + 1}. ${title}${suffix}`);
        });
    }
    if (titles.length >= 2) {
        lines.push(
            '',
            'Yêu cầu: tối ưu tiêu đề cho TẤT CẢ sản phẩm trên cùng lúc — kể cả SP chưa xuất hiện trong bảng kết quả.',
        );
    }
    else if (titles.length === 1) {
        lines.push(
            '',
            'Gợi ý: thêm tên SP khác (dán thêm) để Gemini so sánh và đề xuất cho nhiều listing.',
        );
    }
    return lines.join('\n');
}

function buildPositionBlocks(rows, productTitles) {
    const entries = resolveProductDisplayPositionsForTitles(rows, productTitles);
    const blocks = entries
        .filter((e) => e.title && e.position.promptBlock)
        .map((e) => e.position.promptBlock);
    if (blocks.length)
        return blocks.join('\n\n');
    return `=== VỊ TRÍ HIỂN THỊ (trong bảng kết quả đã thu thập) ===
(Chưa nhập tên SP — dán tên vào ô «Tên sản phẩm của tôi» để xác định vị trí trong bảng.)`;
}

/**
 * @param {Record<string, unknown>[]} rows — dòng bảng SP tương tự
 * @param {Record<string, string>} [titlesByShopId] — shopId → tên SP (tự gán theo SP khớp bảng)
 * @param {{ productTitles?: string[], filledSlotCount?: number }} [options]
 */
export function buildSimilarProductsTitleResearchPrompt(
    rows,
    titlesByShopId = {},
    options = {},
) {
    const productTitles =
        options.productTitles ??
        SIBLING_SHOPEE_SHOPS.map((s) =>
            String(titlesByShopId[s.shopId] ?? '').trim(),
        ).filter(Boolean);
    const derivedByShop =
        Object.keys(titlesByShopId).length > 0
            ? titlesByShopId
            : deriveTitlesByShopFromList(rows, productTitles);
    const filledCount =
        options.filledSlotCount ?? productTitles.filter((t) => String(t).trim()).length;
    const similar = rows.filter(
        (r) => r.kind === 'Tương tự' || r.kind === 'Kết quả',
    );
    const tableTsv = rowsToTsv(similar, TITLE_RESEARCH_PROMPT_COLUMNS);
    const siblingResult = collectSiblingShopPositions(rows);
    const siblingBlock = buildSiblingShopPromptBlock(siblingResult);
    const productsSection = buildProductsSection(productTitles, derivedByShop);
    const positionBlock = buildPositionBlocks(rows, productTitles);
    const siblingSection = siblingBlock ? `\n${siblingBlock}\n` : '';
    const multiHint =
        siblingResult.hasAny || filledCount >= 2
            ? '- Có nhiều SP / shop cùng hệ — ưu tiên tối ưu từ khóa cho từng SP đã nhập, kể cả SP chưa có trong bảng.'
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
- Đề xuất tiêu đề: ưu tiên từ khóa mua hàng ở đoạn đầu, dễ đọc trên lưới; được phép dùng dấu / (vd Combo/Bộ, A4/A5).
- Không bịa thương hiệu/model không có trong tên SP đã nhập hoặc bảng; không dùng Freeship/Hot/Top/Rẻ nhất.
${multiHint}

${buildOutputRules(siblingResult, filledCount, derivedByShop)}`);
}
