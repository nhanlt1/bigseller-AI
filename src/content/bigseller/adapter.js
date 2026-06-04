import { BIGSELLER_DESCRIPTION_SELECTORS, BIGSELLER_TITLE_SELECTORS, } from '../../shared/product-field-elements.js';
import { getInputValue, queryFirst, setInputValue } from '../shared/dom-utils.js';
const TITLE_SELECTORS = BIGSELLER_TITLE_SELECTORS;
const DESCRIPTION_SELECTORS = BIGSELLER_DESCRIPTION_SELECTORS;
export const bigsellerAdapter = {
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
        return { title, description };
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
