import { getGeminiLastResponseHash, } from '../../shared/storage.js';
import { parseGeminiKeywordsJson, parseGeminiProductJson, } from '../../shared/gemini-json.js';
import { hashText } from '../../shared/text-hash.js';
import { getModelResponseElements, isGeminiGenerating } from './dom-query.js';
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
function pickWatchBubble(nodes, snapshot) {
    if (nodes.length === 0)
        return null;
    if (nodes.length > snapshot.modelCount) {
        const index = snapshot.modelCount;
        return {
            el: nodes[index],
            index,
            strategy: `bubble_mới tại index=${index} (nodes=${nodes.length} > modelCount=${snapshot.modelCount})`,
        };
    }
    const tailIndex = nodes.length - 1;
    return {
        el: nodes[tailIndex],
        index: tailIndex,
        strategy: `bubble_đuôi index=${tailIndex} (chưa thêm node; nodes=${nodes.length} === modelCount=${snapshot.modelCount})`,
    };
}
/** @typedef {'keywords' | 'product'} GeminiExpectedSchema */

function hasValidGeminiJson(text, expectedSchema = 'product') {
    if (expectedSchema === 'keywords') {
        return !!parseGeminiKeywordsJson(text);
    }
    return !!parseGeminiProductJson(text);
}

function jsonSchemaLabel(expectedSchema) {
    return expectedSchema === 'keywords'
        ? 'JSON keywords'
        : 'JSON title/description';
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
    const nodes = getModelResponseElements(scope);
    for (let i = nodes.length - 1; i >= 0; i--) {
        const text = readBubbleText(nodes[i]);
        if (!text || !hasValidGeminiJson(text, expectedSchema))
            continue;
        const currentHash = hashText(text);
        if (!isNewResponseHash(currentHash, snapshot).ok)
            continue;
        return { text, index: i, hash: currentHash };
    }
    return null;
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
        const nodes = getModelResponseElements(scope);
        cache.nodeLength = nodes.length;
        if (nodes.length > snapshot.modelCount) {
            forceScan = true;
        }
        else if (nodes.length > 0) {
            const tailIndex = nodes.length - 1;
            const tail = nodes[tailIndex];
            cache.bubble = tail;
            cache.bubbleIndex = tailIndex;
            return {
                el: tail,
                index: tailIndex,
                strategy: `cache-đuôi index=${tailIndex} (cập nhật tại chỗ, nodes=${nodes.length})`,
            };
        }
    }
    const nodes = getModelResponseElements(scope);
    cache.nodeLength = nodes.length;
    const picked = pickWatchBubble(nodes, snapshot);
    cache.bubble = picked?.el ?? null;
    cache.bubbleIndex = picked?.index ?? -1;
    if (forceScan && cache.nodeLength !== nodes.length) {
        geminiDebugLog('scan', `forceScan: ${forceReason}`, {
            nodeLength: nodes.length,
            wasLength: cache.nodeLength,
            strategy: picked?.strategy ?? 'không có bubble',
        });
        geminiDebugTable('scan', `Bubbles document (modelCount=${snapshot.modelCount}, hiện=${nodes.length})`, buildBubbleRows(nodes), picked?.index);
    }
    return picked;
}
export async function captureSendSnapshot(sourceContentHash) {
    geminiDebugClearPanel();
    geminiDebugLog('snapshot', '── Bắt đầu captureSendSnapshot (trước khi gửi prompt) ──');
    const docNodes = getModelResponseElements(document);
    const modelCount = docNodes.length;
    const lastText = modelCount > 0 ? readBubbleText(docNodes[modelCount - 1]) : '';
    const previousResponseHash = await getGeminiLastResponseHash();
    const baselineHash = hashText(lastText);
    geminiDebugLog('snapshot', 'Quét toàn document (đã dedupe nested)', {
        modelCount,
        selectorProbe: probeSelectorCounts(document),
        tailIndex: modelCount > 0 ? modelCount - 1 : null,
    });
    if (modelCount > 0) {
        geminiDebugTable('snapshot', `Bubble document — theo dõi index=${modelCount} khi có câu mới`, buildBubbleRows(docNodes), modelCount - 1);
    }
    geminiDebugLog('snapshot', 'Mã băm trước khi gửi', {
        modelCount,
        baselineHash,
        previousResponseHash: previousResponseHash ?? '(chưa có)',
        sourceContentHash: sourceContentHash ?? '(không)',
        lastBubblePreview: lastText.slice(0, 100) || '(rỗng)',
    });
    return {
        modelCount,
        baselineHash,
        previousResponseHash,
        scopedRoot: document,
        sourceContentHash,
    };
}
export function waitForNewStableResponse(snapshot, timeoutMs = 120000, expectedSchema = 'product') {
    pollTickCount = 0;
    geminiDebugLog('wait', '── Bắt đầu chờ phản hồi mới (poll 1s) ──', {
        modelCount: snapshot.modelCount,
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
                geminiDebugLog('wait', 'Timeout — quét toàn bubble, tìm phản hồi mới → áp dụng', {
                    index: scanned.index,
                    textLen: scanned.text.length,
                });
                succeed(scanned.text, scanned.index);
                return;
            }
            const hash = lastSeenText ? hashText(lastSeenText) : '';
            const hashCheck = isNewResponseHash(hash, snapshot);
            if (lastSeenText &&
                hasValidGeminiJson(lastSeenText, expectedSchema) &&
                hashCheck.ok) {
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
                : ' (chưa đọc được nội dung phản hồi)';
            fail(new Error(`Hết thời gian chờ phản hồi Gemini${hint} — kiểm tra tab Gemini có ${jsonSchemaLabel(expectedSchema)}`));
        }, timeoutMs);
        const tick = () => {
            if (cancelled)
                return;
            pollTickCount += 1;
            const tickN = pollTickCount;
            const generating = isGeminiGenerating();
            const scope = getScope(snapshot);
            const awaitingMoreNodes = generating && cache.nodeLength <= snapshot.modelCount;
            const forceScan = !cache.bubble?.isConnected ||
                cache.nodeLength < 0 ||
                awaitingMoreNodes ||
                cache.nodeLength < snapshot.modelCount;
            const forceReason = !cache.bubble?.isConnected
                ? 'bubble cache mất DOM'
                : cache.nodeLength < 0
                    ? 'lần quét đầu'
                    : awaitingMoreNodes
                        ? `đang generate (nodes=${cache.nodeLength}, cần > ${snapshot.modelCount} hoặc cập nhật đuôi)`
                        : cache.nodeLength < snapshot.modelCount
                            ? 'số bubble giảm (DOM đổi)'
                            : 'đếm bubble thay đổi';
            const picked = refreshWatchCache(scope, snapshot, cache, forceScan, forceReason);
            if (!picked) {
                if (tickN === 1 || tickN % 5 === 0) {
                    geminiDebugLog('poll', `#${tickN} — không tìm thấy bubble model`, {
                        generating,
                        forceScan,
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
                    geminiDebugLog('poll', `#${tickN} — bubble rỗng`, {
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
            const settled =
                isStreamingSettled(stableStreak) ||
                (!generating && jsonOk && stableStreak >= 1);
            const blockers = [];
            if (!settled)
                blockers.push(`ổn định ${stableStreak}/${STABLE_POLLS_REQUIRED}`);
            if (!hashCheck.ok)
                blockers.push(hashCheck.reason);
            if (!jsonOk)
                blockers.push(`chưa parse được ${jsonSchemaLabel(expectedSchema)}`);
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
            if (settled && jsonOk && hashCheck.ok) {
                window.clearInterval(interval);
                window.clearTimeout(timeout);
                succeed(text, picked.index);
                return;
            }
            if (settled && jsonOk && !hashCheck.ok) {
                const scanned = scanForFreshResponse(scope, snapshot, expectedSchema);
                if (scanned) {
                    window.clearInterval(interval);
                    window.clearTimeout(timeout);
                    geminiDebugLog('poll', `#${tickN} bubble theo dõi trùng baseline — dùng bubble index=${scanned.index}`);
                    succeed(scanned.text, scanned.index);
                }
            }
        };
        const interval = window.setInterval(tick, POLL_INTERVAL_MS);
        tick();
    });
}
