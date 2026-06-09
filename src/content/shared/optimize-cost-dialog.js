import { parsePriceInput } from '../../pricing/price-input.js';
import { parseGeminiOptimizeJson } from '../../shared/gemini-json.js';
import { computeMinSellPrice, formatMinSellPricePreview } from '../../shared/optimize-pricing.js';
import { getSettings } from '../../shared/storage.js';

const HOST_ID = 'bigseller-ai-optimize-cost-host';

/** @type {HTMLElement | null} */
let host = null;
/** @type {ShadowRoot | null} */
let shadow = null;

function ensureHost() {
    if (host && shadow)
        return;
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>${DIALOG_CSS}</style>
      <div class="backdrop"></div>
      <div class="card" role="dialog" aria-labelledby="cost-title">
        <p class="title" id="cost-title">Giá vốn trước khi tối ưu</p>
        <p class="hint">Nhập giá vốn để tính <strong>giá sàn tối thiểu</strong> — mức giá bán mà sau khi trừ phí sàn bạn thu về đủ giá vốn (cộng lợi nhuận mục tiêu từ popup $ nếu có). Gemini đề xuất giá cạnh tranh từ mức sàn và dữ liệu đối thủ.</p>
        <label for="cost-input">Giá vốn / sản phẩm</label>
        <input type="text" id="cost-input" placeholder="vd: 55k hoặc 55000" autocomplete="off" />
        <p class="preview" id="min-preview" hidden></p>
        <p class="paste-error" id="cost-paste-error" hidden></p>
        <div class="actions">
          <div class="actions-row">
            <button type="button" class="btn" id="cost-cancel">Hủy</button>
            <button type="button" class="btn paste" id="cost-paste-gemini" title="Copy JSON {title, description, suggestedPrice?} từ tab Gemini">Paste từ Gemini</button>
            <button type="button" class="btn primary" id="cost-start" disabled>Bắt đầu tối ưu</button>
          </div>
          <button type="button" class="btn ghost" id="cost-skip">Tôi muốn bổ sung giá vốn sau</button>
        </div>
      </div>`;
    document.body.appendChild(host);
}

const DIALOG_CSS = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  :host([data-visible="1"]) { display: block; }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.42);
  }
  .card {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    padding: 20px 20px 16px;
    color: #111827;
  }
  .title {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 700;
    color: #ee4d2d;
  }
  .hint {
    margin: 0 0 14px;
    font-size: 12px;
    line-height: 1.45;
    color: #6b7280;
  }
  label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #374151;
  }
  input[type="text"] {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 10px;
  }
  input:focus {
    outline: none;
    border-color: #ee4d2d;
    box-shadow: 0 0 0 2px rgba(238, 77, 45, 0.15);
  }
  .preview {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    font-size: 12px;
    line-height: 1.45;
    color: #9a3412;
  }
  .preview strong { color: #c2410c; }
  .preview-note {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    color: #b45309;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions-row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #111827;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    line-height: 1.2;
  }
  .btn:hover:not(:disabled) { filter: brightness(0.97); }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn.primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
    color: #fff;
  }
  .btn.ghost {
    border-color: transparent;
    background: transparent;
    color: #6b7280;
    text-decoration: underline;
    text-underline-offset: 2px;
    align-self: flex-start;
    padding-left: 0;
  }
  .btn.paste {
    border-color: #fdba74;
    background: #fff7ed;
    color: #c2410c;
  }
  .btn.paste:hover:not(:disabled) {
    background: #ffedd5;
  }
  .paste-error {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    font-size: 11px;
    line-height: 1.4;
    color: #b91c1c;
  }
`;

/** @typedef {{ costPerUnit: number | null, minSellPrice: number | null, profitTargetPerUnit: number, costSkipped: boolean, pastedGeminiText?: string }} OptimizeCostChoice */

/**
 * @returns {Promise<OptimizeCostChoice | null>} null = user đóng / hủy
 */
export function showOptimizeCostDialog() {
    return new Promise((resolve) => {
        ensureHost();
        if (!host || !shadow)
            return resolve(null);
        const input = shadow.getElementById('cost-input');
        const preview = shadow.getElementById('min-preview');
        const startBtn = shadow.getElementById('cost-start');
        const cancelBtn = shadow.getElementById('cost-cancel');
        const skipBtn = shadow.getElementById('cost-skip');
        const pasteBtn = shadow.getElementById('cost-paste-gemini');
        const pasteError = shadow.getElementById('cost-paste-error');
        if (!input || !preview || !startBtn || !cancelBtn || !skipBtn || !pasteBtn)
            return resolve(null);
        let settings = null;
        void getSettings().then((s) => {
            settings = s;
        });
        const hidePasteError = () => {
            if (pasteError) {
                pasteError.hidden = true;
                pasteError.textContent = '';
            }
        };
        const showPasteError = (msg) => {
            if (!pasteError)
                return;
            pasteError.hidden = false;
            pasteError.textContent = msg;
        };
        const cleanup = (value) => {
            host.dataset.visible = '0';
            input.removeEventListener('input', onInput);
            cancelBtn.removeEventListener('click', onCancel);
            startBtn.removeEventListener('click', onStart);
            skipBtn.removeEventListener('click', onSkip);
            pasteBtn.removeEventListener('click', onPaste);
            resolve(value);
        };
        const resolveCostFields = async () => {
            const cost = parsePriceInput(input.value);
            if (cost && cost > 0) {
                const s = settings ?? (await getSettings());
                const { minSellPrice, profitTargetPerUnit: pt } = await computeMinSellPrice(cost, s);
                return {
                    costPerUnit: cost,
                    minSellPrice,
                    profitTargetPerUnit: pt,
                    costSkipped: false,
                };
            }
            return {
                costPerUnit: null,
                minSellPrice: null,
                profitTargetPerUnit: 0,
                costSkipped: true,
            };
        };
        const updatePreview = async () => {
            const cost = parsePriceInput(input.value);
            if (!cost || cost <= 0) {
                preview.hidden = true;
                startBtn.disabled = true;
                return;
            }
            const s = settings ?? (await getSettings());
            const { minSellPrice, profitTargetPerUnit: pt } = await computeMinSellPrice(cost, s);
            if (minSellPrice != null) {
                preview.hidden = false;
                preview.innerHTML = formatMinSellPricePreview(minSellPrice, cost, pt);
            }
            else {
                preview.hidden = true;
            }
            startBtn.disabled = false;
        };
        const onInput = () => {
            hidePasteError();
            void updatePreview();
        };
        const onCancel = () => cleanup(null);
        const onSkip = () => cleanup({
            costPerUnit: null,
            minSellPrice: null,
            profitTargetPerUnit: 0,
            costSkipped: true,
        });
        const onStart = async () => {
            const cost = parsePriceInput(input.value);
            if (!cost || cost <= 0)
                return;
            const s = settings ?? (await getSettings());
            const { minSellPrice, profitTargetPerUnit: pt } = await computeMinSellPrice(cost, s);
            cleanup({
                costPerUnit: cost,
                minSellPrice,
                profitTargetPerUnit: pt,
                costSkipped: false,
            });
        };
        const onPaste = async () => {
            hidePasteError();
            let raw = '';
            try {
                raw = (await navigator.clipboard.readText())?.trim() ?? '';
            }
            catch {
                showPasteError('Không đọc được clipboard — cho phép quyền dán trên trang này.');
                return;
            }
            if (!raw) {
                showPasteError('Clipboard trống — copy JSON phản hồi cuối từ tab Gemini trước.');
                return;
            }
            if (!parseGeminiOptimizeJson(raw)) {
                showPasteError('Clipboard không có JSON {title, description, suggestedPrice?} hợp lệ.');
                return;
            }
            const costFields = await resolveCostFields();
            cleanup({
                ...costFields,
                pastedGeminiText: raw,
            });
        };
        input.value = '';
        preview.hidden = true;
        hidePasteError();
        startBtn.disabled = true;
        host.dataset.visible = '1';
        input.addEventListener('input', onInput);
        cancelBtn.addEventListener('click', onCancel);
        startBtn.addEventListener('click', () => { void onStart(); });
        skipBtn.addEventListener('click', onSkip);
        pasteBtn.addEventListener('click', () => { void onPaste(); });
        input.focus();
    });
}
