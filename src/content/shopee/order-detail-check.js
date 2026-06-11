import { formatVnd } from "../../pricing/formula-engine.js";
import {
  amountsMatch,
  buildSettlementFromRows,
  computeExtensionSettlement,
  expectedValueForRow,
  extractIncomeLabel,
  parseOrderProductLines,
  parseVndText,
  resolveIncomeRowRole,
  resolveRowRole,
  isSettlementRowFromDom,
  rowCheckTitle,
} from "../../pricing/order-settlement.js";
import { copyTextToClipboard } from "../../shared/clipboard.js";
import { getSettings } from "../../shared/storage.js";
import { observeDomChanges } from "../shared/dom-utils.js";

const STYLE_ID = "bigseller-ai-order-check-style";
const FLOAT_ID = "bigseller-ai-order-check-float";
let checkObserverBound = false;
let positionListenersBound = false;
let positionRaf = 0;
/** @type {{ valueEl: HTMLElement, cellEl: HTMLElement }[]} */
let floatRowRefs = [];
let lastIncomeSnapshot = "";

function incomeContainerSelector() {
  return ".order-detail .payment-info-detail .income-container, .order-detail .income-container";
}

function snapshotIncomeRows(rows) {
  return JSON.stringify(rows.map((r) => [r.label, r.value]));
}

export function isShopeeOrderDetailUrl(url = location.href) {
  return /banhang\.shopee\.(vn|com)\/portal\/sale\/order\/\d+/i.test(url);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
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
        z-index: 2147483641;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        width: auto;
        max-width: 200px;
        text-align: right;
        font-size: 11px;
        font-weight: 700;
        color: #ee4d2d;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        pointer-events: auto;
        padding: 6px 8px;
        background: rgba(255,255,255,.94);
        border-radius: 6px 6px 0 0;
        box-shadow: 0 1px 4px rgba(0,0,0,.08);
      }
      .bigseller-ai-check-float-header-title {
        font-size: 11px;
        font-weight: 700;
        color: #ee4d2d;
      }
      .bigseller-ai-copy-reconcile {
        padding: 5px 10px;
        border: 1px solid #fed7aa;
        border-radius: 6px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .bigseller-ai-copy-reconcile:hover {
        background: #ffedd5;
      }
      .bigseller-ai-copy-reconcile:disabled {
        opacity: 0.6;
        cursor: wait;
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
  let groupIndex = -1;
  for (const child of container.children) {
    if (child.classList.contains("income-item")) {
      const valueEl = child.querySelector(".income-value");
      if (!valueEl) continue;
      const label = extractIncomeLabel(child);
      const isSubtotal = child.classList.contains("income-subtotal");
      const isHighlighted = child.classList.contains("highlighted");
      rows.push({
        item: child,
        label,
        value: parseVndText(valueEl.textContent),
        valueEl,
        role: resolveIncomeRowRole({
          label,
          isSubtotal,
          isHighlighted,
          groupIndex: null,
        }),
      });
      continue;
    }
    if (!child.classList.contains("income-group")) continue;
    groupIndex += 1;
    child
      .querySelectorAll(":scope > .income-item")
      .forEach((item) => {
        const valueEl = item.querySelector(".income-value");
        if (!valueEl) return;
        const label = extractIncomeLabel(item);
        rows.push({
          item,
          label,
          value: parseVndText(valueEl.textContent),
          valueEl,
          role: resolveIncomeRowRole({
            label,
            isSubtotal: false,
            isHighlighted: false,
            groupIndex,
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
  if (positionListenersBound) return;
  positionListenersBound = true;
  const schedule = () => {
    cancelAnimationFrame(positionRaf);
    positionRaf = requestAnimationFrame(positionFloatOverlay);
  };
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
}

function extensionCheckDisplay(row, role, calc) {
  const expected = expectedValueForRow(role, calc);
  const fromDom = isSettlementRowFromDom(role, calc);
  if (expected == null)
    return "—";
  if (fromDom)
    return "đơn ✓";
  const match = amountsMatch(row.value, expected);
  return `${formatVnd(expected)}${match ? " ✓" : ""}`;
}

function copyAmount(value) {
  return formatVnd(value).replace(/\u00a0/g, " ");
}

/** Tab-separated — dán Excel/Sheets: nhãn | Shopee | Extension */
function buildReconciliationCopyText(rows, calc) {
  const finalRow =
    rows.find((r) => resolveRowRole(r) === "sellerIncome") ??
    rows.find((r) => r.item.classList.contains("highlighted")) ??
    rows[rows.length - 1];
  const lines = ["Nhãn\tShopee\tExtension (kiểm tra)"];
  for (const row of rows) {
    const role = resolveRowRole(row);
    lines.push(
      `${row.label}\t${copyAmount(row.value)}\t${extensionCheckDisplay(row, role, calc).replace(/\u00a0/g, " ")}`,
    );
  }
  lines.push("");
  lines.push(
    `Tổng kết\tShopee ${copyAmount(finalRow.value)}\tExtension ${copyAmount(calc.sellerIncome)}${amountsMatch(finalRow.value, calc.sellerIncome) ? " ✓" : ""}`,
  );
  return lines.join("\n");
}

async function copyReconciliationToClipboard(btn) {
  const container = document.querySelector(incomeContainerSelector());
  if (!container) {
    btn.textContent = "Không thấy bảng";
    return;
  }
  const rows = readIncomeRows(container);
  if (rows.length === 0) {
    btn.textContent = "Không có dòng";
    return;
  }
  const settings = await getSettings();
  const parsed = buildSettlementFromRows(rows, {
    productLines: parseOrderProductLines(document),
  });
  const calc = computeExtensionSettlement(parsed, settings.platformFeeConfig);
  const text = buildReconciliationCopyText(rows, calc);
  btn.disabled = true;
  const prev = btn.textContent;
  const ok = await copyTextToClipboard(text);
  btn.textContent = ok ? "Đã copy!" : "Copy lỗi";
  btn.disabled = false;
  setTimeout(() => {
    btn.textContent = prev;
  }, 1600);
}

function positionFloatOverlay() {
  const float = document.getElementById(FLOAT_ID);
  if (!float) return;
  const header = float.querySelector(".bigseller-ai-check-float-header");
  const banner = float.querySelector(".bigseller-ai-check-float-banner");
  const anchor = floatRowRefs[0]?.valueEl;
  if (!anchor?.isConnected) {
    removeFloatOverlay();
    return;
  }
  const firstRect = anchor.getBoundingClientRect();
  const gap = 8;
  if (header) {
    header.style.left = `${firstRect.right + gap}px`;
    const headerH = header.getBoundingClientRect().height || 32;
    const headerGap = 4;
    header.style.top = `${Math.max(8, firstRect.top - headerH - headerGap)}px`;
  }
  if (banner && header) {
    const headerRect = header.getBoundingClientRect();
    banner.style.top = `${Math.max(8, headerRect.top - 72)}px`;
    banner.style.left = `${firstRect.right + gap}px`;
  }
  for (const { valueEl, cellEl } of floatRowRefs) {
    if (!valueEl.isConnected) continue;
    const rect = valueEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    cellEl.style.top = `${rect.top}px`;
    cellEl.style.left = `${rect.right + gap}px`;
    cellEl.style.height = `${Math.max(rect.height, 28)}px`;
  }
}

function renderCheckColumn(container, settings, rows) {
  removeFloatOverlay();
  if (rows.length === 0) return;
  const parsed = buildSettlementFromRows(rows, {
    productLines: parseOrderProductLines(document),
  });
  const calc = computeExtensionSettlement(parsed, settings.platformFeeConfig);
  ensureStyles();
  bindPositionListeners();
  const float = document.createElement("div");
  float.id = FLOAT_ID;
  const header = document.createElement("div");
  header.className = "bigseller-ai-check-float-header";
  const headerTitle = document.createElement("span");
  headerTitle.className = "bigseller-ai-check-float-header-title";
  headerTitle.textContent = "Kiểm tra ($)";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "bigseller-ai-copy-reconcile";
  copyBtn.textContent = "Copy 3 cột";
  copyBtn.title =
    "Copy nhãn + số Shopee + số extension (tab-separated, dán Excel)";
  copyBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void copyReconciliationToClipboard(copyBtn);
  });
  header.appendChild(headerTitle);
  header.appendChild(copyBtn);
  float.appendChild(header);
  const finalRow =
    rows.find((r) => resolveRowRole(r) === "sellerIncome") ??
    rows.find((r) => r.item.classList.contains("highlighted")) ??
    rows[rows.length - 1];
  const finalExpected = calc.sellerIncome;
  const finalMatch = amountsMatch(finalRow.value, finalExpected);
  const banner = document.createElement("div");
  banner.className = `bigseller-ai-check-float-banner${finalMatch ? " ok" : ""}`;
  banner.innerHTML = finalMatch
    ? `✓ Thu nhập khớp (<strong>${formatVnd(finalExpected)}</strong>).`
    : `✗ Shopee <strong>${formatVnd(finalRow.value)}</strong> ≠ ext. <strong>${formatVnd(finalExpected)}</strong> (lệch ${formatVnd(finalRow.value - finalExpected)}). Chỉnh % phí nút <strong>$</strong>.`;
  float.appendChild(banner);
  for (const row of rows) {
    const role = resolveRowRole(row);
    const expected = expectedValueForRow(role, calc);
    const cell = document.createElement("div");
    cell.className = "bigseller-ai-check-float-cell";
    const fromDom = isSettlementRowFromDom(role, calc);
    const display = extensionCheckDisplay(row, role, calc);
    if (expected == null) {
      cell.classList.add("na");
      cell.textContent = display;
      const hint = rowCheckTitle(role, calc);
      cell.title =
        role === "shippingDetail"
          ? "Chi tiết ship/voucher — không đưa vào công thức"
          : hint || "Extension không tính dòng này";
    } else if (fromDom) {
      cell.classList.add("match");
      cell.textContent = display;
      cell.title = rowCheckTitle(role, calc) || "Dùng số trên đơn để tính thu nhập";
    } else {
      const match = amountsMatch(row.value, expected);
      cell.classList.add(match ? "match" : "mismatch");
      cell.textContent = display;
      const hint = rowCheckTitle(role, calc);
      cell.title = match
        ? hint || "Khớp công thức extension"
        : `${hint ? `${hint} · ` : ""}Shopee ${formatVnd(row.value)} · extension ${formatVnd(expected)}`;
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
    lastIncomeSnapshot = "";
    return;
  }
  const container = document.querySelector(incomeContainerSelector());
  if (!container) {
    removeFloatOverlay();
    lastIncomeSnapshot = "";
    return;
  }
  const rows = readIncomeRows(container);
  if (rows.length === 0) {
    removeFloatOverlay();
    lastIncomeSnapshot = "";
    return;
  }
  const snapshot = snapshotIncomeRows(rows);
  if (snapshot === lastIncomeSnapshot && document.getElementById(FLOAT_ID)) {
    positionFloatOverlay();
    return;
  }
  lastIncomeSnapshot = snapshot;
  const settings = await getSettings();
  renderCheckColumn(container, settings, rows);
}

export function mountOrderDetailCheck() {
  if (!isShopeeOrderDetailUrl()) return;
  if (!checkObserverBound) {
    checkObserverBound = true;
    observeDomChanges(() => {
      void refreshOrderCheck();
    });
  }
  void refreshOrderCheck();
}
