import { SHOPEE_DESCRIPTION_CONTAINER_SELECTORS, SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS, SHOPEE_DESCRIPTION_FALLBACK_SELECTORS, SHOPEE_TITLE_SELECTORS, } from '../../shared/product-field-elements.js';
import { getInputValue, getPlainTextContainerValue, getQuillText, queryFirst, setInputValue, setPlainTextContainerValue, setQuillText, } from '../shared/dom-utils.js';
const TITLE_SELECTORS = SHOPEE_TITLE_SELECTORS;
const DESCRIPTION_EDITOR_OUTER_SELECTORS = SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS;
const DESCRIPTION_CONTAINER_SELECTORS = SHOPEE_DESCRIPTION_CONTAINER_SELECTORS;
const DESCRIPTION_FALLBACK_SELECTORS = SHOPEE_DESCRIPTION_FALLBACK_SELECTORS;
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
        return { title, description };
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
