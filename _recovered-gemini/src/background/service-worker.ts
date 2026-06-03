import { MessageType } from '../shared/messaging';
import type {
  ExtensionMessage,
  GeminiResponsePayload,
  GeminiSendPromptPayload,
  RewriteProductPayload,
  RewriteResultPayload,
} from '../shared/types';
import {
  fillPromptTemplate,
  getSettings,
  parseGeminiProductJson,
} from '../shared/storage';

const GEMINI_URL = 'https://gemini.google.com/';
const pendingRewrites = new Map<
  string,
  { tabId?: number; resolve?: (r: RewriteResultPayload) => void }
>();

async function findOrOpenGeminiTab(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }
  const created = await chrome.tabs.create({ url: GEMINI_URL, active: true });
  if (!created.id) throw new Error('Không mở được tab Gemini');
  await waitForTabLoad(created.id);
  return created.id;
}

function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Gemini tải quá lâu'));
    }, timeoutMs);

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500);
      }
    });
  });
}

async function sendPromptToGemini(
  tabId: number,
  payload: GeminiSendPromptPayload,
): Promise<GeminiResponsePayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Hết thời gian chờ Gemini'));
    }, 130000);

    const onResponse = (message: ExtensionMessage) => {
      if (message.type !== MessageType.GEMINI_RESPONSE) return;
      const data = message.payload as GeminiResponsePayload;
      if (data.requestId !== payload.requestId) return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onResponse);
      resolve(data);
    };

    chrome.runtime.onMessage.addListener(onResponse);

    chrome.tabs
      .sendMessage(tabId, {
        type: MessageType.GEMINI_SEND_PROMPT,
        payload,
      })
      .catch(async () => {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['src/content/gemini/entry.ts'],
        });
        return chrome.tabs.sendMessage(tabId, {
          type: MessageType.GEMINI_SEND_PROMPT,
          payload,
        });
      })
      .catch((err) => {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(onResponse);
        reject(err);
      });
  });
}

async function handleRewriteProduct(
  payload: RewriteProductPayload & { requestId?: string },
  senderTabId?: number,
): Promise<RewriteResultPayload> {
  const requestId =
    payload.requestId ??
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const settings = await getSettings();
  const prompt = fillPromptTemplate(settings.promptTemplate, {
    title: payload.title,
    description: payload.description,
    language: payload.language ?? settings.language,
  });

  try {
    const geminiTabId = await findOrOpenGeminiTab();
    pendingRewrites.set(requestId, { tabId: senderTabId });

    const geminiPayload: GeminiSendPromptPayload = { prompt, requestId };
    const response = await sendPromptToGemini(geminiTabId, geminiPayload);

    if (response.error) {
      return { requestId, ok: false, error: response.error };
    }

    const parsed = parseGeminiProductJson(response.text);
    if (!parsed) {
      return {
        requestId,
        ok: false,
        error: 'Gemini không trả về JSON {title, description} hợp lệ',
      };
    }

    const result: RewriteResultPayload = {
      requestId,
      ok: true,
      data: parsed,
    };

    if (senderTabId) {
      try {
        await chrome.tabs.sendMessage(senderTabId, {
          type: MessageType.REWRITE_RESULT,
          payload: result,
        });
      } catch {
        /* content script may not listen */
      }
    }

    return result;
  } catch (e) {
    return {
      requestId,
      ok: false,
      error: e instanceof Error ? e.message : 'Lỗi không xác định',
    };
  } finally {
    pendingRewrites.delete(requestId);
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === MessageType.PING) {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MessageType.GET_SETTINGS) {
      void getSettings().then((s) => sendResponse(s));
      return true;
    }

    if (message.type === MessageType.REWRITE_PRODUCT) {
      const payload = message.payload as RewriteProductPayload & {
        requestId?: string;
      };
      void handleRewriteProduct(payload, sender.tab?.id).then(sendResponse);
      return true;
    }

    if (message.type === MessageType.GEMINI_RESPONSE) {
      return false;
    }

    return false;
  },
);

export {};
