import { MessageType, replyAsync, safeSendResponse } from '../../shared/messaging.js';
import { fillChatGPTComposer } from './composer.js';
const CHATGPT_SCRIPT_FLAG = '__bigsellerAiChatgptScript';
if (!globalThis[CHATGPT_SCRIPT_FLAG]) {
    globalThis[CHATGPT_SCRIPT_FLAG] = true;
    registerChatGPTMessageListener();
}
function registerChatGPTMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === MessageType.CHATGPT_PING) {
            safeSendResponse(sendResponse, { ok: true });
            return false;
        }
        if (message.type !== MessageType.CHATGPT_FILL_IMAGE_PROMPT) {
            return false;
        }
        const payload = message.payload;
        const prompt = payload?.prompt?.trim();
        if (!prompt) {
            safeSendResponse(sendResponse, { ok: false, error: 'Thiếu prompt' });
            return false;
        }
        return replyAsync(sendResponse, async () => {
            await fillChatGPTComposer(prompt);
            return { ok: true };
        });
    });
}
