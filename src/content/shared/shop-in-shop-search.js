import {
    BIGSELLER_TITLE_SELECTORS,
    SHOPEE_TITLE_SELECTORS,
} from '../../shared/product-field-elements.js';
import { isExtensionContextAlive } from '../../shared/extension-context.js';
import { MessageType, sendMessage } from '../../shared/messaging.js';
import {
    buildShopeeShopSearchUrl,
    DTL_SHOP_SEARCH_ID,
} from '../../shared/shopee-shop-search.js';
import { queryFirst } from './dom-utils.js';

export const SHOP_SEARCH_HOST_ID = 'bigseller-ai-shop-search-host';
const STYLE_ID = 'bigseller-ai-shop-search-style';

function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bs-ai-title-row {
        display: flex !important;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 8px;
      }
      .bs-ai-title-row > .product_name,
      .bs-ai-title-row > .product-name-editor {
        flex: 1 1 320px;
        min-width: 0;
      }
      #${SHOP_SEARCH_HOST_ID} {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 0 0 auto;
        margin-top: 0;
      }
      #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-label {
        font-size: 11px;
        line-height: 1.2;
        color: #666;
        white-space: nowrap;
        user-select: none;
      }
      #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-input {
        box-sizing: border-box;
        width: 148px;
        height: 32px;
        padding: 4px 8px;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        font-size: 13px;
        line-height: 1.3;
        background: #fff;
        color: #333;
      }
      #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-input:focus {
        outline: none;
        border-color: #40a9ff;
        box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.15);
      }
      .page_edit #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-input {
        height: 32px;
      }
      .product-name-editor ~ #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-input,
      .bs-ai-title-row #${SHOP_SEARCH_HOST_ID} .bs-ai-shop-search-input.eds-match {
        height: 38px;
      }
    `;
    document.head.appendChild(style);
}

function findMountPoint(platform, titleEl) {
    if (platform === 'bigseller') {
        return titleEl.closest('.page_edit_item')?.querySelector('.content') ??
            titleEl.closest('.content');
    }
    return (
        titleEl.closest('.edit-main') ??
        titleEl.closest('.product-name-editor')?.parentElement
    );
}

function openShopSearchFallback(keyword) {
    const url = buildShopeeShopSearchUrl(keyword, DTL_SHOP_SEARCH_ID);
    window.open(url, '_blank', 'noopener');
}

async function openShopSearch(keyword) {
    const k = keyword.trim();
    if (!k)
        return;
    if (!isExtensionContextAlive()) {
        openShopSearchFallback(k);
        return;
    }
    try {
        const res = await sendMessage({
            type: MessageType.OPEN_SHOPEE_SHOP_SEARCH,
            payload: { keyword: k, shopId: DTL_SHOP_SEARCH_ID },
        });
        if (res?.ok === false)
            openShopSearchFallback(k);
    }
    catch {
        /* SW chưa sẵn sàng / port đóng — vẫn mở tab tìm kiếm */
        openShopSearchFallback(k);
    }
}

function bindSearchInput(input) {
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        e.preventDefault();
        e.stopPropagation();
        void openShopSearch(input.value);
    });
}

function createHost(platform) {
    const host = document.createElement('div');
    host.id = SHOP_SEARCH_HOST_ID;
    host.innerHTML =
        '<span class="bs-ai-shop-search-label">Tìm trong shop DTL</span>' +
        '<input type="text" class="bs-ai-shop-search-input" ' +
        'placeholder="Từ khóa…" autocomplete="off" ' +
        `title="Enter → ${buildShopeeShopSearchUrl('…', DTL_SHOP_SEARCH_ID).replace('…', 'keyword')}">`;
    if (platform === 'shopee')
        host.querySelector('.bs-ai-shop-search-input')?.classList.add('eds-match');
    const input = host.querySelector('.bs-ai-shop-search-input');
    if (input)
        bindSearchInput(input);
    return host;
}

/** Gắn ô «Tìm trong shop DTL» cạnh input tên sản phẩm (BigSeller / Shopee SC). */
export function mountShopInShopSearch(platform) {
    if (document.getElementById(SHOP_SEARCH_HOST_ID))
        return;
    const selectors =
        platform === 'bigseller' ? BIGSELLER_TITLE_SELECTORS : SHOPEE_TITLE_SELECTORS;
    const titleEl = queryFirst(selectors);
    if (!titleEl)
        return;
    const mountPoint = findMountPoint(platform, titleEl);
    if (!mountPoint)
        return;
    ensureStyles();
    mountPoint.classList.add('bs-ai-title-row');
    mountPoint.appendChild(createHost(platform));
}
