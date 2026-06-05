import {
    formatCommissionPercent,
    lookupCategoryCommission,
    readProductCategoryPath,
} from '../../pricing/category-commission.js';
import { formatVnd } from '../../pricing/formula-engine.js';
import { formatPriceInputValue, parsePriceInput } from '../../pricing/price-input.js';
import { buildPricingOrderInput, evaluateOrderProfit, pricingOrderOptsFromCalc, resolvePricingTarget, solveMinUnitPriceByTarget, } from '../../pricing/order-profit.js';
import { evaluateTiers } from '../../pricing/wholesale-tiers.js';
import {
    isExtensionContextAlive,
    notifyExtensionReloadNeeded,
} from '../../shared/extension-context.js';
import { getSettings, saveSettings } from '../../shared/storage.js';
const POPUP_HOST_ID = 'bigseller-ai-pricing-popup-host';
const FAB_ID = 'bigseller-ai-pricing-fab';
/** Ô nhập giá VND — hỗ trợ 55k, 26,7k, 55.000 */
const PRICE_FIELD_IDS = [
    'cost',
    'profit',
    'net-receive',
    'sell-price',
    'cost-receive',
    'infra',
    'shop-discount',
];
/** @typedef {'sell' | 'receive'} PricingPopupTab */

export class PricingPopup {
    host;
    shadow;
    visible = false;
    /** @type {PricingPopupTab} */
    activeTab = 'sell';
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
        if (!isExtensionContextAlive()) {
            notifyExtensionReloadNeeded();
            this.renderReloadHint();
            return;
        }
        try {
            this.settings = await getSettings();
            this.applyCategoryCommissionFromPage();
            this.render();
            this.bindEvents();
            this.updateResults();
        }
        catch {
            notifyExtensionReloadNeeded();
            this.renderReloadHint();
        }
    }
    renderReloadHint() {
        this.host.style.display = this.visible ? 'block' : 'none';
        this.shadow.innerHTML = `
      <style>${POPUP_STYLES}</style>
      <div class="pricing-popup" role="alert">
        <header class="popup-header">
          <span class="title">Tính giá</span>
          <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
        </header>
        <div class="popup-body">
          <p class="cat-fee-warn" style="margin:12px">
            Extension vừa được cập nhật hoặc reload. Vui lòng <strong>F5</strong> trang này rồi bấm nút $ lại.
          </p>
        </div>
      </div>`;
        this.shadow.getElementById('close-btn')?.addEventListener('click', () => {
            this.visible = false;
            this.host.style.display = 'none';
            this.host.dataset.open = 'false';
        });
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
        try {
            await saveSettings({
                pricingCalculator: this.settings.pricingCalculator,
                platformFeeConfig: this.settings.platformFeeConfig,
            });
        }
        catch {
            /* extension context invalidated */
        }
    }
    readForm() {
        if (!this.settings)
            return;
        const calc = this.settings.pricingCalculator;
        const fee = this.settings.platformFeeConfig;
        const num = (id) => Number(this.shadow.getElementById(id)?.value) || 0;
        const price = (id) =>
            parsePriceInput(this.shadow.getElementById(id)?.value);
        const costSell = price('cost');
        const costRecv = price('cost-receive');
        calc.costPerUnit =
            this.activeTab === 'receive'
                ? costRecv || costSell
                : costSell || costRecv;
        const profitRaw = this.shadow.getElementById('profit')?.value ?? '';
        calc.useProfitTarget = profitRaw.trim() !== '';
        calc.desiredProfitPerUnit = calc.useProfitTarget
            ? parsePriceInput(profitRaw)
            : 0;
        calc.desiredNetReceivePerUnit = price('net-receive');
        calc.retailUnitPrice = price('sell-price');
        calc.receiveQuantity = Math.max(1, Math.floor(num('receive-qty')) || 1);
        calc.shopDiscountPerOrder = price('shop-discount');
        fee.commissionRate = num('commission') / 100;
        fee.paymentFeeRate = num('payment') / 100;
        fee.voucherXtraRate = num('voucher-xtra') / 100;
        fee.useVoucherXtra =
            this.shadow.getElementById('use-voucher-xtra')
                ?.checked ?? false;
        fee.infrastructureFeePerOrder = price('infra');
        fee.vatRate = num('vat') / 100;
        fee.pitRate = num('pit') / 100;
        fee.usePiShip =
            this.shadow.getElementById('use-piship')?.checked ??
                false;
        fee.useNttdInPricing =
            this.shadow.getElementById('use-nttd')?.checked ?? true;
        fee.nttdDisplayRate = num('nttd') / 100;
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
        const sellActive = this.activeTab === 'sell';
        const receiveActive = this.activeTab === 'receive';
        this.shadow.innerHTML = `
      <style>${POPUP_STYLES}</style>
      <div class="pricing-popup" role="dialog" aria-label="Tính giá">
        <header class="popup-header">
          <span class="title">Tính giá</span>
          <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
        </header>
        <nav class="tab-bar" role="tablist">
          <button type="button" class="tab-btn${sellActive ? ' active' : ''}" role="tab" data-tab="sell" aria-selected="${sellActive}">
            Tính giá bán
          </button>
          <button type="button" class="tab-btn${receiveActive ? ' active' : ''}" role="tab" data-tab="receive" aria-selected="${receiveActive}">
            Tính giá thực nhận
          </button>
        </nav>
        <div class="popup-body">
          <div class="tab-panel" data-panel="sell"${sellActive ? '' : ' hidden'}>
            <section class="section">
              <h3>Sản phẩm</h3>
              <label class="field"><span>Giá vốn (đ/sp)</span>
                <input type="text" inputmode="decimal" id="cost" autocomplete="off" value="${c.costPerUnit || ''}" placeholder="VD: 6,3k hoặc 6300" /></label>
              <label class="field"><span>Lợi nhuận mong muốn (đ/sp)</span>
                <input type="text" inputmode="decimal" id="profit" autocomplete="off" value="${c.useProfitTarget ? (c.desiredProfitPerUnit || '') : ''}" placeholder="VD: 10k" /></label>
              <label class="field"><span>Giá muốn nhận về (đ/sp)</span>
                <input type="text" inputmode="decimal" id="net-receive" autocomplete="off" value="${c.desiredNetReceivePerUnit || ''}" placeholder="VD: 15k" /></label>
              <p class="field-hint">Nhận về = tiền về sau phí sàn (chưa trừ vốn). Có thể gõ tắt: 55k, 26,7k, 55.000.</p>
            </section>
            <section class="section results retail-box" id="retail-results"></section>
            <section class="section">
              <h3>Giá buôn theo số lượng</h3>
              <table class="tier-table">
                <thead><tr><th></th><th>Min SL</th><th>Max SL</th><th>Giá đề xuất/sp</th></tr></thead>
                <tbody>${tierRows}</tbody>
              </table>
              <div id="tier-results" class="tier-results"></div>
            </section>
          </div>
          <div class="tab-panel" data-panel="receive"${receiveActive ? '' : ' hidden'}>
            <section class="section">
              <h3>Giá đang bán</h3>
              <div class="fee-grid">
                <label class="field"><span>Giá bán hiện tại (đ/sp)</span>
                  <input type="text" inputmode="decimal" id="sell-price" autocomplete="off" value="${c.retailUnitPrice || ''}" placeholder="VD: 25k" /></label>
                <label class="field"><span>Số lượng (SP/đơn)</span>
                  <input type="number" id="receive-qty" min="1" step="1" value="${c.receiveQuantity || 1}" /></label>
              </div>
              <label class="field"><span>Giá vốn (đ/sp)</span>
                <input type="text" inputmode="decimal" id="cost-receive" autocomplete="off" value="${c.costPerUnit || ''}" placeholder="VD: 6,3k" /></label>
              <p class="field-hint">Nhập giá đang niêm yết + số lượng — tính thực nhận và lãi theo đơn (cùng công thức đối soát). Gõ tắt: 55k, 26,7k.</p>
            </section>
            <section class="section results receive-box" id="receive-results"></section>
          </div>
          <section class="section fees-shared">
            <h3>Phí sàn Shopee (cùng công thức đối soát đơn)</h3>
            ${catHint}
            <label class="field"><span>Trợ giá / mã shop (đ/đơn)</span>
              <input type="text" inputmode="decimal" id="shop-discount" autocomplete="off" value="${c.shopDiscountPerOrder || ''}" placeholder="VD: 7244 (VX tính sau khoản này)" /></label>
            <div class="fee-grid">
              <label class="field"><span>Phí cố định</span>
                <span class="input-suffix-wrap"><input type="number" id="commission" min="0" max="100" step="0.1" value="${(f.commissionRate * 100).toFixed(2)}" /><span class="input-suffix">%</span></span></label>
              <label class="field"><span>Phí xử lý GD</span>
                <span class="input-suffix-wrap"><input type="number" id="payment" min="0" max="100" step="0.1" value="${(f.paymentFeeRate * 100).toFixed(2)}" /><span class="input-suffix">%</span></span></label>
              <label class="field"><span>Phí hạ tầng (đ/đơn)</span>
                <input type="text" inputmode="decimal" id="infra" autocomplete="off" value="${f.infrastructureFeePerOrder || ''}" placeholder="VD: 3k" /></label>
            </div>
            <label class="check"><input type="checkbox" id="use-voucher-xtra" ${f.useVoucherXtra ? 'checked' : ''} />
              Voucher Xtra <span class="input-suffix-wrap inline"><input type="number" id="voucher-xtra" min="0" max="100" step="0.1" value="${(f.voucherXtraRate * 100).toFixed(2)}" /><span class="input-suffix">%</span></span></label>
            <label class="check"><input type="checkbox" id="use-piship" ${f.usePiShip ? 'checked' : ''} />
              PiShip (+${f.piShipFeePerOrder}đ/đơn khi bật)</label>
            <label class="check"><input type="checkbox" id="use-nttd" ${f.useNttdInPricing !== false ? 'checked' : ''} />
              Phí dịch vụ hiển thị NTTD <span class="input-suffix-wrap inline"><input type="number" id="nttd" min="0" max="100" step="0.1" value="${((f.nttdDisplayRate ?? 0.01) * 100).toFixed(2)}" /><span class="input-suffix">%</span></span> (tiền hàng sau trợ giá)</label>
            <div class="fee-grid">
              <label class="field"><span>Thuế GTGT (tiền hàng)</span>
                <span class="input-suffix-wrap"><input type="number" id="vat" min="0" max="100" step="0.1" value="${((f.vatRate ?? 0) * 100).toFixed(2)}" /><span class="input-suffix">%</span></span></label>
              <label class="field"><span>Thuế TNCN (tiền hàng)</span>
                <span class="input-suffix-wrap"><input type="number" id="pit" min="0" max="100" step="0.1" value="${((f.pitRate ?? 0) * 100).toFixed(2)}" /><span class="input-suffix">%</span></span></label>
            </div>
          </section>
        </div>
      </div>
    `;
    }
    categoryCommissionHintHtml() {
        try {
            const path = readProductCategoryPath();
            const lookup =
                this.categoryLookup ??
                (path ? lookupCategoryCommission(path) : null);
            if (!lookup?.raw)
                return '';
            const pct = formatCommissionPercent(lookup.rate);
            if (!pct) {
                return `<p class="cat-fee-warn">Danh mục: ${this.escapeHtml(lookup.raw)} — chưa có trong biểu phí, nhập % thủ công.</p>`;
            }
            return `<p class="cat-fee-auto">Danh mục SP: <strong>${this.escapeHtml(lookup.raw)}</strong> → phí cố định <strong class="fee-pct">${pct}</strong></p>`;
        }
        catch {
            return '';
        }
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
        for (const id of PRICE_FIELD_IDS) {
            const el = this.shadow.getElementById(id);
            if (!el)
                continue;
            el.addEventListener('blur', () => {
                const formatted = formatPriceInputValue(el.value);
                if (formatted !== '' && formatted !== el.value)
                    el.value = formatted;
                onInput();
            });
        }
        const syncCostFields = (sourceId, targetId) => {
            const src = this.shadow.getElementById(sourceId);
            const tgt = this.shadow.getElementById(targetId);
            if (!src || !tgt)
                return;
            src.addEventListener('input', () => {
                tgt.value = src.value;
            });
        };
        syncCostFields('cost', 'cost-receive');
        syncCostFields('cost-receive', 'cost');
        this.shadow.querySelectorAll('[data-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab !== 'sell' && tab !== 'receive' || tab === this.activeTab)
                    return;
                this.readForm();
                this.activeTab = tab;
                const cost = this.settings?.pricingCalculator.costPerUnit ?? 0;
                const costSellEl = this.shadow.getElementById('cost');
                const costRecvEl = this.shadow.getElementById('cost-receive');
                if (costSellEl)
                    costSellEl.value = String(cost);
                if (costRecvEl)
                    costRecvEl.value = String(cost);
                this.shadow
                    .querySelectorAll('[data-tab]')
                    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
                this.shadow.querySelectorAll('[data-tab]').forEach((b) => {
                    b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
                });
                this.shadow.querySelectorAll('[data-panel]').forEach((panel) => {
                    panel.hidden = panel.dataset.panel !== tab;
                });
                this.updateResults();
            });
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
        const nttd =
            s.nttdDisplay > 0
                ? ` · NTTD ${formatVnd(s.nttdDisplay)}`
                : '';
        return `Phụ phí ${formatVnd(s.platformFeesTotal)}${nttd} · Thuế ${formatVnd(s.taxTotal)} · Thu nhập ${formatVnd(s.sellerIncome)}`;
    }
    updateReceiveResults() {
        if (!this.settings)
            return;
        const c = this.settings.pricingCalculator;
        const f = this.settings.platformFeeConfig;
        const receiveEl = this.shadow.getElementById('receive-results');
        if (!receiveEl)
            return;
        const price = c.retailUnitPrice ?? 0;
        const qty = Math.max(1, Math.floor(c.receiveQuantity ?? 1));
        if (!price || price <= 0) {
            receiveEl.innerHTML =
                '<p class="error">Nhập giá bán hiện tại (đ/sp).</p>';
            return;
        }
        const ev = evaluateOrderProfit(
            buildPricingOrderInput({
                quantity: qty,
                unitPrice: price,
                costPerUnit: c.costPerUnit,
                feeConfig: f,
                pricingCalculator: c,
            }),
        );
        const s = ev.settlement;
        const netTotal = Math.round(ev.sellerIncome);
        const netPerUnit = Math.round(ev.sellerIncome / qty);
        const profitTotal = Math.round(ev.totalProfit);
        const profitPerUnit = Math.round(ev.profitPerUnit);
        const qtyLine =
            qty > 1
                ? `<p class="ok">Thực nhận tổng (${qty} sp): <strong>${formatVnd(netTotal)}</strong></p>`
                : '';
        const profitBlock =
            c.costPerUnit > 0
                ? `<p class="ok">Tổng lãi sau vốn (${qty} sp): <strong>${formatVnd(profitTotal)}</strong></p>
          <p class="ok">Lãi/sp (tổng lãi ÷ SL): <strong>${formatVnd(profitPerUnit)}/sp</strong></p>`
                : '<p class="muted">Nhập giá vốn để xem tổng lãi và lãi/sp.</p>';
        receiveEl.innerHTML = `
          <h3>Thực nhận — ${qty} sp × ${formatVnd(price)}</h3>
          <p class="receive-price">${formatVnd(netPerUnit)}<span class="per">/sp</span></p>
          ${qtyLine}
          <p class="muted">${this.formatSettlementHint(s)}</p>
          ${profitBlock}
        `;
    }
    updateResults() {
        if (!this.settings)
            return;
        if (this.activeTab === 'receive') {
            this.updateReceiveResults();
            return;
        }
        const c = this.settings.pricingCalculator;
        const f = this.settings.platformFeeConfig;
        const orderOpts = pricingOrderOptsFromCalc(f, c);
        const target = resolvePricingTarget(c);
        const retailPrice = target
            ? solveMinUnitPriceByTarget(1, c.costPerUnit, target, f, orderOpts)
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
                const ev = evaluateOrderProfit(
                    buildPricingOrderInput({
                        quantity: 1,
                        unitPrice: retailPrice,
                        costPerUnit: c.costPerUnit,
                        feeConfig: f,
                        pricingCalculator: c,
                    }),
                );
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
        const evals = evaluateTiers(c.wholesaleTiers, c.costPerUnit, c, f, orderOpts);
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
                ? solveMinUnitPriceByTarget(tier.qtyMin, c.costPerUnit, target, f, orderOpts)
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
  .tab-bar {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .tab-btn {
    flex: 1;
    padding: 9px 8px;
    border: none;
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    line-height: 1.3;
  }
  .tab-btn:hover { color: #374151; background: #f3f4f6; }
  .tab-btn.active {
    color: #ee4d2d;
    background: #fff;
    border-bottom-color: #ee4d2d;
  }
  .tab-panel[hidden] { display: none; }
  .fees-shared { margin-top: 4px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
  .title { font-weight: 700; font-size: 14px; }
  .btn-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
    font-size: 28px;
    font-weight: 400;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .btn-close:hover {
    background: rgba(255, 255, 255, 0.38);
  }
  .btn-close:active {
    background: rgba(0, 0, 0, 0.12);
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
  .input-suffix-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .input-suffix-wrap.inline { width: auto; flex-shrink: 0; }
  .input-suffix-wrap input { flex: 1; min-width: 0; }
  .input-suffix-wrap.inline input {
    flex: none;
    width: 56px;
    padding: 4px 6px;
  }
  .input-suffix {
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    flex-shrink: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin: 6px 0;
    flex-wrap: wrap;
  }
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
  .receive-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px;
  }
  .receive-box h3 { margin: 0 0 6px; font-size: 12px; color: #1e40af; }
  .retail-price {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 800;
    color: #047857;
  }
  .receive-price {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 800;
    color: #1d4ed8;
  }
  .receive-price .per {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
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

function disposePricingPopup() {
    popupInstance?.host?.remove();
    popupInstance = null;
}

export function getPricingPopup() {
    if (!isExtensionContextAlive()) {
        disposePricingPopup();
        notifyExtensionReloadNeeded();
        return null;
    }
    if (!popupInstance)
        popupInstance = new PricingPopup();
    return popupInstance;
}
export function mountPricingFab() {
    if (!isExtensionContextAlive()) {
        notifyExtensionReloadNeeded();
        return;
    }
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
    btn.addEventListener('click', () => {
        const popup = getPricingPopup();
        if (!popup)
            return;
        popup.toggle();
        const host = document.getElementById(POPUP_HOST_ID);
        if (host) {
            host.dataset.open = host.style.display !== 'none' ? 'true' : 'false';
        }
    });
    document.body.appendChild(btn);
}
