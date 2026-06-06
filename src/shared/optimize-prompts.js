import { rowsToTsv } from "./table-export.js";
import { OPTIMIZE_SERP_COLUMNS } from "./optimize-serp-columns.js";
import {
  REWRITE_JSON_OUTPUT_RULES,
  SHOPEE_DESCRIPTION_MAX_LENGTH,
  SHOPEE_TITLE_MAX_LENGTH,
  SHOPEE_TITLE_MIN_LENGTH,
  SHOPEE_TITLE_TARGET_MAX_LENGTH,
  SHOP_NAME_PROMPT_BLOCK,
} from "./storage.js";

export const OPTIMIZE_KEYWORDS_JSON_OUTPUT_RULES = `---
ĐẦU RA BẮT BUỘC (chỉ JSON, không markdown, không giải thích trước/sau):
- Trả về đúng một object JSON hợp lệ UTF-8.
- Không dùng \`\`\`json hay văn bản ngoài JSON.
- Schema: {"keywords":["cụm 1","cụm 2",...]}
- 8–10 cụm từ khóa, mỗi cụm 2–5 từ, tiếng Việt có dấu, sát cách khách gõ trên Shopee VN.
- Không dùng Freeship, Hot, Top, Rẻ nhất, Giảm giá, Bán chạy.
- Ví dụ: {"keywords":["bút bi bấm","tập viết định vị ngón","ngòi 0.5mm"]}`;

export const DEFAULT_OPTIMIZE_KEYWORD_PROMPT = `Bạn là chuyên gia SEO Shopee Việt Nam. Từ tiêu đề và mô tả sản phẩm bên dưới, đề xuất 8–10 CỤM TỪ KHÓA khách hay gõ trên Shopee để tìm loại sản phẩm này.

Quy tắc:
- Tiếng {language}, có dấu, 2–5 từ/cụm, sát ngành hàng thực tế.
- Ưu tiên nỗi đau / nhu cầu mua (vd tập viết, chống mỏi tay, siêu dính…).
- Không thêm tên shop, không khuyến mãi (Freeship/Hot/Top/Rẻ nhất/Giảm giá).
- Chỉ dựa trên nội dung gốc — không bịa model/thương hiệu không có.

Tên gian hàng (tham khảo ngữ cảnh, không đưa vào keywords): {shopName}

Tiêu đề gốc:
{title}

Mô tả gốc:
{description}`;

export const DEFAULT_OPTIMIZE_ANALYSIS_PROMPT = `Bạn là chuyên gia SEO Shopee Việt Nam. Phân tích đối thủ trang 1 (chỉ SERP trang 1) và viết lại TIÊU ĐỀ + MÔ TẢ tối ưu cho sản phẩm của tôi.

${SHOP_NAME_PROMPT_BLOCK}

=== SẢN PHẨM GỐC ===
Tiêu đề gốc:
{title}

Mô tả gốc:
{description}

=== VỊ TRÍ SP GỐC THEO TỪ KHÓA (trang 1) ===
{sourcePositionsBlock}

=== BẢNG ĐỐI THỦ (TSV, trang 1) ===
{competitorsTsv}

=== YÊU CẦU ===
- Học cách đặt từ khóa ở đoạn đầu tiêu đề từ đối thủ có lượt bán tốt; không copy y nguyên.
- Nếu SP gốc «không thấy» trên SERP trang 1 — vẫn tối ưu dựa trên đối thủ và nội dung gốc.
- Tiêu đề ${SHOPEE_TITLE_MIN_LENGTH}–${SHOPEE_TITLE_TARGET_MAX_LENGTH} ký tự (bắt buộc ≥${SHOPEE_TITLE_MIN_LENGTH}, mục tiêu ≤${SHOPEE_TITLE_TARGET_MAX_LENGTH}, trần ${SHOPEE_TITLE_MAX_LENGTH}); mô tả ≤${SHOPEE_DESCRIPTION_MAX_LENGTH} ký tự (đếm mọi ký tự, KHÔNG theo số từ). Mục tiêu mô tả 1500–2400 ký tự.
- Mô tả: 4 phần gọn (mở đầu / thông số bullet / hướng dẫn / cam kết + hashtag); emoji tiết kiệm; nếu dài thì rút phần 3–4 trước khi vượt ${SHOPEE_DESCRIPTION_MAX_LENGTH}.
- Được dùng dấu / khi hợp lý (Combo/Bộ, A4/A5).
- Áp dụng quy tắc tiêu đề/mô tả Shopee (từ khóa vàng, emoji chỉ trong mô tả, hashtag cuối).
- Cho phép dấu / trong tiêu đề; cấm emoji trong tiêu đề; cấm Freeship/Hot/Top/Rẻ nhất.`;

function fillTemplate(template, vars) {
  let out = String(template ?? "");
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), String(value ?? ""));
  }
  return out.trim();
}

function formatSourcePositionsBlock(crawlResults = []) {
  if (!crawlResults.length) {
    return "(Chưa có dữ liệu crawl SERP.)";
  }
  const lines = [];
  for (const chunk of crawlResults) {
    const kw = String(chunk.keyword ?? "").trim() || "—";
    const pos = chunk.sourcePosition;
    if (!pos) {
      lines.push(`- «${kw}»: (chưa crawl được SERP trang 1)`);
      continue;
    }
    if (pos.empty) {
      lines.push(`- «${kw}»: (chưa xác định — thiếu tên SP gốc)`);
      continue;
    }
    if (!pos.found) {
      lines.push(`- «${kw}»: không thấy SP gốc trên trang 1`);
      continue;
    }
    lines.push(
      `- «${kw}»: trang ${pos.page ?? "—"}, #${pos.rank ?? "—"}, lưới «${pos.gridVisible ?? "—"}»` +
        (pos.matchedTitle ? ` (khớp: ${pos.matchedTitle})` : ""),
    );
  }
  return lines.join("\n");
}

function flattenCompetitorsForTsv(crawlResults = []) {
  const rows = [];
  for (const chunk of crawlResults) {
    const kw = String(chunk.keyword ?? "").trim();
    for (const row of chunk.competitors ?? []) {
      rows.push({ ...row, keyword: row.keyword ?? kw });
    }
  }
  return rows;
}

/**
 * @param {{ title?: string, description?: string, shopName?: string, language?: string }} product
 * @param {Record<string, unknown>} settings
 */
export function buildKeywordPrompt(product, settings = {}) {
  const template =
    String(settings.optimizeKeywordPrompt ?? "").trim() ||
    DEFAULT_OPTIMIZE_KEYWORD_PROMPT;
  const shopName = String(product.shopName ?? "").trim();
  const body = fillTemplate(template, {
    title: product.title ?? "",
    description: product.description ?? "",
    shopName: shopName || "(chưa đọc được tên gian hàng)",
    language: settings.language ?? product.language ?? "Việt",
  });
  if (body.includes("ĐẦU RA BẮT BUỘC")) {
    return body;
  }
  return `${body}\n\n${OPTIMIZE_KEYWORDS_JSON_OUTPUT_RULES}`;
}

/**
 * @param {{
 *   title?: string,
 *   description?: string,
 *   shopName?: string,
 *   language?: string,
 *   crawlResults?: Array<{ keyword?: string, competitors?: Record<string, unknown>[], sourcePosition?: Record<string, unknown> }>,
 * }} product
 * @param {Record<string, unknown>} settings
 */
export function buildAnalysisPrompt(product, settings = {}) {
  const template =
    String(settings.optimizeAnalysisPrompt ?? "").trim() ||
    DEFAULT_OPTIMIZE_ANALYSIS_PROMPT;
  const crawlResults = product.crawlResults ?? [];
  const competitorsTsv = rowsToTsv(
    flattenCompetitorsForTsv(crawlResults),
    OPTIMIZE_SERP_COLUMNS,
  );
  const sourcePositionsBlock = formatSourcePositionsBlock(crawlResults);
  const shopName = String(product.shopName ?? "").trim();
  const body = fillTemplate(template, {
    title: product.title ?? "",
    description: product.description ?? "",
    shopName: shopName || "(chưa đọc được tên gian hàng)",
    language: settings.language ?? product.language ?? "Việt",
    competitorsTsv,
    sourcePositionsBlock,
  });
  if (body.includes("ĐẦU RA BẮT BUỘC")) {
    return body;
  }
  return `${body}\n\n${REWRITE_JSON_OUTPUT_RULES}`;
}
