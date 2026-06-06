import { MessageType, sendMessage } from '../../shared/messaging.js';
import { buildPromptProductContext, sanitizeRewrittenProduct, } from '../../shared/shop-names.js';
import { fillPromptTemplate, getSettings, parseGeminiProductJson, } from '../../shared/storage.js';
import {
    clearOptimizeProgressCallbacks,
    hideOptimizeProgress,
    setOptimizeProgressCallbacks,
    showOptimizeProgress,
    updateOptimizeProgress,
} from './optimize-progress.js';
import { getDescriptionToolbarPlacement } from './product-editor-anchors.js';
import {
    mountFloatingEditorToolbar,
    refreshEditorToolbar,
    setEditorToolbarBusy,
} from './product-editor-toolbar.js';

const PANEL_HOST_ID = 'bigseller-ai-panel-host';

/** Neo FAB nghiên cứu SP tương tự (Shopee) */
export const FAB_ROW_BOTTOM_PX = 24;
export const FAB_SIZE_PX = 48;
export const FAB_GAP_PX = 10;
export const FAB_IMAGE_RIGHT_PX = 56;

/** Logic viết lại / copy / áp dụng — không còn panel UI (nút nằm trên toolbar inline). */
export class FloatingPanel {
    adapter;
    state = 'idle';
    settings = null;
    lastResult = null;
    waitingGemini = false;
    rewriteGeneration = 0;

    constructor(adapter) {
        this.adapter = adapter;
        document.getElementById(PANEL_HOST_ID)?.remove();
        void this.loadSettings();
    }

    async loadSettings() {
        try {
            this.settings = await getSettings();
        }
        catch {
            /* storage/messaging đã nhắc F5 hoặc dùng mặc định */
        }
    }

    setState(state, message, options) {
        this.state = state;
        if (options?.waitingGemini !== undefined) {
            this.waitingGemini = options.waitingGemini;
        }
        else if (state !== 'busy') {
            this.waitingGemini = false;
        }
        if (state === 'error' && message) {
            alert(message);
        }
    }

    promptContextFromPage() {
        const product = this.adapter.extract();
        if (!product?.title && !product?.description)
            return null;
        const platform = this.adapter.platform ?? 'shopee';
        return buildPromptProductContext(product, platform);
    }

    async handleRewrite(scope = 'both') {
        const product = this.adapter.extract();
        if (!product?.title && !product?.description) {
            this.setState('error', 'Không đọc được tiêu đề/mô tả từ trang');
            return;
        }
        const platform = this.adapter.platform ?? 'shopee';
        const ctx = buildPromptProductContext(product, platform);
        if (scope === 'title' && !ctx.title?.trim()) {
            this.setState('error', 'Không đọc được tiêu đề từ form');
            return;
        }
        if (scope === 'description' && !ctx.description?.trim()) {
            this.setState('error', 'Không đọc được mô tả từ form');
            return;
        }
        const generation = ++this.rewriteGeneration;
        this.setState('busy', undefined, { waitingGemini: true });
        try {
            const settings = this.settings ?? (await getSettings());
            const result = await sendMessage({
                type: MessageType.REWRITE_PRODUCT,
                payload: {
                    title: ctx.title,
                    description: ctx.description,
                    originalTitle: product.title ?? '',
                    originalDescription: product.description ?? '',
                    shopName: ctx.shopName,
                    language: settings.language,
                    scope,
                },
            });
            if (generation !== this.rewriteGeneration)
                return;
            if (!result.ok || !result.data) {
                throw new Error(result.error ?? 'Gemini không trả về kết quả');
            }
            const data = sanitizeRewrittenProduct(result.data, ctx.shopName, scope);
            this.lastResult = data;
            const ok = this.adapter.apply(data, { scope });
            this.setState(ok ? 'done' : 'error', ok
                ? undefined
                : 'Có JSON nhưng không điền được form — kiểm tra trang');
        }
        catch (err) {
            if (generation !== this.rewriteGeneration)
                return;
            const msg = err instanceof Error ? err.message : 'Không viết lại được';
            if (msg.includes('Đã hủy chờ Gemini')) {
                this.setState('idle');
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
            this.setState('done');
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
            const ctx = this.promptContextFromPage();
            const raw = await navigator.clipboard.readText();
            const parsed = parseGeminiProductJson(raw.trim());
            if (!parsed) {
                throw new Error('Clipboard không có JSON {"title":"...","description":"..."} — copy lại phản hồi từ Gemini');
            }
            const data = sanitizeRewrittenProduct(parsed, ctx?.shopName ?? '');
            this.lastResult = data;
            const ok = this.adapter.apply(data);
            this.setState(ok ? 'done' : 'error', ok
                ? undefined
                : 'Parse OK nhưng không điền được form — kiểm tra trang sản phẩm');
        }
        catch (err) {
            this.setState('error', err instanceof Error ? err.message : 'Không áp dụng được');
        }
    }

    rewrite(scope) {
        return this.handleRewrite(scope);
    }

    copyPrompt() {
        return this.handleCopyPrompt();
    }

    applyFromClipboard() {
        return this.handleApply();
    }

    optimizePayloadFromPage() {
        const product = this.adapter.extract();
        if (!product?.title && !product?.description)
            return null;
        const platform = this.adapter.platform ?? 'shopee';
        const ctx = buildPromptProductContext(product, platform);
        const ids =
            typeof this.adapter.extractIds === 'function'
                ? this.adapter.extractIds()
                : {
                    itemId: product.itemId ?? '',
                    shopId: product.shopId ?? '',
                };
        return {
            title: ctx.title,
            description: ctx.description,
            shopName: ctx.shopName,
            itemId: String(ids?.itemId ?? '').trim(),
            shopId: String(ids?.shopId ?? '').trim(),
            platform,
        };
    }

    finishOptimizeRun() {
        hideOptimizeProgress();
        clearOptimizeProgressCallbacks();
        setEditorToolbarBusy(DESC_TOOLBAR_ID, false);
        this.setState('idle');
    }

    async handleOptimizeCancel() {
        try {
            await sendMessage({ type: MessageType.OPTIMIZE_CANCEL });
        }
        catch {
            /* SW có thể đã dừng */
        }
        this.finishOptimizeRun();
    }

    async handleOptimizeResume() {
        updateOptimizeProgress('Đang tiếp tục sau CAPTCHA…', { waitingCaptcha: false });
        try {
            const result = await sendMessage({ type: MessageType.OPTIMIZE_RESUME });
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Không tiếp tục được pipeline');
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Không tiếp tục được';
            if (isOptimizeServiceWorkerUnavailable(msg)) {
                this.finishOptimizeRun();
                this.setState('error', 'Pipeline chưa sẵn sàng — Reload extension rồi thử lại.');
                return;
            }
            updateOptimizeProgress(msg, { waitingCaptcha: false });
            window.setTimeout(() => this.finishOptimizeRun(), 2800);
            this.setState('error', msg);
        }
    }

    async handleOptimize() {
        const payload = this.optimizePayloadFromPage();
        if (!payload) {
            this.setState('error', 'Không đọc được tiêu đề/mô tả từ trang');
            return;
        }
        this.setState('busy');
        setEditorToolbarBusy(DESC_TOOLBAR_ID, true);
        showOptimizeProgress('Đang khởi động pipeline…');
        setOptimizeProgressCallbacks({
            onCancel: () => void this.handleOptimizeCancel(),
            onResume: () => void this.handleOptimizeResume(),
            onDone: () => this.finishOptimizeRun(),
            onError: (message) => {
                setEditorToolbarBusy(DESC_TOOLBAR_ID, false);
                this.setState('idle');
                if (message) {
                    window.setTimeout(() => this.setState('error', message), 2900);
                }
            },
        });
        try {
            const result = await sendMessage({
                type: MessageType.OPTIMIZE_PRODUCT,
                payload,
            });
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Pipeline chưa sẵn sàng');
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Không tối ưu được';
            if (isOptimizeServiceWorkerUnavailable(msg)) {
                this.finishOptimizeRun();
                this.setState('error', 'Pipeline chưa sẵn sàng — Reload extension rồi thử lại.');
                return;
            }
            updateOptimizeProgress(msg, { waitingCaptcha: false });
            window.setTimeout(() => this.finishOptimizeRun(), 2800);
            this.setState('error', msg);
        }
    }

    optimizeProduct() {
        return this.handleOptimize();
    }
}

function isOptimizeServiceWorkerUnavailable(message) {
    return /receiving end does not exist|could not establish connection|message port closed|unknown message|not handled/i.test(message);
}

export const DESC_TOOLBAR_ID = 'bigseller-ai-desc-toolbar';

/** Nút viết lại + copy/áp dụng — neo vùng mô tả (BigSeller / Shopee). */
export function mountProductDescriptionToolbar(panel, platform) {
    document.getElementById('bigseller-ai-toggle')?.remove();
    const busyWrap = async (fn) => {
        setEditorToolbarBusy(DESC_TOOLBAR_ID, true);
        try {
            await fn();
        }
        finally {
            setEditorToolbarBusy(DESC_TOOLBAR_ID, false);
        }
    };
    mountFloatingEditorToolbar({
        hostId: DESC_TOOLBAR_ID,
        tone: 'text',
        wrap: platform === 'bigseller',
        getPlacement: () => getDescriptionToolbarPlacement(platform),
        buttons: [
            {
                id: 'optimize',
                label: 'Tự động tối ưu',
                primary: true,
                onClick: () => panel.optimizeProduct(),
            },
            {
                id: 'rewrite-title',
                label: 'Tên SP',
                primary: true,
                onClick: () => busyWrap(() => panel.rewrite('title')),
            },
            {
                id: 'rewrite-desc',
                label: 'Mô tả',
                primary: true,
                onClick: () => busyWrap(() => panel.rewrite('description')),
            },
            {
                id: 'rewrite-both',
                label: 'Tên + mô tả',
                primary: true,
                onClick: () => busyWrap(() => panel.rewrite('both')),
            },
            {
                id: 'copy-prompt',
                label: 'Copy prompt',
                ghost: true,
                onClick: () => busyWrap(() => panel.copyPrompt()),
            },
            {
                id: 'apply',
                label: 'Áp dụng',
                ghost: true,
                onClick: () => busyWrap(() => panel.applyFromClipboard()),
            },
        ],
    });
}

export function refreshDescriptionToolbar() {
    refreshEditorToolbar(DESC_TOOLBAR_ID);
}

/** @deprecated dùng mountProductDescriptionToolbar */
export function mountToggleButton(panel) {
    mountProductDescriptionToolbar(panel, panel.adapter?.platform ?? 'shopee');
}
