import {
    formatCommissionPercent,
    getBigsellerCategorySelectionEl,
    getBigsellerCategoryTextEl,
    getCategoryFeeMeta,
    lookupCategoryCommission,
    readBigsellerProductCategoryPath,
    readProductCategoryPath,
    readShopeeProductCategoryPath,
} from '../../pricing/category-commission.js';
import { getSettings, saveSettings } from '../../shared/storage.js';

const BADGE_ID = 'bigseller-ai-category-fee-badge';
const STYLE_ID = 'bigseller-ai-category-fee-style';
const BADGE_FLOAT_CLASS = 'bs-fee-badge--bigseller-float';

let bigsellerRepositionBound = false;

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
      #${BADGE_ID}.${BADGE_FLOAT_CLASS} {
        position: fixed;
        margin: 0;
        z-index: 2147483640;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
        pointer-events: none;
      }
      .product-category-box-inner {
        display: flex !important;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
      }
    `;
    document.head.appendChild(style);
}

function findShopeeCategoryAnchor() {
    return (
        document.querySelector('.product-category-box-inner') ??
        document.querySelector('.product-category-text')?.parentElement ??
        null
    );
}

function findBigsellerCategoryPositionEl() {
    return getBigsellerCategorySelectionEl(document);
}

function findBigsellerCategoryAnchor() {
    const textEl = getBigsellerCategoryTextEl(document);
    if (!textEl)
        return null;
    return textEl.parentElement ?? textEl;
}

function positionBigsellerBadge(badge, positionEl) {
    if (!positionEl?.isConnected) {
        badge.style.display = 'none';
        return;
    }
    badge.style.display = 'inline-flex';
    const rect = positionEl.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const badgeW = badge.offsetWidth || 0;
    // Lệch phải thêm ~1 chiều rộng badge để không đè lên combobox
    let left = rect.right + gap + badgeW;
    let top = rect.top + (rect.height - badge.offsetHeight) / 2;
    if (left + badgeW > window.innerWidth - margin) {
        left = Math.max(margin, rect.right + gap);
        top = rect.bottom + 4;
    }
    if (top + badge.offsetHeight > window.innerHeight - margin)
        top = Math.max(margin, rect.top - badge.offsetHeight - 4);
    if (top < margin)
        top = margin;
    badge.style.left = `${Math.round(left)}px`;
    badge.style.top = `${Math.round(top)}px`;
}

function ensureBigsellerReposition(badge, getPositionEl) {
    if (bigsellerRepositionBound)
        return;
    bigsellerRepositionBound = true;
    const reposition = () => {
        if (!badge.isConnected || !badge.classList.contains(BADGE_FLOAT_CLASS))
            return;
        const el = getPositionEl();
        if (el)
            positionBigsellerBadge(badge, el);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
}

function resolveCategoryContext() {
    const shopeePath = readShopeeProductCategoryPath();
    if (shopeePath) {
        return {
            path: shopeePath,
            anchor: findShopeeCategoryAnchor(),
            platform: 'shopee',
            positionEl: null,
        };
    }
    const bsPath = readBigsellerProductCategoryPath();
    if (bsPath) {
        const textEl = getBigsellerCategoryTextEl(document);
        return {
            path: bsPath,
            anchor: textEl ? findBigsellerCategoryAnchor() : null,
            platform: 'bigseller',
            positionEl: textEl ? null : findBigsellerCategoryPositionEl(),
        };
    }
    return { path: '', anchor: null, platform: null, positionEl: null };
}

function renderBadge(ctx, lookup) {
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
        badge.title = ctx.path
            ? `Không tra được % cho: ${ctx.path}\nChỉnh tay trong popup $.`
            : 'Không tra được % từ biểu phí Shopee (23/05/2026). Chỉnh tay trong popup $.';
    }
    else {
        const matchNote =
            lookup.match === 'fuzzy' ||
            lookup.match === 'leaf-fuzzy' ||
            /^prefix-fuzzy-\d+$/.test(lookup.match ?? '')
                ? ' (ước lượng từ biểu phí)'
                : lookup.match?.startsWith('prefix-')
                  ? ` (theo ${lookup.match.replace('prefix-', '')} cấp breadcrumb)`
                  : lookup.match === 'l1-fallback'
                    ? ' (theo ngành cấp 1)'
                    : '';
        badge.innerHTML =
            `<span class="bs-fee-label">Phí cố định:</span> <span class="bs-fee-pct">${pct}</span>`;
        const meta = getCategoryFeeMeta();
        badge.title = `${lookup.raw}${matchNote}\nNguồn: Shopee ${meta.effectiveFrom} (seller thường)`;
    }

    if (ctx.platform === 'bigseller' && ctx.positionEl) {
        badge.classList.add(BADGE_FLOAT_CLASS);
        if (badge.parentElement !== document.body)
            document.body.appendChild(badge);
        ensureBigsellerReposition(badge, findBigsellerCategoryPositionEl);
        requestAnimationFrame(() => {
            positionBigsellerBadge(badge, findBigsellerCategoryPositionEl());
        });
        return;
    }

    if (ctx.platform === 'bigseller' && ctx.anchor) {
        const textEl = getBigsellerCategoryTextEl(document);
        badge.classList.remove(BADGE_FLOAT_CLASS);
        badge.style.left = '';
        badge.style.top = '';
        badge.style.display = '';
        badge.style.zIndex = '';
        if (textEl) {
            if (badge.previousElementSibling !== textEl)
                textEl.insertAdjacentElement('afterend', badge);
            return;
        }
    }

    badge.classList.remove(BADGE_FLOAT_CLASS);
    badge.style.left = '';
    badge.style.top = '';
    badge.style.display = '';
    badge.style.zIndex = '';
    const anchor = ctx.anchor;
    if (!anchor)
        return;
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

function isCategoryFeePage() {
    if (/\/portal\/product\b/i.test(location.pathname))
        return true;
    return (
        /bigseller\.com/i.test(location.hostname) &&
        !!document.querySelector('.page_edit')
    );
}

export function updateProductCategoryFeeBadge() {
    if (!isCategoryFeePage())
        return;
    const ctx = resolveCategoryContext();
    if (!ctx.path)
        return;
    if (ctx.platform === 'shopee' && !ctx.anchor)
        return;
    if (ctx.platform === 'bigseller' && !ctx.positionEl && !ctx.anchor)
        return;
    ensureStyles();
    const lookup = lookupCategoryCommission(ctx.path);
    renderBadge(ctx, lookup);
    void syncPricingCommission(lookup.rate);
}

export function mountProductCategoryFeeBadge() {
    updateProductCategoryFeeBadge();
}
