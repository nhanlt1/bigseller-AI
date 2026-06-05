import { shopeeAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { mountImageFab, refreshImageToolbar, IMAGE_TOOLBAR_ID } from '../shared/image-fab.js';
import {
    FloatingPanel,
    mountProductDescriptionToolbar,
    refreshDescriptionToolbar,
    DESC_TOOLBAR_ID,
} from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import { observeDomChanges } from '../shared/dom-utils.js';
import { isShopeeOrderDetailUrl, mountOrderDetailCheck } from './order-detail-check.js';
import { mountProductCategoryFeeBadge, updateProductCategoryFeeBadge, } from '../shared/product-category-fee.js';
import {
    mountSimilarProductsResearch,
    scheduleAutoCollect,
} from './similar-products-research.js';
import {
    isShopeePricingHost,
    isShopeeProductResearchUrl,
    isShopeeSellerCenterHost,
} from './shopee-host.js';

listenForProductApply(shopeeAdapter);

let editorPanel = null;

function initSimilarProductsResearch() {
    if (!isShopeeProductResearchUrl())
        return;
    mountSimilarProductsResearch();
}

function ensurePricingFab() {
    if (!document.getElementById('bigseller-ai-pricing-fab'))
        mountPricingFab();
}

function initProductEditor() {
    if (!isShopeeSellerCenterHost())
        return;
    if (isShopeeOrderDetailUrl())
        return;
    if (!shopeeAdapter.extract())
        return;
    mountProductCategoryFeeBadge();
    mountImageFab(shopeeAdapter);
    if (!editorPanel)
        editorPanel = new FloatingPanel(shopeeAdapter);
    mountProductDescriptionToolbar(editorPanel, 'shopee');
}

function initSellerCenterExtras() {
    mountOrderDetailCheck();
    if (isShopeeOrderDetailUrl())
        return;
    initProductEditor();
}

function init() {
    if (!isShopeePricingHost())
        return;
    ensurePricingFab();
    initSimilarProductsResearch();
    if (isShopeeSellerCenterHost())
        initSellerCenterExtras();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
}
else {
    init();
}
observeDomChanges(() => {
    if (!isShopeePricingHost())
        return;
    ensurePricingFab();
    initSimilarProductsResearch();
    if (isShopeeProductResearchUrl())
        scheduleAutoCollect();
    if (!isShopeeSellerCenterHost())
        return;
    mountOrderDetailCheck();
    updateProductCategoryFeeBadge();
    if (isShopeeOrderDetailUrl())
        return;
    if (
        !document.getElementById(IMAGE_TOOLBAR_ID) ||
        !document.getElementById(DESC_TOOLBAR_ID)
    ) {
        initProductEditor();
    }
    else {
        refreshImageToolbar();
        refreshDescriptionToolbar();
    }
});
