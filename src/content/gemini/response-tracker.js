import { getGeminiLastResponseHash, } from '../../shared/storage.js';
import { parseGeminiKeywordsJson, parseGeminiOptimizeJson, parseGeminiProductJson, } from '../../shared/gemini-json.js';
import { hashText } from '../../shared/text-hash.js';
import { getModelResponseElements, getUserQueryElements, isGeminiGenerating, resolveWatchBubbleAfterUser, } from './dom-query.js';
import { buildBubbleRows, geminiDebugClearPanel, geminiDebugLog, geminiDebugTable, probeSelectorCounts, } from './gemini-debug-log.js';
/** Băm mỗi 1 giây; 2 lần liên tiếp trùng = stream xong */
const POLL_INTERVAL_MS = 1000;
const STABLE_POLLS_REQUIRED = 2;
let activeWaitCancel = null;
let pollTickCount = 0;
export function cancelActiveGeminiWait() {
    activeWaitCancel?.();
    activeWaitCancel = null;
}
function getScope(_snapshot) {
    return document;
}
function readBubbleText(el) {
    if (!el)
        return '';
    return (el.innerText ?? el.textContent ?? '').trim();
}
function pickWatchBubbleAfterUser(scope, snapshot) {
    const resolved = resolveWatchBubbleAfterUser(scope, snapshot.userCount);
    if (!resolved?.modelEl)
        return null;
    return {
        el: resolved.modelEl,
        index: resolved.modelIndex,
        strategy: `sau_user model index=${resolved.modelIndex} (users=${snapshot.userCount}→${getUserQueryElements(scope).length})`,
    };
}
function isExpectedModelBubble(picked, snapshot) {
    if (!picked?.el)
        return false;
    const resolved = resolveWatchBubbleAfterUser(document, snapshot.userCount);
    if (!resolved?.modelEl)
        return false;
    return picked.el === resolved.modelEl;
}
function verifyLatestUserBubble(snapshot) {
    const users = getUserQueryElements(document);
    if (users.length === 0) {
        return { ok: false, reason: 'chưa có user bubble trong chat' };
    }
    if (users.length <= snapshot.userCount) {
        return {
            ok: false,
            reason: `chưa thấy user bubble mới (users=${users.length}, cần > ${snapshot.userCount})`,
        };
    }
    const text = readBubbleText(users[users.length - 1]);
    if (!text) {
        return { ok: false, reason: 'user bubble mới nhất rỗng' };
    }
    const titleSnippet = snapshot.sourceTitleSnippet;
    if (titleSnippet && text.includes(titleSnippet)) {
        return { ok: true };
    }
    const snippet = snapshot.promptSnippet;
    if (snippet && (text.includes(snippet) || text.includes(snippet.slice(0, 60)))) {
        return { ok: true };
    }
    if (snapshot.promptHash && hashText(text) === snapshot.promptHash) {
        return { ok: true };
    }
    return {
        ok: false,
        reason: 'user bubble mới không khớp prompt đã gửi',
    };
}
/** @typedef {'keywords' | 'product' | 'optimize'} GeminiExpectedSchema */

function hasValidGeminiJson(text, expectedSchema = 'product') {
    if (expectedSchema === 'keywords') {
        return !!parseGeminiKeywordsJson(text);
    }
    if (expectedSchema === 'optimize') {
        return !!parseGeminiOptimizeJson(text);
    }
    return !!parseGeminiProductJson(text);
}

function jsonSchemaLabel(expectedSchema) {
    if (expectedSchema === 'keywords')
        return 'JSON keywords';
    if (expectedSchema === 'optimize')
        return 'JSON title/description/suggestedPrice';
    return 'JSON title/description';
}
function isStreamingSettled(stableStreak) {
    return stableStreak >= STABLE_POLLS_REQUIRED;
}
/** Chỉ từ chối khi nội dung vẫn y hệt lúc chụp snapshot (trước Send). */
function isNewResponseHash(currentHash, snapshot) {
    if (currentHash === snapshot.baselineHash) {
        return { ok: false, reason: 'hash === baselineHash (vẫn là bubble cũ trước khi gửi)' };
    }
    return { ok: true };
}

function scanForFreshResponse(scope, snapshot, expectedSchema) {
    const userCheck = verifyLatestUserBubble(snapshot);
    if (!userCheck.ok)
        return null;
    const resolved = resolveWatchBubbleAfterUser(scope, snapshot.userCount);
    if (!resolved?.modelEl)
        return null;
    const nodes = getModelResponseElements(scope);
    const index = nodes.indexOf(resolved.modelEl);
    if (index < 0)
        return null;
    const text = readBubbleText(resolved.modelEl);
    if (!text || !hasValidGeminiJson(text, expectedSchema))
        return null;
    const currentHash = hashText(text);
    if (!isNewResponseHash(currentHash, snapshot).ok)
        return null;
    return { text, index, hash: currentHash };
}
function finish(resolve, text, index) {
    resolve({
        text,
        hash: hashText(text),
        elementIndex: index,
    });
}
function refreshWatchCache(scope, snapshot, cache, forceScan, forceReason) {
    const connected = cache.bubble?.isConnected ?? false;
    if (!forceScan && connected) {
        const resolved = resolveWatchBubbleAfterUser(scope, snapshot.userCount);
        if (resolved?.modelEl === cache.bubble) {
            const nodes = getModelResponseElements(scope);
            cache.nodeLength = nodes.length;
            return {
                el: cache.bubble,
                index: cache.bubbleIndex,
                strategy: `cache-sau_user index=${cache.bubbleIndex}`,
            };
        }
        forceScan = true;
    }
    const nodes = getModelResponseElements(scope);
    cache.nodeLength = nodes.length;
    const picked = pickWatchBubbleAfterUser(scope, snapshot);
    cache.bubble = picked?.el ?? null;
    cache.bubbleIndex = picked?.index ?? -1;
    if (forceScan) {
        geminiDebugLog('scan', `forceScan: ${forceReason}`, {
            nodeLength: nodes.length,
            userCount: snapshot.userCount,
            usersNow: getUserQueryElements(scope).length,
            strategy: picked?.strategy ?? 'chưa có model sau user',
        });
        if (picked) {
            geminiDebugTable('scan', `Bubbles model (chờ sau user, hiện=${nodes.length})`, buildBubbleRows(nodes), picked.index);
        }
    }
    return picked;
}
export async function captureSendSnapshot(sourceContentHash, promptText = '', sourceTitle = '') {
    geminiDebugClearPanel();
    geminiDebugLog('snapshot', '── Bắt đầu captureSendSnapshot (trước khi gửi prompt) ──');
    const docNodes = getModelResponseElements(document);
    const userNodes = getUserQueryElements(document);
    const modelCount = docNodes.length;
    const userCount = userNodes.length;
    const lastText = modelCount > 0 ? readBubbleText(docNodes[modelCount - 1]) : '';
    const previousResponseHash = await getGeminiLastResponseHash();
    const baselineHash = hashText(lastText);
    const promptTrimmed = promptText.trim();
    const promptHash = promptTrimmed ? hashText(promptTrimmed) : undefined;
    const promptSnippet = promptTrimmed ? promptTrimmed.slice(0, 120) : undefined;
    const sourceTitleSnippet = String(sourceTitle ?? '').trim().slice(0, 80) || undefined;
    geminiDebugLog('snapshot', 'Quét toàn document (đã dedupe nested)', {
        modelCount,
        userCount,
        selectorProbe: probeSelectorCounts(document),
        tailIndex: modelCount > 0 ? modelCount - 1 : null,
        watchAfterUserIndex: userCount,
    });
    if (modelCount > 0) {
        geminiDebugTable('snapshot', `Bubble model hiện có (${modelCount}) — chờ bubble sau user mới`, buildBubbleRows(docNodes), modelCount - 1);
    }
    if (userCount > 0) {
        geminiDebugTable('snapshot', `Bubble user — cần thêm sau Send (hiện=${userCount})`, buildBubbleRows(userNodes), userCount - 1);
    }
    geminiDebugLog('snapshot', 'Mã băm trước khi gửi', {
        modelCount,
        userCount,
        baselineHash,
        previousResponseHash: previousResponseHash ?? '(chưa có)',
        sourceContentHash: sourceContentHash ?? '(không)',
        promptHash: promptHash ?? '(không)',
        lastBubblePreview: lastText.slice(0, 100) || '(rỗng)',
    });
    return {
        modelCount,
        userCount,
        baselineHash,
        previousResponseHash,
        scopedRoot: document,
        sourceContentHash,
        promptHash,
        promptSnippet,
        sourceTitleSnippet,
    };
}
export function waitForNewStableResponse(snapshot, timeoutMs = 120000, expectedSchema = 'product') {
    pollTickCount = 0;
    geminiDebugLog('wait', '── Bắt đầu chờ phản hồi mới (poll 1s, neo sau user bubble) ──', {
        modelCount: snapshot.modelCount,
        userCount: snapshot.userCount,
        baselineHash: snapshot.baselineHash,
        previousResponseHash: snapshot.previousResponseHash,
        timeoutMs,
        expectedSchema,
    });
    return new Promise((resolve, reject) => {
        let lastPollHash = null;
        let stableStreak = 0;
        let lastSeenText = '';
        let lastIndex = -1;
        let lastPickedEl = null;
        let cancelled = false;
        const cache = { bubble: null, bubbleIndex: -1, nodeLength: -1 };
        const cleanup = () => {
            activeWaitCancel = null;
        };
        const fail = (err) => {
            geminiDebugLog('wait', `✗ Kết thúc lỗi: ${err.message}`);
            cleanup();
            reject(err);
        };
        const succeed = (text, index) => {
            geminiDebugLog('wait', `✓ Hoàn tất tại bubble index=${index}`, {
                textLen: text.length,
                hash: hashText(text),
                jsonOk: true,
            });
            cleanup();
            finish(resolve, text, index);
        };
        activeWaitCancel = () => {
            cancelled = true;
            window.clearInterval(interval);
            window.clearTimeout(timeout);
            fail(new Error('Đã hủy chờ Gemini'));
        };
        const timeout = window.setTimeout(() => {
            window.clearInterval(interval);
            if (cancelled)
                return;
            const scope = getScope(snapshot);
            const scanned = scanForFreshResponse(scope, snapshot, expectedSchema);
            if (scanned) {
                geminiDebugLog('wait', 'Timeout — quét bubble sau user, tìm phản hồi mới → áp dụng', {
                    index: scanned.index,
                    textLen: scanned.text.length,
                });
                succeed(scanned.text, scanned.index);
                return;
            }
            const hash = lastSeenText ? hashText(lastSeenText) : '';
            const hashCheck = isNewResponseHash(hash, snapshot);
            const userCheck = verifyLatestUserBubble(snapshot);
            if (lastSeenText &&
                lastPickedEl &&
                hasValidGeminiJson(lastSeenText, expectedSchema) &&
                hashCheck.ok &&
                userCheck.ok &&
                isExpectedModelBubble({ el: lastPickedEl }, snapshot)) {
                geminiDebugLog('wait', 'Timeout nhưng đủ điều kiện → áp dụng');
                succeed(lastSeenText, lastIndex);
                return;
            }
            geminiDebugLog('wait', '✗ Timeout', {
                lastIndex,
                textLen: lastSeenText.length,
                jsonOk: hasValidGeminiJson(lastSeenText, expectedSchema),
                hashCheck: hashCheck.reason ?? 'ok',
                stableStreak,
                lastHash: hash.slice(0, 8),
            });
            const jsonOk = hasValidGeminiJson(lastSeenText, expectedSchema);
            const hint = lastSeenText.length > 0
                ? ` (đã thấy ${lastSeenText.length} ký tự, parse ${jsonSchemaLabel(expectedSchema)}: ${jsonOk ? 'OK' : 'fail'}${!hashCheck.ok ? `, ${hashCheck.reason}` : ''})`
                : ' (chưa đọc được nội dung phản hồi sau user bubble)';
            fail(new Error(`Hết thời gian chờ phản hồi Gemini${hint} — kiểm tra tab Gemini có ${jsonSchemaLabel(expectedSchema)}`));
        }, timeoutMs);
        const tick = () => {
            if (cancelled)
                return;
            pollTickCount += 1;
            const tickN = pollTickCount;
            const generating = isGeminiGenerating();
            const scope = getScope(snapshot);
            const resolved = resolveWatchBubbleAfterUser(scope, snapshot.userCount);
            const usersNow = getUserQueryElements(scope).length;
            const awaitingModelAfterUser = usersNow > snapshot.userCount && !resolved?.modelEl;
            const forceScan = !cache.bubble?.isConnected ||
                cache.nodeLength < 0 ||
                awaitingModelAfterUser ||
                (resolved?.modelEl != null && cache.bubble !== resolved.modelEl);
            const forceReason = !cache.bubble?.isConnected
                ? 'bubble cache mất DOM'
                : cache.nodeLength < 0
                    ? 'lần quét đầu'
                    : awaitingModelAfterUser
                        ? `đang chờ model sau user (users=${usersNow})`
                        : resolved?.modelEl && cache.bubble !== resolved.modelEl
                            ? 'model sau user đổi phần tử'
                            : 'quét lại';
            const picked = refreshWatchCache(scope, snapshot, cache, forceScan, forceReason);
            if (!picked) {
                if (tickN === 1 || tickN % 5 === 0) {
                    geminiDebugLog('poll', `#${tickN} — chưa có model sau user bubble`, {
                        generating,
                        forceScan,
                        usersNow,
                        userCount: snapshot.userCount,
                        scope: scope === document ? 'document' : 'element',
                    });
                }
                lastPollHash = null;
                stableStreak = 0;
                return;
            }
            const text = readBubbleText(picked.el);
            if (!text) {
                if (tickN === 1 || tickN % 5 === 0) {
                    geminiDebugLog('poll', `#${tickN} — bubble sau user rỗng`, {
                        index: picked.index,
                        strategy: picked.strategy,
                        generating,
                    });
                }
                lastPollHash = null;
                stableStreak = 0;
                return;
            }
            lastSeenText = text;
            lastIndex = picked.index;
            lastPickedEl = picked.el;
            const currentHash = hashText(text);
            if (lastPollHash !== null && currentHash === lastPollHash) {
                stableStreak += 1;
            }
            else {
                stableStreak = 0;
                lastPollHash = currentHash;
            }
            const hashCheck = isNewResponseHash(currentHash, snapshot);
            const jsonOk = hasValidGeminiJson(text, expectedSchema);
            const userCheck = verifyLatestUserBubble(snapshot);
            const isExpectedBubble = isExpectedModelBubble(picked, snapshot);
            const settled =
                isStreamingSettled(stableStreak) ||
                (!generating && jsonOk && stableStreak >= 1);
            const blockers = [];
            if (generating && !settled)
                blockers.push('Gemini đang generate');
            if (!isExpectedBubble)
                blockers.push('sai bubble (không phải model ngay sau user cuối)');
            if (!settled)
                blockers.push(`ổn định ${stableStreak}/${STABLE_POLLS_REQUIRED}`);
            if (!hashCheck.ok)
                blockers.push(hashCheck.reason);
            if (!jsonOk)
                blockers.push(`chưa parse được ${jsonSchemaLabel(expectedSchema)}`);
            if (!userCheck.ok)
                blockers.push(userCheck.reason);
            const shouldLog = tickN <= 3 ||
                tickN % 5 === 0 ||
                blockers.length === 0 ||
                (settled && hashCheck.ok && !jsonOk);
            if (shouldLog) {
                geminiDebugLog('poll', `#${tickN} bubble index=${picked.index}`, {
                    strategy: picked.strategy,
                    generating,
                    forceScan,
                    textLen: text.length,
                    hash: currentHash,
                    stableStreak,
                    blockers: blockers.length ? blockers : ['(sẵn sàng hoàn tất)'],
                });
            }
            if (settled &&
                jsonOk &&
                hashCheck.ok &&
                userCheck.ok &&
                isExpectedBubble) {
                window.clearInterval(interval);
                window.clearTimeout(timeout);
                succeed(text, picked.index);
                return;
            }
        };
        const interval = window.setInterval(tick, POLL_INTERVAL_MS);
        tick();
    });
}
