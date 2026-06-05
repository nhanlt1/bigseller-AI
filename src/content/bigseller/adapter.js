import { BIGSELLER_DESCRIPTION_SELECTORS, BIGSELLER_TITLE_SELECTORS, } from '../../shared/product-field-elements.js';
import { getInputValue, queryFirst, setInputValue } from '../shared/dom-utils.js';
import { parseProductIdsFromUrl } from '../shopee/similar-products-scraper.js';

const TITLE_SELECTORS = BIGSELLER_TITLE_SELECTORS;
const DESCRIPTION_SELECTORS = BIGSELLER_DESCRIPTION_SELECTORS;

function extractBigSellerShopeeIds() {
    for (const link of document.querySelectorAll('a[href*="shopee.vn"]')) {
        const ids = parseProductIdsFromUrl(link.href);
        if (ids.itemId || ids.shopId)
            return {
                itemId: String(ids.itemId ?? '').trim(),
                shopId: String(ids.shopId ?? '').trim(),
            };
    }
    const sourceInput = document.querySelector('[autoid="product_source_link_text"], input[class*="product_source"], input[class*="source_link"]');
    if (sourceInput?.value) {
        const ids = parseProductIdsFromUrl(String(sourceInput.value));
        if (ids.itemId || ids.shopId)
            return {
                itemId: String(ids.itemId ?? '').trim(),
                shopId: String(ids.shopId ?? '').trim(),
            };
    }
    const skuCell = document.querySelector('.vxe-table--body .vxe-body--row .col_4 .vxe-cell--label, .vxe-table--body .vxe-body--row td:first-child .vxe-cell--label');
    const skuText = skuCell?.textContent?.trim() ?? '';
    if (/^\d{8,}$/.test(skuText))
        return { itemId: skuText, shopId: '' };
    return { itemId: '', shopId: '' };
}

export const bigsellerAdapter = {
    platform: 'bigseller',
    canHandle(url) {
        return /bigseller\.com/i.test(url);
    },
    extract() {
        const titleEl = queryFirst(TITLE_SELECTORS);
        const descEl = queryFirst(DESCRIPTION_SELECTORS);
        if (!titleEl && !descEl)
            return null;
        const title = titleEl ? getInputValue(titleEl) : '';
        const description = descEl ? getInputValue(descEl) : '';
        if (!title && !description)
            return null;
        const { itemId, shopId } = extractBigSellerShopeeIds();
        return { title, description, itemId, shopId };
    },
    extractIds() {
        return extractBigSellerShopeeIds();
    },
    apply(data) {
        let ok = false;
        if (data.title) {
            const titleEl = queryFirst(TITLE_SELECTORS);
            if (titleEl) {
                setInputValue(titleEl, data.title);
                ok = true;
            }
        }
        if (data.description) {
            const descEl = queryFirst(DESCRIPTION_SELECTORS);
            if (descEl) {
                setInputValue(descEl, data.description);
                ok = true;
            }
        }
        return ok;
    },
};
