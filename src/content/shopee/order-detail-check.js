import { formatVnd } from '../../pricing/formula-engine.js';
import { amountsMatch, buildSettlementFromRows, computeExtensionSettlement, expectedValueForRow, inferIncomeRowRole, parseVndText, resolveRowRole, rowCheckTitle, } from '../../pricing/order-settlement.js';
import { getSettings } from '../../shared/storage.js';
import { observeDomChanges } from '../shared/dom-utils.js';

const STYLE_ID = 'bigseller-ai-order-check-style';
const FLOAT_ID = 'bigseller-ai-order-check-float';
let checkObserverBound = false;
let positionListenersBound = false;
let positionRaf = 0;
/** @type {{ valueEl: HTMLElement, cellEl: HTMLElement }[]} */
let floatRowRefs = [];

export function isShopeeOrderDetailUrl(url = location.href) {
    return /banhang\.shopee\.(vn|com)\/portal\/sale\/order\/\d+/i.test(url);
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${FLOAT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        pointer-events: none;
        overflow: visible;
      }
      .bigseller-ai-check-float-header {
        position: fixed;
        width: 152px;
        text-align: right;
        font-size: 11px;
        font-weight: 700;
        color: #ee4d2d;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        pointer-events: none;
        padding: 2px 6px;
        background: rgba(255,255,255,.94);
        border-radius: 6px 6px 0 0;
        box-shadow: 0 1px 4px rgba(0,0,0,.08);
      }
      .bigseller-ai-check-float-banner {
        position: fixed;
        width: min(280px, calc(100vw - 24px));
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.4;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: rgba(255,247,237,.97);
        border: 1px solid #fed7aa;
        color: #9a3412;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(0,0,0,.12);
      }
      .bigseller-ai-check-float-banner.ok {
        background: rgba(240,253,244,.97);
        border-color: #bbf7d0;
        color: #166534;
      }
      .bigseller-ai-check-float-cell {
        position: fixed;
        width: 148px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 0 6px;
        font-size: 13px;
        font-weight: 500;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        box-sizing: border-box;
        white-space: nowrap;
        pointer-events: auto;
        background: rgba(255,255,255,.94);
        border-radius: 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,.08);
      }
      .bigseller-ai-check-float-cell.match { color: #15803d; }
      .bigseller-ai-check-float-cell.mismatch { color: #dc2626; }
      .bigseller-ai-check-float-cell.na {
        color: #6b7280;
        font-weight: 400;
        background: rgba(249,250,251,.9);
      }
    `;
    document.head.appendChild(style);
}

function readIncomeRows(container) {
    const rows = [];
    let subtotalIndex = 0;
    let groupIndex = -1;
    for (const child of container.children) {
        if (child.classList.contains('income-item')) {
            const valueEl = child.querySelector('.income-value');
            if (!valueEl)
                continue;
            const labelEl = child.querySelector('.income-label, .income-name, [class*="label"]');
            const label = (labelEl?.textContent ?? child.textContent ?? '')
                .replace(valueEl.textContent ?? '', '')
                .trim();
            const isSubtotal = child.classList.contains('income-subtotal');
            const isHighlighted = child.classList.contains('highlighted');
            const role = inferIncomeRowRole({
                isSubtotal,
                subtotalIndex: isSubtotal ? subtotalIndex : null,
                groupIndex: null,
                itemIndex: null,
                isHighlighted,
            });
            if (isSubtotal)
                subtotalIndex += 1;
            rows.push({
                item: child,
                label,
                value: parseVndText(valueEl.textContent),
                valueEl,
                role,
            });
            continue;
        }
        if (!child.classList.contains('income-group'))
            continue;
        groupIndex += 1;
        child.querySelectorAll(':scope > .income-item').forEach((item, itemIndex) => {
            const valueEl = item.querySelector('.income-value');
            if (!valueEl)
                return;
            const labelEl = item.querySelector('.income-label, .income-name, [class*="label"]');
            const label = (labelEl?.textContent ?? item.textContent ?? '')
                .replace(valueEl.textContent ?? '', '')
                .trim();
            rows.push({
                item,
                label,
                value: parseVndText(valueEl.textContent),
                valueEl,
                role: inferIncomeRowRole({
                    isSubtotal: false,
                    subtotalIndex: null,
                    groupIndex,
                    itemIndex,
                    isHighlighted: false,
                }),
            });
        });
    }
    return rows;
}

function removeFloatOverlay() {
    floatRowRefs = [];
    document.getElementById(FLOAT_ID)?.remove();
}

function bindPositionListeners() {
    if (positionListenersBound)
        return;
    positionListenersBound = true;
    const schedule = () => {
        cancelAnimationFrame(positionRaf);
        positionRaf = requestAnimationFrame(positionFloatOverlay);
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
}

function positionFloatOverlay() {
    const float = document.getElementById(FLOAT_ID);
    if (!float)
        return;
    const header = float.querySelector('.bigseller-ai-check-float-header');
    const banner = float.querySelector('.bigseller-ai-check-float-banner');
    const anchor = floatRowRefs[0]?.valueEl;
    if (!anchor?.isConnected) {
        removeFloatOverlay();
        return;
    }
    const firstRect = anchor.getBoundingClientRect();
    const gap = 8;
    if (header) {
        header.style.top = `${Math.max(8, firstRect.top - 26)}px`;
        header.style.left = `${firstRect.right + gap}px`;
    }
    if (banner && header) {
        const headerRect = header.getBoundingClientRect();
        banner.style.top = `${Math.max(8, headerRect.top - 72)}px`;
        banner.style.left = `${firstRect.right + gap}px`;
    }
    for (const { valueEl, cellEl } of floatRowRefs) {
        if (!valueEl.isConnected)
            continue;
        const rect = valueEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0)
            continue;
        cellEl.style.top = `${rect.top}px`;
        cellEl.style.left = `${rect.right + gap}px`;
        cellEl.style.height = `${Math.max(rect.height, 28)}px`;
    }
}

function renderCheckColumn(container, settings) {
    removeFloatOverlay();
    const rows = readIncomeRows(container);
    if (rows.length === 0)
        return;
    const parsed = buildSettlementFromRows(rows);
    const calc = computeExtensionSettlement(parsed, settings.platformFeeConfig);
    ensureStyles();
    bindPositionListeners();
    const float = document.createElement('div');
    float.id = FLOAT_ID;
    const header = document.createElement('div');
    header.className = 'bigseller-ai-check-float-header';
    header.textContent = 'Kiểm tra ($)';
    float.appendChild(header);
    const finalRow = rows.find((r) => resolveRowRole(r) === 'sellerIncome') ??
        rows.find((r) => r.item.classList.contains('highlighted')) ??
        rows[rows.length - 1];
    const finalExpected = calc.sellerIncome;
    const finalMatch = amountsMatch(finalRow.value, finalExpected);
    const banner = document.createElement('div');
    banner.className = `bigseller-ai-check-float-banner${finalMatch ? ' ok' : ''}`;
    banner.innerHTML = finalMatch
        ? `✓ Thu nhập khớp (<strong>${formatVnd(finalExpected)}</strong>).`
        : `✗ Shopee <strong>${formatVnd(finalRow.value)}</strong> ≠ ext. <strong>${formatVnd(finalExpected)}</strong> (lệch ${formatVnd(finalRow.value - finalExpected)}). Chỉnh % phí nút <strong>$</strong>.`;
    float.appendChild(banner);
    for (const row of rows) {
        const role = resolveRowRole(row);
        const expected = expectedValueForRow(role, calc);
        const cell = document.createElement('div');
        cell.className = 'bigseller-ai-check-float-cell';
        if (expected == null) {
            cell.classList.add('na');
            cell.textContent = '—';
            const hint = rowCheckTitle(role, calc);
            cell.title = role === 'shippingDetail'
                ? 'Chi tiết ship/voucher — không đưa vào công thức'
                : hint || 'Extension không tính dòng này';
        }
        else {
            const match = amountsMatch(row.value, expected);
            cell.classList.add(match ? 'match' : 'mismatch');
            cell.textContent = `${formatVnd(expected)}${match ? ' ✓' : ''}`;
            const hint = rowCheckTitle(role, calc);
            cell.title = match
                ? (hint || 'Khớp công thức extension')
                : `${hint ? `${hint} · ` : ''}Shopee ${formatVnd(row.value)} · extension ${formatVnd(expected)}`;
        }
        float.appendChild(cell);
        floatRowRefs.push({ valueEl: row.valueEl, cellEl: cell });
    }
    document.body.appendChild(float);
    positionFloatOverlay();
}

async function refreshOrderCheck() {
    if (!isShopeeOrderDetailUrl()) {
        removeFloatOverlay();
        return;
    }
    const container = document.querySelector('.order-detail .payment-info-detail .income-container, .order-detail .income-container');
    if (!container) {
        removeFloatOverlay();
        return;
    }
    const settings = await getSettings();
    renderCheckColumn(container, settings);
}

export function mountOrderDetailCheck() {
    if (!isShopeeOrderDetailUrl())
        return;
    if (!checkObserverBound) {
        checkObserverBound = true;
        observeDomChanges(() => {
            void refreshOrderCheck();
        });
    }
    void refreshOrderCheck();
}
