import { openChatGPTWithImagePrompt } from './chatgpt-tab.js';
import { ensureTabReady, sendTabMessageReady } from './tab-messenger.js';
import { withServiceWorkerKeepalive } from './keepalive.js';
import { MessageType, replyAsync, safeSendResponse, sendTabMessage, } from '../shared/messaging.js';
import { parseGeminiKeywordsJson } from '../shared/gemini-json.js';
import { buildAnalysisPrompt, buildKeywordPrompt } from '../shared/optimize-prompts.js';
import { sanitizeRewrittenProduct } from '../shared/shop-names.js';
import { fillPromptTemplate, getSettings, mergeRewriteByScope, parseGeminiProductJson, } from '../shared/storage.js';

const OPTIMIZE_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const CAPTCHA_WAIT_MS = 10 * 60 * 1000;
const SEARCH_TAB_URL = 'https://shopee.vn/search';
const GEMINI_URL = 'https://gemini.google.com/app';
function createRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function waitForTabComplete(tabId, timeoutMs = 25000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete')
        return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Gemini tải trang quá lâu — thử F5 tab Gemini'));
        }, timeoutMs);
        const listener = (id, info) => {
            if (id !== tabId || info.status !== 'complete')
                return;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}
async function sendGeminiFillPrompt(prompt) {
    const geminiTabId = await openGeminiTabIfNeeded();
    await ensureTabReady(geminiTabId, 'gemini');
    const response = await sendTabMessageReady(geminiTabId, 'gemini', {
        type: MessageType.GEMINI_FILL_PROMPT,
        payload: { prompt },
    });
    if (response?.error)
        throw new Error(response.error);
    if (!response?.ok)
        throw new Error('Không điền được prompt vào Gemini');
    return { ok: true };
}

async function openGeminiTabIfNeeded() {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    if (tabs[0]?.id != null) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        return tabs[0].id;
    }
    const tab = await chrome.tabs.create({ url: GEMINI_URL, active: true });
    if (tab.id == null)
        throw new Error('Không tạo được tab Gemini');
    await waitForTabComplete(tab.id);
    await sleep(1200);
    return tab.id;
}
function sellerTabKind(url) {
    if (!url)
        return null;
    if (/banhang\.shopee\.(vn|com)/i.test(url))
        return 'shopee';
    if (/bigseller\.com/i.test(url))
        return 'bigseller';
    return null;
}
async function applyToSellerTab(tabId, data) {
    const tab = await chrome.tabs.get(tabId);
    const kind = sellerTabKind(tab.url);
    if (!kind)
        return;
    await sendTabMessageReady(tabId, kind, {
        type: MessageType.APPLY_PRODUCT,
        payload: data,
    });
    await chrome.tabs.update(tabId, { active: true });
}
async function handleRewriteProduct(payload, senderTabId) {
    const requestId = payload.requestId ?? createRequestId();
    const scope = payload.scope ?? 'both';
    if (scope === 'title' && !payload.title?.trim()) {
        return { requestId, ok: false, error: 'Thiếu tiêu đề sản phẩm' };
    }
    if (scope === 'description' && !payload.description?.trim()) {
        return { requestId, ok: false, error: 'Thiếu mô tả sản phẩm' };
    }
    if (scope === 'both' && !payload.title?.trim() && !payload.description?.trim()) {
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
        shopName: payload.shopName ?? '',
        language: payload.language ?? settings.language,
    }, { scope });
    try {
        const geminiTabId = await openGeminiTabIfNeeded();
        await ensureTabReady(geminiTabId, 'gemini');
        const geminiPayload = {
            prompt,
            requestId,
            title: payload.title,
            description: payload.description,
        };
        const response = await sendTabMessageReady(geminiTabId, 'gemini', {
            type: MessageType.GEMINI_SEND_PROMPT,
            payload: geminiPayload,
        });
        const geminiRes = response;
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
        const merged = mergeRewriteByScope(parsed, {
            title: payload.title,
            description: payload.description,
        }, scope);
        const data = sanitizeRewrittenProduct(merged, payload.shopName ?? '');
        if (senderTabId != null) {
            try {
                await applyToSellerTab(senderTabId, data);
            }
            catch {
                /* panel vẫn hiển thị preview */
            }
        }
        return { requestId, ok: true, data };
    }
    catch (err) {
        return {
            requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
/** @type {{
 *   runId: string,
 *   sellerTabId: number,
 *   searchTabId: number | null,
 *   cancelled: boolean,
 *   waitingCaptcha: boolean,
 *   resumeResolve: (() => void) | null,
 * } | null} */
let optimizeState = null;

function normalizeTitleKey(title) {
    return String(title ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

async function sendOptimizeProgress(sellerTabId, payload) {
    if (sellerTabId == null)
        return;
    try {
        await chrome.tabs.sendMessage(sellerTabId, {
            type: MessageType.OPTIMIZE_PROGRESS,
            payload,
        });
    }
    catch {
        /* tab đóng hoặc chưa có listener */
    }
}

function clearOptimizeState() {
    optimizeState = null;
}

function isOptimizeCancelled() {
    return optimizeState?.cancelled === true;
}

function waitForOptimizeResume(timeoutMs = CAPTCHA_WAIT_MS) {
    return new Promise((resolve, reject) => {
        if (!optimizeState) {
            reject(new Error('Pipeline không hoạt động'));
            return;
        }
        const timer = setTimeout(() => {
            if (optimizeState)
                optimizeState.resumeResolve = null;
            reject(new Error('Hết thời gian chờ CAPTCHA — giải xong rồi bấm Tiếp tục'));
        }, timeoutMs);
        optimizeState.resumeResolve = () => {
            clearTimeout(timer);
            resolve();
        };
    });
}

async function openOrReuseSearchTab() {
    const tabs = await chrome.tabs.query({ url: ['https://shopee.vn/*', 'https://*.shopee.vn/*'] });
    const consumerTabs = tabs.filter((tab) => {
        try {
            const host = new URL(tab.url ?? '').hostname.toLowerCase();
            return host.endsWith('shopee.vn') && !host.startsWith('banhang.');
        }
        catch {
            return false;
        }
    });
    const onSearch = consumerTabs.find((tab) => /shopee\.vn\/search/i.test(tab.url ?? ''));
    if (onSearch?.id != null) {
        await chrome.tabs.update(onSearch.id, { active: true });
        return onSearch.id;
    }
    if (consumerTabs[0]?.id != null) {
        await chrome.tabs.update(consumerTabs[0].id, { active: true, url: SEARCH_TAB_URL });
        await waitForTabComplete(consumerTabs[0].id);
        return consumerTabs[0].id;
    }
    const tab = await chrome.tabs.create({ url: SEARCH_TAB_URL, active: true });
    if (tab.id == null)
        throw new Error('Không tạo được tab Shopee tìm kiếm');
    await waitForTabComplete(tab.id);
    await sleep(800);
    return tab.id;
}

function buildKeywordSearchUrl(keyword) {
    const url = new URL('https://shopee.vn/search');
    url.searchParams.set('keyword', String(keyword ?? '').trim());
    url.searchParams.delete('page');
    return url.toString();
}

function searchTabKeyword(tabUrl) {
    try {
        return new URL(tabUrl ?? '').searchParams.get('keyword')?.trim() ?? '';
    }
    catch {
        return '';
    }
}

async function navigateSearchTabToKeyword(searchTabId, keyword, navigateDelayMs) {
    const tab = await chrome.tabs.get(searchTabId);
    const want = normalizeTitleKey(keyword);
    const current = normalizeTitleKey(searchTabKeyword(tab.url));
    const onSearch = /shopee\.vn\/search/i.test(tab.url ?? '');
    if (onSearch && current === want) {
        await sleep(Math.max(navigateDelayMs, 3000));
        await ensureTabReady(searchTabId, 'shopee');
        return;
    }
    await chrome.tabs.update(searchTabId, {
        url: buildKeywordSearchUrl(keyword),
        active: true,
    });
    await waitForTabComplete(searchTabId, 35000);
    await sleep(Math.max(navigateDelayMs, 4000));
    await ensureTabReady(searchTabId, 'shopee');
    await sleep(1500);
}

async function sendGeminiSchemaPrompt({ prompt, requestId, title, description, expectedSchema }) {
    const geminiTabId = await openGeminiTabIfNeeded();
    await ensureTabReady(geminiTabId, 'gemini');
    const response = await sendTabMessageReady(geminiTabId, 'gemini', {
        type: MessageType.GEMINI_SEND_PROMPT,
        payload: {
            prompt,
            requestId,
            title,
            description,
            expectedSchema,
        },
    });
    if (response?.error)
        throw new Error(response.error);
    return response;
}

async function crawlKeywordOnSearchTab(searchTabId, crawlPayload) {
    await ensureTabReady(searchTabId, 'shopee');
    const response = await sendTabMessageReady(searchTabId, 'shopee', {
        type: MessageType.SHOPEE_SEARCH_CRAWL,
        payload: crawlPayload,
    });
    if (response?.status === 'cancelled') {
        throw new Error(response.error ?? 'Đã hủy crawl');
    }
    if (response?.error && !response?.status) {
        throw new Error(response.error);
    }
    return response;
}

async function handleOptimizeProduct(payload, sellerTabId) {
    const requestId = payload.requestId ?? createRequestId();
    if (!payload?.title?.trim() && !payload?.description?.trim()) {
        return { requestId, ok: false, error: 'Thiếu tiêu đề/mô tả sản phẩm' };
    }
    if (sellerTabId == null) {
        return { requestId, ok: false, error: 'Không xác định được tab sửa sản phẩm' };
    }
    if (optimizeState && !optimizeState.cancelled) {
        return { requestId, ok: false, error: 'Pipeline tối ưu đang chạy — đợi xong hoặc Hủy' };
    }

    const runId = createRequestId();
    optimizeState = {
        runId,
        sellerTabId,
        searchTabId: null,
        cancelled: false,
        waitingCaptcha: false,
        resumeResolve: null,
    };

    const startedAt = Date.now();
    const settings = await getSettings();
    const product = {
        title: payload.title ?? '',
        description: payload.description ?? '',
        shopName: payload.shopName ?? '',
        language: settings.language,
        itemId: String(payload.itemId ?? '').trim(),
        shopId: String(payload.shopId ?? '').trim(),
        platform: payload.platform ?? 'shopee',
    };

    try {
        await sendOptimizeProgress(sellerTabId, { text: 'Đang hỏi Gemini từ khóa…' });

        const keywordPrompt = buildKeywordPrompt(product, settings);
        const kwResponse = await sendGeminiSchemaPrompt({
            prompt: keywordPrompt,
            requestId: `${requestId}_kw`,
            title: product.title,
            description: product.description,
            expectedSchema: 'keywords',
        });
        if (isOptimizeCancelled())
            return { requestId, ok: false, error: 'Đã hủy pipeline' };

        const parsedKeywords = parseGeminiKeywordsJson(kwResponse.text ?? '');
        if (!parsedKeywords?.keywords?.length) {
            return {
                requestId,
                ok: false,
                error: 'Gemini không trả JSON keywords hợp lệ',
            };
        }

        const maxKeywords = Math.max(1, Number(settings.optimizeMaxKeywords) || 8);
        const keywords = parsedKeywords.keywords.slice(0, maxKeywords);
        const crawlResults = [];

        const searchTabId = await openOrReuseSearchTab();
        if (optimizeState)
            optimizeState.searchTabId = searchTabId;

        for (let i = 0; i < keywords.length; i++) {
            if (isOptimizeCancelled())
                return { requestId, ok: false, error: 'Đã hủy pipeline' };
            if (Date.now() - startedAt > OPTIMIZE_TOTAL_TIMEOUT_MS) {
                return { requestId, ok: false, error: 'Hết thời gian pipeline tối ưu (15 phút)' };
            }

            const keyword = keywords[i];
            await sendOptimizeProgress(sellerTabId, {
                text: `Tìm kiếm trang 1 (${i + 1}/${keywords.length}): «${keyword}»`,
            });

            let chunk = null;
            while (!chunk) {
                if (isOptimizeCancelled())
                    return { requestId, ok: false, error: 'Đã hủy pipeline' };

                const crawlPayload = {
                    keyword,
                    minSold: settings.optimizeMinSold,
                    sourceItemId: product.itemId,
                    sourceTitle: product.title,
                    navigateDelayMs: settings.optimizeNavigateDelayMs,
                    scrollStepDelayMs: settings.optimizeScrollStepDelayMs,
                    minProductCards: settings.optimizeMinProductCards,
                };

                try {
                    await navigateSearchTabToKeyword(
                        searchTabId,
                        keyword,
                        Math.max(Number(settings.optimizeNavigateDelayMs) || 4000, 3000),
                    );
                    const response = await crawlKeywordOnSearchTab(searchTabId, {
                        ...crawlPayload,
                        skipNavigate: true,
                    });
                    if (response.status === 'captcha') {
                        if (optimizeState)
                            optimizeState.waitingCaptcha = true;
                        await sendOptimizeProgress(sellerTabId, {
                            text: 'Chờ CAPTCHA — giải trên tab Shopee tìm kiếm, rồi bấm Tiếp tục',
                            waitingCaptcha: true,
                            status: 'waiting_captcha',
                        });
                        await waitForOptimizeResume();
                        if (optimizeState) {
                            optimizeState.waitingCaptcha = false;
                            optimizeState.resumeResolve = null;
                        }
                        if (isOptimizeCancelled())
                            return { requestId, ok: false, error: 'Đã hủy pipeline' };
                        continue;
                    }
                    chunk = {
                        keyword: response.keyword ?? keyword,
                        competitors: response.competitors ?? [],
                        sourcePosition: response.sourcePosition ?? null,
                    };
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    await sendOptimizeProgress(sellerTabId, {
                        text: `Lỗi crawl «${keyword}»: ${msg} — bỏ qua từ khóa này`,
                    });
                    chunk = {
                        keyword,
                        competitors: [],
                        sourcePosition: null,
                        error: msg,
                    };
                }
            }

            crawlResults.push(chunk);
            const count = chunk.competitors?.length ?? 0;
            const pos = chunk.sourcePosition;
            const posText = !pos || pos.empty
                ? 'chưa xác định'
                : pos.found
                    ? `#${pos.rank ?? '—'}`
                    : 'không thấy SP gốc';
            await sendOptimizeProgress(sellerTabId, {
                text: `«${keyword}»: ${count} đối thủ, SP gốc ${posText}`,
            });

            if (i < keywords.length - 1) {
                const betweenDelay = Math.max(
                    Number(settings.optimizeBetweenKeywordDelayMs) || 3500,
                    2000,
                );
                await sleep(betweenDelay);
            }
        }

        if (isOptimizeCancelled())
            return { requestId, ok: false, error: 'Đã hủy pipeline' };

        const totalCompetitors = crawlResults.reduce(
            (sum, chunk) => sum + (chunk.competitors?.length ?? 0),
            0,
        );
        if (totalCompetitors === 0) {
            return {
                requestId,
                ok: false,
                error: 'Không crawl được đối thủ SERP (bảng TSV trống) — mở tab shopee.vn/search, giải CAPTCHA nếu có, reload extension rồi thử lại',
            };
        }

        await sendOptimizeProgress(sellerTabId, { text: 'Đang phân tích đối thủ với Gemini…' });

        const analysisPrompt = buildAnalysisPrompt({
            ...product,
            crawlResults,
        }, settings);
        const analysisResponse = await sendGeminiSchemaPrompt({
            prompt: analysisPrompt,
            requestId: `${requestId}_analysis`,
            title: product.title,
            description: product.description,
            expectedSchema: 'product',
        });
        if (isOptimizeCancelled())
            return { requestId, ok: false, error: 'Đã hủy pipeline' };

        const parsedProduct = parseGeminiProductJson(analysisResponse.text ?? '');
        if (!parsedProduct) {
            return {
                requestId,
                ok: false,
                error: 'Gemini không trả JSON {title, description} hợp lệ',
            };
        }

        const data = sanitizeRewrittenProduct(parsedProduct, product.shopName);
        await applyToSellerTab(sellerTabId, data);
        await sendOptimizeProgress(sellerTabId, {
            text: 'Đã áp dụng tiêu đề và mô tả mới vào form',
            done: true,
        });
        return { requestId, ok: true, data };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOptimizeProgress(sellerTabId, { error: msg });
        return { requestId, ok: false, error: msg };
    }
    finally {
        clearOptimizeState();
    }
}

/** Tăng khi hủy / rewrite mới — bỏ qua sendResponse cho tác vụ rewrite cũ */
let rewriteEpoch = 0;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MessageType.PING) {
        safeSendResponse(sendResponse, { ok: true });
        return false;
    }
    if (message.type === MessageType.GET_SETTINGS) {
        return replyAsync(sendResponse, () => getSettings());
    }
    if (message.type === MessageType.OPEN_GEMINI_TAB) {
        return replyAsync(sendResponse, async () => {
            await openGeminiTabIfNeeded();
            return { ok: true };
        });
    }
    if (message.type === MessageType.GEMINI_FILL_PROMPT) {
        const prompt = message.payload?.prompt?.trim();
        if (!prompt) {
            safeSendResponse(sendResponse, { ok: false, error: 'Thiếu prompt' });
            return false;
        }
        return replyAsync(sendResponse, () => sendGeminiFillPrompt(prompt));
    }
    if (message.type === MessageType.GEMINI_CANCEL) {
        rewriteEpoch += 1;
        return replyAsync(sendResponse, async () => {
            const tabs = await chrome.tabs.query({
                url: 'https://gemini.google.com/*',
            });
            if (tabs[0]?.id != null) {
                try {
                    await sendTabMessage(tabs[0].id, {
                        type: MessageType.GEMINI_CANCEL,
                    });
                }
                catch {
                    /* tab chưa có script */
                }
            }
            return { ok: true };
        });
    }
    if (message.type === MessageType.REWRITE_PRODUCT) {
        const payload = message.payload;
        const epoch = ++rewriteEpoch;
        return replyAsync(sendResponse, () => withServiceWorkerKeepalive(async () => {
            const result = await handleRewriteProduct(payload, sender.tab?.id);
            if (epoch !== rewriteEpoch) {
                return {
                    requestId: result.requestId,
                    ok: false,
                    error: 'Đã hủy chờ Gemini',
                };
            }
            return result;
        }));
    }
    if (message.type === MessageType.OPEN_CHATGPT_IMAGE) {
        const prompt = message.payload?.prompt;
        if (!prompt?.trim()) {
            safeSendResponse(sendResponse, { ok: false, error: 'Thiếu prompt tạo ảnh' });
            return false;
        }
        return replyAsync(sendResponse, () => withServiceWorkerKeepalive(async () => {
            await openChatGPTWithImagePrompt(prompt.trim());
            return { ok: true };
        }));
    }
    if (message.type === MessageType.OPTIMIZE_PRODUCT) {
        const payload = message.payload;
        return replyAsync(sendResponse, () => withServiceWorkerKeepalive(() => handleOptimizeProduct(payload, sender.tab?.id)));
    }
    if (message.type === MessageType.OPTIMIZE_RESUME) {
        return replyAsync(sendResponse, async () => {
            if (!optimizeState?.waitingCaptcha) {
                return { ok: false, error: 'Pipeline không đang chờ CAPTCHA' };
            }
            optimizeState.waitingCaptcha = false;
            optimizeState.resumeResolve?.();
            optimizeState.resumeResolve = null;
            return { ok: true };
        });
    }
    if (message.type === MessageType.OPTIMIZE_CANCEL) {
        return replyAsync(sendResponse, async () => {
            if (optimizeState) {
                optimizeState.cancelled = true;
                optimizeState.waitingCaptcha = false;
                optimizeState.resumeResolve?.();
                optimizeState.resumeResolve = null;
                if (optimizeState.searchTabId != null) {
                    try {
                        await sendTabMessage(optimizeState.searchTabId, {
                            type: MessageType.OPTIMIZE_CANCEL,
                        });
                    }
                    catch {
                        /* tab search có thể đã đóng */
                    }
                }
            }
            return { ok: true };
        });
    }
    return false;
});
