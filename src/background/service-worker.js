import { openChatGPTWithImagePrompt } from './chatgpt-tab.js';
import { ensureTabReady, sendTabMessageReady } from './tab-messenger.js';
import { withServiceWorkerKeepalive } from './keepalive.js';
import { MessageType, replyAsync, safeSendResponse, sendTabMessage, } from '../shared/messaging.js';
import { sanitizeRewrittenProduct } from '../shared/shop-names.js';
import { fillPromptTemplate, getSettings, mergeRewriteByScope, parseGeminiProductJson, } from '../shared/storage.js';
const GEMINI_URL = 'https://gemini.google.com/app';
function createRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function waitForTabComplete(tabId, timeoutMs = 25000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete')
        return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Gemini tải trang quá lâu — thử F5 tab Gemini'));
        }, timeoutMs);
        const listener = (id, info) => {
            if (id !== tabId || info.status !== 'complete')
                return;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}
async function sendGeminiFillPrompt(prompt) {
    const geminiTabId = await openGeminiTabIfNeeded();
    await ensureTabReady(geminiTabId, 'gemini');
    const response = await sendTabMessageReady(geminiTabId, 'gemini', {
        type: MessageType.GEMINI_FILL_PROMPT,
        payload: { prompt },
    });
    if (response?.error)
        throw new Error(response.error);
    if (!response?.ok)
        throw new Error('Không điền được prompt vào Gemini');
    return { ok: true };
}

async function openGeminiTabIfNeeded() {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    if (tabs[0]?.id != null) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        return tabs[0].id;
    }
    const tab = await chrome.tabs.create({ url: GEMINI_URL, active: true });
    if (tab.id == null)
        throw new Error('Không tạo được tab Gemini');
    await waitForTabComplete(tab.id);
    await sleep(1200);
    return tab.id;
}
function sellerTabKind(url) {
    if (!url)
        return null;
    if (/banhang\.shopee\.(vn|com)/i.test(url))
        return 'shopee';
    if (/bigseller\.com/i.test(url))
        return 'bigseller';
    return null;
}
async function applyToSellerTab(tabId, data) {
    const tab = await chrome.tabs.get(tabId);
    const kind = sellerTabKind(tab.url);
    if (!kind)
        return;
    await sendTabMessageReady(tabId, kind, {
        type: MessageType.APPLY_PRODUCT,
        payload: data,
    });
    await chrome.tabs.update(tabId, { active: true });
}
async function handleRewriteProduct(payload, senderTabId) {
    const requestId = payload.requestId ?? createRequestId();
    const scope = payload.scope ?? 'both';
    if (scope === 'title' && !payload.title?.trim()) {
        return { requestId, ok: false, error: 'Thiếu tiêu đề sản phẩm' };
    }
    if (scope === 'description' && !payload.description?.trim()) {
        return { requestId, ok: false, error: 'Thiếu mô tả sản phẩm' };
    }
    if (scope === 'both' && !payload.title?.trim() && !payload.description?.trim()) {
        return {
            requestId,
            ok: false,
            error: 'Thiếu tiêu đề/mô tả sản phẩm',
        };
    }
    const settings = await getSettings();
    const prompt = fillPromptTemplate(settings.promptTemplate, {
        title: payload.title,
        description: payload.description,
        shopName: payload.shopName ?? '',
        language: payload.language ?? settings.language,
    }, { scope });
    try {
        const geminiTabId = await openGeminiTabIfNeeded();
        await ensureTabReady(geminiTabId, 'gemini');
        const geminiPayload = {
            prompt,
            requestId,
            title: payload.title,
            description: payload.description,
        };
        const response = await sendTabMessageReady(geminiTabId, 'gemini', {
            type: MessageType.GEMINI_SEND_PROMPT,
            payload: geminiPayload,
        });
        const geminiRes = response;
        if (geminiRes.error) {
            return { requestId, ok: false, error: geminiRes.error };
        }
        const parsed = parseGeminiProductJson(geminiRes.text);
        if (!parsed) {
            return {
                requestId,
                ok: false,
                error: 'Gemini không trả về JSON {title, description} hợp lệ',
            };
        }
        const merged = mergeRewriteByScope(parsed, {
            title: payload.title,
            description: payload.description,
        }, scope);
        const data = sanitizeRewrittenProduct(merged, payload.shopName ?? '');
        if (senderTabId != null) {
            try {
                await applyToSellerTab(senderTabId, data);
            }
            catch {
                /* panel vẫn hiển thị preview */
            }
        }
        return { requestId, ok: true, data };
    }
    catch (err) {
        return {
            requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
/** Tăng khi hủy / rewrite mới — bỏ qua sendResponse cho tác vụ rewrite cũ */
let rewriteEpoch = 0;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MessageType.PING) {
        safeSendResponse(sendResponse, { ok: true });
        return false;
    }
    if (message.type === MessageType.GET_SETTINGS) {
        return replyAsync(sendResponse, () => getSettings());
    }
    if (message.type === MessageType.OPEN_GEMINI_TAB) {
        return replyAsync(sendResponse, async () => {
            await openGeminiTabIfNeeded();
            return { ok: true };
        });
    }
    if (message.type === MessageType.GEMINI_FILL_PROMPT) {
        const prompt = message.payload?.prompt?.trim();
        if (!prompt) {
            safeSendResponse(sendResponse, { ok: false, error: 'Thiếu prompt' });
            return false;
        }
        return replyAsync(sendResponse, () => sendGeminiFillPrompt(prompt));
    }
    if (message.type === MessageType.GEMINI_CANCEL) {
        rewriteEpoch += 1;
        return replyAsync(sendResponse, async () => {
            const tabs = await chrome.tabs.query({
                url: 'https://gemini.google.com/*',
            });
            if (tabs[0]?.id != null) {
                try {
                    await sendTabMessage(tabs[0].id, {
                        type: MessageType.GEMINI_CANCEL,
                    });
                }
                catch {
                    /* tab chưa có script */
                }
            }
            return { ok: true };
        });
    }
    if (message.type === MessageType.REWRITE_PRODUCT) {
        const payload = message.payload;
        const epoch = ++rewriteEpoch;
        return replyAsync(sendResponse, () => withServiceWorkerKeepalive(async () => {
            const result = await handleRewriteProduct(payload, sender.tab?.id);
            if (epoch !== rewriteEpoch) {
                return {
                    requestId: result.requestId,
                    ok: false,
                    error: 'Đã hủy chờ Gemini',
                };
            }
            return result;
        }));
    }
    if (message.type === MessageType.OPEN_CHATGPT_IMAGE) {
        const prompt = message.payload?.prompt;
        if (!prompt?.trim()) {
            safeSendResponse(sendResponse, { ok: false, error: 'Thiếu prompt tạo ảnh' });
            return false;
        }
        return replyAsync(sendResponse, () => withServiceWorkerKeepalive(async () => {
            await openChatGPTWithImagePrompt(prompt.trim());
            return { ok: true };
        }));
    }
    return false;
});
