import { parseVndText } from "../../pricing/order-settlement.js";
import { isShopeeSearchUrl } from "./shopee-host.js";

const MAIN_ROOT_SELECTORS = [".XwdvuO", ".container .XwdvuO"];

export const GRID_TITLE_CHAR_MIN = 44;
export const GRID_TITLE_CHAR_MAX = 52;

/** Đếm ký tự tiêu đề — chữ có dấu (á, ấ, …) mỗi chữ = 1 ký tự */
export function countGridTitleChars(text) {
  return [...String(text ?? "")].length;
}

export function titleVisibleApprox(title, maxChars = GRID_TITLE_CHAR_MAX) {
  const raw = String(title ?? "").trim();
  if (!raw) return "";
  return [...raw].slice(0, maxChars).join("").trim();
}

export function parsePriceRange(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { priceText: "", priceMin: null, priceMax: null };
  const parts = raw.split(/\s*[-–—]\s*/);
  if (parts.length >= 2) {
    const priceMin = parseVndText(parts[0]);
    const priceMax = parseVndText(parts[1]);
    const priceText =
      priceMin && priceMax
        ? `${formatVndShort(priceMin)} - ${formatVndShort(priceMax)}`
        : raw;
    return {
      priceText,
      priceMin: priceMin || null,
      priceMax: priceMax || null,
    };
  }
  const single = parseVndText(raw);
  const priceText = single ? formatVndShort(single) : raw;
  return { priceText, priceMin: single || null, priceMax: single || null };
}

function formatVndShort(n) {
  if (!n) return "";
  return n.toLocaleString("vi-VN") + "₫";
}

export function parseSoldCount(text) {
  const raw = String(text ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return { soldText: "", soldNumeric: null };
  const soldText = raw;
  const kMatch = raw.match(/([\d.,]+)\s*k\+?/i);
  if (kMatch) {
    const base = Number.parseFloat(kMatch[1].replace(",", "."));
    return { soldText, soldNumeric: Math.round(base * 1000) };
  }
  const mMatch = raw.match(/([\d.,]+)\s*m\+?/i);
  if (mMatch) {
    const base = Number.parseFloat(mMatch[1].replace(",", "."));
    return { soldText, soldNumeric: Math.round(base * 1_000_000) };
  }
  const digits = raw.replace(/[^\d]/g, "");
  return {
    soldText,
    soldNumeric: digits ? Number.parseInt(digits, 10) : null,
  };
}

export function parseRatingCount(text) {
  const raw = String(text ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

export function parseRatingScore(text) {
  const m = String(text ?? "").match(/\b(\d(?:\.\d)?)\b/);
  return m ? Number.parseFloat(m[1]) : null;
}

export function parseDiscountPercent(text) {
  const m = String(text ?? "").match(/(-?\d+)\s*%/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** itemid/shopid từ URL SP Shopee: ...-i.{shopid}.{itemid} */
export function parseProductIdsFromUrl(url) {
  const href = String(url ?? "");
  const m =
    href.match(/\.(\d+)\.(\d+)(?:\?|#|$)/) ?? href.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  try {
    const u = new URL(href, location.origin);
    const itemId = u.searchParams.get("itemid") ?? "";
    const shopId = u.searchParams.get("shopid") ?? "";
    if (itemId || shopId) return { shopId, itemId };
  } catch {
    /* relative URL */
  }
  return { shopId: "", itemId: "" };
}

function readCardPrice(card) {
  const priceSpan =
    card.querySelector("span.truncate.text-base\\/5.font-medium") ??
    card.querySelector(".text-shopee-primary span.truncate.font-medium") ??
    card.querySelector('[class*="text-shopee-primary"] span.truncate');
  let text = priceSpan?.textContent?.trim() ?? "";
  const parent = priceSpan?.closest(".truncate, .flex");
  const currency = parent
    ?.querySelector("span:not(.truncate)")
    ?.textContent?.trim();
  if (text && currency === "₫" && !text.includes("₫")) text = text + "₫";
  if (!text) {
    const block = card.querySelector(".text-shopee-primary");
    text = block?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  return parsePriceRange(text);
}

function findMainRoot(root = document) {
  for (const sel of MAIN_ROOT_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function readUrlParams() {
  const params = new URLSearchParams(location.search);
  return {
    itemId: params.get("itemid") ?? "",
    shopId: params.get("shopid") ?? "",
    catId: params.get("catid") ?? "",
  };
}

/**
 * @param {Document} [root]
 * @param {number} page
 */
export function scrapeMainProduct(root = document, page = 1) {
  if (page > 1) return null;
  const block = findMainRoot(root);
  if (!block) return null;
  const titleEl =
    block.querySelector("a.nUiJ7Z") ??
    block.querySelector('a[href*="shopee.vn"]');
  const title = titleEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const productUrl = titleEl?.href ?? "";
  const ratingCountEl = block.querySelector(
    ".shopee-product-info__header__rating-count",
  );
  const soldEl = block.querySelector(
    ".shopee-product-info__header__sold-count",
  );
  const priceEl = block.querySelector(".FZKPyi");
  const ratingBlock = block.querySelector(
    ".shopee-product-info__header__rating",
  );
  const blockText = block.textContent ?? "";
  const discountPercent = parseDiscountPercent(blockText);
  const price = parsePriceRange(priceEl?.textContent ?? "");
  const sold = parseSoldCount(soldEl?.textContent ?? "");
  const urlIds = parseProductIdsFromUrl(productUrl);
  const queryIds = readUrlParams();
  return {
    kind: "main",
    page: 1,
    rank: 0,
    title,
    titleVisibleApprox: titleVisibleApprox(title),
    titleGridCharCount: countGridTitleChars(title),
    ...price,
    discountPercent,
    ratingScore: parseRatingScore(ratingBlock?.textContent ?? blockText),
    ratingCount: parseRatingCount(ratingCountEl?.textContent ?? ""),
    ratingCountText: ratingCountEl?.textContent?.trim() ?? "",
    ...sold,
    productUrl,
    itemId: urlIds.itemId || queryIds.itemId,
    shopId: urlIds.shopId || queryIds.shopId,
    catId: queryIds.catId,
    shopName: extractShopNameFromMain(block),
  };
}

function extractShopNameFromMain(block) {
  const links = block.querySelectorAll('a[href*="/shop/"], a[href*="shopid="]');
  for (const a of links) {
    const t = a.textContent?.trim();
    if (t && t.length > 1 && t.length < 80) return t;
  }
  return "";
}

function findSearchResultCards(root = document) {
  const bySqe = root.querySelectorAll('[data-sqe="item"]');
  if (bySqe.length) return [...bySqe];
  const containers = root.querySelectorAll(
    '.shopee-search-item-result, [class*="search-item-result"]',
  );
  for (const container of containers) {
    const cards = container.querySelectorAll(
      'div[role="group"][aria-label^="Product card"]',
    );
    if (cards.length >= 2) return [...cards];
  }
  return [];
}

function scrapeCardKind() {
  return isShopeeSearchUrl() ? "search" : "similar";
}

function collectUniqueCards(nodeLists) {
  const seen = new Set();
  const results = [];
  for (const list of nodeLists) {
    for (const el of list) {
      if (seen.has(el)) continue;
      seen.add(el);
      results.push(el);
    }
  }
  return results;
}

export function findSimilarProductCards(root = document) {
  if (isShopeeSearchUrl()) {
    const searchCards = findSearchResultCards(root);
    if (searchCards.length) return searchCards;
    return collectUniqueCards([
      root.querySelectorAll('div[role="group"][aria-label^="Product card"]'),
    ]);
  }
  const cardSel = 'div[role="group"][aria-label^="Product card"]';
  const rows = root.querySelectorAll(".rBfdm_.row");
  if (rows.length) {
    const fromRows = collectUniqueCards(
      [...rows].map((row) => row.querySelectorAll(cardSel)),
    );
    if (fromRows.length) return fromRows;
  }
  const looseRows = root.querySelectorAll('[class*="rBfdm_"]');
  if (looseRows.length) {
    const fromLoose = collectUniqueCards(
      [...looseRows].map((row) => row.querySelectorAll(cardSel)),
    );
    if (fromLoose.length) return fromLoose;
  }
  return collectUniqueCards([
    root.querySelectorAll('.wujux8 > div[role="group"]'),
    root.querySelectorAll(cardSel),
  ]);
}

export function readSimilarCardTitle(card) {
  const aria = card.getAttribute("aria-label") ?? "";
  const fromAria = aria.replace(/^Product card:\s*/i, "").trim();
  const titleEl =
    card.querySelector("div.line-clamp-2") ??
    card.querySelector('[class*="line-clamp-2"]');
  const fromDom = titleEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return fromDom || fromAria;
}

/**
 * @param {Document} [root]
 * @param {number} page
 */
export function scrapeSimilarProducts(root = document, page = 1) {
  const cards = findSimilarProductCards(root);
  const results = [];
  cards.forEach((card, index) => {
    const title = readSimilarCardTitle(card);
    if (!title) return;
    const link = card.querySelector('a.contents[href], a[href*="shopee.vn"]');
    const productUrl = link?.href ?? "";
    const soldEl =
      card.querySelector(".text-shopee-black87.text-xs") ??
      card.querySelector('[class*="text-xs"][class*="truncate"]');
    const sold = parseSoldCount(soldEl?.textContent ?? "");
    const cardText = card.textContent ?? "";
    const price = readCardPrice(card);
    const ids = parseProductIdsFromUrl(productUrl);
    results.push({
      kind: scrapeCardKind(),
      page,
      rank: index + 1,
      title,
      ariaLabel: card.getAttribute("aria-label") ?? "",
      titleVisibleApprox: titleVisibleApprox(title),
      titleGridCharCount: countGridTitleChars(title),
      ...price,
      discountPercent: parseDiscountPercent(cardText),
      ratingScore: parseRatingScore(cardText),
      ratingCount: null,
      ratingCountText: "",
      ...sold,
      productUrl,
      itemId: ids.itemId,
      shopId: ids.shopId,
      catId: "",
      shopName: "",
    });
  });
  return results;
}

function parsePageButtonText(el) {
  const text = String(el?.textContent ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return n >= 1 ? n : null;
}

function isActivePageControl(el) {
  if (!el || parsePageButtonText(el) == null) return false;
  if (el.getAttribute("aria-current") === "page") return true;
  const cls = String(el.className ?? "");
  if (/page--active|__page--active/.test(cls)) return true;
  if (/\bactive\b/.test(cls) && !/\binactive\b/.test(cls)) return true;
  if (el.matches?.("button.shopee-button-solid, .shopee-button-solid"))
    return true;
  return false;
}

/** Trang hiện tại — ưu tiên nút phân trang Shopee (SPA thường không đổi ?page=). */
export function detectShopeeCurrentPage(doc = document) {
  const controllers = doc.querySelectorAll(
    '.shopee-page-controller, .shopee-mini-page-controller, [class*="page-controller"]',
  );
  for (const root of controllers) {
    const marked = root.querySelector(
      '.shopee-page-controller__page--active, [class*="__page--active"], [aria-current="page"]',
    );
    const fromMarked = parsePageButtonText(marked);
    if (fromMarked) return fromMarked;

    for (const el of root.querySelectorAll(
      "button, a, .shopee-page-controller__page, [class*='page-controller__page']",
    )) {
      if (!isActivePageControl(el)) continue;
      const n = parsePageButtonText(el);
      if (n) return n;
    }
  }

  const fromUrl = Number.parseInt(
    new URLSearchParams(location.search).get("page") ?? "",
    10,
  );
  if (fromUrl >= 1) return fromUrl;
  return 1;
}

/**
 * @param {Document} [root]
 */
export function scrapeCurrentPage(root = document) {
  const page = detectShopeeCurrentPage(root);
  const main = scrapeMainProduct(root, page);
  const similar = scrapeSimilarProducts(root, page);
  return { page, main, similar };
}

/** @typedef {ReturnType<typeof scrapeMainProduct> | ReturnType<typeof scrapeSimilarProducts>[number]} ScrapedProduct */

/** Cột hiển thị trên bảng panel */
export const RESEARCH_TABLE_COLUMNS = [
  { key: "page", label: "Trang", colClass: "col-num" },
  { key: "rank", label: "#", colClass: "col-num" },
  { key: "title", label: "Tên sản phẩm", colClass: "col-title" },
  { key: "priceText", label: "Giá KM", colClass: "col-price" },
  { key: "discountDisplay", label: "Giảm", colClass: "col-num" },
  { key: "ratingDisplay", label: "Đánh giá", colClass: "col-rating" },
  { key: "soldText", label: "Đã bán", colClass: "col-sold" },
  { key: "productUrl", label: "Link", colClass: "col-link" },
];

/** Cột bổ sung khi copy / tải CSV */
export const RESEARCH_EXPORT_EXTRA_COLUMNS = [
  { key: "titleGridCharCount", label: "Số ký tự lưới" },
  { key: "priceMin", label: "Giá min (đ)" },
  { key: "priceMax", label: "Giá max (đ)" },
  { key: "soldNumeric", label: "Đã bán (ước tính)" },
  { key: "itemId", label: "itemId" },
  { key: "shopId", label: "shopId" },
];

export const RESEARCH_EXPORT_COLUMNS = [
  ...RESEARCH_TABLE_COLUMNS,
  ...RESEARCH_EXPORT_EXTRA_COLUMNS,
];

function formatDiscountDisplay(pct) {
  if (pct == null || pct === "") return "";
  const n = Number(pct);
  if (!Number.isFinite(n)) return String(pct);
  return n > 0 ? `-${n}%` : `${n}%`;
}

function formatRatingDisplay(product) {
  const score = product.ratingScore;
  const count =
    product.ratingCount ?? parseRatingCount(product.ratingCountText ?? "");
  if (score != null && count) return `${score} · ${count}`;
  if (score != null) return String(score);
  if (product.ratingCountText) return product.ratingCountText;
  if (count) return String(count);
  return "";
}

export function productToTableRow(product) {
  if (!product) return null;
  const row = {
    kind:
      product.kind === "main"
        ? "Chính"
        : product.kind === "search"
          ? "Kết quả"
          : "Tương tự",
    page: product.kind === "main" ? "—" : (product.page ?? ""),
    rank: product.kind === "main" ? "—" : (product.rank ?? ""),
    title: product.title ?? "",
    titleVisibleApprox: product.titleVisibleApprox ?? "",
    titleGridCharCount: product.titleGridCharCount ?? "",
    priceText: product.priceText ?? "",
    priceMin: product.priceMin ?? "",
    priceMax: product.priceMax ?? "",
    discountDisplay: formatDiscountDisplay(product.discountPercent),
    ratingDisplay: formatRatingDisplay(product),
    soldText: product.soldText ?? "",
    soldNumeric: product.soldNumeric ?? "",
    productUrl: product.productUrl ?? "",
    itemId: product.itemId ?? "",
    shopId: product.shopId ?? "",
  };
  return row;
}

/** Chỉ SP tương tự — không thêm SP chính từ DOM */
export function buildTableRows(_main, similarList) {
  const rows = [];
  for (const p of similarList) {
    const r = productToTableRow(p);
    if (r) rows.push(r);
  }
  return rows;
}
