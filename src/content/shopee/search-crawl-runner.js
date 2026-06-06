import { getSettings } from "../../shared/storage.js";
import { mapRowsToOptimizeSerp } from "../../shared/optimize-serp-columns.js";
import { waitForElement } from "../shared/dom-utils.js";
import { isShopeeSearchUrl } from "./shopee-host.js";
import {
  findSimilarProductCards,
  productToTableRow,
  scrapeCurrentPage,
} from "./similar-products-scraper.js";
import { resolveMyProductDisplayPosition } from "./similar-products-title-position.js";
import {
  ingestPageIntoResearchTable,
  setOptimizeCrawlActive,
} from "./similar-products-research.js";

const CARD_WAIT_SELECTORS = [
  'div[role="group"][aria-label^="Product card"]',
  '[data-sqe="item"]',
  ".shopee-search-item-result",
];

const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[src*="recaptcha"]',
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  '[class*="verify" i][class*="modal" i]',
  ".shopee-captcha",
  ".nc-container",
];

/** Sau khi URL khớp từ khóa — chờ 1 s rồi PageDown */
const KEYWORD_SETTLE_MS = 1000;
/** Khoảng cách giữa mỗi lần PageDown */
const PAGE_DOWN_INTERVAL_MS = 500;
const KEYWORD_URL_MATCH_MS = 30_000;
const MIN_SANITY_PRODUCTS = 5;
const MAX_PAGE_DOWN_STEPS = 80;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function normalizeTitleKey(title) {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildKeywordSearchUrl(keyword) {
  const url = new URL("https://shopee.vn/search");
  url.searchParams.set("keyword", keyword);
  url.searchParams.delete("page");
  return url.toString();
}

function currentSearchKeyword(url = location.href) {
  try {
    return new URL(url).searchParams.get("keyword")?.trim() ?? "";
  } catch {
    return "";
  }
}

function isOnKeywordSearchPage(keyword) {
  if (!isShopeeSearchUrl()) return false;
  return normalizeTitleKey(currentSearchKeyword()) === normalizeTitleKey(keyword);
}

/** Heuristic phát hiện CAPTCHA Shopee trên trang hiện tại. */
export function detectShopeeCaptcha(root = document) {
  for (const sel of CAPTCHA_SELECTORS) {
    if (root.querySelector(sel)) return true;
  }
  const text = (root.body?.innerText ?? root.textContent ?? "").toLowerCase();
  if (/xác minh|verify you are|i'?m not a robot|robot check|captcha/.test(text)) {
    const hasCards = findSimilarProductCards(root).length > 0;
    if (!hasCards) return true;
  }
  return false;
}

function dispatchKey(key, code, keyCode) {
  const init = {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    view: window,
  };
  for (const target of [
    document.activeElement,
    document.body,
    document.documentElement,
  ]) {
    if (!target) continue;
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}

function isAtPageBottom() {
  const maxScroll =
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ) - window.innerHeight;
  return window.scrollY >= maxScroll - 4;
}

/** PageDown — kèm scroll fallback (~ một viewport). */
function pressPageDown() {
  dispatchKey("PageDown", "PageDown", 34);
  window.scrollBy({ top: window.innerHeight * 0.92, behavior: "instant" });
}

async function navigateToKeywordSearch(keyword, navigateDelayMs, signal, skipNavigate) {
  const settleMs = Math.max(Number(navigateDelayMs) || 0, KEYWORD_SETTLE_MS);
  if (skipNavigate) {
    if (!isOnKeywordSearchPage(keyword)) {
      throw new Error(
        `Tab search chưa đúng từ khóa «${keyword}» — đợi trang tải xong rồi thử lại`,
      );
    }
    await sleep(settleMs, signal);
    return;
  }
  const targetUrl = buildKeywordSearchUrl(keyword);
  if (!isOnKeywordSearchPage(keyword)) {
    location.assign(targetUrl);
    await sleep(settleMs, signal);
    try {
      await waitForElement(CARD_WAIT_SELECTORS, 20000);
    } catch {
      /* pageDownToBottom sẽ thử tiếp */
    }
    return;
  }
  await sleep(settleMs, signal);
}

async function waitForKeywordUrl(keyword, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < KEYWORD_URL_MATCH_MS) {
    signal?.throwIfAborted();
    if (isOnKeywordSearchPage(keyword)) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    await sleep(300, signal);
  }
  throw new Error(
    `Tab search chưa chuyển sang từ khóa «${keyword}» — đợi trang tải xong rồi thử lại`,
  );
}

/** PageDown mỗi 500 ms tới cuối trang — tới cuối là xong, không chờ thêm. */
async function pageDownToBottom(signal) {
  window.scrollTo({ top: 0, behavior: "instant" });

  for (let step = 0; step < MAX_PAGE_DOWN_STEPS; step++) {
    signal?.throwIfAborted();
    if (isAtPageBottom()) break;

    pressPageDown();
    await sleep(PAGE_DOWN_INTERVAL_MS, signal);
    ingestPageIntoResearchTable();
  }

  ingestPageIntoResearchTable();
}

/** Đợi 1 s → PageDown tới cuối trang → scrape ngay. */
async function loadSearchResultsByPageDown(keyword, signal) {
  await waitForKeywordUrl(keyword, signal);
  await sleep(KEYWORD_SETTLE_MS, signal);

  try {
    await waitForElement(CARD_WAIT_SELECTORS, 8000);
  } catch {
    /* vẫn PageDown — có thể DOM chậm */
  }

  await pageDownToBottom(signal);

  const scraped = scrapeCurrentPage().similar.length;
  const count = Math.max(scraped, findSimilarProductCards().length);

  if (count <= MIN_SANITY_PRODUCTS) {
    throw new Error(
      `Chỉ thấy ${count} SP cho «${keyword}» — trang chưa tải đủ (cần > ${MIN_SANITY_PRODUCTS})`,
    );
  }

  return count;
}

function filterByMinSold(rows, minSold) {
  const threshold = Number(minSold) || 0;
  if (threshold <= 0) return rows;
  return rows.filter((row) => {
    const sold = Number(row.soldNumeric);
    if (!Number.isFinite(sold)) return false;
    return sold >= threshold;
  });
}

function limitTopBySold(rows, max) {
  const cap = Number(max);
  if (!Number.isFinite(cap) || cap <= 0) return rows;
  return rows.slice(0, cap);
}

function sortBySoldDesc(rows) {
  return [...rows].sort((a, b) => {
    const sa = Number(a.soldNumeric);
    const sb = Number(b.soldNumeric);
    if (!Number.isFinite(sa) && !Number.isFinite(sb)) return 0;
    if (!Number.isFinite(sa)) return 1;
    if (!Number.isFinite(sb)) return -1;
    return sb - sa;
  });
}

function dedupeByTitle(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = normalizeTitleKey(row.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function resolveSourcePosition(tableRows, { sourceItemId, sourceTitle }) {
  const itemId = String(sourceItemId ?? "").trim();
  if (itemId) {
    const matched = tableRows.find((row) => String(row.itemId ?? "").trim() === itemId);
    if (matched) {
      return resolveMyProductDisplayPosition(
        tableRows,
        String(matched.title ?? sourceTitle ?? ""),
      );
    }
  }
  return resolveMyProductDisplayPosition(tableRows, String(sourceTitle ?? ""));
}

/**
 * Crawl SERP trang 1 cho một từ khóa trên tab hiện tại.
 * @param {{
 *   keyword: string,
 *   minSold?: number,
 *   maxCompetitors?: number,
 *   sourceItemId?: string,
 *   sourceTitle?: string,
 *   navigateDelayMs?: number,
 *   signal?: AbortSignal,
 *   skipNavigate?: boolean,
 * }} opts
 */
export async function crawlKeywordSearch(opts) {
  const keyword = String(opts.keyword ?? "").trim();
  if (!keyword) {
    throw new Error("Thiếu từ khóa crawl.");
  }

  const settings = await getSettings();
  const navigateDelayMs = Math.max(
    opts.navigateDelayMs ?? settings.optimizeNavigateDelayMs ?? KEYWORD_SETTLE_MS,
    KEYWORD_SETTLE_MS,
  );
  const minSold = opts.minSold ?? settings.optimizeMinSold ?? 1000;
  const maxCompetitors =
    opts.maxCompetitors ?? settings.optimizeMaxCompetitorsPerKeyword ?? 15;
  const signal = opts.signal;

  setOptimizeCrawlActive(true);
  try {
    await navigateToKeywordSearch(
      keyword,
      navigateDelayMs,
      signal,
      opts.skipNavigate === true,
    );

    if (detectShopeeCaptcha()) {
      return { status: "captcha", keyword, competitors: [], sourcePosition: null };
    }

    await loadSearchResultsByPageDown(keyword, signal);

    if (detectShopeeCaptcha()) {
      return { status: "captcha", keyword, competitors: [], sourcePosition: null };
    }

    ingestPageIntoResearchTable();
    const { similar } = scrapeCurrentPage();
    const tableRows = similar
      .map((product) => productToTableRow(product))
      .filter(Boolean);
    const filtered = filterByMinSold(tableRows, minSold);
    const deduped = dedupeByTitle(filtered);
    const sourcePosition = resolveSourcePosition(deduped, {
      sourceItemId: opts.sourceItemId,
      sourceTitle: opts.sourceTitle,
    });
    const bySold = sortBySoldDesc(deduped);
    const top = limitTopBySold(bySold, maxCompetitors);
    const competitors = mapRowsToOptimizeSerp(top, keyword);

    return {
      status: "ok",
      keyword,
      competitors,
      sourcePosition,
    };
  }
  finally {
    setOptimizeCrawlActive(false);
  }
}

/**
 * @param {unknown} payload
 * @param {AbortSignal} [signal]
 */
export async function handleShopeeSearchCrawl(payload, signal) {
  return crawlKeywordSearch({
    keyword: payload?.keyword,
    minSold: payload?.minSold,
    maxCompetitors: payload?.maxCompetitors,
    sourceItemId: payload?.sourceItemId,
    sourceTitle: payload?.sourceTitle,
    navigateDelayMs: payload?.navigateDelayMs,
    skipNavigate: payload?.skipNavigate === true,
    signal,
  });
}
