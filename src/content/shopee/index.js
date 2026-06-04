import { shopeeAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { mountImageFab } from '../shared/image-fab.js';
import { FloatingPanel, mountToggleButton } from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import { observeDomChanges } from '../shared/dom-utils.js';
import { isShopeeOrderDetailUrl, mountOrderDetailCheck } from './order-detail-check.js';
import { mountProductCategoryFeeBadge, updateProductCategoryFeeBadge, } from './product-category-fee.js';

listenForProductApply(shopeeAdapter);

function initProductEditor() {
    if (!shopeeAdapter.canHandle(location.href))
        return;
    if (isShopeeOrderDetailUrl())
        return;
    if (!shopeeAdapter.extract())
        return;
    mountPricingFab();
    mountProductCategoryFeeBadge();
    mountImageFab(shopeeAdapter);
    const panel = new FloatingPanel(shopeeAdapter);
    mountToggleButton(panel);
}

function init() {
    mountOrderDetailCheck();
    if (isShopeeOrderDetailUrl()) {
        mountPricingFab();
        return;
    }
    initProductEditor();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
}
else {
    init();
}
observeDomChanges(() => {
    mountOrderDetailCheck();
    if (isShopeeOrderDetailUrl()) {
        if (!document.getElementById('bigseller-ai-pricing-fab'))
            mountPricingFab();
        return;
    }
    updateProductCategoryFeeBadge();
    if (!document.getElementById('bigseller-ai-toggle') ||
        !document.getElementById('bigseller-ai-pricing-fab') ||
        !document.getElementById('bigseller-ai-image-fab')) {
        initProductEditor();
    }
});
