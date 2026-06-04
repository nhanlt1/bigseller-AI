import { getGeminiLastResponseHash, parseGeminiProductJson, } from '../../shared/storage.js';
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
function hasValidProductJson(text) {
    return !!parseGeminiProductJson(text);
}
function isStreamingSettled(stableStreak) {
    return stableStreak >= STABLE_POLLS_REQUIRED;
}
function isNewResponseHash(currentHash, snapshot) {
    if (currentHash === snapshot.baselineHash) {
        return { ok: false, reason: 'hash === baselineHash (vẫn là bubble cũ trước khi gửi)' };
    }
    if (snapshot.previousResponseHash &&
        currentHash === snapshot.previousResponseHash) {
        return {
            ok: false,
            reason: 'hash === previousResponseHash (trùng lần phản hồi đã lưu)',
        };
    }
    return { ok: true };
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
export function waitForNewStableResponse(snapshot, timeoutMs = 120000) {
    pollTickCount = 0;
    geminiDebugLog('wait', '── Bắt đầu chờ phản hồi mới (poll 1s) ──', {
        modelCount: snapshot.modelCount,
        baselineHash: snapshot.baselineHash,
        previousResponseHash: snapshot.previousResponseHash,
        timeoutMs,
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
            const hash = lastSeenText ? hashText(lastSeenText) : '';
            const hashCheck = isNewResponseHash(hash, snapshot);
            if (lastSeenText &&
                hasValidProductJson(lastSeenText) &&
                hashCheck.ok) {
                geminiDebugLog('wait', 'Timeout nhưng đủ điều kiện → áp dụng');
                succeed(lastSeenText, lastIndex);
                return;
            }
            geminiDebugLog('wait', '✗ Timeout', {
                lastIndex,
                textLen: lastSeenText.length,
                jsonOk: hasValidProductJson(lastSeenText),
                hashCheck: hashCheck.reason ?? 'ok',
                stableStreak,
                lastHash: hash.slice(0, 8),
            });
            const hint = lastSeenText.length > 0
                ? ` (đã thấy ${lastSeenText.length} ký tự, parse JSON: ${hasValidProductJson(lastSeenText) ? 'OK' : 'fail'})`
                : ' (chưa đọc được nội dung phản hồi)';
            fail(new Error(`Hết thời gian chờ phản hồi Gemini${hint} — kiểm tra tab Gemini có JSON title/description`));
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
            const jsonOk = hasValidProductJson(text);
            const settled = isStreamingSettled(stableStreak);
            const blockers = [];
            if (!settled)
                blockers.push(`ổn định ${stableStreak}/${STABLE_POLLS_REQUIRED}`);
            if (!hashCheck.ok)
                blockers.push(hashCheck.reason);
            if (!jsonOk)
                blockers.push('chưa parse được JSON title/description');
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
            if (!settled || !hashCheck.ok || !jsonOk)
                return;
            window.clearInterval(interval);
            window.clearTimeout(timeout);
            succeed(text, picked.index);
        };
        const interval = window.setInterval(tick, POLL_INTERVAL_MS);
        tick();
    });
}
