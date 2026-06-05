import { isSiblingShopId, SIBLING_SHOPEE_SHOPS } from '../../shared/shop-names.js';
import { getMatchedResearchRow } from './similar-products-title-position.js';

const MY_TITLES_LIST_SESSION_PREFIX = 'bigseller-ai-my-product-titles:';
const MY_TITLES_LIST_GLOBAL_KEY = 'bigseller-ai-my-product-titles-global';

/** @deprecated slot storage — migrate only */
const MY_TITLE_SLOT_COUNT = 2;
const MY_TITLE_SLOT_SESSION_PREFIX = 'bigseller-ai-my-product-title-slot:';
const MY_TITLE_SLOT_GLOBAL_PREFIX = 'bigseller-ai-my-product-title-global-slot:';
const MY_TITLE_LEGACY_PREFIX = 'bigseller-ai-my-product-title:';
const MY_TITLE_LEGACY_GLOBAL_KEY = 'bigseller-ai-my-product-title-global';
const MY_TITLE_SESSION_PREFIX = 'bigseller-ai-my-product-title-shop:';
const MY_TITLE_GLOBAL_PREFIX = 'bigseller-ai-my-product-title-global-shop:';

function emptyProductTitles() {
    return Object.fromEntries(
        SIBLING_SHOPEE_SHOPS.map((s) => [s.shopId, '']),
    );
}

function normalizeTitleText(raw) {
    return String(raw ?? '')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {unknown} raw */
function parseTitlesJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return null;
        return parsed
            .map((t) => normalizeTitleText(t))
            .filter(Boolean);
    }
    catch {
        return null;
    }
}

function myTitleStorageKey(sessionKey, shopId) {
    return `${MY_TITLE_SESSION_PREFIX}${shopId}:${sessionKey}`;
}

function myTitleGlobalKey(shopId) {
    return `${MY_TITLE_GLOBAL_PREFIX}${shopId}`;
}

function loadLegacyShopTitles(sessionKey) {
    const titles = emptyProductTitles();
    for (const shop of SIBLING_SHOPEE_SHOPS) {
        try {
            const perSession = sessionStorage.getItem(
                myTitleStorageKey(sessionKey, shop.shopId),
            );
            if (perSession != null && perSession !== '') {
                titles[shop.shopId] = perSession;
                continue;
            }
            if (shop.shopId === SIBLING_SHOPEE_SHOPS[0].shopId) {
                const legacySession = sessionStorage.getItem(
                    `${MY_TITLE_LEGACY_PREFIX}${sessionKey}`,
                );
                if (legacySession) {
                    titles[shop.shopId] = legacySession;
                    continue;
                }
                const legacyGlobal = localStorage.getItem(MY_TITLE_LEGACY_GLOBAL_KEY);
                if (legacyGlobal) {
                    titles[shop.shopId] = legacyGlobal;
                    continue;
                }
            }
            const global = localStorage.getItem(myTitleGlobalKey(shop.shopId));
            if (global)
                titles[shop.shopId] = global;
        }
        catch {
            /* private mode */
        }
    }
    return titles;
}

function loadLegacySlotTitles(sessionKey) {
    const slots = Array(MY_TITLE_SLOT_COUNT).fill('');
    for (let i = 0; i < MY_TITLE_SLOT_COUNT; i++) {
        try {
            const perSession = sessionStorage.getItem(
                `${MY_TITLE_SLOT_SESSION_PREFIX}${i}:${sessionKey}`,
            );
            if (perSession != null) {
                slots[i] = perSession;
                continue;
            }
            const global = localStorage.getItem(
                `${MY_TITLE_SLOT_GLOBAL_PREFIX}${i}`,
            );
            if (global != null)
                slots[i] = global;
        }
        catch {
            /* private mode */
        }
    }
    const fromSlots = slots.map((s) => normalizeTitleText(s)).filter(Boolean);
    if (fromSlots.length)
        return fromSlots;
    const legacy = loadLegacyShopTitles(sessionKey);
    const fromShops = [];
    for (const shop of SIBLING_SHOPEE_SHOPS) {
        const title = normalizeTitleText(legacy[shop.shopId]);
        if (title)
            fromShops.push(title);
    }
    return fromShops;
}

/** @returns {string[]} */
export function loadMyProductTitlesList(sessionKey) {
    try {
        const perSession = sessionStorage.getItem(
            `${MY_TITLES_LIST_SESSION_PREFIX}${sessionKey}`,
        );
        const fromSession = parseTitlesJson(perSession);
        if (fromSession?.length)
            return fromSession;
        const global = localStorage.getItem(MY_TITLES_LIST_GLOBAL_KEY);
        const fromGlobal = parseTitlesJson(global);
        if (fromGlobal?.length)
            return fromGlobal;
    }
    catch {
        /* private mode */
    }
    return loadLegacySlotTitles(sessionKey);
}

/** @param {string[]} titles */
export function saveMyProductTitlesList(sessionKey, titles) {
    const cleaned = titles
        .map((t) => normalizeTitleText(t))
        .filter(Boolean);
    try {
        sessionStorage.setItem(
            `${MY_TITLES_LIST_SESSION_PREFIX}${sessionKey}`,
            JSON.stringify(cleaned),
        );
        if (cleaned.length)
            localStorage.setItem(MY_TITLES_LIST_GLOBAL_KEY, JSON.stringify(cleaned));
        else
            localStorage.removeItem(MY_TITLES_LIST_GLOBAL_KEY);
    }
    catch {
        /* private mode */
    }
    return cleaned;
}

/** Gán tên SP vào shop theo dòng khớp trong bảng; chưa khớp thì gán shop trống */
export function deriveTitlesByShopFromList(rows, titles) {
    const titlesByShop = emptyProductTitles();
    const unmatched = [];
    for (const raw of titles) {
        const value = normalizeTitleText(raw);
        if (!value)
            continue;
        const row = getMatchedResearchRow(rows, value);
        const shopId = String(row?.shopId ?? '').trim();
        if (shopId && isSiblingShopId(shopId))
            titlesByShop[shopId] = value;
        else
            unmatched.push(value);
    }
    for (const value of unmatched) {
        const freeShop = SIBLING_SHOPEE_SHOPS.find(
            (s) => !String(titlesByShop[s.shopId] ?? '').trim(),
        );
        if (freeShop)
            titlesByShop[freeShop.shopId] = value;
    }
    return titlesByShop;
}

export function normalizePastedProductTitle(raw) {
    return normalizeTitleText(raw);
}

export function renderMyTitlesSectionHtml() {
    return `
        <div class="my-title-section">
          <div class="my-title-header">
            <span class="my-title-heading">Tên sản phẩm của tôi</span>
            <button type="button" class="my-title-clear-btn" id="my-titles-clear-all"
              title="Xóa tất cả tên SP">Xóa tất cả</button>
          </div>
          <div class="my-title-badges" id="my-title-badges"></div>
          <textarea id="my-title-paste" class="my-title-paste" rows="2"
            placeholder="Dán tên SP (Ctrl+V) — mỗi lần dán thành 1 thẻ. Có thể thêm nhiều SP."></textarea>
        </div>`;
}
