import {
    formatCommissionPercent,
    lookupCategoryCommission,
    readProductCategoryPath,
} from '../../pricing/category-commission.js';
import { formatVnd } from '../../pricing/formula-engine.js';
import { evaluateOrderProfit, resolvePricingTarget, solveMinUnitPriceByTarget, } from '../../pricing/order-profit.js';
import { evaluateTiers } from '../../pricing/wholesale-tiers.js';
import { getSettings, saveSettings } from '../../shared/storage.js';
const POPUP_HOST_ID = 'bigseller-ai-pricing-popup-host';
const FAB_ID = 'bigseller-ai-pricing-fab';
export class PricingPopup {
    host;
    shadow;
    visible = false;
    settings = null;
    categoryLookup = null;
    saveTimer = null;
    commissionListener = null;
    constructor() {
        const existing = document.getElementById(POPUP_HOST_ID);
        if (existing)
            existing.remove();
        this.host = document.createElement('div');
        this.host.id = POPUP_HOST_ID;
        this.host.style.display = 'none';
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        document.body.appendChild(this.host);
        void this.loadAndRender();
    }
    toggle() {
        this.visible = !this.visible;
        this.host.style.display = this.visible ? 'block' : 'none';
        this.host.dataset.open = this.visible ? 'true' : 'false';
        if (this.visible)
            void this.loadAndRender();
    }
    async loadAndRender() {
        this.settings = await getSettings();
        this.applyCategoryCommissionFromPage();
        this.render();
        this.bindEvents();
        this.updateResults();
    }
    applyCategoryCommissionFromPage() {
        if (!this.settings)
            return null;
        const path = readProductCategoryPath();
        if (!path)
            return null;
        const lookup = lookupCategoryCommission(path);
        if (lookup.rate == null)
            return lookup;
        this.settings.platformFeeConfig.commissionRate = lookup.rate;
        this.categoryLookup = lookup;
        return lookup;
    }
    scheduleSave() {
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.persist(), 400);
    }
    async persist() {
        if (!this.settings)
            return;
        await saveSettings({
            pricingCalculator: this.settings.pricingCalculator,
            platformFeeConfig: this.settings.platformFeeConfig,
        });
    }
    readForm() {
        if (!this.settings)
            return;
        const calc = this.settings.pricingCalculator;
        const fee = this.settings.platformFeeConfig;
        const num = (id) => Number(this.shadow.getElementById(id)?.value) || 0;
        calc.costPerUnit = num('cost');
        const profitRaw = this.shadow.getElementById('profit')?.value ?? '';
        calc.useProfitTarget = profitRaw.trim() !== '';
        calc.desiredProfitPerUnit = calc.useProfitTarget ? Number(profitRaw) || 0 : 0;
        calc.desiredNetReceivePerUnit = num('net-receive');
        fee.commissionRate = num('commission') / 100;
        fee.paymentFeeRate = num('payment') / 100;
        fee.voucherXtraRate = num('voucher-xtra') / 100;
        fee.useVoucherXtra =
            this.shadow.getElementById('use-voucher-xtra')
                ?.checked ?? false;
        fee.infrastructureFeePerOrder = num('infra');
        fee.vatRate = num('vat') / 100;
        fee.pitRate = num('pit') / 100;
        fee.usePiShip =
            this.shadow.getElementById('use-piship')?.checked ??
                false;
        calc.wholesaleTiers = [];
        for (let i = 0; i < 5; i++) {
            calc.wholesaleTiers.push({
                qtyMin: num(`tier-${i}-min`),
                qtyMax: num(`tier-${i}-max`),
                unitPrice: 0,
            });
        }
    }
    render() {
        if (!this.settings)
            return;
        const { pricingCalculator: c, platformFeeConfig: f } = this.settings;
        const catHint = this.categoryCommissionHintHtml();
        const tierRows = c.wholesaleTiers
            .map((t, i) => `
        <tr data-tier="${i}">
          <td class="tier-label">Bậc ${i + 1}</td>
          <td><input type="number" id="tier-${i}-min" min="0" step="1" value="${t.qtyMin || ''}" placeholder="Min" /></td>
          <td><input type="number" id="tier-${i}-max" min="0" step="1" value="${t.qtyMax || ''}" placeholder="Max" /></td>
          <td class="tier-price" id="tier-${i}-computed">—</td>
        </tr>`)
            .join('');
        this.shadow.innerHTML = `
      <style>${POPUP_STYLES}</style>
      <div class="pricing-popup" role="dialog" aria-label="Tính giá">
        <header class="popup-header">
          <span class="title">Tính giá</span>
          <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
        </header>
        <div class="popup-body">
          <section class="section">
            <h3>Sản phẩm</h3>
            <label class="field"><span>Giá vốn (đ/sp)</span>
              <input type="number" id="cost" min="0" step="100" value="${c.costPerUnit}" /></label>
            <label class="field"><span>Lợi nhuận mong muốn (đ/sp)</span>
              <input type="number" id="profit" min="0" step="1000" value="${c.useProfitTarget ? (c.desiredProfitPerUnit || '') : ''}" placeholder="Tuỳ chọn" /></label>
            <label class="field"><span>Giá muốn nhận về (đ/sp)</span>
              <input type="number" id="net-receive" min="0" step="1000" value="${c.desiredNetReceivePerUnit || ''}" placeholder="Khi không nhập lợi nhuận" /></label>
            <p class="field-hint">Nhận về = tiền về sau phí sàn (chưa trừ vốn). Ship do sàn tự chọn — không nhập.</p>
          </section>
          <section class="section results retail-box" id="retail-results"></section>
          <section class="section">
            <h3>Phí sàn Shopee (cùng công thức đối soát đơn)</h3>
            ${catHint}
            <div class="fee-grid">
              <label class="field"><span>Phí cố định %</span>
                <input type="number" id="commission" min="0" max="100" step="0.1" value="${(f.commissionRate * 100).toFixed(2)}" /></label>
              <label class="field"><span>Phí xử lý GD %</span>
                <input type="number" id="payment" min="0" max="100" step="0.1" value="${(f.paymentFeeRate * 100).toFixed(2)}" /></label>
              <label class="field"><span>Phí hạ tầng (đ/đơn)</span>
                <input type="number" id="infra" min="0" step="100" value="${f.infrastructureFeePerOrder}" /></label>
            </div>
            <label class="check"><input type="checkbox" id="use-voucher-xtra" ${f.useVoucherXtra ? 'checked' : ''} />
              Voucher Xtra <input type="number" id="voucher-xtra" min="0" max="100" step="0.1" value="${(f.voucherXtraRate * 100).toFixed(2)}" />%</label>
            <label class="check"><input type="checkbox" id="use-piship" ${f.usePiShip ? 'checked' : ''} />
              PiShip (+${f.piShipFeePerOrder}đ/đơn khi bật)</label>
            <div class="fee-grid">
              <label class="field"><span>Thuế GTGT % (tiền hàng)</span>
                <input type="number" id="vat" min="0" max="100" step="0.1" value="${((f.vatRate ?? 0) * 100).toFixed(2)}" /></label>
              <label class="field"><span>Thuế TNCN % (tiền hàng)</span>
                <input type="number" id="pit" min="0" max="100" step="0.1" value="${((f.pitRate ?? 0) * 100).toFixed(2)}" /></label>
            </div>
          </section>
          <section class="section">
            <h3>Giá buôn theo số lượng</h3>
            <table class="tier-table">
              <thead><tr><th></th><th>Min SL</th><th>Max SL</th><th>Giá đề xuất/sp</th></tr></thead>
              <tbody>${tierRows}</tbody>
            </table>
            <div id="tier-results" class="tier-results"></div>
          </section>
        </div>
      </div>
    `;
    }
    categoryCommissionHintHtml() {
        const lookup =
            this.categoryLookup ??
            (readShopeeProductCategoryPath()
                ? lookupCategoryCommission(readShopeeProductCategoryPath())
                : null);
        if (!lookup?.raw)
            return '';
        const pct = formatCommissionPercent(lookup.rate);
        if (!pct) {
            return `<p class="cat-fee-warn">Danh mục: ${this.escapeHtml(lookup.raw)} — chưa có trong biểu phí, nhập % thủ công.</p>`;
        }
        return `<p class="cat-fee-auto">Danh mục SP: <strong>${this.escapeHtml(lookup.raw)}</strong> → phí cố định <strong class="fee-pct">${pct}</strong></p>`;
    }
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    bindEvents() {
        this.commissionListener?.();
        this.commissionListener = () => {
            window.removeEventListener('bigseller-ai:commission-rate', this.onCommissionFromPage);
        };
        window.addEventListener('bigseller-ai:commission-rate', this.onCommissionFromPage);
        this.shadow.getElementById('close-btn')?.addEventListener('click', () => {
            this.visible = false;
            this.host.style.display = 'none';
            this.host.dataset.open = 'false';
        });
        const onInput = () => {
            this.readForm();
            this.updateResults();
            this.scheduleSave();
        };
        this.shadow.querySelectorAll('input').forEach((el) => {
            el.addEventListener('input', onInput);
            el.addEventListener('change', onInput);
        });
    }
    onCommissionFromPage = (ev) => {
        const rate = ev.detail?.rate;
        if (rate == null || !this.settings)
            return;
        this.settings.platformFeeConfig.commissionRate = rate;
        const input = this.shadow.getElementById('commission');
        if (input)
            input.value = (rate * 100).toFixed(2);
        this.applyCategoryCommissionFromPage();
        const hint = this.shadow.querySelector('.cat-fee-auto, .cat-fee-warn');
        if (hint) {
            const html = this.categoryCommissionHintHtml();
            if (html)
                hint.outerHTML = html;
        }
        this.updateResults();
    };
    formatSettlementHint(s) {
        return `Phụ phí ${formatVnd(s.platformFeesTotal)} · Thuế ${formatVnd(s.taxTotal)} · Thu nhập ${formatVnd(s.sellerIncome)}`;
    }
    updateResults() {
        if (!this.settings)
            return;
        const c = this.settings.pricingCalculator;
        const f = this.settings.platformFeeConfig;
        const target = resolvePricingTarget(c);
        const retailPrice = target
            ? solveMinUnitPriceByTarget(1, c.costPerUnit, target, f)
            : null;
        const retailEl = this.shadow.getElementById('retail-results');
        if (retailEl) {
            if (!target) {
                retailEl.innerHTML =
                    '<p class="error">Nhập lợi nhuận mong muốn hoặc giá muốn nhận về (đ/sp).</p>';
            }
            else if (retailPrice == null) {
                retailEl.innerHTML =
                    '<p class="error">Không tính được giá — giảm % phí hoặc mục tiêu nhập.</p>';
            }
            else {
                const ev = evaluateOrderProfit({
                    quantity: 1,
                    unitPrice: retailPrice,
                    costPerUnit: c.costPerUnit,
                    feeConfig: f,
                });
                const s = ev.settlement;
                const incomePerUnit = Math.round(ev.sellerIncome);
                const outcomeLine = target.kind === 'profit'
                    ? `<p class="ok">Lời sau phí: <strong>${formatVnd(Math.round(ev.profitPerUnit))}/sp</strong> (mục tiêu ${formatVnd(target.perUnit)})</p>`
                    : `<p class="ok">Nhận về: <strong>${formatVnd(incomePerUnit)}/sp</strong> (mục tiêu ${formatVnd(target.perUnit)}) · Lời ${formatVnd(Math.round(ev.profitPerUnit))}/sp</p>`;
                retailEl.innerHTML = `
          <h3>Giá bán lẻ (1 SP)</h3>
          <p class="retail-price">${formatVnd(retailPrice)}</p>
          <p class="muted">${this.formatSettlementHint(s)}</p>
          ${outcomeLine}
        `;
            }
        }
        const tierEl = this.shadow.getElementById('tier-results');
        if (!tierEl)
            return;
        const evals = evaluateTiers(c.wholesaleTiers, c.costPerUnit, c, f);
        if (evals.length === 0) {
            tierEl.innerHTML = '<p class="muted">Nhập ít nhất một bậc (min ≤ max, SL &gt; 0).</p>';
            return;
        }
        for (let i = 0; i < 5; i++) {
            const cell = this.shadow.getElementById(`tier-${i}-computed`);
            const tier = c.wholesaleTiers[i];
            if (!cell || !tier)
                continue;
            const valid = tier.qtyMin > 0 && tier.qtyMax >= tier.qtyMin;
            const price = valid && target
                ? solveMinUnitPriceByTarget(tier.qtyMin, c.costPerUnit, target, f)
                : null;
            cell.textContent = price != null ? formatVnd(price) : '—';
            cell.className = price != null ? 'tier-price ok' : 'tier-price';
        }
        tierEl.innerHTML = evals
            .map((e) => {
            if (e.computedUnitPrice <= 0) {
                return `<div class="tier-card"><strong>Bậc ${e.tierIndex}</strong> (${e.qtyMin}–${e.qtyMax} SP)<br/><span class="error">Không tính được — kiểm tra % phí</span></div>`;
            }
            return `<div class="tier-card">
          <strong>Bậc ${e.tierIndex}</strong> — khách mua ${e.qtyMin}–${e.qtyMax} sp
          <p class="tier-price-lg">${formatVnd(e.computedUnitPrice)}<span class="per">/sp</span></p>
          <p class="tier-outcome-label">Nếu khách mua đúng ${e.qtyMin} sp:</p>
          <ul class="tier-stats">
            <li>Tiền về sau phí sàn: <strong>${formatVnd(e.netReceivePerUnitAtMin)}/sp</strong></li>
            <li>Lãi còn lại (trừ giá vốn): <strong>${formatVnd(e.profitPerUnitAtMin)}/sp</strong></li>
          </ul>
        </div>`;
        })
            .join('');
    }
}
const POPUP_STYLES = `
  :host {
    all: initial;
    position: fixed;
    bottom: 88px;
    right: 56px;
    z-index: 2147483646;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
    pointer-events: none;
    max-height: min(85vh, 720px);
  }
  :host([data-open="true"]) { pointer-events: auto; }
  .pricing-popup {
    display: flex;
    flex-direction: column;
    width: min(400px, calc(100vw - 32px));
    max-height: min(85vh, 720px);
    overflow: hidden;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.18);
    border: 1px solid #e5e7eb;
    pointer-events: auto;
  }
  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 10px 14px;
    background: linear-gradient(135deg, #ee4d2d, #ff7337);
    color: #fff;
    border-radius: 12px 12px 0 0;
  }
  .title { font-weight: 700; font-size: 14px; }
  .btn-close {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 22px;
    cursor: pointer;
    line-height: 1;
    padding: 0 4px;
  }
  .popup-body {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 12px 14px;
    scrollbar-gutter: stable;
  }
  .popup-body::-webkit-scrollbar { width: 8px; }
  .popup-body::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;
  }
  .popup-body::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
  .section { margin-bottom: 14px; }
  .section h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 700;
    color: #374151;
  }
  .field { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
  .field span { font-size: 11px; font-weight: 600; color: #6b7280; }
  .field-hint {
    margin: -4px 0 8px;
    font-size: 10px;
    color: #9ca3af;
    line-height: 1.35;
  }
  .field input, .tier-table input {
    padding: 6px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
  }
  .fee-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin: 6px 0;
    flex-wrap: wrap;
  }
  .check input[type="number"] { width: 56px; padding: 4px 6px; }
  .tier-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .tier-table th, .tier-table td { padding: 4px; text-align: left; }
  .tier-label { font-weight: 600; color: #6b7280; white-space: nowrap; }
  .tier-price {
    font-weight: 700;
    color: #047857;
    font-size: 12px;
    white-space: nowrap;
  }
  .tier-price-lg {
    margin: 4px 0;
    font-size: 18px;
    font-weight: 800;
    color: #047857;
  }
  .tier-price-lg .per { font-size: 12px; font-weight: 600; color: #6b7280; }
  .tier-results { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .tier-card {
    padding: 8px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    font-size: 12px;
    line-height: 1.5;
  }
  .tier-outcome-label {
    margin: 6px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: #374151;
  }
  .tier-stats {
    margin: 0;
    padding-left: 18px;
    color: #047857;
    font-size: 12px;
  }
  .tier-stats li { margin: 2px 0; }
  .tier-stats strong { font-weight: 700; }
  .retail-box {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 10px;
    padding: 12px;
  }
  .retail-box h3 { margin: 0 0 6px; font-size: 12px; color: #065f46; }
  .retail-price {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 800;
    color: #047857;
  }
  .highlight { color: #047857; font-weight: 600; margin: 0 0 6px; }
  .ok { color: #047857; font-weight: 600; }
  .warn { color: #b45309; font-weight: 600; }
  .error { color: #b91c1c; margin: 0; }
  .muted { color: #6b7280; font-size: 11px; }
  .cat-fee-auto {
    margin: 0 0 8px;
    padding: 6px 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
    color: #7f1d1d;
  }
  .cat-fee-auto .fee-pct { color: #dc2626; }
  .cat-fee-warn {
    margin: 0 0 8px;
    padding: 6px 8px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    font-size: 11px;
    color: #92400e;
  }
`;
let popupInstance = null;
export function getPricingPopup() {
    if (!popupInstance)
        popupInstance = new PricingPopup();
    return popupInstance;
}
export function mountPricingFab() {
    if (document.getElementById(FAB_ID))
        return;
    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.type = 'button';
    btn.title = 'Tính giá';
    btn.setAttribute('aria-label', 'Tính giá');
    btn.innerHTML = `<span class="fab-dollar">$</span>`;
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '88px',
        right: '56px',
        zIndex: '2147483645',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        border: 'none',
        background: 'linear-gradient(135deg, #ee4d2d, #ff7337)',
        color: '#fff',
        fontWeight: '700',
        fontSize: '22px',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(238,77,45,.4)',
        lineHeight: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    });
    const popup = getPricingPopup();
    btn.addEventListener('click', () => {
        popup.toggle();
        const host = document.getElementById(POPUP_HOST_ID);
        if (host) {
            host.dataset.open = host.style.display !== 'none' ? 'true' : 'false';
        }
    });
    document.body.appendChild(btn);
}
