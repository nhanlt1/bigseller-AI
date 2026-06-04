import { MessageType, replyAsync, safeSendResponse } from '../../shared/messaging.js';
import { runGeminiPrompt } from './automation.js';
import { cancelActiveGeminiWait } from './response-tracker.js';
const GEMINI_SCRIPT_FLAG = '__bigsellerAiGeminiScript';
if (!globalThis[GEMINI_SCRIPT_FLAG]) {
    globalThis[GEMINI_SCRIPT_FLAG] = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MessageType.PING) {
            safeSendResponse(sendResponse, { ok: true });
            return false;
        }
        if (message?.type === MessageType.GEMINI_CANCEL) {
            cancelActiveGeminiWait();
            safeSendResponse(sendResponse, { ok: true });
            return false;
        }
        if (message?.type !== MessageType.GEMINI_SEND_PROMPT)
            return false;
        const payload = message.payload;
        return replyAsync(sendResponse, () => runGeminiPrompt(payload.prompt, payload.requestId, payload.title, payload.description));
    });
}
