import type { ProductAdapter, ProductData } from '../../shared/types';
import {
  BIGSELLER_DESCRIPTION_SELECTORS,
  BIGSELLER_TITLE_SELECTORS,
} from '../../shared/product-field-elements';
import { getInputValue, queryFirst, setInputValue } from '../shared/dom-utils';

const TITLE_SELECTORS = BIGSELLER_TITLE_SELECTORS;
const DESCRIPTION_SELECTORS = BIGSELLER_DESCRIPTION_SELECTORS;

export const bigsellerAdapter: ProductAdapter = {
  canHandle(url: string): boolean {
    return /bigseller\.com/i.test(url);
  },

  extract(): ProductData | null {
    const titleEl = queryFirst<HTMLInputElement>(TITLE_SELECTORS);
    const descEl = queryFirst<HTMLTextAreaElement>(DESCRIPTION_SELECTORS);
    if (!titleEl && !descEl) return null;

    const title = titleEl ? getInputValue(titleEl) : '';
    const description = descEl ? getInputValue(descEl) : '';
    if (!title && !description) return null;
    return { title, description };
  },

  apply(data: ProductData): boolean {
    let ok = false;

    if (data.title) {
      const titleEl = queryFirst<HTMLInputElement>(TITLE_SELECTORS);
      if (titleEl) {
        setInputValue(titleEl, data.title);
        ok = true;
      }
    }

    if (data.description) {
      const descEl = queryFirst<HTMLTextAreaElement>(DESCRIPTION_SELECTORS);
      if (descEl) {
        setInputValue(descEl, data.description);
        ok = true;
      }
    }

    return ok;
  },
};
