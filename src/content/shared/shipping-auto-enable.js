import { isExtensionContextAlive } from '../../shared/extension-context.js';

export const SHIPPING_AUTO_HOST_ID = 'bigseller-ai-shipping-auto-host';
const STYLE_ID = 'bigseller-ai-shipping-auto-style';
const STORAGE_KEY = 'bsaiAutoShippingOn';
const LS_FALLBACK_KEY = 'bsaiAutoShippingOn';
const HOST_WIDTH_EST = 200;
/** Mặc định bật — user tắt thì lưu false vào storage */
const DEFAULT_ENABLED = true;

/** @type {boolean | null} */
let enabledCache = null;
let applyTimer = null;
let applying = false;
let positionListenersBound = false;

function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SHIPPING_AUTO_HOST_ID} {
        position: fixed;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        border: 1px solid rgba(0, 0, 0, 0.08);
        user-select: none;
        z-index: 2147483000;
        pointer-events: auto;
      }
      #${SHIPPING_AUTO_HOST_ID} .bs-ai-shipping-auto-label {
        font-size: 12px;
        line-height: 1.3;
        color: #333;
        white-space: nowrap;
      }
      #${SHIPPING_AUTO_HOST_ID} .bs-ai-shipping-auto-track {
        position: relative;
        width: 40px;
        height: 22px;
        border: none;
        padding: 0;
        border-radius: 11px;
        background: #d9d9d9;
        cursor: pointer;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      #${SHIPPING_AUTO_HOST_ID} .bs-ai-shipping-auto-track[aria-checked="true"] {
        background: #52c41a;
      }
      #${SHIPPING_AUTO_HOST_ID} .bs-ai-shipping-auto-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.2);
        transition: transform 0.2s;
        pointer-events: none;
      }
      #${SHIPPING_AUTO_HOST_ID} .bs-ai-shipping-auto-track[aria-checked="true"] .bs-ai-shipping-auto-thumb {
        transform: translateX(18px);
      }
    `;
    document.head.appendChild(style);
}

async function readEnabled() {
    if (enabledCache !== null)
        return enabledCache;
    if (isExtensionContextAlive()) {
        try {
            const area = chrome.storage?.local;
            if (area) {
                const result = await area.get(STORAGE_KEY);
                const stored = result[STORAGE_KEY];
                enabledCache = stored === undefined ? DEFAULT_ENABLED : Boolean(stored);
                return enabledCache;
            }
        }
        catch {
            /* fallback localStorage */
        }
    }
    try {
        const v = localStorage.getItem(LS_FALLBACK_KEY);
        enabledCache = v === null ? DEFAULT_ENABLED : v === '1';
    }
    catch {
        enabledCache = DEFAULT_ENABLED;
    }
    return enabledCache;
}

async function writeEnabled(on) {
    enabledCache = on;
    if (isExtensionContextAlive()) {
        try {
            const area = chrome.storage?.local;
            if (area) {
                await area.set({ [STORAGE_KEY]: on });
                return;
            }
        }
        catch {
            /* fallback */
        }
    }
    try {
        localStorage.setItem(LS_FALLBACK_KEY, on ? '1' : '0');
    }
    catch {
        /* ignore */
    }
}

function isVisible(el) {
    if (!el || !(el instanceof HTMLElement))
        return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** Card vận chuyển BigSeller: com_card có bảng checkbox in_table */
function findBigsellerShippingCard(root = document) {
    const page = root.querySelector('.page_edit');
    if (!page)
        return null;
    for (const card of page.querySelectorAll('.com_card')) {
        const table = card.querySelector('table.in_table');
        if (!table?.querySelector('input.ant-checkbox-input'))
            continue;
        const head =
            card.querySelector('.title') ??
            card.querySelector('.com_card_head') ??
            card.querySelector('h3, h4');
        const headText = head?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (/ph[ií]\s*vận\s*chuyển/i.test(headText))
            return card;
    }
    for (const card of page.querySelectorAll('.com_card')) {
        const table = card.querySelector('table.in_table');
        if (table?.querySelector('input.ant-checkbox-input'))
            return card;
    }
    return null;
}

/** Neo căn vị trí BigSeller — khối bảng ĐVVC `.w_full.border_ddd.p_10` */
function findBigsellerAnchor() {
    const card = findBigsellerShippingCard();
    if (!card)
        return null;
    const box =
        card.querySelector('.w_full.border_ddd.p_10') ??
        card.querySelector('.border_ddd.p_10') ??
        card.querySelector('.w_full.border_ddd');
    if (box?.querySelector('table.in_table') && isVisible(box))
        return box;
    for (const el of card.querySelectorAll('[class*="border_ddd"]')) {
        if (el.querySelector('table.in_table') && isVisible(el))
            return el;
    }
    const body = card.querySelector('.com_card_body');
    return body && isVisible(body) ? body : null;
}

/** Neo căn vị trí Shopee — hàng «Lấy hàng chủ động» (.service-type) */
function findShopeeAnchor() {
    const panel =
        document.querySelector('.product-shipping') ??
        document.querySelector('[class*="product-shipping"]');
    const scope = panel ?? document;
    const serviceType =
        scope.querySelector('.logistic-item-container .service-type') ??
        scope.querySelector('.service-type');
    if (serviceType && isVisible(serviceType))
        return serviceType;
    const wrapper =
        scope.querySelector('.logistic-setting-wrapper') ??
        document.querySelector('.logistic-setting-wrapper');
    return wrapper && isVisible(wrapper) ? wrapper : null;
}

function getAnchor(platform) {
    return platform === 'bigseller' ? findBigsellerAnchor() : findShopeeAnchor();
}

/** Đặt host nổi (fixed) theo anchor — không chèn vào DOM trang, không đổi layout. */
function positionFloatingHost(host, platform) {
    if (!host)
        return;
    const anchor = getAnchor(platform);
    if (!anchor) {
        host.style.display = 'none';
        return;
    }
    const r = anchor.getBoundingClientRect();
    const hostH = host.offsetHeight || 30;
    const hostW = host.offsetWidth || HOST_WIDTH_EST;
    host.style.display = 'inline-flex';
    if (platform === 'bigseller') {
        const gap = 6;
        let top = r.top - hostH - gap;
        top = Math.max(8, top);
        host.style.top = `${top}px`;
        host.style.left = `${r.left}px`;
        host.style.right = 'auto';
    }
    else {
        const top = r.top + Math.max(0, (r.height - hostH) / 2);
        let left = r.right - hostW - 8;
        left = Math.max(8, Math.min(left, window.innerWidth - hostW - 8));
        host.style.top = `${top}px`;
        host.style.left = `${left}px`;
        host.style.right = 'auto';
    }
}

function bindPositionListeners() {
    if (positionListenersBound)
        return;
    positionListenersBound = true;
    const onMove = () => {
        try {
            const host = document.getElementById(SHIPPING_AUTO_HOST_ID);
            if (!host)
                return;
            const platform = host.getAttribute('data-platform') ?? 'bigseller';
            positionFloatingHost(host, platform);
        }
        catch {
            /* im lặng */
        }
    };
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove, { passive: true });
}

function createHost(platform) {
    const host = document.createElement('div');
    host.id = SHIPPING_AUTO_HOST_ID;
    host.setAttribute('data-platform', platform);
    host.innerHTML =
        '<span class="bs-ai-shipping-auto-label">Tự bật mọi ĐVVC</span>' +
        '<button type="button" class="bs-ai-shipping-auto-track" ' +
        'role="switch" aria-checked="false" aria-label="Tự bật mọi đơn vị vận chuyển">' +
        '<span class="bs-ai-shipping-auto-thumb"></span></button>';
    return host;
}

function setTrackState(track, on) {
    track.setAttribute('aria-checked', on ? 'true' : 'false');
}

function bindHost(host, platform) {
    const track = host.querySelector('.bs-ai-shipping-auto-track');
    if (!track)
        return;
    void readEnabled().then((on) => {
        setTrackState(track, on);
        if (on)
            scheduleApply(platform);
    });
    track.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = track.getAttribute('aria-checked') !== 'true';
        setTrackState(track, next);
        void writeEnabled(next).then(() => {
            if (next)
                scheduleApply(platform);
        });
    });
}

function clickAntCheckbox(input) {
    if (!input || input.disabled || input.checked)
        return;
    const label = input.closest('label.ant-checkbox-wrapper') ??
        input.closest('label');
    if (label) {
        label.click();
        return;
    }
    input.click();
}

function clickEdsSwitch(sw) {
    if (!sw || sw.classList.contains('eds-switch--open'))
        return;
    if (sw.classList.contains('eds-switch--disabled') ||
        sw.classList.contains('eds-switch--loading'))
        return;
    sw.click();
}

function applyBigsellerShipping() {
    const card = findBigsellerShippingCard();
    if (!card)
        return;
    const inputs = card.querySelectorAll('table.in_table input.ant-checkbox-input');
    for (const input of inputs)
        clickAntCheckbox(input);
}

function applyShopeeShipping() {
    const panel =
        document.querySelector('.product-shipping') ??
        document.querySelector('[class*="product-shipping"]');
    const scope = panel ?? document;
    const switches = scope.querySelectorAll(
        '.logistic-item-container .eds-switch, .logistics-section .eds-switch',
    );
    for (const sw of switches)
        clickEdsSwitch(sw);
}

/** Bật mọi kênh vận chuyển khi switch đang ON (debounce + chống re-entry). */
export function scheduleApply(platform) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
        void applyAutoShipping(platform);
    }, 300);
}

export async function applyAutoShipping(platform) {
    try {
        const on = await readEnabled();
        if (!on || applying)
            return;
        applying = true;
        if (platform === 'bigseller')
            applyBigsellerShipping();
        else
            applyShopeeShipping();
    }
    catch {
        /* selector/DOM lỗi — im lặng, không làm chết observer chung */
    }
    finally {
        applying = false;
    }
}

/** Căn lại vị trí nổi theo anchor (scroll/resize/DOM đổi). */
export function repositionShippingAutoToggle(platform) {
    try {
        const host = document.getElementById(SHIPPING_AUTO_HOST_ID);
        if (!host)
            return;
        const p = host.getAttribute('data-platform') ?? platform;
        positionFloatingHost(host, p);
    }
    catch {
        /* im lặng */
    }
}

/** Gắn switch «Tự bật mọi ĐVVC» nổi trên body — không sửa DOM trang (idempotent). */
export function mountShippingAutoToggle(platform) {
    try {
        if (document.getElementById(SHIPPING_AUTO_HOST_ID)) {
            repositionShippingAutoToggle(platform);
            return;
        }
        if (platform === 'bigseller' && !document.querySelector('.page_edit'))
            return;
        if (platform === 'shopee' &&
            !document.querySelector('.product-shipping, [class*="product-shipping"]'))
            return;
        if (!getAnchor(platform))
            return;
        ensureStyles();
        const host = createHost(platform);
        document.body.appendChild(host);
        bindHost(host, platform);
        bindPositionListeners();
        positionFloatingHost(host, platform);
        requestAnimationFrame(() => positionFloatingHost(host, platform));
        void readEnabled().then((on) => {
            if (on)
                scheduleApply(platform);
        });
    }
    catch {
        /* im lặng */
    }
}

/** Re-mount nếu host mất + căn lại vị trí + áp dụng khi DOM đổi. */
export function refreshShippingAutoEnable(platform) {
    try {
        if (!document.getElementById(SHIPPING_AUTO_HOST_ID))
            mountShippingAutoToggle(platform);
        else
            repositionShippingAutoToggle(platform);
        void readEnabled().then((on) => {
            if (on)
                scheduleApply(platform);
        });
    }
    catch {
        /* im lặng */
    }
}
