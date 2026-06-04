import { MessageType, safeSendResponse } from '../../shared/messaging.js';
export function listenForProductApply(adapter) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MessageType.PING) {
            safeSendResponse(sendResponse, { ok: true });
            return false;
        }
        if (message?.type !== MessageType.APPLY_PRODUCT)
            return false;
        const data = message.payload;
        try {
            const ok = adapter.apply(data);
            safeSendResponse(sendResponse, { ok });
        }
        catch (err) {
            safeSendResponse(sendResponse, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return false;
    });
}
