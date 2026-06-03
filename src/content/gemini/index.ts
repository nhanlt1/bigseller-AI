import { MessageType } from '../../shared/messaging';
import type { GeminiSendPromptPayload } from '../../shared/types';
import { runGeminiPrompt } from './automation';
import { cancelActiveGeminiWait } from './response-tracker';

const GEMINI_SCRIPT_FLAG = '__bigsellerAiGeminiScript';

if (!(globalThis as Record<string, unknown>)[GEMINI_SCRIPT_FLAG]) {
  (globalThis as Record<string, unknown>)[GEMINI_SCRIPT_FLAG] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MessageType.PING) {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === MessageType.GEMINI_CANCEL) {
      cancelActiveGeminiWait();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type !== MessageType.GEMINI_SEND_PROMPT) return false;

    const payload = message.payload as GeminiSendPromptPayload;
    void runGeminiPrompt(
      payload.prompt,
      payload.requestId,
      payload.title,
      payload.description,
    ).then(sendResponse);
    return true;
  });
}
