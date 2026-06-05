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
import { setOptimizeCrawlActive } from "./similar-products-research.js";

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

const SCROLL_STEP_PX = 400;
const SCROLL_STABLE_ROUNDS = 5;
const DEFAULT_MIN_PRODUCT_CARDS = 55;
const SCROLL_MAX_WAIT_MS = 150_000;
const DEFAULT_SCROLL_SETTLE_MS = 2500;
const CARD_LOAD_POLL_MS = 1000;
const CARD_LOAD_STABLE_ROUNDS = 5;
const INITIAL_CARD_WAIT_MS = 120_000;
const KEYWORD_URL_MATCH_MS = 45_000;
const KEYWORD_FRESH_MIN_MS = 3000;
const KEYWORD_FRESH_MAX_MS = 18000;

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

async function navigateToKeywordSearch(keyword, navigateDelayMs, signal, skipNavigate) {
  const settleMs = Math.max(Number(navigateDelayMs) || 0, 3000);
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
      await waitForElement(CARD_WAIT_SELECTORS, 30000);
    } catch {
      /* kiểm tra ở waitForProductCardsReady */
    }
    return;
  }
  await sleep(settleMs, signal);
}

/** Chờ URL khớp từ khóa rồi DOM kết quả mới (tránh đếm thẻ SP cũ). */
async function waitForKeywordSearchFresh(keyword, signal) {
  const startedAt = Date.now();
  let urlMatchedAt = 0;

  while (Date.now() - startedAt < KEYWORD_URL_MATCH_MS) {
    signal?.throwIfAborted();
    if (isOnKeywordSearchPage(keyword)) {
      urlMatchedAt = Date.now();
      break;
    }
    await sleep(350, signal);
  }
  if (!urlMatchedAt) {
    throw new Error(
      `Tab search chưa chuyển sang từ khóa «${keyword}» — đợi trang tải xong rồi thử lại`,
    );
  }

  window.scrollTo({ top: 0, behavior: "instant" });
  await sleep(600, signal);

  let sawLowCount = false;
  const freshDeadline = urlMatchedAt + KEYWORD_FRESH_MAX_MS;

  while (Date.now() < freshDeadline) {
    signal?.throwIfAborted();
    if (!isOnKeywordSearchPage(keyword)) {
      urlMatchedAt = Date.now();
      sawLowCount = false;
    }

    const count = findSimilarProductCards().length;
    if (count <= 8) {
      sawLowCount = true;
    }

    const elapsed = Date.now() - urlMatchedAt;
    if (sawLowCount && elapsed >= KEYWORD_FRESH_MIN_MS) {
      break;
    }
    if (!sawLowCount && elapsed >= KEYWORD_FRESH_MIN_MS + 2000) {
      break;
    }

    await sleep(CARD_LOAD_POLL_MS, signal);
  }
}

/** Chờ đủ thẻ SP (mặc định ~55) ổn định trước khi scroll/scrape. */
async function waitForProductCardsReady(keyword, minProductCards, signal, timeoutMs = INITIAL_CARD_WAIT_MS) {
  await waitForKeywordSearchFresh(keyword, signal);

  const target = Math.max(
    1,
    Number(minProductCards) || DEFAULT_MIN_PRODUCT_CARDS,
  );
  let lastCount = 0;
  let stableRounds = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    signal?.throwIfAborted();
    if (!isOnKeywordSearchPage(keyword)) {
      stableRounds = 0;
      lastCount = 0;
      await waitForKeywordSearchFresh(keyword, signal);
    }

    try {
      await waitForElement(CARD_WAIT_SELECTORS, 4000);
    }
    catch {
      /* chưa render thẻ — poll tiếp */
    }

    const count = findSimilarProductCards().length;
    if (count >= target && count === lastCount) {
      stableRounds += 1;
      if (stableRounds >= CARD_LOAD_STABLE_ROUNDS)
        return count;
    }
    else {
      stableRounds = 0;
    }
    lastCount = count;

    if (count > 0 && count < target) {
      window.scrollBy({ top: SCROLL_STEP_PX, behavior: "instant" });
    }
    await sleep(CARD_LOAD_POLL_MS, signal);
  }

  const finalCount = findSimilarProductCards().length;
  if (finalCount < target) {
    throw new Error(
      `Chỉ thấy ${finalCount}/${target} thẻ SP cho «${keyword}» — trang chưa tải đủ, thử tăng delay trong Cài đặt`,
    );
  }
  return finalCount;
}

function isAtPageBottom() {
  const maxScroll =
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ) - window.innerHeight;
  return window.scrollY >= maxScroll - 4;
}

async function slowScrollPageOne(
  scrollStepDelayMs,
  scrollSettleMs,
  minProductCards,
  signal,
) {
  const target = Math.max(
    1,
    Number(minProductCards) || DEFAULT_MIN_PRODUCT_CARDS,
  );
  let stableRounds = 0;
  let lastCount = 0;
  const startedAt = Date.now();

  window.scrollTo({ top: 0, behavior: "instant" });
  await sleep(400, signal);

  while (true) {
    signal?.throwIfAborted();
    const count = findSimilarProductCards().length;
    const atBottom = isAtPageBottom();
    const reachedTarget = count >= target;
    const timedOut = Date.now() - startedAt > SCROLL_MAX_WAIT_MS;

    if (reachedTarget && atBottom && count === lastCount) {
      stableRounds += 1;
      if (stableRounds >= SCROLL_STABLE_ROUNDS)
        break;
    }
    else {
      stableRounds = 0;
    }
    lastCount = count;

    if (timedOut)
      break;

    if (!atBottom) {
      window.scrollBy({ top: SCROLL_STEP_PX, behavior: "instant" });
      await sleep(scrollStepDelayMs, signal);
      continue;
    }

    await sleep(Math.max(scrollStepDelayMs, 1200), signal);
  }

  await sleep(scrollSettleMs ?? DEFAULT_SCROLL_SETTLE_MS, signal);
}

function filterByMinSold(rows, minSold) {
  const threshold = Number(minSold) || 0;
  if (threshold <= 0) return rows;
  return rows.filter((row) => {
    const sold = Number(row.soldNumeric);
    if (!Number.isFinite(sold)) return true;
    return sold >= threshold;
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
 *   sourceItemId?: string,
 *   sourceTitle?: string,
 *   navigateDelayMs?: number,
 *   scrollStepDelayMs?: number,
 *   scrollSettleMs?: number,
 *   signal?: AbortSignal,
 * }} opts
 */
export async function crawlKeywordSearch(opts) {
  const keyword = String(opts.keyword ?? "").trim();
  if (!keyword) {
    throw new Error("Thiếu từ khóa crawl.");
  }

  const settings = await getSettings();
  const navigateDelayMs = Math.max(
    opts.navigateDelayMs ?? settings.optimizeNavigateDelayMs ?? 4000,
    3000,
  );
  const scrollStepDelayMs = Math.max(
    opts.scrollStepDelayMs ?? settings.optimizeScrollStepDelayMs ?? 900,
    500,
  );
  const scrollSettleMs = opts.scrollSettleMs ?? DEFAULT_SCROLL_SETTLE_MS;
  const minProductCards =
    opts.minProductCards ?? settings.optimizeMinProductCards ?? DEFAULT_MIN_PRODUCT_CARDS;
  const minSold = opts.minSold ?? settings.optimizeMinSold ?? 1;
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

    await waitForProductCardsReady(keyword, minProductCards, signal);

    if (detectShopeeCaptcha()) {
      return { status: "captcha", keyword, competitors: [], sourcePosition: null };
    }

    await slowScrollPageOne(
      scrollStepDelayMs,
      scrollSettleMs,
      minProductCards,
      signal,
    );

    if (detectShopeeCaptcha()) {
      return { status: "captcha", keyword, competitors: [], sourcePosition: null };
    }

    const { similar } = scrapeCurrentPage();
    const tableRows = similar
      .map((product) => productToTableRow(product))
      .filter(Boolean);
    const filtered = filterByMinSold(tableRows, minSold);
    const deduped = dedupeByTitle(filtered);
    const competitors = mapRowsToOptimizeSerp(deduped, keyword);
    const sourcePosition = resolveSourcePosition(deduped, {
      sourceItemId: opts.sourceItemId,
      sourceTitle: opts.sourceTitle,
    });

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
    sourceItemId: payload?.sourceItemId,
    sourceTitle: payload?.sourceTitle,
    navigateDelayMs: payload?.navigateDelayMs,
    scrollStepDelayMs: payload?.scrollStepDelayMs,
    scrollSettleMs: payload?.scrollSettleMs,
    minProductCards: payload?.minProductCards,
    skipNavigate: payload?.skipNavigate === true,
    signal,
  });
}
