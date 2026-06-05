/** Cột TSV đối thủ gửi Gemini — pipeline tối ưu tự động (không link/đánh giá/giảm). */
export const OPTIMIZE_SERP_COLUMNS = [
  { key: "keyword", label: "Từ khóa" },
  { key: "rank", label: "# trang 1" },
  { key: "title", label: "Tên đầy đủ" },
  { key: "titleVisibleApprox", label: "Đoạn hiện lưới" },
  { key: "titleGridCharCount", label: "Số ký tự lưới" },
  { key: "priceText", label: "Giá KM" },
  { key: "soldText", label: "Đã bán" },
];

/**
 * @param {Record<string, unknown>} row
 * @param {string} keyword
 */
export function pickOptimizeSerpFields(row, keyword) {
  const picked = { keyword: String(keyword ?? "").trim() };
  for (const col of OPTIMIZE_SERP_COLUMNS) {
    if (col.key === "keyword") continue;
    picked[col.key] = row[col.key] ?? "";
  }
  return picked;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} keyword
 */
export function mapRowsToOptimizeSerp(rows, keyword) {
  return rows.map((row) => pickOptimizeSerpFields(row, keyword));
}
