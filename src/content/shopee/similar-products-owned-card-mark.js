import {
    findSimilarProductCards,
    parseProductIdsFromUrl,
} from './similar-products-scraper.js';
import { resolveResearchShopMeta } from '../../shared/shop-names.js';

const STYLE_ID = 'bigseller-research-shop-card-style';
export const OWNED_CARD_MARK_CLASS = 'bigseller-owned-shop-card';
export const REFERENCE_CARD_MARK_CLASS = 'bigseller-reference-shop-card';

const RESEARCH_SHOP_CARD_CSS = `
.${OWNED_CARD_MARK_CLASS} {
  outline: 3px solid #ec4899 !important;
  outline-offset: 2px;
  border-radius: 10px;
  box-shadow:
    0 0 0 2px rgba(251, 207, 232, 1),
    0 0 14px 3px rgba(236, 72, 153, 0.4) !important;
}
.${REFERENCE_CARD_MARK_CLASS} {
  outline: 3px solid #3b82f6 !important;
  outline-offset: 2px;
  border-radius: 10px;
  box-shadow:
    0 0 0 2px rgba(147, 197, 253, 1),
    0 0 14px 3px rgba(59, 130, 246, 0.4) !important;
}
`;

function ensureResearchShopCardStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = RESEARCH_SHOP_CARD_CSS;
    document.head.appendChild(el);
}

function findCardProductLink(card) {
    return (
        card.querySelector('a.contents[href], a[href*="-i."][href*="shopee"]') ??
        card.querySelector('a[href*="shopee.vn"]')
    );
}

/** Viền hồng / xanh — luôn bật trên card SP thuộc shop user hoặc ĐTL. */
export function markOwnedShopCardsOnPage(root = document) {
    ensureResearchShopCardStyles();
    for (const card of findSimilarProductCards(root)) {
        const link = findCardProductLink(card);
        const { shopId } = parseProductIdsFromUrl(link?.href ?? '');
        const meta = resolveResearchShopMeta(shopId);
        card.classList.toggle(OWNED_CARD_MARK_CLASS, meta?.kind === 'owned');
        card.classList.toggle(REFERENCE_CARD_MARK_CLASS, meta?.kind === 'reference');
    }
}
