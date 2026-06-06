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

const COMPOSER_ROOT_SELECTORS = [
    'form.group\\/composer',
    '[data-testid="composer"]',
    'main form',
];

const ATTACH_BUTTON_SELECTORS = [
    'button[data-testid="composer-plus-btn"]',
    'button[data-testid="composer-attach-file-button"]',
    'button[aria-label="Attach files"]',
    'button[aria-label="Add photos & files"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Đính kèm"]',
    'button[aria-label*="Thêm ảnh"]',
    'button[aria-label*="Tải lên"]',
];

const FILE_INPUT_SELECTORS = [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
];

const PHOTO_MENU_LABEL = /photo|ảnh|hình|image|tệp|file|upload|đính kèm/i;

/**
 * @param {string} prompt
 * @param {{ imageBase64?: string, imageMimeType?: string }} [opts]
 */
export async function fillChatGPTComposer(prompt, opts = {}) {
    const editor = await waitForElement(COMPOSER_SELECTORS, 20000);
    if (!editor) {
        throw new Error('Không tìm thấy ô nhập ChatGPT (#prompt-textarea)');
    }
    const editable = resolveEditable(editor);
    await focusComposerEditor(editable);
    setComposerText(editable, prompt);
    await sleep(400);

    let imageAttached = false;
    const base64 = String(opts.imageBase64 ?? '').trim();
    if (base64) {
        const file = base64ToFile(
            base64,
            opts.imageMimeType || 'image/jpeg',
            'bigseller-product.jpg',
        );
        imageAttached = await attachImageToComposer(editable, file);
    }

    let uploadUiOpened = false;
    if (!imageAttached && !base64) {
        uploadUiOpened = await openComposerUploadUi(editable);
    }

    return { editor: editable, imageAttached, uploadUiOpened };
}

/**
 * dispatchEvent(KeyboardEvent) có isTrusted=false — trình duyệt chặn phím tắt mở file picker.
 * Thay bằng paste/drop/file-input hoặc bấm nút đính kèm trên UI ChatGPT.
 */
async function attachImageToComposer(editor, file) {
    const composerRoot = findComposerRoot(editor);
    const before = countComposerAttachments(composerRoot);

    const input =
        queryFirst(FILE_INPUT_SELECTORS, composerRoot) ??
        queryFirst(FILE_INPUT_SELECTORS, document);
    if (input instanceof HTMLInputElement) {
        if (assignFileToInput(input, file)) {
            if (await waitForMoreAttachments(composerRoot, before))
                return true;
            return false;
        }
    }

    await clickAttachButton(composerRoot);
    await sleep(350);
    const openedInput = await waitForFileInput(composerRoot, 2000);
    if (openedInput instanceof HTMLInputElement) {
        if (assignFileToInput(openedInput, file)) {
            if (await waitForMoreAttachments(composerRoot, before))
                return true;
            return false;
        }
    }

    if (await tryPasteImageFile(editor, file)) {
        await sleep(450);
        if (countComposerAttachments(composerRoot) > before)
            return true;
    }

    return false;
}

function countComposerAttachments(root) {
    const scope = root instanceof Element ? root : document;
    const inScope = scope.querySelectorAll(
        '[data-testid*="attachment" i], [class*="attachment" i], [class*="Attachment" i], img[src^="blob:"]',
    ).length;
    if (inScope > 0)
        return inScope;
    return document.querySelectorAll(
        'form.group\\/composer [data-testid*="attachment" i], form.group\\/composer img[src^="blob:"]',
    ).length;
}

async function waitForMoreAttachments(root, before, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (countComposerAttachments(root) > before)
            return true;
        await sleep(120);
    }
    return countComposerAttachments(root) > before;
}

async function openComposerUploadUi(editor) {
    const composerRoot = findComposerRoot(editor);
    const clicked = await clickAttachButton(composerRoot);
    if (!clicked)
        return false;
    await sleep(300);
    clickPhotoMenuItem();
    await sleep(200);
    return true;
}

function findComposerRoot(editor) {
    return (
        editor.closest('form') ??
        queryFirst(COMPOSER_ROOT_SELECTORS) ??
        editor.parentElement
    );
}

async function clickAttachButton(root) {
    const scopes = [root, document].filter(Boolean);
    for (const scope of scopes) {
        const btn = queryFirst(ATTACH_BUTTON_SELECTORS, scope);
        if (btn instanceof HTMLElement) {
            btn.click();
            return true;
        }
    }
    return false;
}

function clickPhotoMenuItem() {
    const items = document.querySelectorAll(
        '[role="menuitem"], [role="menuitemradio"], [role="option"], button, a',
    );
    for (const el of items) {
        const label = (
            el.getAttribute('aria-label') ||
            el.textContent ||
            ''
        ).trim();
        if (PHOTO_MENU_LABEL.test(label)) {
            el.click();
            return true;
        }
    }
    return false;
}

async function waitForFileInput(root, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const input = queryFirst(FILE_INPUT_SELECTORS, root ?? document);
        if (input instanceof HTMLInputElement)
            return input;
        const global = queryFirst(FILE_INPUT_SELECTORS, document);
        if (global instanceof HTMLInputElement)
            return global;
        await sleep(120);
    }
    return null;
}

function assignFileToInput(input, file) {
    try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input.files?.length > 0;
    }
    catch {
        return false;
    }
}

async function tryPasteImageFile(target, file) {
    if (!(target instanceof HTMLElement))
        return false;
    try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
        });
        target.focus({ preventScroll: true });
        return target.dispatchEvent(event);
    }
    catch {
        return false;
    }
}

function base64ToFile(base64, mimeType, filename) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    const type = mimeType || 'image/jpeg';
    return new File([bytes], filename, { type });
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
    }
    catch {
        /* ClipboardEvent + DataTransfer không khả dụng */
    }

    throw new Error('Không điền được prompt vào ô ChatGPT');
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
