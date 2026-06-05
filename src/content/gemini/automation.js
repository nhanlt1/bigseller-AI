import { setGeminiLastResponseHash, } from '../../shared/storage.js';
import { parseGeminiKeywordsJson, parseGeminiProductJson, } from '../../shared/gemini-json.js';
import { hashProductContent } from '../../shared/text-hash.js';
import { queryFirst, setQuillText, waitForElement } from '../shared/dom-utils.js';
import { GEMINI_INPUT_SELECTORS, GEMINI_SEND_SELECTORS } from './selectors.js';
import { geminiDebugLog } from './gemini-debug-log.js';
import { captureSendSnapshot, waitForNewStableResponse } from './response-tracker.js';
function clickSend() {
    const btn = queryFirst(GEMINI_SEND_SELECTORS);
    if (!btn || btn.disabled)
        return false;
    btn.click();
    return true;
}
export function fillGeminiInput(editor, prompt) {
    const quillRoot = editor.closest('rich-textarea, .rich-textarea, .text-input-field_textarea') ??
        editor.parentElement ??
        editor;
    if (quillRoot.querySelector('.ql-editor')) {
        setQuillText(quillRoot, prompt);
        return;
    }
    editor.focus();
    editor.innerHTML = '';
    for (const line of prompt.split('\n')) {
        const p = document.createElement('p');
        p.textContent = line;
        editor.appendChild(p);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
}
/** Chỉ điền prompt vào ô chat — không gửi, không chờ phản hồi */
export async function fillGeminiComposer(prompt) {
    const editor = await waitForElement(GEMINI_INPUT_SELECTORS, 30000);
    if (!editor)
        throw new Error('Không tìm thấy ô nhập Gemini');
    fillGeminiInput(editor, prompt);
    editor.focus();
}

/** @typedef {'keywords' | 'product'} GeminiExpectedSchema */

export async function runGeminiPrompt(prompt, requestId, sourceTitle, sourceDescription, expectedSchema = 'product') {
    try {
        geminiDebugLog('run', `requestId=${requestId} — bắt đầu runGeminiPrompt`, { expectedSchema });
        const editor = await waitForElement(GEMINI_INPUT_SELECTORS, 30000);
        if (!editor) {
            throw new Error('Không tìm thấy ô nhập Gemini');
        }
        const sourceHash = sourceTitle !== undefined
            ? hashProductContent(sourceTitle, sourceDescription ?? '')
            : undefined;
        const snapshot = await captureSendSnapshot(sourceHash);
        fillGeminiInput(editor, prompt);
        await new Promise((r) => setTimeout(r, 400));
        if (!clickSend()) {
            throw new Error('Không thể gửi tin nhắn (nút Send không khả dụng)');
        }
        geminiDebugLog('run', 'Đã bấm Send — bắt đầu poll bubble');
        const { text: responseText, hash: responseHash } = await waitForNewStableResponse(snapshot, 120000, expectedSchema);
        const parsed = expectedSchema === 'keywords'
            ? parseGeminiKeywordsJson(responseText)
            : parseGeminiProductJson(responseText);
        if (!parsed) {
            const schemaHint = expectedSchema === 'keywords'
                ? '{"keywords":["..."]}'
                : '{"title":"...","description":"..."}';
            return {
                requestId,
                text: responseText,
                error: `Gemini phải trả JSON ${schemaHint} — không parse được`,
            };
        }
        await setGeminiLastResponseHash(responseHash);
        return {
            requestId,
            text: JSON.stringify(parsed),
            responseHash,
            baselineHash: snapshot.baselineHash,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        geminiDebugLog('run', `✗ Lỗi: ${msg}`);
        return {
            requestId,
            text: '',
            error: msg,
        };
    }
}
