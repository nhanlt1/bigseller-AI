import { MessageType, sendMessage } from '../../shared/messaging.js';
import { buildPromptProductContext } from '../../shared/shop-names.js';
import { fillPromptTemplate, getSettings, parseGeminiProductJson, } from '../../shared/storage.js';
const PANEL_HOST_ID = 'bigseller-ai-panel-host';
/** Hàng nút tròn góc phải — đồng bộ với image-fab */
export const FAB_ROW_BOTTOM_PX = 24;
export const FAB_SIZE_PX = 48;
export const FAB_GAP_PX = 10;
export const FAB_IMAGE_RIGHT_PX = 56;
export const FAB_TEXT_AI_RIGHT_PX = FAB_IMAGE_RIGHT_PX + FAB_SIZE_PX + FAB_GAP_PX;
const PANEL_HOST_RIGHT_PX = FAB_TEXT_AI_RIGHT_PX + 82;
export class FloatingPanel {
    adapter;
    shadow;
    host;
    state = 'idle';
    settings = null;
    statusEl;
    titlePreviewEl;
    descPreviewEl;
    rewriteBtn;
    copyPromptBtn;
    applyBtn;
    lastResult = null;
    waitingGemini = false;
    rewriteGeneration = 0;
    constructor(adapter) {
        this.adapter = adapter;
        const existing = document.getElementById(PANEL_HOST_ID);
        if (existing)
            existing.remove();
        this.host = document.createElement('div');
        this.host.id = PANEL_HOST_ID;
        this.host.style.display = 'none';
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        document.body.appendChild(this.host);
        this.render();
        void this.loadSettings();
    }
    async loadSettings() {
        this.settings = await getSettings();
    }
    setState(state, message, options) {
        this.state = state;
        if (options?.waitingGemini !== undefined) {
            this.waitingGemini = options.waitingGemini;
        }
        else if (state !== 'busy') {
            this.waitingGemini = false;
        }
        const labels = {
            idle: 'Sẵn sàng',
            busy: 'Đang xử lý…',
            done: 'Hoàn tất',
            error: 'Lỗi',
        };
        this.statusEl.textContent = message ?? labels[state];
        this.statusEl.dataset.state = state;
        this.rewriteBtn.disabled = state === 'busy';
        this.copyPromptBtn.disabled = state === 'busy';
        this.applyBtn.disabled = false;
        this.applyBtn.title = this.waitingGemini
            ? 'Hủy chờ Gemini và áp dụng từ clipboard'
            : 'Áp dụng JSON từ clipboard vào form';
    }
    render() {
        this.shadow.innerHTML = `
      <style>${PANEL_STYLES}</style>
      <div class="panel" part="panel">
        <header class="panel-header">
          <span class="logo">BigSeller AI</span>
          <button type="button" class="btn-icon" id="close-btn" title="Thu gọn">×</button>
        </header>
        <div class="panel-body">
          <p class="status" id="status">Sẵn sàng</p>
          <p class="hint" id="flow-hint">Viết lại AI tự gửi Gemini — hoặc Copy prompt thủ công</p>
          <div class="preview">
            <label>Tiêu đề mới</label>
            <div class="preview-box" id="title-preview">—</div>
            <label>Mô tả mới</label>
            <div class="preview-box desc" id="desc-preview">—</div>
          </div>
          <div class="actions">
            <button type="button" class="btn primary" id="rewrite-btn">Viết lại bằng AI</button>
            <button type="button" class="btn" id="copy-prompt-btn">Copy prompt</button>
            <button type="button" class="btn" id="apply-btn" title="Áp dụng JSON từ clipboard vào form">Áp dụng vào form</button>
          </div>
        </div>
      </div>
    `;
        this.statusEl = this.shadow.getElementById('status');
        this.titlePreviewEl = this.shadow.getElementById('title-preview');
        this.descPreviewEl = this.shadow.getElementById('desc-preview');
        this.rewriteBtn = this.shadow.getElementById('rewrite-btn');
        this.copyPromptBtn = this.shadow.getElementById('copy-prompt-btn');
        this.applyBtn = this.shadow.getElementById('apply-btn');
        this.shadow.getElementById('close-btn').addEventListener('click', () => {
            this.host.style.display = 'none';
        });
        this.rewriteBtn.addEventListener('click', () => void this.handleRewrite());
        this.copyPromptBtn.addEventListener('click', () => void this.handleCopyPrompt());
        this.applyBtn.addEventListener('click', () => void this.handleApply());
    }
    promptContextFromPage() {
        const product = this.adapter.extract();
        if (!product?.title && !product?.description)
            return null;
        const platform = this.adapter.platform ?? 'shopee';
        return buildPromptProductContext(product, platform);
    }
    async handleRewrite() {
        const ctx = this.promptContextFromPage();
        if (!ctx) {
            this.setState('error', 'Không đọc được tiêu đề/mô tả từ trang');
            return;
        }
        const generation = ++this.rewriteGeneration;
        this.setState('busy', 'Đang gửi Gemini…', { waitingGemini: true });
        try {
            const settings = this.settings ?? (await getSettings());
            const result = await sendMessage({
                type: MessageType.REWRITE_PRODUCT,
                payload: {
                    title: ctx.title,
                    description: ctx.description,
                    shopName: ctx.shopName,
                    language: settings.language,
                },
            });
            if (generation !== this.rewriteGeneration)
                return;
            if (!result.ok || !result.data) {
                throw new Error(result.error ?? 'Gemini không trả về kết quả');
            }
            this.lastResult = result.data;
            this.titlePreviewEl.textContent = result.data.title || '—';
            this.descPreviewEl.textContent = result.data.description || '—';
            const ok = this.adapter.apply(result.data);
            this.setState(ok ? 'done' : 'error', ok
                ? 'Đã viết lại và áp dụng vào form'
                : 'Có JSON nhưng không điền được form — kiểm tra trang');
        }
        catch (err) {
            if (generation !== this.rewriteGeneration)
                return;
            const msg = err instanceof Error ? err.message : 'Không viết lại được';
            if (msg.includes('Đã hủy chờ Gemini')) {
                this.setState('idle', 'Đã hủy chờ Gemini');
                return;
            }
            this.setState('error', msg);
        }
    }
    async handleCopyPrompt() {
        const ctx = this.promptContextFromPage();
        if (!ctx) {
            this.setState('error', 'Không đọc được tiêu đề/mô tả từ trang');
            return;
        }
        this.setState('busy');
        try {
            const settings = this.settings ?? (await getSettings());
            const prompt = fillPromptTemplate(settings.promptTemplate, {
                title: ctx.title,
                description: ctx.description,
                shopName: ctx.shopName,
                language: settings.language,
            });
            await navigator.clipboard.writeText(prompt);
            const tabResult = await sendMessage({
                type: MessageType.OPEN_GEMINI_TAB,
            });
            if (!tabResult.ok) {
                throw new Error(tabResult.error ?? 'Không mở được tab Gemini');
            }
            this.setState('done', 'Đã copy prompt — dán vào Gemini, copy JSON phản hồi rồi bấm Áp dụng vào form');
        }
        catch (err) {
            this.setState('error', err instanceof Error ? err.message : 'Không copy được prompt');
        }
    }
    async handleApply() {
        if (this.waitingGemini) {
            this.rewriteGeneration += 1;
            this.waitingGemini = false;
            try {
                await sendMessage({ type: MessageType.GEMINI_CANCEL });
            }
            catch {
                /* tab Gemini có thể chưa sẵn sàng */
            }
        }
        this.setState('busy', 'Đang áp dụng…');
        try {
            const raw = await navigator.clipboard.readText();
            const parsed = parseGeminiProductJson(raw.trim());
            if (!parsed) {
                throw new Error('Clipboard không có JSON {"title":"...","description":"..."} — copy lại phản hồi từ Gemini');
            }
            this.lastResult = parsed;
            this.titlePreviewEl.textContent = parsed.title || '—';
            this.descPreviewEl.textContent = parsed.description || '—';
            const ok = this.adapter.apply(parsed);
            this.setState(ok ? 'done' : 'error', ok
                ? 'Đã áp dụng vào form'
                : 'Parse OK nhưng không điền được form — kiểm tra trang sản phẩm');
        }
        catch (err) {
            this.setState('error', err instanceof Error ? err.message : 'Không áp dụng được');
        }
    }
    show() {
        this.host.style.display = 'block';
    }
}
const PANEL_STYLES = `
  :host {
    all: initial;
    position: fixed;
    bottom: 24px;
    right: ${PANEL_HOST_RIGHT_PX}px;
    z-index: 2147483646;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
  }
  .panel {
    width: 340px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.18);
    border: 1px solid #e5e7eb;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: linear-gradient(135deg, #ee4d2d, #ff7337);
    color: #fff;
  }
  .logo { font-weight: 700; font-size: 14px; }
  .btn-icon {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
    padding: 0 4px;
  }
  .panel-body { padding: 12px 14px; }
  .status {
    margin: 0 0 6px;
    padding: 6px 10px;
    border-radius: 6px;
    background: #f3f4f6;
    font-size: 12px;
  }
  .hint {
    margin: 0 0 10px;
    font-size: 11px;
    color: #6b7280;
    line-height: 1.35;
  }
  .status[data-state="error"] { background: #fef2f2; color: #b91c1c; }
  .status[data-state="done"] { background: #ecfdf5; color: #047857; }
  .status[data-state="busy"] { background: #eff6ff; color: #1d4ed8; }
  .preview label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    margin-bottom: 4px;
  }
  .preview-box {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 10px;
    max-height: 60px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.4;
  }
  .preview-box.desc { max-height: 100px; }
  .actions { display: flex; flex-direction: column; gap: 8px; }
  .btn {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
    color: #fff;
  }
`;
export function mountToggleButton(panel) {
    const btnId = 'bigseller-ai-toggle';
    if (document.getElementById(btnId))
        return;
    const btn = document.createElement('button');
    btn.id = btnId;
    btn.textContent = 'Mô tả AI';
    btn.title = 'BigSeller AI — viết lại tiêu đề/mô tả (Gemini)';
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: `${FAB_ROW_BOTTOM_PX}px`,
        right: `${FAB_TEXT_AI_RIGHT_PX}px`,
        zIndex: '2147483645',
        minWidth: `${FAB_SIZE_PX}px`,
        height: `${FAB_SIZE_PX}px`,
        padding: '0 10px',
        borderRadius: '24px',
        border: 'none',
        background: '#6b7280',
        color: '#fff',
        fontWeight: '700',
        fontSize: '11px',
        letterSpacing: '-0.02em',
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(107,114,128,.45)',
        lineHeight: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
    });
    btn.addEventListener('click', () => panel.show());
    document.body.appendChild(btn);
}
