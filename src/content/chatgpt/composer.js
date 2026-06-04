import { queryFirst, waitForElement } from '../shared/dom-utils.js';

const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[id="prompt-textarea"]',
    'div#prompt-textarea[contenteditable="true"]',
    'form.group\\/composer [contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[data-testid="composer-text-input"]',
    '[aria-label="Trò chuyện với ChatGPT"][contenteditable="true"]',
    'textarea[name="prompt-textarea"]',
];

export async function fillChatGPTComposer(prompt) {
    const editor = await waitForElement(COMPOSER_SELECTORS, 20000);
    if (!editor) {
        throw new Error('Không tìm thấy ô nhập ChatGPT (#prompt-textarea)');
    }
    const editable = resolveEditable(editor);
    await focusComposerEditor(editable);
    setComposerText(editable, prompt);
    await sleep(250);
    await focusComposerEditor(editable);
    triggerCtrlU(editable);
    return editable;
}

function triggerCtrlU(editor) {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const eventInit = {
        key: 'u',
        code: 'KeyU',
        bubbles: true,
        cancelable: true,
        ctrlKey: !isMac,
        metaKey: isMac,
    };
    editor.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    editor.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}

function resolveEditable(editor) {
    if (editor.isContentEditable) {
        return editor;
    }
    return editor.querySelector('[contenteditable="true"]') ?? editor;
}

async function focusComposerEditor(passed) {
    const root =
        passed ??
        queryFirst(COMPOSER_SELECTORS) ??
        (await waitForElement(COMPOSER_SELECTORS, 8000));
    if (!root) {
        throw new Error('Không tìm thấy khung chat ChatGPT');
    }
    const editable = resolveEditable(root);
    editable.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(50);
    editable.focus({ preventScroll: true });
    await sleep(100);
    return editable;
}

/** Điền text không phá DOM React (tránh innerHTML → lỗi hydration #418) */
function setComposerText(root, text) {
    root.focus();
    const selection = window.getSelection();
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(root);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    if (document.execCommand('insertText', false, text)) {
        root.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text,
            }),
        );
        return;
    }

    try {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        const pasted = root.dispatchEvent(
            new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: data,
            }),
        );
        if (pasted) {
            return;
        }
    } catch {
        /* ClipboardEvent + DataTransfer không khả dụng */
    }

    throw new Error('Không điền được prompt vào ô ChatGPT');
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
