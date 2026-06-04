import { shopeeAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { mountImageFab } from '../shared/image-fab.js';
import { FloatingPanel, mountToggleButton } from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import { observeDomChanges } from '../shared/dom-utils.js';
import { isShopeeOrderDetailUrl, mountOrderDetailCheck } from './order-detail-check.js';
import { mountProductCategoryFeeBadge, updateProductCategoryFeeBadge, } from '../shared/product-category-fee.js';
import { isShopeePricingHost, isShopeeSellerCenterHost } from './shopee-host.js';

listenForProductApply(shopeeAdapter);

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
    const panel = new FloatingPanel(shopeeAdapter);
    mountToggleButton(panel);
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
    if (!isShopeeSellerCenterHost())
        return;
    mountOrderDetailCheck();
    updateProductCategoryFeeBadge();
    if (isShopeeOrderDetailUrl())
        return;
    if (!document.getElementById('bigseller-ai-toggle') ||
        !document.getElementById('bigseller-ai-image-fab')) {
        initProductEditor();
    }
});
