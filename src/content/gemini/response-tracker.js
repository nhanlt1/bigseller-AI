import { getGeminiLastResponseHash, } from '../../shared/storage.js';
import { parseGeminiKeywordsJson, parseGeminiOptimizeJson, parseGeminiProductJson, } from '../../shared/gemini-json.js';
import { hashText } from '../../shared/text-hash.js';
import { getModelResponseElements, getUserQueryElements, isGeminiGenerating } from './dom-query.js';
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
            inPlace: false,
            strategy: `bubble_mới index=${index} (nodes=${nodes.length} > modelCount=${snapshot.modelCount})`,
        };
    }
    if (nodes.length === snapshot.modelCount) {
        const tailIndex = nodes.length - 1;
        return {
            el: nodes[tailIndex],
            index: tailIndex,
            inPlace: true,
            strategy: `bubble_đuôi index=${tailIndex} (stream tại chỗ, nodes=${nodes.length})`,
        };
    }
    return null;
}
function isExpectedModelBubble(picked, snapshot, currentHash) {
    if (!picked)
        return false;
    if (picked.index >= snapshot.modelCount)
        return true;
    if (picked.inPlace &&
        picked.index === snapshot.modelCount - 1 &&
        snapshot.modelCount > 0 &&
        currentHash !== snapshot.baselineHash) {
        return true;
    }
    return false;
}
function verifyLatestUserBubble(snapshot) {
    const users = getUserQueryElements(document);
    if (users.length === 0) {
        return { ok: true };
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
    return { ok: true };
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
    const nodes = getModelResponseElements(scope);
    const userCheck = verifyLatestUserBubble(snapshot);
    if (!userCheck.ok)
        return null;
    let best = null;
    const tryIndex = (index, inPlace) => {
        const text = readBubbleText(nodes[index]);
        if (!text || !hasValidGeminiJson(text, expectedSchema))
            return;
        const currentHash = hashText(text);
        if (!isNewResponseHash(currentHash, snapshot).ok)
            return;
        const picked = { index, inPlace };
        if (!isExpectedModelBubble(picked, snapshot, currentHash))
            return;
        best = { text, index, hash: currentHash };
    };
    for (let index = snapshot.modelCount; index < nodes.length; index++) {
        tryIndex(index, false);
    }
    if (!best && nodes.length === snapshot.modelCount && nodes.length > 0) {
        tryIndex(nodes.length - 1, true);
    }
    return best;
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
        else if (nodes.length === snapshot.modelCount && nodes.length > 0) {
            const tailIndex = nodes.length - 1;
            const tail = nodes[tailIndex];
            cache.bubble = tail;
            cache.bubbleIndex = tailIndex;
            return {
                el: tail,
                index: tailIndex,
                inPlace: true,
                strategy: `cache-đuôi index=${tailIndex} (stream tại chỗ)`,
            };
        }
        else {
            cache.bubble = null;
            cache.bubbleIndex = -1;
            return null;
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
        watchModelIndex: modelCount,
    });
    if (modelCount > 0) {
        geminiDebugTable('snapshot', `Bubble model — chờ bubble mới tại index=${modelCount}`, buildBubbleRows(docNodes), modelCount - 1);
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
    geminiDebugLog('wait', '── Bắt đầu chờ phản hồi mới (poll 1s) ──', {
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
            const userCheck = verifyLatestUserBubble(snapshot);
            if (lastSeenText &&
                hasValidGeminiJson(lastSeenText, expectedSchema) &&
                hashCheck.ok &&
                userCheck.ok &&
                isExpectedModelBubble({ index: lastIndex, inPlace: lastIndex === snapshot.modelCount - 1 && snapshot.modelCount > 0 }, snapshot, hash)) {
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
            const userCheck = verifyLatestUserBubble(snapshot);
            const isExpectedBubble = isExpectedModelBubble(picked, snapshot, currentHash);
            const settled =
                isStreamingSettled(stableStreak) ||
                (!generating && jsonOk && stableStreak >= 1) ||
                (jsonOk && stableStreak >= 1 && picked.index >= snapshot.modelCount);
            const blockers = [];
            if (generating && !settled)
                blockers.push('Gemini đang generate');
            if (!isExpectedBubble)
                blockers.push(`sai bubble (index=${picked.index}, modelCount=${snapshot.modelCount})`);
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
