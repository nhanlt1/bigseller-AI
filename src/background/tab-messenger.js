import { MessageType } from '../shared/messaging.js';
const CONNECTION_ERROR_RE = /Receiving end does not exist|Could not establish connection/i;
function urlMatchesPattern(url, pattern) {
    if (pattern.endsWith('/*')) {
        return url.startsWith(pattern.slice(0, -1));
    }
    return url === pattern;
}
function getScriptFiles(kind) {
    const manifest = chrome.runtime.getManifest();
    const needles = kind === 'shopee'
        ? ['banhang.shopee', '.shopee.vn']
        : kind === 'bigseller'
            ? ['bigseller.com']
            : ['gemini.google.com'];
    const entry = manifest.content_scripts?.find((cs) => cs.matches?.some((m) => needles.some((needle) => m.includes(needle))));
    return entry?.js ?? [];
}
async function injectContentScript(tabId, kind) {
    const files = getScriptFiles(kind);
    if (files.length === 0)
        return;
    await chrome.scripting.executeScript({
        target: { tabId },
        files,
    });
}
function inferKindFromUrl(url) {
    if (/banhang\.shopee\.(vn|com)/i.test(url))
        return 'shopee';
    if (/^https?:\/\/(?:www\.)?shopee\.(vn|com)\b/i.test(url))
        return 'shopee';
    if (/(?:^https?:\/\/)?(?:[\w-]+\.)?shopee\.vn/i.test(url))
        return 'shopee';
    if (/bigseller\.com/i.test(url))
        return 'bigseller';
    if (/gemini\.google\.com/i.test(url))
        return 'gemini';
    return null;
}
async function pingTab(tabId) {
    try {
        const res = await chrome.tabs.sendMessage(tabId, {
            type: MessageType.PING,
        });
        return !!(res && typeof res === 'object' && 'ok' in res && res.ok);
    }
    catch {
        return false;
    }
}
/**
 * Đợi content script nhận message (tránh "Receiving end does not exist").
 */
export async function ensureTabReady(tabId, kind, timeoutMs = 25000) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) {
        throw new Error('Tab không tồn tại — quay lại trang sản phẩm và thử lại');
    }
    const resolvedKind = kind ?? (tab.url ? inferKindFromUrl(tab.url) : null);
    if (!resolvedKind) {
        throw new Error('URL tab không được extension hỗ trợ');
    }
    const deadline = Date.now() + timeoutMs;
    let injected = false;
    while (Date.now() < deadline) {
        if (await pingTab(tabId))
            return;
        if (!injected) {
            try {
                await injectContentScript(tabId, resolvedKind);
                injected = true;
                await new Promise((r) => setTimeout(r, 400));
                if (await pingTab(tabId))
                    return;
            }
            catch {
                /* loader có thể đã inject — tiếp tục ping */
            }
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Tab chưa sẵn sàng — tải lại trang (F5) trên Shopee/BigSeller/Gemini rồi thử Viết lại');
}
export async function sendTabMessageReady(tabId, kind, message) {
    await ensureTabReady(tabId, kind);
    try {
        return (await chrome.tabs.sendMessage(tabId, message));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (CONNECTION_ERROR_RE.test(msg)) {
            await ensureTabReady(tabId, kind, 15000);
            return (await chrome.tabs.sendMessage(tabId, message));
        }
        throw err;
    }
}
