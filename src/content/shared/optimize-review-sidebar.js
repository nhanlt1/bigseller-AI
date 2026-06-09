import { MessageType, safeSendResponse } from '../../shared/messaging.js';
import { formatVnd } from '../../pricing/formula-engine.js';
import {
    buildPricingOrderInput,
    evaluateOrderProfit,
} from '../../pricing/order-profit.js';
import { parsePriceInput, formatPriceInputValue } from '../../pricing/price-input.js';
import { computeComboUnitPrices, computeMinSellPrice } from '../../shared/optimize-pricing.js';
import { getSettings } from '../../shared/storage.js';
import { parsePriceRange } from '../shopee/similar-products-scraper.js';

const HOST_ID = 'bigseller-ai-optimize-review-host';
const SESSION_KEY = 'bigseller-ai-optimize-review';

function normalizeProductKeyPart(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {{ itemId?: string, shopId?: string, title?: string }} product
 */
export function buildOptimizeProductKey(product) {
    const itemId = String(product?.itemId ?? '').trim();
    const shopId = String(product?.shopId ?? '').trim();
    if (itemId && shopId)
        return `item:${shopId}:${itemId}`;
    if (itemId)
        return `item:${itemId}`;
    const title = normalizeProductKeyPart(product?.title);
    if (title)
        return `title:${title.slice(0, 96)}`;
    return '';
}

function readStoredReviewRaw() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}

function hasReviewContent(data) {
    if (!data)
        return false;
    const form = data.form ?? {};
    if (String(form.title ?? '').trim() || String(form.description ?? '').trim())
        return true;
    return Array.isArray(data.rows) && data.rows.length > 0;
}

/**
 * Khôi phục crawlResults từ session sidebar (cùng productKey) sau lỗi pipeline.
 * @param {string} productKey
 */
export function buildSessionCrawlResults(productKey) {
    if (!productKey)
        return null;
    const data = readStoredReviewRaw();
    if (!data || data.productKey !== productKey || !Array.isArray(data.rows) || !data.rows.length)
        return null;
    /** @type {Map<string, Record<string, unknown>[]>} */
    const byKeyword = new Map();
    for (const row of data.rows) {
        const keyword = String(row?.keyword ?? '').trim() || 'unknown';
        if (!byKeyword.has(keyword))
            byKeyword.set(keyword, []);
        byKeyword.get(keyword).push(row);
    }
    return [...byKeyword.entries()].map(([keyword, competitorsUi]) => ({
        keyword,
        competitors: competitorsUi,
        competitorsUi,
        sourcePosition: null,
    }));
}

/**
 * @param {string} productKey
 */
export function getStoredOptimizeKeywords(productKey) {
    const data = readStoredReviewRaw();
    if (!data || data.productKey !== productKey)
        return [];
    return Array.isArray(data.keywords) ? data.keywords : [];
}

/**
 * @param {string} productKey
 */
export function hasStoredOptimizeReview(productKey) {
    if (!productKey)
        return false;
    const data = readStoredReviewRaw();
    return data?.productKey === productKey && hasReviewContent(data);
}

/**
 * Mở lại sidebar với dữ liệu đã lưu (form + bảng SERP) cho cùng sản phẩm.
 * @param {string} productKey
 */
export function reopenStoredOptimizeReview(productKey) {
    if (!productKey)
        return false;
    const data = readStoredReviewRaw();
    if (!data || data.productKey !== productKey || !hasReviewContent(data))
        return false;
    const panel = ensurePanel();
    panel.applyStoredData(data);
    panel.host.dataset.open = '1';
    void panel.loadSettingsAndPaint();
    return true;
}
const WIDTH_KEY = 'bigseller-ai-optimize-sidebar-width';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 560;

const PANEL_CSS = `
  :host {
    all: initial;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2147483644;
    width: var(--sidebar-width, ${DEFAULT_WIDTH}px);
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    pointer-events: none;
    display: none;
  }
  :host([data-open="1"]) { display: block; }
  .shell {
    pointer-events: auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    box-shadow: -8px 0 24px rgba(0,0,0,.08);
  }
  .resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
    pointer-events: auto;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid #f3f4f6;
    background: linear-gradient(135deg, #ee4d2d 0%, #f97316 100%);
    color: #fff;
    flex-shrink: 0;
  }
  .header-title { font-size: 14px; font-weight: 700; }
  .btn-close {
    border: none;
    background: rgba(255,255,255,.2);
    color: #fff;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  .tab-bar {
    display: flex;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }
  .tab-btn {
    flex: 1;
    padding: 10px 8px;
    border: none;
    background: #f9fafb;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tab-btn.active {
    color: #ee4d2d;
    background: #fff;
    border-bottom-color: #ee4d2d;
  }
  .tab-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
  }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #374151;
    margin: 10px 0 4px;
  }
  label:first-child { margin-top: 0; }
  input[type="text"], textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 12px;
    font-family: inherit;
  }
  textarea { min-height: 120px; resize: vertical; line-height: 1.45; }
  .price-card {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
  }
  .price-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .price-row:last-child { margin-bottom: 0; }
  .price-label { font-weight: 600; color: #9a3412; min-width: 0; flex: 1 1 140px; }
  .price-value { font-weight: 700; color: #c2410c; }
  .price-input-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 160px;
  }
  .price-input-wrap input { flex: 1; min-width: 0; margin: 0; }
  .profit-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 4px 8px;
    border-radius: 6px;
    white-space: nowrap;
  }
  .profit-badge.positive { background: #dcfce7; color: #166534; }
  .profit-badge.negative { background: #fee2e2; color: #b91c1c; }
  .profit-badge.muted { background: #f3f4f6; color: #6b7280; }
  .warn {
    margin-top: 8px;
    font-size: 11px;
    color: #b45309;
  }
  .detail-line {
    font-size: 10px;
    color: #78716c;
    margin-top: 6px;
  }
  .combo-section {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed #fdba74;
  }
  .combo-title {
    font-size: 11px;
    font-weight: 700;
    color: #9a3412;
    margin: 0 0 6px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid #f3f4f6;
  }
  .btn {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    color: #111827;
  }
  .btn.primary { background: #ee4d2d; border-color: #ee4d2d; color: #fff; }
  .btn:hover:not(:disabled) { filter: brightness(0.97); }
  .btn:disabled { opacity: .55; cursor: not-allowed; }
  .kw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .kw-chip {
    padding: 4px 10px;
    border-radius: 999px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    font-size: 11px;
    color: #1d4ed8;
  }
  .status { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
  .table-scroll { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 6px 5px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f9fafb; font-weight: 600; position: sticky; top: 0; }
  .title-cell { max-width: 140px; word-break: break-word; }
  .btn-del {
    padding: 3px 6px;
    font-size: 10px;
    border: 1px solid #fecaca;
    background: #fef2f2;
    color: #b91c1c;
    border-radius: 4px;
    cursor: pointer;
  }
`;

/** @type {import('../bigseller/adapter.js').bigsellerAdapter | import('../shopee/adapter.js').shopeeAdapter | null} */
let productAdapter = null;
/** @type {OptimizeReviewPanel | null} */
let panelInstance = null;

class OptimizeReviewPanel {
    /** @type {ShadowRoot} */
    shadow;
    /** @type {HTMLElement} */
    host;
    state = {
        productKey: '',
        activeTab: 'result',
        keywords: [],
        rows: [],
        deletedRowIds: new Set(),
        pricing: {
            costPerUnit: null,
            minSellPrice: null,
            costSkipped: true,
            profitTargetPerUnit: 0,
        },
        form: {
            title: '',
            description: '',
            suggestedPrice: null,
            costPerUnit: null,
            combo5Price: null,
            combo10Price: null,
        },
        priceClamped: false,
        priceInferredFromSerp: false,
        priceAlignedToTopSeller: false,
        geminiMissingPrice: false,
        settings: null,
        feeConfig: null,
    };

    constructor() {
        this.host = document.createElement('div');
        this.host.id = HOST_ID;
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        this.applyWidth(loadSidebarWidth());
        document.body.appendChild(this.host);
    }

    applyWidth(px) {
        const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px));
        this.host.style.setProperty('--sidebar-width', `${w}px`);
        try {
            localStorage.setItem(WIDTH_KEY, String(w));
        }
        catch { /* ignore */ }
    }

    bindResize() {
        const handle = this.shadow.getElementById('resize-handle');
        if (!handle)
            return;
        let dragging = false;
        let startX = 0;
        let startW = 0;
        const onMove = (ev) => {
            if (!dragging)
                return;
            const x = ev.touches?.[0]?.clientX ?? ev.clientX;
            this.applyWidth(startW + (startX - x));
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        handle.addEventListener('mousedown', (ev) => {
            dragging = true;
            startX = ev.clientX;
            startW = this.host.offsetWidth;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    open(payload) {
        const rows = [];
        for (const chunk of payload.crawlResults ?? []) {
            for (const row of chunk.competitorsUi ?? chunk.competitors ?? []) {
                if (row?.id)
                    rows.push({ ...row });
                else
                    rows.push({ ...row, id: `${chunk.keyword}::${row.rank}::${String(row.title ?? '').slice(0, 30)}` });
            }
        }
        const productKey = buildOptimizeProductKey({
            itemId: payload.original?.itemId ?? '',
            shopId: payload.original?.shopId ?? '',
            title: payload.original?.title ?? payload.result?.title ?? '',
        });
        this.state = {
            productKey,
            activeTab: 'result',
            keywords: payload.keywords ?? [],
            rows,
            deletedRowIds: new Set(),
            pricing: {
                costPerUnit: payload.pricing?.costPerUnit ?? null,
                minSellPrice: payload.pricing?.minSellPrice ?? null,
                costSkipped: payload.pricing?.costSkipped === true,
                profitTargetPerUnit: payload.pricing?.profitTargetPerUnit ?? 0,
            },
            form: {
                title: payload.result?.title ?? '',
                description: payload.result?.description ?? '',
                suggestedPrice: payload.result?.suggestedPrice ?? null,
                costPerUnit: payload.pricing?.costSkipped
                    ? null
                    : (payload.pricing?.costPerUnit ?? null),
                combo5Price: null,
                combo10Price: null,
            },
            priceClamped: payload.result?.priceClamped === true,
            priceInferredFromSerp: payload.result?.priceInferredFromSerp === true,
            priceAlignedToTopSeller: payload.result?.priceAlignedToTopSeller === true,
            geminiMissingPrice: payload.result?.geminiMissingPrice === true,
            settings: null,
            feeConfig: null,
        };
        void this.loadSettingsAndPaint();
        this.host.dataset.open = '1';
        this.persist();
    }

    close() {
        this.host.dataset.open = '0';
    }

    async loadSettingsAndPaint() {
        try {
            const s = await getSettings();
            this.state.settings = s;
            this.state.feeConfig = { ...s.platformFeeConfig };
        }
        catch { /* defaults */ }
        this.paint();
        window.addEventListener('bigseller-ai:commission-rate', this.onCommissionRate);
    }

    onCommissionRate = (ev) => {
        const rate = ev.detail?.rate;
        if (rate == null || !this.state.feeConfig)
            return;
        this.state.feeConfig.commissionRate = rate;
        this.updatePriceBlock();
    };

    visibleRows() {
        return this.state.rows.filter((r) => !this.state.deletedRowIds.has(r.id));
    }

    priceRangeLabel() {
        const rows = this.visibleRows();
        let min = Infinity;
        let max = -Infinity;
        for (const row of rows) {
            const pMin = Number(row.priceMin);
            const pMax = Number(row.priceMax);
            if (Number.isFinite(pMin)) {
                min = Math.min(min, pMin);
                max = Math.max(max, pMax ?? pMin);
            }
            else if (row.priceText) {
                const parsed = parsePriceRange(row.priceText);
                if (parsed.priceMin) {
                    min = Math.min(min, parsed.priceMin);
                    max = Math.max(max, parsed.priceMax ?? parsed.priceMin);
                }
            }
        }
        if (!Number.isFinite(min) || min === Infinity)
            return 'Giá KM';
        const lo = formatVnd(min).replace(/\s/g, '');
        const hi = formatVnd(max).replace(/\s/g, '');
        return min === max ? `Giá KM (${lo})` : `Giá KM (${lo} – ${hi})`;
    }

    async calcMinSellPrice(cost) {
        if (!cost || cost <= 0)
            return null;
        const s = this.state.settings ?? (await getSettings());
        const { minSellPrice } = await computeMinSellPrice(cost, s);
        return minSellPrice;
    }

    deriveComboPrices(suggested) {
        if (!suggested || suggested <= 0)
            return { combo5: null, combo10: null, derivedWithoutCost: false };
        const calc = this.state.settings?.pricingCalculator ?? {};
        return computeComboUnitPrices({
            suggestedPrice: suggested,
            costPerUnit: this.state.form.costPerUnit,
            feeConfig: this.state.feeConfig ?? {},
            pricingCalculator: calc,
        });
    }

    profitAtSuggested() {
        const cost = this.state.form.costPerUnit;
        const price = this.state.form.suggestedPrice;
        const feeConfig = this.state.feeConfig;
        if (!feeConfig || !cost || cost <= 0 || !price || price <= 0)
            return null;
        const calc = this.state.settings?.pricingCalculator ?? {};
        const input = buildPricingOrderInput({
            quantity: 1,
            unitPrice: price,
            costPerUnit: cost,
            feeConfig,
            pricingCalculator: calc,
        });
        return evaluateOrderProfit(input);
    }

    paint() {
        const s = this.state;
        const suggestedStr = s.form.suggestedPrice != null
            ? formatPriceInputValue(s.form.suggestedPrice)
            : '';
        const costStr = s.form.costPerUnit != null
            ? formatPriceInputValue(s.form.costPerUnit)
            : '';
        this.shadow.innerHTML = `
          <style>${PANEL_CSS}</style>
          <div class="resize-handle" id="resize-handle"></div>
          <div class="shell">
            <header class="header">
              <span class="header-title">Kết quả tối ưu</span>
              <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
            </header>
            <nav class="tab-bar">
              <button type="button" class="tab-btn${s.activeTab === 'result' ? ' active' : ''}" data-tab="result">Kết quả</button>
              <button type="button" class="tab-btn${s.activeTab === 'data' ? ' active' : ''}" data-tab="data">Dữ liệu SERP</button>
            </nav>
            <div class="tab-body">
              <div class="tab-panel${s.activeTab === 'result' ? ' active' : ''}" id="tab-result">
                <label for="opt-title">Tên sản phẩm</label>
                <input type="text" id="opt-title" value="${escapeAttr(s.form.title)}" />
                <label for="opt-desc">Mô tả</label>
                <textarea id="opt-desc">${escapeHtml(s.form.description)}</textarea>
                <label for="opt-cost">Giá vốn / sp</label>
                <input type="text" id="opt-cost" value="${escapeAttr(costStr)}" placeholder="55k" />
                <div class="price-card" id="price-card"></div>
                ${s.priceClamped ? '<p class="warn">Giá đề xuất đã được nâng lên mức sàn tối thiểu.</p>' : ''}
                ${s.geminiMissingPrice && !s.form.suggestedPrice ? '<p class="warn">Gemini chưa đề xuất giá — nhập thủ công hoặc chạy lại sau khi reload extension.</p>' : ''}
                ${s.priceInferredFromSerp && s.form.suggestedPrice ? '<p class="warn">Giá đề xuất ước tính từ SERP (Gemini không trả suggestedPrice).</p>' : ''}
                ${s.priceAlignedToTopSeller && s.form.suggestedPrice ? '<p class="warn">Giá đề xuất đã căn theo SP bán chạy nhất trên SERP (Gemini neo quá sát giá vốn/sàn).</p>' : ''}
                <div class="actions">
                  <button type="button" class="btn primary" id="apply-btn">Áp dụng Tên + Mô tả</button>
                  <button type="button" class="btn" id="copy-price-btn">Copy giá</button>
                  <button type="button" class="btn" id="copy-json-btn">Copy JSON</button>
                </div>
              </div>
              <div class="tab-panel${s.activeTab === 'data' ? ' active' : ''}" id="tab-data">
                <div class="kw-chips" id="kw-chips"></div>
                <p class="status" id="data-status"></p>
                <div class="table-scroll">
                  <table>
                    <thead><tr id="table-head"></tr></thead>
                    <tbody id="table-body"></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>`;
        this.bindEvents();
        this.bindResize();
        this.updatePriceBlock();
        this.renderDataTab();
    }

    bindEvents() {
        this.shadow.getElementById('close-btn')?.addEventListener('click', () => this.close());
        this.shadow.querySelectorAll('.tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.state.activeTab = btn.dataset.tab ?? 'result';
                this.paint();
                this.persist();
            });
        });
        const onFormChange = () => {
            const title = this.shadow.getElementById('opt-title')?.value ?? '';
            const description = this.shadow.getElementById('opt-desc')?.value ?? '';
            const cost = parsePriceInput(this.shadow.getElementById('opt-cost')?.value ?? '');
            this.state.form.title = title;
            this.state.form.description = description;
            this.state.form.costPerUnit = cost && cost > 0 ? cost : null;
            void this.updatePriceBlock();
            this.persist();
        };
        this.shadow.getElementById('opt-title')?.addEventListener('input', onFormChange);
        this.shadow.getElementById('opt-desc')?.addEventListener('input', onFormChange);
        this.shadow.getElementById('opt-cost')?.addEventListener('input', onFormChange);
        this.shadow.getElementById('apply-btn')?.addEventListener('click', () => this.onApply());
        this.shadow.getElementById('copy-price-btn')?.addEventListener('click', () => void this.onCopyPrice());
        this.shadow.getElementById('copy-json-btn')?.addEventListener('click', () => void this.onCopyJson());
    }

    async updatePriceBlock() {
        const card = this.shadow.getElementById('price-card');
        if (!card)
            return;
        const cost = this.state.form.costPerUnit;
        let minSell = this.state.pricing.minSellPrice;
        if (cost && cost > 0) {
            minSell = await this.calcMinSellPrice(cost);
            this.state.pricing.minSellPrice = minSell;
        }
        const suggestedInput = this.shadow.getElementById('opt-suggested');
        const suggested = suggestedInput
            ? parsePriceInput(suggestedInput.value)
            : this.state.form.suggestedPrice;
        if (suggested && suggested > 0) {
            this.state.form.suggestedPrice = suggested;
            const combos = this.deriveComboPrices(suggested);
            if (combos.combo5 != null)
                this.state.form.combo5Price = combos.combo5;
            if (combos.combo10 != null)
                this.state.form.combo10Price = combos.combo10;
        }
        const profit = this.profitAtSuggested();
        const combos = this.deriveComboPrices(this.state.form.suggestedPrice);
        const minLabel = minSell != null && minSell > 0
            ? formatVnd(minSell)
            : '—';
        const profitTarget = this.state.pricing.profitTargetPerUnit ?? 0;
        const minHint = !cost || cost <= 0
            ? '<span class="detail-line">Nhập giá vốn để tính giá sàn tối thiểu.</span>'
            : profitTarget > 0
                ? `<span class="detail-line">Giá bán − phí sàn = vốn + lợi nhuận mục tiêu ${formatVnd(profitTarget)}/sp</span>`
                : '<span class="detail-line">Giá bán trừ phí sàn = giá vốn</span>';
        let profitHtml = '<span class="profit-badge muted">—</span>';
        let detailHtml = '';
        if (profit) {
            const p = profit.profitPerUnit;
            const cls = p >= 0 ? 'positive' : 'negative';
            const sign = p >= 0 ? '+' : '';
            profitHtml = `<span class="profit-badge ${cls}">${sign}${formatVnd(Math.round(p))}/sp</span>`;
            detailHtml = `<div class="detail-line">Thu về sau phí: ${formatVnd(Math.round(profit.sellerIncome))} · Phí sàn: ${formatVnd(Math.round(profit.platformFees))}</div>`;
        }
        else if (cost && cost > 0 && suggested && suggested > 0) {
            profitHtml = '<span class="profit-badge muted">Chưa tính được</span>';
        }
        const suggestedVal = this.state.form.suggestedPrice != null
            ? formatPriceInputValue(this.state.form.suggestedPrice)
            : '';
        const combo5Val = this.state.form.combo5Price != null
            ? formatPriceInputValue(this.state.form.combo5Price)
            : '';
        const combo10Val = this.state.form.combo10Price != null
            ? formatPriceInputValue(this.state.form.combo10Price)
            : '';
        const comboHint = !this.state.form.suggestedPrice
            ? ''
            : combos.derivedWithoutCost
                ? '<span class="detail-line">Gợi ý combo từ giá lẻ (chưa có vốn — nhập vốn để tính theo lợi nhuận/sp).</span>'
                : '<span class="detail-line">Combo giữ cùng lợi nhuận/sp như giá lẻ đề xuất (theo phí sàn popup $).</span>';
        const comboBlock = this.state.form.suggestedPrice
            ? `<div class="combo-section">
            <p class="combo-title">Giá bán theo combo (đ/sp)</p>
            <div class="price-row">
              <span class="price-label">Combo 5</span>
              <div class="price-input-wrap">
                <input type="text" id="opt-combo5" value="${escapeAttr(combo5Val)}" placeholder="—" />
                <span>₫/sp</span>
              </div>
            </div>
            <div class="price-row">
              <span class="price-label">Combo 10</span>
              <div class="price-input-wrap">
                <input type="text" id="opt-combo10" value="${escapeAttr(combo10Val)}" placeholder="—" />
                <span>₫/sp</span>
              </div>
            </div>
            ${comboHint}
          </div>`
            : '';
        card.innerHTML = `
          <div class="price-row">
            <span class="price-label">Giá sàn tối thiểu</span>
            <span class="price-value">${minLabel}</span>
          </div>
          ${minHint}
          <div class="price-row">
            <span class="price-label">Giá sàn đề xuất cạnh tranh</span>
            <div class="price-input-wrap">
              <input type="text" id="opt-suggested" value="${escapeAttr(suggestedVal)}" placeholder="89000" />
              <span>₫</span>
            </div>
            ${profitHtml}
          </div>
          ${detailHtml}
          ${comboBlock}`;
        const bindCombo = (id, key) => {
            const el = this.shadow.getElementById(id);
            el?.addEventListener('input', () => {
                const v = parsePriceInput(el.value);
                this.state.form[key] = v && v > 0 ? v : null;
                this.persist();
            });
        };
        const sugEl = this.shadow.getElementById('opt-suggested');
        sugEl?.addEventListener('input', () => {
            const v = parsePriceInput(sugEl.value);
            this.state.form.suggestedPrice = v && v > 0 ? v : null;
            void this.updatePriceBlock();
            this.persist();
        });
        bindCombo('opt-combo5', 'combo5Price');
        bindCombo('opt-combo10', 'combo10Price');
    }

    renderDataTab() {
        const chips = this.shadow.getElementById('kw-chips');
        if (chips) {
            chips.innerHTML = (this.state.keywords ?? [])
                .map((k) => `<span class="kw-chip">${escapeHtml(k)}</span>`)
                .join('');
        }
        const visible = this.visibleRows();
        const status = this.shadow.getElementById('data-status');
        if (status) {
            const deleted = this.state.deletedRowIds.size;
            status.textContent = `${visible.length} sản phẩm${deleted > 0 ? ` · đã xóa ${deleted}` : ''}`;
        }
        const head = this.shadow.getElementById('table-head');
        if (head) {
            head.innerHTML = `
              <th>Từ khóa</th><th>#</th><th>Tên</th>
              <th>${escapeHtml(this.priceRangeLabel())}</th>
              <th>Đã bán</th><th></th>`;
        }
        const body = this.shadow.getElementById('table-body');
        if (!body)
            return;
        body.innerHTML = visible
            .sort((a, b) => (Number(b.soldNumeric) || 0) - (Number(a.soldNumeric) || 0))
            .map((row) => `
              <tr data-id="${escapeAttr(row.id)}">
                <td>${escapeHtml(row.keyword ?? '')}</td>
                <td>${escapeHtml(String(row.rank ?? ''))}</td>
                <td class="title-cell">${escapeHtml(row.title ?? '')}</td>
                <td>${escapeHtml(row.priceText ?? '')}</td>
                <td>${escapeHtml(row.soldText ?? '')}</td>
                <td><button type="button" class="btn-del" data-del="${escapeAttr(row.id)}">Xóa</button></td>
              </tr>`)
            .join('');
        body.querySelectorAll('[data-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-del');
                if (id)
                    this.state.deletedRowIds.add(id);
                this.renderDataTab();
                this.persist();
            });
        });
    }

    onApply() {
        if (!productAdapter) {
            alert('Không tìm thấy adapter sản phẩm.');
            return;
        }
        const title = this.shadow.getElementById('opt-title')?.value?.trim() ?? '';
        const description = this.shadow.getElementById('opt-desc')?.value?.trim() ?? '';
        if (!title && !description) {
            alert('Thiếu tiêu đề và mô tả.');
            return;
        }
        const ok = productAdapter.apply({ title, description }, { scope: 'both' });
        if (!ok)
            alert('Không điền được form — kiểm tra trang sửa sản phẩm.');
    }

    async onCopyPrice() {
        const p = this.state.form.suggestedPrice;
        if (!p) {
            alert('Chưa có giá đề xuất.');
            return;
        }
        await navigator.clipboard.writeText(String(p));
    }

    async onCopyJson() {
        const json = JSON.stringify({
            title: this.state.form.title,
            description: this.state.form.description,
            suggestedPrice: this.state.form.suggestedPrice,
            combo5Price: this.state.form.combo5Price,
            combo10Price: this.state.form.combo10Price,
        });
        await navigator.clipboard.writeText(json);
    }

    applyStoredData(data) {
        this.state.productKey = data.productKey ?? '';
        this.state.activeTab = data.activeTab ?? 'result';
        this.state.keywords = data.keywords ?? [];
        this.state.rows = data.rows ?? [];
        this.state.deletedRowIds = new Set(data.deletedRowIds ?? []);
        this.state.pricing = data.pricing ?? this.state.pricing;
        this.state.form = {
            title: '',
            description: '',
            suggestedPrice: null,
            costPerUnit: null,
            combo5Price: null,
            combo10Price: null,
            ...(data.form ?? {}),
        };
        this.state.priceClamped = data.priceClamped === true;
        this.state.priceInferredFromSerp = data.priceInferredFromSerp === true;
        this.state.priceAlignedToTopSeller = data.priceAlignedToTopSeller === true;
        this.state.geminiMissingPrice = data.geminiMissingPrice === true;
    }

    persist() {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                productKey: this.state.productKey,
                activeTab: this.state.activeTab,
                keywords: this.state.keywords,
                rows: this.state.rows,
                deletedRowIds: [...this.state.deletedRowIds],
                pricing: this.state.pricing,
                form: this.state.form,
                priceClamped: this.state.priceClamped,
                priceInferredFromSerp: this.state.priceInferredFromSerp,
                priceAlignedToTopSeller: this.state.priceAlignedToTopSeller,
                geminiMissingPrice: this.state.geminiMissingPrice,
            }));
        }
        catch { /* quota */ }
    }

    restoreFromSession() {
        try {
            const data = readStoredReviewRaw();
            if (!data || !hasReviewContent(data))
                return;
            this.applyStoredData(data);
        }
        catch { /* ignore */ }
    }
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
}

function loadSidebarWidth() {
    try {
        const v = Number(localStorage.getItem(WIDTH_KEY));
        if (Number.isFinite(v) && v >= MIN_WIDTH)
            return v;
    }
    catch { /* ignore */ }
    return DEFAULT_WIDTH;
}

function ensurePanel() {
    if (!panelInstance) {
        panelInstance = new OptimizeReviewPanel();
        panelInstance.restoreFromSession();
    }
    return panelInstance;
}

/**
 * @param {import('../bigseller/adapter.js').bigsellerAdapter | import('../shopee/adapter.js').shopeeAdapter} adapter
 */
export function mountOptimizeReviewSidebar(adapter) {
    productAdapter = adapter;
    ensurePanel();
}

export function openOptimizeReview(payload) {
    ensurePanel().open(payload);
}

/** @type {((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean) | null} */
let resultListener = null;

export function mountOptimizeResultListener() {
    if (resultListener)
        return;
    resultListener = (message, _sender, sendResponse) => {
        if (message?.type !== MessageType.OPTIMIZE_RESULT)
            return false;
        openOptimizeReview(message.payload ?? {});
        safeSendResponse(sendResponse, { ok: true });
        return false;
    };
    chrome.runtime.onMessage.addListener(resultListener);
}
