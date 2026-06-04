import {
    formatCommissionPercent,
    getCategoryFeeMeta,
    lookupCategoryCommission,
    readShopeeProductCategoryPath,
} from '../../pricing/category-commission.js';
import { getSettings, saveSettings } from '../../shared/storage.js';

const BADGE_ID = 'bigseller-ai-category-fee-badge';
const STYLE_ID = 'bigseller-ai-category-fee-style';

function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.3;
        color: #dc2626 !important;
        background: #fef2f2;
        border: 1px solid #fecaca;
        white-space: nowrap;
        vertical-align: middle;
        flex-shrink: 0;
      }
      #${BADGE_ID} .bs-fee-label { color: #991b1b; font-weight: 600; }
      #${BADGE_ID} .bs-fee-pct { color: #dc2626; font-weight: 800; }
      .product-category-box-inner {
        display: flex !important;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
      }
    `;
    document.head.appendChild(style);
}

function findCategoryAnchor() {
    return (
        document.querySelector('.product-category-box-inner') ??
        document.querySelector('.product-category-text')?.parentElement ??
        null
    );
}

function renderBadge(anchor, lookup) {
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
        badge = document.createElement('span');
        badge.id = BADGE_ID;
        badge.setAttribute('aria-label', 'Phí cố định theo ngành hàng');
    }
    const pct = formatCommissionPercent(lookup.rate);
    if (!pct) {
        badge.innerHTML =
            '<span class="bs-fee-label">Phí cố định:</span> <span class="bs-fee-pct">—</span>';
        badge.title =
            'Không tra được % từ biểu phí Shopee (23/05/2026). Chỉnh tay trong popup $.';
    }
    else {
        const matchNote =
            lookup.match === 'fuzzy'
                ? ' (ước lượng từ biểu phí)'
                : lookup.match === 'l1-fallback'
                  ? ' (theo ngành cấp 1)'
                  : '';
        badge.innerHTML =
            `<span class="bs-fee-label">Phí cố định:</span> <span class="bs-fee-pct">${pct}</span>`;
        const meta = getCategoryFeeMeta();
        badge.title = `${lookup.raw}${matchNote}\nNguồn: Shopee ${meta.effectiveFrom} (seller thường)`;
    }
    if (badge.parentElement !== anchor)
        anchor.appendChild(badge);
}

async function syncPricingCommission(rate) {
    if (rate == null || !Number.isFinite(rate))
        return;
    const settings = await getSettings();
    if (Math.abs(settings.platformFeeConfig.commissionRate - rate) < 0.0001)
        return;
    await saveSettings({
        platformFeeConfig: {
            ...settings.platformFeeConfig,
            commissionRate: rate,
        },
    });
    window.dispatchEvent(
        new CustomEvent('bigseller-ai:commission-rate', {
            detail: { rate, ratePct: rate * 100 },
        }),
    );
}

export function updateProductCategoryFeeBadge() {
    if (!/\/portal\/product\b/i.test(location.pathname))
        return;
    const path = readShopeeProductCategoryPath();
    const anchor = findCategoryAnchor();
    if (!anchor)
        return;
    ensureStyles();
    const lookup = lookupCategoryCommission(path);
    renderBadge(anchor, lookup);
    void syncPricingCommission(lookup.rate);
}

export function mountProductCategoryFeeBadge() {
    updateProductCategoryFeeBadge();
}
