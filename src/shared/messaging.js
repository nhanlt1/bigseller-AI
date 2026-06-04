export const MessageType = {
    OPEN_GEMINI_TAB: 'OPEN_GEMINI_TAB',
    REWRITE_PRODUCT: 'REWRITE_PRODUCT',
    GEMINI_SEND_PROMPT: 'GEMINI_SEND_PROMPT',
    GEMINI_CANCEL: 'GEMINI_CANCEL',
    OPEN_CHATGPT_IMAGE: 'OPEN_CHATGPT_IMAGE',
    CHATGPT_FILL_IMAGE_PROMPT: 'CHATGPT_FILL_IMAGE_PROMPT',
    CHATGPT_PING: 'CHATGPT_PING',
    APPLY_PRODUCT: 'APPLY_PRODUCT',
    GET_SETTINGS: 'GET_SETTINGS',
    PING: 'PING',
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
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
                return;
            }
            resolve(response);
        });
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
