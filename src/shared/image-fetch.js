/** Tải ảnh qua service worker (host_permissions) → base64 gửi content script ChatGPT. */
export async function fetchImageAsBase64(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
        throw new Error(`Không tải được ảnh (${res.status})`);
    }
    const blob = await res.blob();
    const mimeType = blob.type || guessMimeFromUrl(url) || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { base64: btoa(binary), mimeType };
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
