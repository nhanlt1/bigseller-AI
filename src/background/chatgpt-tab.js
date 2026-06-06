import { MessageType, sendTabMessage } from '../shared/messaging.js';
import { fetchImagesAsBase64 } from '../shared/image-fetch.js';
export const CHATGPT_HOME = 'https://chatgpt.com/';
const CHATGPT_TAB_URL_PATTERNS = [
    'https://chatgpt.com/*',
    'https://*.chatgpt.com/*',
    'https://chat.openai.com/*',
];
function isNoReceiverError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (msg.includes('Receiving end does not exist') ||
        msg.includes('Could not establish connection'));
}
function getChatGPTContentScriptFiles() {
    const scripts = chrome.runtime.getManifest().content_scripts ?? [];
    const entry = scripts.find((cs) => cs.matches?.some((m) => m.includes('chatgpt.com') || m.includes('chat.openai.com')));
    return entry?.js ?? [];
}
export async function findChatGPTTabId() {
    for (const pattern of CHATGPT_TAB_URL_PATTERNS) {
        const tabs = await chrome.tabs.query({ url: pattern });
        if (tabs[0]?.id != null)
            return tabs[0].id;
    }
    return null;
}
export async function getOrCreateChatGPTTab() {
    const existing = await findChatGPTTabId();
    if (existing != null) {
        await chrome.tabs.update(existing, { active: true });
        return existing;
    }
    const tab = await chrome.tabs.create({ url: CHATGPT_HOME, active: true });
    if (tab.id == null)
        throw new Error('Không tạo được tab ChatGPT');
    return tab.id;
}
export async function waitForTabComplete(tabId, timeoutMs = 25000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete')
        return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('ChatGPT tải trang quá lâu — thử F5 tab ChatGPT'));
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
/** Inject content script khi tab mở trước khi reload extension hoặc SPA chưa có listener. */
export async function ensureChatGPTContentScript(tabId) {
    try {
        const res = await sendTabMessage(tabId, {
            type: MessageType.CHATGPT_PING,
        });
        if (res?.ok)
            return;
    }
    catch (err) {
        if (!isNoReceiverError(err))
            throw err;
    }
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? '';
    if (!url.startsWith('https://chatgpt.com') &&
        !url.startsWith('https://chat.openai.com')) {
        throw new Error('Tab ChatGPT chưa sẵn sàng — mở https://chatgpt.com rồi thử lại');
    }
    const files = getChatGPTContentScriptFiles();
    if (files.length === 0) {
        throw new Error('Extension thiếu content script ChatGPT — reload tiện ích trên chrome://extensions');
    }
    await chrome.scripting.executeScript({
        target: { tabId },
        files,
    });
    await sleep(400);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function normalizeImageUrlList(imageUrls) {
    if (!imageUrls)
        return [];
    const list = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    for (const raw of list) {
        const url = String(raw ?? '').trim();
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

/**
 * @param {number} tabId
 * @param {string} prompt
 * @param {{ images?: { base64?: string, mimeType?: string }[], imageUrls?: string | string[] }} [opts]
 */
export async function sendChatGPTImagePrompt(tabId, prompt, opts = {}) {
    const urls = normalizeImageUrlList(opts.imageUrls);
    /** @type {{ base64: string, mimeType: string }[]} */
    let images = Array.isArray(opts.images)
        ? opts.images.filter((row) => row?.base64?.trim())
        : [];
    if (!images.length && urls.length) {
        images = await fetchImagesAsBase64(urls);
    }
    const message = {
        type: MessageType.CHATGPT_FILL_IMAGE_PROMPT,
        payload: { prompt, images, imageUrls: urls },
    };
    let lastError = 'Content script ChatGPT chưa sẵn sàng';
    let injected = false;
    for (let i = 0; i < 30; i++) {
        if (i === 0 || (i % 3 === 0 && !injected)) {
            try {
                await ensureChatGPTContentScript(tabId);
                injected = true;
            }
            catch (err) {
                if (!isNoReceiverError(err) && i > 4)
                    throw err;
            }
        }
        try {
            const res = await sendTabMessage(tabId, message);
            if (res?.ok) {
                if (urls.length && !res.imageAttached) {
                    throw new Error('Đã điền prompt nhưng ChatGPT không nhận ảnh — thử đính kèm thủ công (+)');
                }
                return;
            }
            lastError = res?.error ?? lastError;
            if (res && res.ok === false)
                break;
        }
        catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            if (!isNoReceiverError(err))
                throw err;
            injected = false;
        }
        await sleep(500);
    }
    throw new Error(`${lastError}. Hãy mở https://chatgpt.com, F5 trang rồi bấm tạo ảnh lại.`);
}

/**
 * @param {string} prompt
 * @param {{ images?: { base64?: string, mimeType?: string }[], imageUrls?: string | string[] }} [opts]
 */
export async function openChatGPTWithImagePrompt(prompt, opts = {}) {
    const tabId = await getOrCreateChatGPTTab();
    await waitForTabComplete(tabId);
    await sleep(800);
    await sendChatGPTImagePrompt(tabId, prompt, opts);
}
export { isNoReceiverError };
