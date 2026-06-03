import { MessageType, type ExtensionMessage } from '../shared/messaging';

const CONNECTION_ERROR_RE =
  /Receiving end does not exist|Could not establish connection/i;

export type ContentScriptKind = 'shopee' | 'bigseller' | 'gemini';

function urlMatchesPattern(url: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    return url.startsWith(pattern.slice(0, -1));
  }
  return url === pattern;
}

function getScriptFiles(kind: ContentScriptKind): string[] {
  const manifest = chrome.runtime.getManifest();
  const needle =
    kind === 'shopee'
      ? 'banhang.shopee'
      : kind === 'bigseller'
        ? 'bigseller.com'
        : 'gemini.google.com';

  const entry = manifest.content_scripts?.find((cs) =>
    cs.matches?.some((m) => m.includes(needle)),
  );
  return (entry?.js as string[] | undefined) ?? [];
}

async function injectContentScript(
  tabId: number,
  kind: ContentScriptKind,
): Promise<void> {
  const files = getScriptFiles(kind);
  if (files.length === 0) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
  });
}

function inferKindFromUrl(url: string): ContentScriptKind | null {
  if (/banhang\.shopee\.(vn|com)/i.test(url)) return 'shopee';
  if (/bigseller\.com/i.test(url)) return 'bigseller';
  if (/gemini\.google\.com/i.test(url)) return 'gemini';
  return null;
}

async function pingTab(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: MessageType.PING,
    });
    return !!(res && typeof res === 'object' && 'ok' in res && res.ok);
  } catch {
    return false;
  }
}

/**
 * Đợi content script nhận message (tránh "Receiving end does not exist").
 */
export async function ensureTabReady(
  tabId: number,
  kind: ContentScriptKind,
  timeoutMs = 25000,
): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    throw new Error('Tab không tồn tại — quay lại trang sản phẩm và thử lại');
  }

  const resolvedKind =
    kind ?? (tab.url ? inferKindFromUrl(tab.url) : null);
  if (!resolvedKind) {
    throw new Error('URL tab không được extension hỗ trợ');
  }

  const deadline = Date.now() + timeoutMs;
  let injected = false;

  while (Date.now() < deadline) {
    if (await pingTab(tabId)) return;

    if (!injected) {
      try {
        await injectContentScript(tabId, resolvedKind);
        injected = true;
        await new Promise((r) => setTimeout(r, 400));
        if (await pingTab(tabId)) return;
      } catch {
        /* loader có thể đã inject — tiếp tục ping */
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    'Tab chưa sẵn sàng — tải lại trang (F5) trên Shopee/BigSeller/Gemini rồi thử Viết lại',
  );
}

export async function sendTabMessageReady<T>(
  tabId: number,
  kind: ContentScriptKind,
  message: ExtensionMessage,
): Promise<T> {
  await ensureTabReady(tabId, kind);
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (CONNECTION_ERROR_RE.test(msg)) {
      await ensureTabReady(tabId, kind, 15000);
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    }
    throw err;
  }
}
