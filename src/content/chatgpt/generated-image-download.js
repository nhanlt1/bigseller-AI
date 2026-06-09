const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
/** Kích thước ảnh tải về cố định */
const OUTPUT_SIZE_PX = 1234;
const MAX_BUTTON_IMAGES = 5;
/** Khoảng cách nút tải bên phải, ngoài mép ảnh */
const BUTTON_OUTSIDE_GAP_PX = 8;
const STYLE_ID = 'bigseller-chatgpt-dl-style';
const HOST_ID = 'bigseller-chatgpt-dl-host';

const COMPOSER_SELECTOR =
    'form.group\\/composer, [data-testid="composer"], [data-testid*="composer" i]';

const ALT_PREFIX_RE = /^(?:Ảnh đã tạo|Generated image):\s*/i;

const DOWNLOAD_ICON_SVG = `
<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3v12"/>
  <path d="m7 10 5 5 5-5"/>
  <path d="M5 21h14"/>
</svg>`;

const LOADING_ICON_SVG = `
<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="bigseller-chatgpt-dl-spin">
  <path d="M12 3a9 9 0 1 0 9 9"/>
</svg>`;

/** Không ghi attribute/listener lên DOM React — chỉ overlay ngoài cây React. */
/** @type {Set<HTMLImageElement>} */
const activeImages = new Set();
/** @type {WeakMap<HTMLImageElement, HTMLButtonElement>} */
const buttonByImage = new WeakMap();
/** @type {WeakMap<HTMLImageElement, ResizeObserver>} */
const resizeObserverByImage = new WeakMap();

/** @type {ReturnType<typeof setTimeout> | null} */
let rescanTimer = null;

export function installGeneratedImageDownloadButtons() {
    if (globalThis.__bigsellerChatgptDownloadInstalled)
        return;
    globalThis.__bigsellerChatgptDownloadInstalled = true;

    ensureStyles();
    ensureHost();
    scheduleSyncDownloadButtons();

    window.addEventListener('scroll', repositionAllButtons, true);
    window.addEventListener('resize', repositionAllButtons);

    const observer = new MutationObserver(() => {
        scheduleSyncDownloadButtons();
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
}

function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host)
        return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    document.body.appendChild(host);
    return host;
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bigseller-chatgpt-dl-btn {
        position: fixed;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.35);
        background: rgba(17,24,39,.82);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
        pointer-events: auto;
      }
      .bigseller-chatgpt-dl-btn:hover:not(:disabled) {
        background: rgba(238,77,45,.95);
        border-color: rgba(238,77,45,.95);
      }
      .bigseller-chatgpt-dl-btn:disabled {
        opacity: .65;
        cursor: wait;
      }
      .bigseller-chatgpt-dl-spin {
        transform-origin: center;
        animation: bigseller-chatgpt-dl-spin 0.8s linear infinite;
      }
      @keyframes bigseller-chatgpt-dl-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
}

function scheduleSyncDownloadButtons() {
    if (rescanTimer)
        clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
        rescanTimer = null;
        syncDownloadButtons();
    }, 200);
}

/** Chỉ ảnh ChatGPT tạo — không phải ảnh user đính kèm. */
function isGeneratedImage(img) {
    if (!(img instanceof HTMLImageElement))
        return false;
    if (!img.isConnected)
        return false;
    if (img.closest(COMPOSER_SELECTOR))
        return false;

    const src = decodeSrc(img.currentSrc || img.src);
    if (!src || /^blob:/i.test(src))
        return false;
    if (!/backend-api\/estuary\/content/i.test(src))
        return false;

    const alt = String(img.alt ?? '').trim();
    if (!ALT_PREFIX_RE.test(alt))
        return false;

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width > 0 && height > 0 && (width < 120 || height < 120))
        return false;

    return true;
}

function imageKey(img) {
    return decodeSrc(img.currentSrc || img.src);
}

/** Ảnh output ChatGPT theo thứ tự DOM — mỗi URL một lần (lấy node cuối). */
function collectGeneratedImages() {
    /** @type {Map<string, HTMLImageElement>} */
    const byKey = new Map();
    for (const img of document.querySelectorAll('img')) {
        if (!(img instanceof HTMLImageElement))
            continue;
        if (!isGeneratedImage(img))
            continue;
        const key = imageKey(img);
        if (!key)
            continue;
        byKey.set(key, img);
    }
    return Array.from(byKey.values());
}

function syncDownloadButtons() {
    const latest = collectGeneratedImages().slice(-MAX_BUTTON_IMAGES);
    const allowed = new Set(latest);

    for (const img of [...activeImages]) {
        if (!allowed.has(img) || !img.isConnected)
            detachDownloadButton(img);
    }

    for (const img of latest) {
        if (!buttonByImage.has(img))
            attachDownloadButton(img);
    }

    repositionAllButtons();
}

function attachDownloadButton(img) {
    if (buttonByImage.has(img))
        return;

    activeImages.add(img);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bigseller-chatgpt-dl-btn';
    btn.setAttribute('aria-label', 'Tải xuống');
    btn.innerHTML = DOWNLOAD_ICON_SVG;
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleDownload(img, btn);
    });

    ensureHost().appendChild(btn);
    buttonByImage.set(img, btn);
    positionButton(btn, img);

    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
            positionButton(btn, img);
        });
        observer.observe(img);
        resizeObserverByImage.set(img, observer);
    }
}

function detachDownloadButton(img) {
    activeImages.delete(img);
    buttonByImage.get(img)?.remove();
    buttonByImage.delete(img);
    resizeObserverByImage.get(img)?.disconnect();
    resizeObserverByImage.delete(img);
}

function repositionAllButtons() {
    for (const img of [...activeImages]) {
        if (!img.isConnected) {
            detachDownloadButton(img);
            continue;
        }
        const btn = buttonByImage.get(img);
        if (btn?.isConnected)
            positionButton(btn, img);
    }
}

function positionButton(btn, img) {
    const rect = img.getBoundingClientRect();
    const btnW = btn.offsetWidth || 32;
    const btnH = btn.offsetHeight || 32;
    const left = rect.right + BUTTON_OUTSIDE_GAP_PX;
    const top = rect.top + Math.max(0, (rect.height - btnH) / 2);

    if (
        rect.width < 40 ||
        rect.height < 40 ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        left + btnW > window.innerWidth - 8
    ) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'inline-flex';
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
}

async function handleDownload(img, btn) {
    if (btn.disabled)
        return;
    btn.disabled = true;
    btn.innerHTML = LOADING_ICON_SVG;
    try {
        const blob = await loadImageBlob(img);
        const prepared = await prepareDownloadBlob(blob);
        const ext = blobExtension(prepared.type);
        const filename = `${filenameFromAlt(img.alt)}.${ext}`;
        triggerDownload(prepared, filename);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Không tải được ảnh: ${msg}`);
    }
    finally {
        btn.disabled = false;
        btn.innerHTML = DOWNLOAD_ICON_SVG;
        repositionAllButtons();
    }
}

async function loadImageBlob(img) {
    const src = decodeSrc(img.currentSrc || img.src);
    if (src) {
        try {
            const res = await fetch(src, {
                credentials: 'include',
                headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
            });
            if (res.ok)
                return res.blob();
        }
        catch {
            /* fallback canvas */
        }
    }
    if (img.complete && img.naturalWidth > 0)
        return blobFromImageElement(img, 1);
    throw new Error('Không có URL ảnh');
}

function decodeSrc(src) {
    return String(src ?? '')
        .replace(/&amp;/g, '&')
        .trim();
}

function blobFromImageElement(img, quality = 1) {
    return new Promise((resolve, reject) => {
        const canvas = createOutputCanvasFromImage(img);
        canvas.toBlob(
            (blob) => {
                if (blob)
                    resolve(blob);
                else
                    reject(new Error('Không đọc được ảnh từ trang'));
            },
            'image/jpeg',
            quality,
        );
    });
}

function createOutputCanvasFromImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE_PX;
    canvas.height = OUTPUT_SIZE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas không khả dụng');
    ctx.drawImage(img, 0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX);
    return canvas;
}

function createOutputCanvasFromBitmap(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE_PX;
    canvas.height = OUTPUT_SIZE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas không khả dụng');
    ctx.drawImage(bitmap, 0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX);
    return canvas;
}

/** Resize 1234×1234, chất lượng JPEG cao nhất nhưng ≤ 2 MB. */
async function prepareDownloadBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
        return await encodeFixedSizeNearMax(bitmap);
    }
    finally {
        bitmap.close();
    }
}

async function encodeFixedSizeNearMax(bitmap) {
    const canvas = createOutputCanvasFromBitmap(bitmap);

    let lo = 0.5;
    let hi = 1;
    /** @type {Blob | null} */
    let best = null;

    for (let i = 0; i < 16; i++) {
        const quality = (lo + hi) / 2;
        const candidate = await canvasToBlob(canvas, 'image/jpeg', quality);
        if (candidate.size <= MAX_DOWNLOAD_BYTES) {
            best = candidate;
            lo = quality;
        }
        else {
            hi = quality;
        }
    }

    if (best)
        return best;

    const fallback = await canvasToBlob(canvas, 'image/jpeg', lo);
    if (fallback.size <= MAX_DOWNLOAD_BYTES)
        return fallback;
    throw new Error('Không nén được ảnh 1234×1234 dưới 2 MB');
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob)
                    resolve(blob);
                else
                    reject(new Error('Xuất ảnh thất bại'));
            },
            type,
            quality,
        );
    });
}

function filenameFromAlt(alt) {
    let name = String(alt ?? '')
        .replace(ALT_PREFIX_RE, '')
        .trim();
    if (!name)
        name = 'chatgpt-image';
    return name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function blobExtension(mimeType) {
    const mime = String(mimeType ?? '').toLowerCase();
    if (mime.includes('png'))
        return 'png';
    if (mime.includes('webp'))
        return 'webp';
    return 'jpg';
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
