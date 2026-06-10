import {
    isExtensionContextAlive,
    isExtensionContextInvalidated,
    notifyExtensionReloadNeeded,
} from './extension-context.js';

export const EXTENSION_RELOAD_MESSAGE =
    'Extension đã Reload — F5 trang này rồi thử lại.';

export const MessageType = {
    OPEN_GEMINI_TAB: 'OPEN_GEMINI_TAB',
    REWRITE_PRODUCT: 'REWRITE_PRODUCT',
    GEMINI_SEND_PROMPT: 'GEMINI_SEND_PROMPT',
    GEMINI_FILL_PROMPT: 'GEMINI_FILL_PROMPT',
    GEMINI_CANCEL: 'GEMINI_CANCEL',
    OPEN_CHATGPT_IMAGE: 'OPEN_CHATGPT_IMAGE',
    CHATGPT_FILL_IMAGE_PROMPT: 'CHATGPT_FILL_IMAGE_PROMPT',
    CHATGPT_PING: 'CHATGPT_PING',
    APPLY_PRODUCT: 'APPLY_PRODUCT',
    GET_SETTINGS: 'GET_SETTINGS',
    PING: 'PING',
    /** Edit tab → SW: bắt đầu pipeline tối ưu SEO */
    OPTIMIZE_PRODUCT: 'OPTIMIZE_PRODUCT',
    /** SW → tab shopee.vn: crawl trang 1 theo keyword */
    SHOPEE_SEARCH_CRAWL: 'SHOPEE_SEARCH_CRAWL',
    /** Edit tab → SW: tiếp tục sau khi user giải CAPTCHA */
    OPTIMIZE_RESUME: 'OPTIMIZE_RESUME',
    /** SW → edit tab: cập nhật overlay progress */
    OPTIMIZE_PROGRESS: 'OPTIMIZE_PROGRESS',
    /** Edit tab → SW: hủy pipeline đang chạy */
    OPTIMIZE_CANCEL: 'OPTIMIZE_CANCEL',
    /** SW → edit tab: kết quả tối ưu + dữ liệu SERP (mở sidebar) */
    OPTIMIZE_RESULT: 'OPTIMIZE_RESULT',
    /** Edit tab → SW: dán JSON phản hồi Gemini từ clipboard (bỏ qua chờ auto-detect) */
    OPTIMIZE_MANUAL_CLIPBOARD: 'OPTIMIZE_MANUAL_CLIPBOARD',
    /** Edit tab → SW: dán kết quả Gemini từ popup giá vốn (pipeline lỗi / bỏ qua crawl) */
    OPTIMIZE_PASTE_GEMINI: 'OPTIMIZE_PASTE_GEMINI',
    /** Edit tab → SW: mở / focus tab shopee.vn/search?shop=… theo từ khóa */
    OPEN_SHOPEE_SHOP_SEARCH: 'OPEN_SHOPEE_SHOP_SEARCH',
};
/** Gọi sendResponse an toàn — tránh lỗi khi channel đã đóng */
export function safeSendResponse(sendResponse, payload) {
    if (typeof sendResponse !== 'function')
        return;
    try {
        sendResponse(payload);
    }
    catch {
        /* message port closed */
    }
}
/**
 * Listener async: return true và luôn gọi sendResponse (kể cả khi promise reject).
 */
export function replyAsync(sendResponse, work) {
    void Promise.resolve()
        .then(work)
        .then((result) => safeSendResponse(sendResponse, result), (err) => safeSendResponse(sendResponse, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
    }));
    return true;
}
export function sendMessage(message) {
    if (!isExtensionContextAlive()) {
        notifyExtensionReloadNeeded();
        return Promise.reject(new Error(EXTENSION_RELOAD_MESSAGE));
    }
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    const error = new Error(err.message);
                    if (isExtensionContextInvalidated(error)) {
                        notifyExtensionReloadNeeded();
                        reject(new Error(EXTENSION_RELOAD_MESSAGE));
                        return;
                    }
                    reject(error);
                    return;
                }
                resolve(response);
            });
        }
        catch (err) {
            if (isExtensionContextInvalidated(err)) {
                notifyExtensionReloadNeeded();
                reject(new Error(EXTENSION_RELOAD_MESSAGE));
                return;
            }
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
export function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
                return;
            }
            resolve(response);
        });
    });
}
