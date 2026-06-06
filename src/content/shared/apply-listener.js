import { MessageType, safeSendResponse } from '../../shared/messaging.js';
export function listenForProductApply(adapter) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MessageType.PING) {
            safeSendResponse(sendResponse, { ok: true });
            return false;
        }
        if (message?.type !== MessageType.APPLY_PRODUCT)
            return false;
        const payload = message.payload ?? {};
        const scope = payload.scope ?? 'both';
        const { scope: _scope, ...data } = payload;
        try {
            const ok = adapter.apply(data, { scope });
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
