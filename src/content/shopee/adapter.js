import { SHOPEE_DESCRIPTION_CONTAINER_SELECTORS, SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS, SHOPEE_DESCRIPTION_FALLBACK_SELECTORS, SHOPEE_TITLE_SELECTORS, } from '../../shared/product-field-elements.js';
import { readShopeeShopId, SIBLING_SHOPEE_SHOPS } from '../../shared/shop-names.js';
import { getInputValue, getPlainTextContainerValue, getQuillText, queryFirst, setInputValue, setPlainTextContainerValue, setQuillText, } from '../shared/dom-utils.js';
import { parseProductIdsFromUrl } from './similar-products-scraper.js';

const TITLE_SELECTORS = SHOPEE_TITLE_SELECTORS;
const DESCRIPTION_EDITOR_OUTER_SELECTORS = SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS;
const DESCRIPTION_CONTAINER_SELECTORS = SHOPEE_DESCRIPTION_CONTAINER_SELECTORS;
const DESCRIPTION_FALLBACK_SELECTORS = SHOPEE_DESCRIPTION_FALLBACK_SELECTORS;

function extractShopeeProductIds() {
    let itemId = '';
    let shopId = '';
    const portalMatch = location.pathname.match(/\/portal\/product\/(\d+)/i);
    if (portalMatch?.[1])
        itemId = portalMatch[1];
    try {
        const params = new URLSearchParams(location.search);
        itemId = itemId || params.get('itemid') || params.get('item_id') || '';
        shopId = shopId || params.get('shopid') || params.get('shop_id') || '';
    }
    catch {
        /* ignore */
    }
    for (const input of document.querySelectorAll('input[type="hidden"][name*="item" i], input[type="hidden"][name*="shop" i]')) {
        const name = String(input.getAttribute('name') ?? '').toLowerCase();
        const value = String(input.value ?? '').trim();
        if (!value)
            continue;
        if (!itemId && /item/.test(name))
            itemId = value;
        if (!shopId && /shop/.test(name))
            shopId = value;
    }
    for (const link of document.querySelectorAll('a[href*="shopee.vn"], a[href*="banhang.shopee"]')) {
        const ids = parseProductIdsFromUrl(link.href);
        if (ids.itemId)
            itemId = itemId || ids.itemId;
        if (ids.shopId)
            shopId = shopId || ids.shopId;
    }
    if (!shopId) {
        const subaccount = readShopeeShopId();
        const sibling = SIBLING_SHOPEE_SHOPS.find((shop) => shop.account === subaccount);
        if (sibling)
            shopId = sibling.shopId;
    }
    return { itemId: String(itemId ?? '').trim(), shopId: String(shopId ?? '').trim() };
}

export const shopeeAdapter = {
    platform: 'shopee',
    canHandle(url) {
        return /banhang\.shopee\.(vn|com)/i.test(url);
    },
    extract() {
        const titleEl = queryFirst(TITLE_SELECTORS);
        if (!titleEl)
            return null;
        const editorOuter = queryFirst(DESCRIPTION_EDITOR_OUTER_SELECTORS);
        let description = editorOuter
            ? getPlainTextContainerValue(editorOuter)
            : '';
        const descContainer = queryFirst(DESCRIPTION_CONTAINER_SELECTORS);
        if (!description && descContainer) {
            const quill = descContainer.querySelector('.ql-editor');
            description = quill
                ? getQuillText(descContainer)
                : getInputValue(queryFirst(DESCRIPTION_FALLBACK_SELECTORS, descContainer) ?? document.createElement('textarea'));
        }
        else if (!description) {
            const fallback = queryFirst(DESCRIPTION_FALLBACK_SELECTORS);
            description = fallback ? getInputValue(fallback) : '';
        }
        const title = getInputValue(titleEl);
        if (!title && !description)
            return null;
        const { itemId, shopId } = extractShopeeProductIds();
        return { title, description, itemId, shopId };
    },
    extractIds() {
        return extractShopeeProductIds();
    },
    apply(data) {
        let ok = false;
        const titleEl = queryFirst(TITLE_SELECTORS);
        if (titleEl && data.title) {
            setInputValue(titleEl, data.title);
            ok = true;
        }
        const editorOuter = queryFirst(DESCRIPTION_EDITOR_OUTER_SELECTORS);
        if (editorOuter && data.description) {
            setPlainTextContainerValue(editorOuter, data.description);
            ok = true;
        }
        const descContainer = queryFirst(DESCRIPTION_CONTAINER_SELECTORS);
        if (!ok && descContainer && data.description) {
            const quill = descContainer.querySelector('.ql-editor');
            if (quill) {
                setQuillText(descContainer, data.description);
                ok = true;
            }
            else {
                const textarea = queryFirst(DESCRIPTION_FALLBACK_SELECTORS, descContainer);
                if (textarea) {
                    setInputValue(textarea, data.description);
                    ok = true;
                }
            }
        }
        else if (!ok && data.description) {
            const fallback = queryFirst(DESCRIPTION_FALLBACK_SELECTORS);
            if (fallback) {
                setInputValue(fallback, data.description);
                ok = true;
            }
        }
        return ok;
    },
};
