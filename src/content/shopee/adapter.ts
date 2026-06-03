import type { ProductAdapter, ProductData } from '../../shared/types';
import {
  SHOPEE_DESCRIPTION_CONTAINER_SELECTORS,
  SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS,
  SHOPEE_DESCRIPTION_FALLBACK_SELECTORS,
  SHOPEE_TITLE_SELECTORS,
} from '../../shared/product-field-elements';
import {
  getInputValue,
  getPlainTextContainerValue,
  getQuillText,
  queryFirst,
  setInputValue,
  setPlainTextContainerValue,
  setQuillText,
} from '../shared/dom-utils';

const TITLE_SELECTORS = SHOPEE_TITLE_SELECTORS;
const DESCRIPTION_EDITOR_OUTER_SELECTORS =
  SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS;
const DESCRIPTION_CONTAINER_SELECTORS = SHOPEE_DESCRIPTION_CONTAINER_SELECTORS;
const DESCRIPTION_FALLBACK_SELECTORS = SHOPEE_DESCRIPTION_FALLBACK_SELECTORS;

export const shopeeAdapter: ProductAdapter = {
  canHandle(url: string): boolean {
    return /banhang\.shopee\.(vn|com)/i.test(url);
  },

  extract(): ProductData | null {
    const titleEl = queryFirst<HTMLInputElement | HTMLTextAreaElement>(
      TITLE_SELECTORS,
    );
    if (!titleEl) return null;

    const editorOuter = queryFirst<Element>(
      DESCRIPTION_EDITOR_OUTER_SELECTORS,
    );
    let description = editorOuter
      ? getPlainTextContainerValue(editorOuter)
      : '';

    const descContainer = queryFirst<Element>(DESCRIPTION_CONTAINER_SELECTORS);
    if (!description && descContainer) {
      const quill = descContainer.querySelector('.ql-editor');
      description = quill
        ? getQuillText(descContainer)
        : getInputValue(
            queryFirst<HTMLTextAreaElement>(
              DESCRIPTION_FALLBACK_SELECTORS,
              descContainer,
            ) ?? document.createElement('textarea'),
          );
    } else if (!description) {
      const fallback = queryFirst<HTMLTextAreaElement>(
        DESCRIPTION_FALLBACK_SELECTORS,
      );
      description = fallback ? getInputValue(fallback) : '';
    }

    const title = getInputValue(titleEl);
    if (!title && !description) return null;
    return { title, description };
  },

  apply(data: ProductData): boolean {
    let ok = false;

    const titleEl = queryFirst<HTMLInputElement | HTMLTextAreaElement>(
      TITLE_SELECTORS,
    );
    if (titleEl && data.title) {
      setInputValue(titleEl, data.title);
      ok = true;
    }

    const editorOuter = queryFirst<Element>(
      DESCRIPTION_EDITOR_OUTER_SELECTORS,
    );
    if (editorOuter && data.description) {
      setPlainTextContainerValue(editorOuter, data.description);
      ok = true;
    }

    const descContainer = queryFirst<Element>(DESCRIPTION_CONTAINER_SELECTORS);
    if (!ok && descContainer && data.description) {
      const quill = descContainer.querySelector('.ql-editor');
      if (quill) {
        setQuillText(descContainer, data.description);
        ok = true;
      } else {
        const textarea = queryFirst<HTMLTextAreaElement>(
          DESCRIPTION_FALLBACK_SELECTORS,
          descContainer,
        );
        if (textarea) {
          setInputValue(textarea, data.description);
          ok = true;
        }
      }
    } else if (!ok && data.description) {
      const fallback = queryFirst<HTMLTextAreaElement>(
        DESCRIPTION_FALLBACK_SELECTORS,
      );
      if (fallback) {
        setInputValue(fallback, data.description);
        ok = true;
      }
    }

    return ok;
  },
};
