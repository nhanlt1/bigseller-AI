import {
  parseGeminiProductJson,
  setGeminiLastResponseHash,
} from '../../shared/storage';
import { hashProductContent } from '../../shared/text-hash';
import type { GeminiResponsePayload } from '../../shared/types';
import { queryFirst, setQuillText, waitForElement } from '../shared/dom-utils';
import { GEMINI_INPUT_SELECTORS, GEMINI_SEND_SELECTORS } from './selectors';
import { geminiDebugLog } from './gemini-debug-log';
import { captureSendSnapshot, waitForNewStableResponse } from './response-tracker';

function clickSend(): boolean {
  const btn = queryFirst<HTMLButtonElement>(GEMINI_SEND_SELECTORS);
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}

function fillGeminiInput(editor: HTMLElement, prompt: string): void {
  const quillRoot =
    editor.closest('rich-textarea, .rich-textarea, .text-input-field_textarea') ??
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

export async function runGeminiPrompt(
  prompt: string,
  requestId: string,
  sourceTitle?: string,
  sourceDescription?: string,
): Promise<GeminiResponsePayload> {
  try {
    geminiDebugLog('run', `requestId=${requestId} — bắt đầu runGeminiPrompt`);
    const editor = await waitForElement<HTMLElement>(GEMINI_INPUT_SELECTORS, 30000);
    if (!editor) {
      throw new Error('Không tìm thấy ô nhập Gemini');
    }

    const sourceHash =
      sourceTitle !== undefined
        ? hashProductContent(sourceTitle, sourceDescription ?? '')
        : undefined;

    const snapshot = await captureSendSnapshot(sourceHash);

    fillGeminiInput(editor, prompt);
    await new Promise((r) => setTimeout(r, 400));

    if (!clickSend()) {
      throw new Error('Không thể gửi tin nhắn (nút Send không khả dụng)');
    }
    geminiDebugLog('run', 'Đã bấm Send — bắt đầu poll bubble');

    const { text: responseText, hash: responseHash } =
      await waitForNewStableResponse(snapshot);

    const parsed = parseGeminiProductJson(responseText);
    if (!parsed) {
      return {
        requestId,
        text: responseText,
        error:
          'Gemini phải trả JSON {"title":"...","description":"..."} — không parse được',
      };
    }

    await setGeminiLastResponseHash(responseHash);

    return {
      requestId,
      text: JSON.stringify(parsed),
      responseHash,
      baselineHash: snapshot.baselineHash,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    geminiDebugLog('run', `✗ Lỗi: ${msg}`);
    return {
      requestId,
      text: '',
      error: msg,
    };
  }
}
