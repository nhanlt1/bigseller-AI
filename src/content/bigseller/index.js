import { bigsellerAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { observeDomChanges } from '../shared/dom-utils.js';
import { mountImageFab } from '../shared/image-fab.js';
import { FloatingPanel, mountToggleButton } from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import {
    mountProductCategoryFeeBadge,
    updateProductCategoryFeeBadge,
} from '../shared/product-category-fee.js';

listenForProductApply(bigsellerAdapter);

function init() {
    if (!bigsellerAdapter.canHandle(location.href))
        return;
    mountPricingFab();
    if (document.querySelector('.page_edit'))
        mountProductCategoryFeeBadge();
    if (!bigsellerAdapter.extract())
        return;
    mountImageFab(bigsellerAdapter);
    const panel = new FloatingPanel(bigsellerAdapter);
    mountToggleButton(panel);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
}
else {
    init();
}
observeDomChanges(() => {
    if (document.querySelector('.page_edit'))
        updateProductCategoryFeeBadge();
    if (!document.getElementById('bigseller-ai-toggle') ||
        !document.getElementById('bigseller-ai-pricing-fab') ||
        !document.getElementById('bigseller-ai-image-fab')) {
        init();
    }
});
