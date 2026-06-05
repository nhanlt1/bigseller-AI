import { waitForElement } from '../shared/dom-utils.js';
import {
    buildTableRows,
    detectShopeeCurrentPage,
    scrapeCurrentPage,
} from './similar-products-scraper.js';

const CARD_WAIT_SELECTORS = [
    'div[role="group"][aria-label^="Product card"]',
    '[data-sqe="item"]',
    '.shopee-search-item-result',
    '.XwdvuO',
    '.rBfdm_.row',
];

const DEFAULT_MAX_PAGES = 20;
const PAGE_SETTLE_MS = 1200;

function buildPageUrl(page) {
    const url = new URL(location.href);
    url.searchParams.set('page', String(page));
    return url.toString();
}

function getCurrentPage() {
    return detectShopeeCurrentPage();
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        });
    });
}

async function waitForPageContent(signal, previousFingerprint) {
    await waitForElement(CARD_WAIT_SELECTORS, 15000);
    await sleep(PAGE_SETTLE_MS, signal);
    const { similar } = scrapeCurrentPage();
    const fingerprint = similar.map((p) => p.itemId || p.title).join('|');
    if (fingerprint && fingerprint !== previousFingerprint)
        return fingerprint;
    await sleep(800, signal);
    const retry = scrapeCurrentPage();
    return retry.similar.map((p) => p.itemId || p.title).join('|');
}

function clickShopeePageButton(page) {
    const label = String(page);
    const candidates = document.querySelectorAll(
        '.shopee-page-controller button, .shopee-mini-page-controller button, [class*="page-controller"] button, .shopee-button-no-outline',
    );
    for (const btn of candidates) {
        if (btn.textContent?.trim() !== label)
            continue;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true')
            continue;
        btn.click();
        return true;
    }
    return false;
}

async function navigateToPage(page, signal) {
    const target = buildPageUrl(page);
    if (location.href === target)
        return;
    const previousFingerprint = scrapeCurrentPage()
        .similar.map((p) => p.itemId || p.title)
        .join('|');
    if (clickShopeePageButton(page)) {
        await waitForPageContent(signal, previousFingerprint);
        if (getCurrentPage() === page && scrapeCurrentPage().similar.length > 0)
            return;
    }
    history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    await waitForPageContent(signal, previousFingerprint);
    if (getCurrentPage() === page && scrapeCurrentPage().similar.length > 0)
        return;
    throw new Error(
        `Không chuyển được sang trang ${page} — hãy lật trang thủ công rồi thử lại.`,
    );
}

/**
 * @param {{
 *   maxPages?: number,
 *   onProgress?: (info: { page: number, totalSimilar: number, status: string }) => void,
 *   onPageRows?: (info: { page: number, rows: ReturnType<typeof buildTableRows>, status: string }) => void,
 *   signal?: AbortSignal,
 *   seenItemIds?: Set<string>,
 * }} opts
 */
export async function collectAllSimilarPages(opts = {}) {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const signal = opts.signal;
    const seenItemIds = new Set(opts.seenItemIds ?? []);
    const allSimilar = [];
    const startPage = getCurrentPage();
    const startHref = location.href;
    try {
        if (startPage !== 1)
            await navigateToPage(1, signal);
        for (let page = 1; page <= maxPages; page++) {
            signal?.throwIfAborted();
            if (page > 1)
                await navigateToPage(page, signal);
            const scraped = scrapeCurrentPage();
            const newThisPage = [];
            let newCount = 0;
            for (const item of scraped.similar) {
                const key = item.itemId || `${item.title}::${item.shopId}`;
                if (!key || seenItemIds.has(key))
                    continue;
                seenItemIds.add(key);
                allSimilar.push(item);
                newThisPage.push(item);
                newCount += 1;
            }
            const status = `Trang ${page}: +${newCount} SP (tổng ${allSimilar.length})`;
            opts.onProgress?.({
                page,
                totalSimilar: allSimilar.length,
                status,
            });
            if (newCount > 0) {
                opts.onPageRows?.({
                    page,
                    rows: buildTableRows(null, newThisPage),
                    status,
                });
            }
            if (scraped.similar.length === 0 || newCount === 0)
                break;
        }
    }
    finally {
        if (!signal?.aborted && startHref !== location.href) {
            try {
                await navigateToPage(startPage, signal);
            }
            catch {
                /* giữ trang hiện tại nếu không quay lại được */
            }
        }
    }
    return {
        similar: allSimilar,
        rows: buildTableRows(null, allSimilar),
    };
}
