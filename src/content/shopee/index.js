import { shopeeAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { mountImageFab } from '../shared/image-fab.js';
import { FloatingPanel, mountToggleButton } from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import { observeDomChanges } from '../shared/dom-utils.js';
listenForProductApply(shopeeAdapter);
function init() {
    if (!shopeeAdapter.canHandle(location.href))
        return;
    if (!shopeeAdapter.extract())
        return;
    mountPricingFab();
    mountImageFab(shopeeAdapter);
    const panel = new FloatingPanel(shopeeAdapter);
    mountToggleButton(panel);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
}
else {
    init();
}
observeDomChanges(() => {
    if (!document.getElementById('bigseller-ai-toggle') ||
        !document.getElementById('bigseller-ai-pricing-fab') ||
        !document.getElementById('bigseller-ai-image-fab')) {
        init();
    }
});
