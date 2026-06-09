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

/**
 * Hàng đầy đủ cho sidebar review (giá min/max, đã bán số).
 * @param {Record<string, unknown>[]} rows
 * @param {string} keyword
 */
function parsePriceDigits(text) {
  const digits = String(text ?? "").replace(/[^\d]/g, "");
  if (!digits)
    return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ price: number, sold: number, title: string } | null}
 */
function competitorPriceSold(row) {
  const sold = Number(row.soldNumeric);
  const priceMin = Number(row.priceMin);
  const price = Number.isFinite(priceMin) && priceMin > 0
    ? priceMin
    : parsePriceDigits(row.priceText);
  if (!price)
    return null;
  return {
    price,
    sold: Number.isFinite(sold) ? sold : 0,
    title: String(row.title ?? "").trim(),
  };
}

/**
 * @param {Array<{ competitors?: Record<string, unknown>[], competitorsUi?: Record<string, unknown>[] }>} crawlResults
 * @returns {Array<{ price: number, sold: number, title: string }>}
 */
export function collectCompetitorPriceSoldRows(crawlResults) {
  const rows = [];
  for (const chunk of crawlResults ?? []) {
    for (const row of chunk.competitorsUi ?? chunk.competitors ?? []) {
      const parsed = competitorPriceSold(row);
      if (parsed)
        rows.push(parsed);
    }
  }
  rows.sort((a, b) => b.sold - a.sold || a.price - b.price);
  return rows;
}

/**
 * Giá KM của đối thủ có lượt bán cao nhất trên SERP.
 * @param {Array<{ competitors?: Record<string, unknown>[], competitorsUi?: Record<string, unknown>[] }>} crawlResults
 * @returns {number | null}
 */
export function getTopSellerPriceFromCrawl(crawlResults) {
  const top = collectCompetitorPriceSoldRows(crawlResults)[0];
  return top?.price ?? null;
}

/**
 * Ước giá cạnh tranh từ SERP khi Gemini không trả suggestedPrice.
 * Lấy giá KM của SP bán chạy nhất (soldNumeric cao nhất).
 * @param {Array<{ competitors?: Record<string, unknown>[], competitorsUi?: Record<string, unknown>[] }>} crawlResults
 * @param {number | null} [minSellPrice]
 * @returns {number | null}
 */
export function inferSuggestedPriceFromCrawl(crawlResults, minSellPrice = null) {
  const anchor = getTopSellerPriceFromCrawl(crawlResults);
  if (anchor == null)
    return null;
  let suggested = anchor;
  if (minSellPrice != null && suggested < minSellPrice)
    suggested = minSellPrice;
  return suggested;
}

/**
 * Điều chỉnh giá Gemini nếu neo quá sát giá vốn/sàn trong khi SERP bán chạy cao hơn.
 * @param {number | null | undefined} suggestedPrice
 * @param {Array<{ competitors?: Record<string, unknown>[], competitorsUi?: Record<string, unknown>[] }>} crawlResults
 * @param {number | null} [minSellPrice]
 * @returns {{ price: number | null, alignedFromTopSeller: boolean }}
 */
export function alignSuggestedPriceWithSerp(suggestedPrice, crawlResults, minSellPrice = null) {
  const anchor = getTopSellerPriceFromCrawl(crawlResults);
  if (anchor == null) {
    const price = Number.isFinite(suggestedPrice) && suggestedPrice > 0
      ? suggestedPrice
      : null;
    return { price, alignedFromTopSeller: false };
  }
  const floor = minSellPrice != null && minSellPrice > 0 ? minSellPrice : 0;
  let price = Number.isFinite(suggestedPrice) && suggestedPrice > 0
    ? suggestedPrice
    : null;
  if (price == null) {
    const next = floor > 0 && anchor < floor ? floor : anchor;
    return { price: next, alignedFromTopSeller: true };
  }
  if (floor > 0 && price < floor)
    price = floor;
  let alignedFromTopSeller = false;
  if (anchor > floor && price <= floor * 1.1 && anchor > price * 1.15) {
    price = anchor;
    alignedFromTopSeller = true;
  }
  else if (anchor > floor && price < anchor * 0.85) {
    price = anchor;
    alignedFromTopSeller = true;
  }
  return { price, alignedFromTopSeller };
}

function formatVndHint(n) {
  return `${Math.round(n).toLocaleString("vi-VN")}₫`;
}

/**
 * Khối gợi ý giá cho prompt Gemini — neo theo SP bán chạy nhất.
 * @param {Array<{ competitors?: Record<string, unknown>[], competitorsUi?: Record<string, unknown>[] }>} crawlResults
 */
export function formatSerpPricingHintBlock(crawlResults) {
  const rows = collectCompetitorPriceSoldRows(crawlResults);
  if (!rows.length)
    return "(Chưa có giá đối thủ trên SERP.)";
  const lines = [];
  const top = rows[0];
  const soldLabel = top.sold > 0 ? `${top.sold.toLocaleString("vi-VN")}+` : "—";
  const titleShort = top.title ? top.title.slice(0, 60) : "—";
  lines.push(
    `- SP bán chạy nhất trên SERP: ${formatVndHint(top.price)} (đã bán ${soldLabel}) — «${titleShort}»`,
  );
  const top3 = rows.slice(0, 3);
  if (top3.length > 1) {
    const prices = top3.map((r) => formatVndHint(r.price)).join(", ");
    lines.push(`- Top ${top3.length} bán chạy (giá KM): ${prices}`);
  }
  lines.push(
    "- suggestedPrice nên GẦN giá SP bán chạy nhất (ưu tiên #1), KHÔNG neo sát giá vốn / giá sàn tối thiểu.",
  );
  lines.push(
    "- Giá sàn tối thiểu (nếu có) chỉ là ngưỡng dưới — khi đối thủ bán chạy cao hơn thì đề xuất theo đối thủ.",
  );
  return lines.join("\n");
}

export function mapRowsToOptimizeUi(rows, keyword) {
  const kw = String(keyword ?? "").trim();
  return rows.map((row, index) => {
    const title = String(row.title ?? "").trim();
    const itemId = String(row.itemId ?? "").trim();
    const rank = row.rank ?? index + 1;
    const id = itemId
      ? `${kw}::${itemId}`
      : `${kw}::${rank}::${title.slice(0, 40)}`;
    return {
      id,
      keyword: kw,
      rank,
      title,
      titleVisibleApprox: row.titleVisibleApprox ?? "",
      priceText: row.priceText ?? "",
      priceMin: row.priceMin ?? null,
      priceMax: row.priceMax ?? null,
      soldText: row.soldText ?? "",
      soldNumeric: row.soldNumeric ?? null,
      itemId,
      shopId: String(row.shopId ?? "").trim(),
    };
  });
}
