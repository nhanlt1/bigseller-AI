function guessReferer(url) {
    const lower = String(url).toLowerCase();
    if (/shopee|susercontent/i.test(lower))
        return 'https://shopee.vn/';
    if (/bigseller/i.test(lower))
        return 'https://www.bigseller.com/';
    return '';
}

function guessMimeFromUrl(url) {
    const lower = String(url).toLowerCase();
    if (lower.includes('.png'))
        return 'image/png';
    if (lower.includes('.webp'))
        return 'image/webp';
    if (lower.includes('.gif'))
        return 'image/gif';
    return 'image/jpeg';
}

async function blobToBase64(blob, urlHint = '') {
    const mimeType = blob.type || guessMimeFromUrl(urlHint) || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { base64: btoa(binary), mimeType };
}

/** Tải ảnh (http/https hoặc blob:) → base64. */
export async function fetchImageAsBase64(url) {
    const raw = String(url ?? '').trim();
    if (!raw)
        throw new Error('URL ảnh trống');

    const referer = guessReferer(raw);
    const res = await fetch(raw, {
        credentials: 'omit',
        headers: {
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            ...(referer ? { Referer: referer } : {}),
        },
    });
    if (!res.ok) {
        throw new Error(`Không tải được ảnh (${res.status})`);
    }
    const blob = await res.blob();
    return blobToBase64(blob, raw);
}

/**
 * @param {string[]} urls
 * @returns {Promise<{ base64: string, mimeType: string, url: string }[]>}
 */
export async function fetchImagesAsBase64(urls) {
    /** @type {{ base64: string, mimeType: string, url: string }[]} */
    const images = [];
    for (const url of urls) {
        const trimmed = String(url ?? '').trim();
        if (!trimmed)
            continue;
        try {
            const fetched = await fetchImageAsBase64(trimmed);
            images.push({ ...fetched, url: trimmed });
        }
        catch {
            /* bỏ qua ảnh lỗi — caller kiểm tra length */
        }
    }
    return images;
}
