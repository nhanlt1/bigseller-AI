import { rowsToTsv } from '../../shared/table-export.js';
import { stripDeprecatedPromptSections } from '../../shared/storage.js';
import { resolveMyProductDisplayPosition } from './similar-products-title-position.js';

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

const TITLE_RESEARCH_OUTPUT_RULES = `---
ĐẦU RA (không JSON):
1) Từ khóa vàng: liệt kê 5-8 cụm khách hay gõ Shopee, kèm lý do ngắn.
2) Mẫu đối thủ: 3-5 tên SP tương tự bán tốt — trích nguyên văn đoạn đầu tiêu đề họ gom từ khóa thế nào.
3) Đề xuất tiêu đề: đúng 5 phương án (đánh số 1-5), mỗi phương án gồm:
   - Tiêu đề đầy đủ (≤120 ký tự)
   - Đoạn hiện trên lưới (trích từ tiêu đề đề xuất) — in nghiêng hoặc trong ngoặc
   - Ghi chú 1 dòng: vì sao phương án này cạnh tranh được
4) Khuyến nghị: chọn 1 phương án tốt nhất và 2 việc nên tránh khi đặt tên loại SP này.`;

/**
 * @param {Record<string, unknown>[]} rows — dòng bảng SP tương tự
 * @param {string} myProductTitle — tên SP người dùng nhập
 */
export function buildSimilarProductsTitleResearchPrompt(rows, myProductTitle = '') {
    const similar = rows.filter(
        (r) => r.kind === 'Tương tự' || r.kind === 'Kết quả',
    );
    const tableTsv = rowsToTsv(similar, TITLE_RESEARCH_PROMPT_COLUMNS);
    const mainTitle = String(myProductTitle ?? '').trim() || '(chưa nhập tên SP của tôi)';
    const position = resolveMyProductDisplayPosition(rows, myProductTitle);
    const positionBlock =
        position.promptBlock ||
        `=== VỊ TRÍ HIỂN THỊ SP CỦA TÔI (trong bảng kết quả đã thu thập) ===
(Chưa nhập tên SP — nhập "Tên sản phẩm của tôi" để xác định vị trí trong bảng.)`;

    return stripDeprecatedPromptSections(`Bạn là chuyên gia SEO Shopee Việt Nam. Nhiệm vụ: nghiên cứu và đề xuất TIÊU ĐỀ sản phẩm dựa trên dữ liệu đối thủ (SP tương tự) bên dưới.

Sản phẩm cần đặt tên (SP của tôi — do người bán nhập):
${mainTitle}

${positionBlock}

=== DỮ LIỆU BẢNG (${similar.length} SP tương tự) ===
${tableTsv}

=== YÊU CẦU PHÂN TÍCH ===
- Đọc toàn bộ tên SP tương tự: từ khóa lặp lại, cách gom model/combo, đoạn đầu tiêu đề trên lưới.
- So sánh giá KM và lượt bán để ưu tiên học từ listing có đánh giá/đã bán tốt (không copy y nguyên).
- Đề xuất tiêu đề cho SP chính: ưu tiên từ khóa mua hàng ở đoạn đầu, dễ đọc trên lưới.
- Không bịa thương hiệu/model không có trong SP chính hoặc bảng; không dùng Freeship/Hot/Top/Rẻ nhất.

${TITLE_RESEARCH_OUTPUT_RULES}`);
}
