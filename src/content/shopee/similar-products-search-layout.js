const STYLE_ID = 'bigseller-ai-shopee-search-layout';
const ROOT_CLASS = 'bigseller-ai-search-layout-shifted';
const LEFT_GAP_PX = 12;

/** Ô cha chứa bộ lọc + kết quả (trang search) hoặc vùng SP (trang tương tự) */
export function findShopeeSearchLayoutRoot() {
    const filter = document.querySelector('.shopee-filter-panel');
    const results = document.querySelector(
        '.shopee-search-item-result, section.shopee-search-item-result',
    );
    if (filter && results) {
        let el = filter.parentElement;
        while (el && el !== document.body) {
            if (el.contains(results))
                return el;
            el = el.parentElement;
        }
    }
    if (results) {
        return (
            results.closest('.container, .fiCAD6, .u37U8O') ??
            results.parentElement
        );
    }
    const card = document.querySelector(
        'div[role="group"][aria-label^="Product card"]',
    );
    if (card) {
        return (
            card.closest('.container, .XwdvuO, .rBfdm_, section') ??
            document.getElementById('main')
        );
    }
    return document.getElementById('main');
}

function ensureStyleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    return el;
}

function layoutCss() {
    const avail =
        'calc(100vw - var(--bigseller-sidebar-w, 420px) - var(--bigseller-left-gap, 12px))';
    return `
      html[data-bigseller-research-open="1"],
      html[data-bigseller-research-open="1"] body {
        overflow-x: hidden !important;
      }
      html[data-bigseller-research-open="1"] #main {
        max-width: ${avail} !important;
        width: ${avail} !important;
        margin-left: var(--bigseller-left-gap, 12px) !important;
        margin-right: var(--bigseller-sidebar-w, 420px) !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
      }
      html[data-bigseller-research-open="1"] .${ROOT_CLASS} {
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      html[data-bigseller-research-open="1"] .${ROOT_CLASS}-columns {
        display: flex !important;
        flex-direction: row !important;
        align-items: flex-start !important;
        flex-wrap: nowrap !important;
        gap: 12px !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      html[data-bigseller-research-open="1"] .shopee-filter-panel {
        flex: 0 1 190px !important;
        min-width: 108px !important;
        max-width: min(190px, 28%) !important;
        width: auto !important;
      }
      html[data-bigseller-research-open="1"] .u37U8O,
      html[data-bigseller-research-open="1"] .shopee-search-item-result,
      html[data-bigseller-research-open="1"] .XwdvuO,
      html[data-bigseller-research-open="1"] .container.fiCAD6 {
        max-width: 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
      }
      html[data-bigseller-research-open="1"] .shopee-search-item-result > *,
      html[data-bigseller-research-open="1"] .u37U8O > * {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      html[data-bigseller-research-open="1"] .rBfdm_.row,
      html[data-bigseller-research-open="1"] [class*="rBfdm_"].row,
      html[data-bigseller-research-open="1"] .shopee-search-item-result [class*="row"] {
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
    `;
}

function clearLayoutClasses() {
    for (const el of document.querySelectorAll(
        `.${ROOT_CLASS}, .${ROOT_CLASS}-columns`,
    )) {
        el.classList.remove(ROOT_CLASS, `${ROOT_CLASS}-columns`);
    }
}

function applyLayoutClasses() {
    clearLayoutClasses();
    const root = findShopeeSearchLayoutRoot();
    if (!root)
        return;
    if (root.querySelector('.shopee-filter-panel')) {
        root.classList.add(`${ROOT_CLASS}-columns`);
    }
    let el = root;
    while (el && el !== document.body) {
        el.classList.add(ROOT_CLASS);
        if (el.id === 'main')
            break;
        el = el.parentElement;
    }
}

/**
 * Chừa vùng bên phải = sidebar — lưới SP không bị đè.
 * @param {{ open: boolean, sidebarWidth?: number }} options
 */
export function syncShopeeSearchPageLayout(options) {
    const { open, sidebarWidth = 420 } = options;
    const styleEl = ensureStyleEl();

    if (!open) {
        document.documentElement.removeAttribute('data-bigseller-research-open');
        document.documentElement.style.removeProperty('--bigseller-sidebar-w');
        document.documentElement.style.removeProperty('--bigseller-left-gap');
        clearLayoutClasses();
        styleEl.textContent = '';
        return;
    }

    document.documentElement.setAttribute('data-bigseller-research-open', '1');
    document.documentElement.style.setProperty(
        '--bigseller-sidebar-w',
        `${Math.max(0, sidebarWidth)}px`,
    );
    document.documentElement.style.setProperty(
        '--bigseller-left-gap',
        `${LEFT_GAP_PX}px`,
    );
    styleEl.textContent = layoutCss();
    applyLayoutClasses();
    if (open) {
        requestAnimationFrame(() => applyLayoutClasses());
        setTimeout(() => applyLayoutClasses(), 400);
    }
}

let layoutWatch = null;
let layoutWatchPending = false;

/** Shopee SPA re-render — gắn lại class sau khi DOM đổi */
export function installSearchLayoutWatch(active, getSidebarWidth) {
    if (!active) {
        layoutWatch?.disconnect();
        layoutWatch = null;
        layoutWatchPending = false;
        return;
    }
    if (layoutWatch)
        return;
    layoutWatch = new MutationObserver(() => {
        if (layoutWatchPending)
            return;
        layoutWatchPending = true;
        requestAnimationFrame(() => {
            layoutWatchPending = false;
            syncShopeeSearchPageLayout({
                open: true,
                sidebarWidth: getSidebarWidth(),
            });
        });
    });
    layoutWatch.observe(document.body, { childList: true, subtree: true });
}
