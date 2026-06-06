import { queryFirst, waitForElement } from '../shared/dom-utils.js';
import { fetchImagesAsBase64 } from '../../shared/image-fetch.js';

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
    'button[aria-label*="Thêm tệp"]',
];

const FILE_INPUT_SELECTORS = [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
];

const PHOTO_MENU_LABEL = /upload from computer|tải lên từ máy|máy tính|upload|tải ảnh|photo|ảnh|hình|image|tệp|file|đính kèm|add photos/i;

const ATTACHMENT_SELECTORS = [
    '[data-testid*="attachment" i]',
    '[class*="attachment" i]',
    '[class*="Attachment" i]',
    'form.group\\/composer img[src^="blob:"]',
    '[data-testid="composer"] img[src^="blob:"]',
];

const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send prompt"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="Gửi"]',
    'button[data-testid="composer-send-button"]',
];

/**
 * @param {string} prompt
 * @param {{ images?: { base64?: string, mimeType?: string }[], imageUrls?: string[], imageBase64?: string, imageMimeType?: string }} [opts]
 */
export async function fillChatGPTComposer(prompt, opts = {}) {
    const editor = await waitForElement(COMPOSER_SELECTORS, 20000);
    if (!editor) {
        throw new Error('Không tìm thấy ô nhập ChatGPT (#prompt-textarea)');
    }
    const editable = resolveEditable(editor);
    await focusComposerEditor(editable);

    const files = await buildImageFiles(opts);
    let imagesAttached = 0;
    for (let i = 0; i < files.length; i++) {
        if (await attachImageToComposer(editable, files[i]))
            imagesAttached += 1;
        dismissChatGPTOverlays();
        if (i < files.length - 1)
            await sleep(400);
    }

    let uploadUiOpened = false;
    if (imagesAttached === 0 && files.length > 0) {
        uploadUiOpened = await openComposerUploadUi(editable);
    }

    let submitted = false;
    if (!uploadUiOpened) {
        const composerRoot = findComposerRoot(editable);
        if (imagesAttached > 0) {
            await waitForAttachmentsReady(composerRoot, imagesAttached);
        }
        dismissChatGPTOverlays();
        await sleep(200);
        setComposerText(editable, prompt);
        dismissChatGPTOverlays();
        await sleep(300);
        submitted = await submitChatGPTComposer(editable);
    }

    return {
        editor: editable,
        imageAttached: imagesAttached > 0,
        imagesAttached,
        uploadUiOpened,
        submitted,
        expectedImages: files.length,
    };
}

/** @param {{ images?: { base64?: string, mimeType?: string }[], imageUrls?: string[], imageBase64?: string, imageMimeType?: string }} opts */
async function buildImageFiles(opts) {
    /** @type {File[]} */
    const files = [];
    const rows = Array.isArray(opts.images) ? opts.images : [];
    if (rows.length) {
        rows.forEach((row, i) => {
            const base64 = String(row?.base64 ?? '').trim();
            if (!base64)
                return;
            const ext = mimeToExt(row.mimeType || 'image/jpeg');
            files.push(base64ToFile(
                base64,
                row.mimeType || 'image/jpeg',
                `bigseller-product-${i + 1}.${ext}`,
            ));
        });
        return files;
    }
    const urls = Array.isArray(opts.imageUrls) ? opts.imageUrls : [];
    if (urls.length) {
        const fetched = await fetchImagesAsBase64(urls);
        fetched.forEach((row, i) => {
            const ext = mimeToExt(row.mimeType || 'image/jpeg');
            files.push(base64ToFile(
                row.base64,
                row.mimeType || 'image/jpeg',
                `bigseller-product-${i + 1}.${ext}`,
            ));
        });
        return files;
    }
    const base64 = String(opts.imageBase64 ?? '').trim();
    if (base64) {
        files.push(base64ToFile(
            base64,
            opts.imageMimeType || 'image/jpeg',
            'bigseller-product-1.jpg',
        ));
    }
    return files;
}

function mimeToExt(mimeType) {
    const mime = String(mimeType ?? '').toLowerCase();
    if (mime.includes('png'))
        return 'png';
    if (mime.includes('webp'))
        return 'webp';
    if (mime.includes('gif'))
        return 'gif';
    return 'jpg';
}

/**
 * Đính kèm từng ảnh qua file input hoặc paste (không dùng drag/drop — gây kẹt overlay ChatGPT).
 */
async function attachImageToComposer(editor, file) {
    const composerRoot = findComposerRoot(editor);
    const before = countComposerAttachments(composerRoot);

    const existingInput =
        queryFirst(FILE_INPUT_SELECTORS, composerRoot) ??
        queryFirst(FILE_INPUT_SELECTORS, document);
    if (existingInput instanceof HTMLInputElement) {
        if (assignFileToInput(existingInput, file)) {
            if (await waitForMoreAttachments(composerRoot, before, 5000))
                return true;
        }
    }

    await clickAttachButton(composerRoot);
    await sleep(400);
    clickPhotoMenuItem();
    await sleep(350);
    const openedInput = await waitForFileInput(composerRoot, 3000);
    if (openedInput instanceof HTMLInputElement) {
        if (assignFileToInput(openedInput, file)) {
            if (await waitForMoreAttachments(composerRoot, before, 5000))
                return true;
        }
    }

    if (await tryPasteImageFile(editor, file)) {
        await sleep(700);
        if (await waitForMoreAttachments(composerRoot, before, 5000))
            return true;
    }

    return false;
}

/** Đóng overlay kéo-thả / menu bị kẹt sau attach giả lập. */
function dismissChatGPTOverlays() {
    try {
        const dt = new DataTransfer();
        for (const target of [document, document.body, document.documentElement]) {
            target.dispatchEvent(new DragEvent('dragleave', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
            }));
            target.dispatchEvent(new DragEvent('dragend', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
            }));
        }
    }
    catch {
        /* DragEvent không khả dụng */
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
    }));

    for (const el of document.querySelectorAll(
        'div.fixed, div[class*="fixed"], div[class*="inset-0"], div[class*="z-"]',
    )) {
        if (!(el instanceof HTMLElement))
            continue;
        const text = el.textContent ?? '';
        if (!/Thả bất kỳ tệp|Drop any file|Thêm bất kỳ điều gì/i.test(text))
            continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.4 || rect.height < window.innerHeight * 0.4)
            continue;
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        el.setAttribute('aria-hidden', 'true');
    }
}

function countComposerAttachments(root) {
    const scope = root instanceof Element ? root : document;
    for (const sel of ATTACHMENT_SELECTORS) {
        const count = scope.querySelectorAll(sel).length;
        if (count > 0)
            return count;
    }
    return document.querySelectorAll(ATTACHMENT_SELECTORS.join(', ')).length;
}

async function waitForMoreAttachments(root, before, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (countComposerAttachments(root) > before)
            return true;
        await sleep(150);
    }
    return countComposerAttachments(root) > before;
}

/** Chờ đủ số ảnh đính kèm và blob preview load xong trước khi gửi. */
async function waitForAttachmentsReady(root, minCount, timeoutMs = 10000) {
    if (minCount <= 0)
        return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const count = countComposerAttachments(root);
        if (count >= minCount && attachmentsLookReady(root))
            return true;
        await sleep(180);
    }
    return countComposerAttachments(root) >= minCount;
}

function attachmentsLookReady(root) {
    const scope = root instanceof Element ? root : document;
    const imgs = scope.querySelectorAll(
        'form.group\\/composer img[src^="blob:"], [data-testid="composer"] img[src^="blob:"], img[src^="blob:"]',
    );
    if (imgs.length === 0)
        return true;
    for (const img of imgs) {
        if (!(img instanceof HTMLImageElement))
            continue;
        if (!img.complete || img.naturalWidth === 0)
            return false;
    }
    return true;
}

async function submitChatGPTComposer(editor) {
    await focusComposerEditor(editor);
    await sleep(150);

    const root = findComposerRoot(editor);
    const sendBtn = await waitForSendButton(root, 5000);
    if (sendBtn) {
        sendBtn.click();
        return true;
    }

    for (const type of ['keydown', 'keypress', 'keyup']) {
        editor.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
        }));
    }
    return false;
}

async function waitForSendButton(root, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const scope of [root, document].filter(Boolean)) {
            const btn = queryFirst(SEND_BUTTON_SELECTORS, scope);
            if (btn instanceof HTMLButtonElement && !btn.disabled)
                return btn;
        }
        await sleep(120);
    }
    return null;
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
        '[role="menuitem"], [role="menuitemradio"], [role="option"], button, a, div[tabindex="0"]',
    );
    /** @type {HTMLElement[]} */
    const matches = [];
    for (const el of items) {
        if (!(el instanceof HTMLElement))
            continue;
        const label = (
            el.getAttribute('aria-label') ||
            el.textContent ||
            ''
        ).trim();
        if (PHOTO_MENU_LABEL.test(label))
            matches.push(el);
    }
    const preferred = matches.find((el) => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        return /upload from computer|tải lên từ máy|máy tính|upload file|tải ảnh lên/i.test(label);
    });
    (preferred ?? matches[0])?.click();
    return Boolean(preferred ?? matches[0]);
}

async function waitForFileInput(root, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const inputs = [
            ...Array.from((root ?? document).querySelectorAll(FILE_INPUT_SELECTORS.join(', '))),
            ...Array.from(document.querySelectorAll(FILE_INPUT_SELECTORS.join(', '))),
        ];
        for (const input of inputs) {
            if (input instanceof HTMLInputElement)
                return input;
        }
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
