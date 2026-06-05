import { bigsellerAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { observeDomChanges } from '../shared/dom-utils.js';
import { mountImageFab, refreshImageToolbar, IMAGE_TOOLBAR_ID } from '../shared/image-fab.js';
import {
    FloatingPanel,
    mountProductDescriptionToolbar,
    refreshDescriptionToolbar,
    DESC_TOOLBAR_ID,
} from '../shared/panel.js';
import { mountPricingFab } from '../shared/pricing-popup.js';
import {
    mountProductCategoryFeeBadge,
    updateProductCategoryFeeBadge,
} from '../shared/product-category-fee.js';

listenForProductApply(bigsellerAdapter);

let editorPanel = null;

function mountEditorToolbars() {
    if (!bigsellerAdapter.extract())
        return;
    mountImageFab(bigsellerAdapter);
    if (!editorPanel)
        editorPanel = new FloatingPanel(bigsellerAdapter);
    mountProductDescriptionToolbar(editorPanel, 'bigseller');
}

function init() {
    if (!bigsellerAdapter.canHandle(location.href))
        return;
    mountPricingFab();
    if (document.querySelector('.page_edit'))
        mountProductCategoryFeeBadge();
    mountEditorToolbars();
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
    if (
        !document.getElementById(IMAGE_TOOLBAR_ID) ||
        !document.getElementById(DESC_TOOLBAR_ID) ||
        !document.getElementById('bigseller-ai-pricing-fab')
    ) {
        init();
    }
    else {
        refreshImageToolbar();
        refreshDescriptionToolbar();
    }
});
