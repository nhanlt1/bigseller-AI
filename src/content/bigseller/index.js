import { bigsellerAdapter } from './adapter.js';
import { listenForProductApply } from '../shared/apply-listener.js';
import { mountOptimizeProgressListener } from '../shared/optimize-progress.js';
import {
    mountOptimizeResultListener,
    mountOptimizeReviewSidebar,
} from '../shared/optimize-review-sidebar.js';
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
import {
    mountShopInShopSearch,
    SHOP_SEARCH_HOST_ID,
} from '../shared/shop-in-shop-search.js';
import { mountProductSaveShortcut } from '../shared/product-save-shortcut.js';
import {
    mountShippingAutoToggle,
    refreshShippingAutoEnable,
    scheduleApply,
    SHIPPING_AUTO_HOST_ID,
} from '../shared/shipping-auto-enable.js';

listenForProductApply(bigsellerAdapter);
mountOptimizeProgressListener();
mountOptimizeResultListener();
mountOptimizeReviewSidebar(bigsellerAdapter);

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
    mountProductSaveShortcut('bigseller');
    mountPricingFab();
    if (document.querySelector('.page_edit')) {
        mountProductCategoryFeeBadge();
        mountShopInShopSearch('bigseller');
        mountShippingAutoToggle('bigseller');
        scheduleApply('bigseller');
    }
    mountEditorToolbars();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
}
else {
    init();
}
observeDomChanges(() => {
    if (document.querySelector('.page_edit')) {
        updateProductCategoryFeeBadge();
        if (!document.getElementById(SHOP_SEARCH_HOST_ID))
            mountShopInShopSearch('bigseller');
        if (!document.getElementById(SHIPPING_AUTO_HOST_ID))
            mountShippingAutoToggle('bigseller');
        refreshShippingAutoEnable('bigseller');
    }
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
