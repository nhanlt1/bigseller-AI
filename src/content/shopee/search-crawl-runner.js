import { getSettings } from "../../shared/storage.js";
import { mapRowsToOptimizeSerp, mapRowsToOptimizeUi } from "../../shared/optimize-serp-columns.js";
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

/** Chờ tối thiểu sau khi URL khớp từ khóa — 0 = cuộn ngay */
const KEYWORD_POST_NAV_MS = 0;
/** Chỉ chờ thêm khi chưa chắc lazy-load xong */
const KEYWORD_POST_SCROLL_MS = 0;
/** Khoảng cách mặc định giữa mỗi bước cuộn (override bằng scrollStepDelayMs) */
const PAGE_DOWN_INTERVAL_DEFAULT_MS = 500;
/** Mỗi bước cuộn ~ ba hàng SP (480×3) */
const SCROLL_STEP_PX = 1440;
const KEYWORD_URL_MATCH_MS = 30_000;
/** Số vòng poll: count + scrollHeight không đổi ở đáy trang */
const SCROLL_STABLE_ROUNDS = 3;
const LAZY_LOAD_POLL_MS = 350;
const SCROLL_NUDGE_UP_PX = 280;
const MAX_PAGE_DOWN_STEPS = 120;

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

function isAtPageBottom() {
  const maxScroll =
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ) - window.innerHeight;
  return window.scrollY >= maxScroll - 4;
}

function pageScrollHeight() {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
  );
}

function takeLazyLoadSnapshot() {
  return {
    count: countVisibleProductCards(),
    scrollHeight: pageScrollHeight(),
    atBottom: isAtPageBottom(),
  };
}

/** Lazy-load xong: đáy trang + count & chiều cao trang ổn định (không cần đủ N SP). */
function isLazyLoadSettled(snap, stableRounds) {
  return snap.atBottom && stableRounds >= SCROLL_STABLE_ROUNDS;
}

function snapshotsMatch(a, b) {
  return a.count === b.count && a.scrollHeight === b.scrollHeight;
}

function countVisibleProductCards() {
  ingestPageIntoResearchTable();
  return Math.max(
    scrapeCurrentPage().similar.length,
    findSimilarProductCards().length,
  );
}

/** Cuộn từng bước nhỏ — không dùng phím PageDown (Shopee thường bỏ qua synthetic key). */
function scrollStepDown() {
  window.scrollBy({ top: SCROLL_STEP_PX, behavior: "instant" });
}

async function navigateToKeywordSearch(keyword, signal, skipNavigate) {
  if (skipNavigate) {
    if (!isOnKeywordSearchPage(keyword)) {
      throw new Error(
        `Tab search chưa đúng từ khóa «${keyword}» — đợi trang tải xong rồi thử lại`,
      );
    }
    return;
  }
  const targetUrl = buildKeywordSearchUrl(keyword);
  if (!isOnKeywordSearchPage(keyword)) {
    location.assign(targetUrl);
    try {
      await waitForElement(CARD_WAIT_SELECTORS, 20000);
    } catch {
      /* loadSearchResultsByPageDown sẽ thử tiếp */
    }
  }
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

/**
 * Cuộn ngay + theo dõi lazy-load (count + scrollHeight ổn định ở đáy).
 * @returns {{ count: number, lazyLoadComplete: boolean }}
 */
async function scrollUntilLazyLoadComplete(signal, stepDelayMs) {
  const intervalMs = Math.max(
    Number(stepDelayMs) || PAGE_DOWN_INTERVAL_DEFAULT_MS,
    200,
  );
  let stableRounds = 0;
  /** @type {ReturnType<typeof takeLazyLoadSnapshot> | null} */
  let lastSnap = null;

  window.scrollTo({ top: 0, behavior: "instant" });

  for (let step = 0; step < MAX_PAGE_DOWN_STEPS; step++) {
    signal?.throwIfAborted();

    const snap = takeLazyLoadSnapshot();

    if (lastSnap && snapshotsMatch(snap, lastSnap) && snap.atBottom) {
      stableRounds += 1;
    }
    else {
      stableRounds = 0;
    }

    if (isLazyLoadSettled(snap, stableRounds)) {
      ingestPageIntoResearchTable();
      return { count: snap.count, lazyLoadComplete: true };
    }

    lastSnap = snap;

    if (!snap.atBottom) {
      scrollStepDown();
      await sleep(intervalMs, signal);
      continue;
    }

    await sleep(LAZY_LOAD_POLL_MS, signal);
    const next = takeLazyLoadSnapshot();
    if (
      next.atBottom &&
      snapshotsMatch(next, snap) &&
      next.count <= snap.count
    ) {
      window.scrollBy({ top: -SCROLL_NUDGE_UP_PX, behavior: "instant" });
      await sleep(150, signal);
      scrollStepDown();
    }
  }

  ingestPageIntoResearchTable();
  return {
    count: countVisibleProductCards(),
    lazyLoadComplete: false,
  };
}

/** URL khớp từ khóa → cuộn ngay, lazy-load xong thì scrape. */
async function loadSearchResultsByPageDown(keyword, signal, timing = {}) {
  const postNavMs = Math.max(Number(timing.postNavMs) ?? KEYWORD_POST_NAV_MS, 0);
  const scrollStepDelayMs = timing.scrollStepDelayMs;
  await waitForKeywordUrl(keyword, signal);
  if (postNavMs > 0)
    await sleep(postNavMs, signal);

  const scrollResult = await scrollUntilLazyLoadComplete(signal, scrollStepDelayMs);
  if (!scrollResult.lazyLoadComplete && KEYWORD_POST_SCROLL_MS > 0)
    await sleep(KEYWORD_POST_SCROLL_MS, signal);

  return countVisibleProductCards();
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
 *   scrollStepDelayMs?: number,
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
  const postNavMs = Math.max(
    Number(opts.navigateDelayMs ?? settings.optimizeNavigateDelayMs) ?? KEYWORD_POST_NAV_MS,
    0,
  );
  const scrollStepDelayMs =
    opts.scrollStepDelayMs ?? settings.optimizeScrollStepDelayMs ?? PAGE_DOWN_INTERVAL_DEFAULT_MS;
  const minSold = opts.minSold ?? settings.optimizeMinSold ?? 1000;
  const maxCompetitors =
    opts.maxCompetitors ?? settings.optimizeMaxCompetitorsPerKeyword ?? 15;
  const signal = opts.signal;

  setOptimizeCrawlActive(true);
  try {
    await navigateToKeywordSearch(
      keyword,
      signal,
      opts.skipNavigate === true,
    );

    if (detectShopeeCaptcha()) {
      return { status: "captcha", keyword, competitors: [], sourcePosition: null };
    }

    await loadSearchResultsByPageDown(keyword, signal, {
      scrollStepDelayMs,
      postNavMs,
    });

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
    const competitorsUi = mapRowsToOptimizeUi(top, keyword);

    return {
      status: "ok",
      keyword,
      competitors,
      competitorsUi,
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
    scrollStepDelayMs: payload?.scrollStepDelayMs,
    skipNavigate: payload?.skipNavigate === true,
    signal,
  });
}
