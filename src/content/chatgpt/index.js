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
            /** @type {{ base64?: string, mimeType?: string }[]} */
            let images = Array.isArray(payload?.images) ? payload.images : [];
            if (!images.length && payload?.imageBase64) {
                images = [{
                    base64: payload.imageBase64,
                    mimeType: payload.imageMimeType,
                }];
            }
            const imageUrls = Array.isArray(payload?.imageUrls) ? payload.imageUrls : [];
            const result = await fillChatGPTComposer(prompt, { images, imageUrls });
            const expected = result.expectedImages ?? images.length ?? imageUrls.length;
            if (expected > 0 && !result.imageAttached) {
                return {
                    ok: false,
                    error: 'Đã điền prompt nhưng không đính kèm được ảnh — bấm (+) trên ChatGPT để thêm ảnh thủ công',
                    uploadUiOpened: result.uploadUiOpened === true,
                };
            }
            return {
                ok: true,
                imageAttached: result.imageAttached === true,
                imagesAttached: result.imagesAttached ?? 0,
                uploadUiOpened: result.uploadUiOpened === true,
            };
        });
    });
}
