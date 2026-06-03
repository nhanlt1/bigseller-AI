import { openChatGPTWithImagePrompt } from './chatgpt-tab';
import { ensureTabReady, sendTabMessageReady } from './tab-messenger';
import {
  MessageType,
  sendTabMessage,
  type ExtensionMessage,
} from '../shared/messaging';
import {
  fillPromptTemplate,
  getSettings,
  parseGeminiProductJson,
} from '../shared/storage';
import type {
  GeminiSendPromptPayload,
  RewriteProductPayload,
  RewriteResultPayload,
} from '../shared/types';

const GEMINI_URL = 'https://gemini.google.com/app';

function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTabComplete(tabId: number, timeoutMs = 25000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Gemini tải trang quá lâu — thử F5 tab Gemini'));
    }, timeoutMs);

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openGeminiTabIfNeeded(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (tabs[0]?.id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }

  const tab = await chrome.tabs.create({ url: GEMINI_URL, active: true });
  if (tab.id == null) throw new Error('Không tạo được tab Gemini');
  await waitForTabComplete(tab.id);
  await sleep(1200);
  return tab.id;
}

function sellerTabKind(url: string | undefined): 'shopee' | 'bigseller' | null {
  if (!url) return null;
  if (/banhang\.shopee\.(vn|com)/i.test(url)) return 'shopee';
  if (/bigseller\.com/i.test(url)) return 'bigseller';
  return null;
}

async function applyToSellerTab(
  tabId: number,
  data: { title: string; description: string },
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const kind = sellerTabKind(tab.url);
  if (!kind) return;

  await sendTabMessageReady(tabId, kind, {
    type: MessageType.APPLY_PRODUCT,
    payload: data,
  });
  await chrome.tabs.update(tabId, { active: true });
}

async function handleRewriteProduct(
  payload: RewriteProductPayload,
  senderTabId?: number,
): Promise<RewriteResultPayload> {
  const requestId = payload.requestId ?? createRequestId();

  if (!payload.title?.trim() && !payload.description?.trim()) {
    return {
      requestId,
      ok: false,
      error: 'Thiếu tiêu đề/mô tả sản phẩm',
    };
  }

  const settings = await getSettings();
  const prompt = fillPromptTemplate(settings.promptTemplate, {
    title: payload.title,
    description: payload.description,
    language: payload.language ?? settings.language,
  });

  try {
    const geminiTabId = await openGeminiTabIfNeeded();
    await ensureTabReady(geminiTabId, 'gemini');

    const geminiPayload: GeminiSendPromptPayload = {
      prompt,
      requestId,
      title: payload.title,
      description: payload.description,
    };

    const response = await sendTabMessageReady(
      geminiTabId,
      'gemini',
      {
        type: MessageType.GEMINI_SEND_PROMPT,
        payload: geminiPayload,
      },
    );

    const geminiRes = response as {
      requestId: string;
      text: string;
      error?: string;
    };

    if (geminiRes.error) {
      return { requestId, ok: false, error: geminiRes.error };
    }

    const parsed = parseGeminiProductJson(geminiRes.text);
    if (!parsed) {
      return {
        requestId,
        ok: false,
        error: 'Gemini không trả về JSON {title, description} hợp lệ',
      };
    }

    if (senderTabId != null) {
      try {
        await applyToSellerTab(senderTabId, parsed);
      } catch {
        /* panel vẫn hiển thị preview */
      }
    }

    return { requestId, ok: true, data: parsed };
  } catch (err) {
    return {
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === MessageType.PING) {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MessageType.GET_SETTINGS) {
      void getSettings().then(sendResponse);
      return true;
    }

    if (message.type === MessageType.OPEN_GEMINI_TAB) {
      void openGeminiTabIfNeeded()
        .then(() => sendResponse({ ok: true }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    if (message.type === MessageType.GEMINI_CANCEL) {
      void (async () => {
        const tabs = await chrome.tabs.query({
          url: 'https://gemini.google.com/*',
        });
        if (tabs[0]?.id != null) {
          try {
            await sendTabMessage(tabs[0].id, {
              type: MessageType.GEMINI_CANCEL,
            });
          } catch {
            /* tab chưa có script */
          }
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === MessageType.REWRITE_PRODUCT) {
      const payload = message.payload as RewriteProductPayload;
      void handleRewriteProduct(payload, sender.tab?.id).then(sendResponse);
      return true;
    }

    if (message.type === MessageType.OPEN_CHATGPT_IMAGE) {
      const prompt = (message.payload as { prompt?: string } | undefined)?.prompt;
      if (!prompt?.trim()) {
        sendResponse({ ok: false, error: 'Thiếu prompt tạo ảnh' });
        return false;
      }
      void openChatGPTWithImagePrompt(prompt.trim())
        .then(() => sendResponse({ ok: true }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    return false;
  },
);
