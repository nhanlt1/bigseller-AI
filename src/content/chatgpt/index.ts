import { MessageType } from '../../shared/messaging';
import type { ChatGPTFillPromptPayload } from '../../shared/types';
import { fillChatGPTComposer } from './composer';

const CHATGPT_SCRIPT_FLAG = '__bigsellerAiChatgptScript';

if (!(globalThis as Record<string, unknown>)[CHATGPT_SCRIPT_FLAG]) {
  (globalThis as Record<string, unknown>)[CHATGPT_SCRIPT_FLAG] = true;
  registerChatGPTMessageListener();
}

function registerChatGPTMessageListener(): void {
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MessageType.CHATGPT_PING) {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type !== MessageType.CHATGPT_FILL_IMAGE_PROMPT) {
    return false;
  }

  const payload = message.payload as ChatGPTFillPromptPayload | undefined;
  const prompt = payload?.prompt?.trim();
  if (!prompt) {
    sendResponse({ ok: false, error: 'Thiếu prompt' });
    return false;
  }

  void (async () => {
    try {
      await fillChatGPTComposer(prompt);
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return true;
});
}
