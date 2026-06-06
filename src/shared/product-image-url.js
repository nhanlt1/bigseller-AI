const SKIP_URL = /logo|icon|avatar|qr|badge|placeholder|emoji|\.svg/i;
const PREFER_URL = /susercontent|shopee.*cdn|cf\.shopee|img\.bigseller/i;

const IMAGE_SCOPE_SELECTORS = [
    '.product-basic-info',
    '.shopee_media_info_wrap',
    '.product-edit-images',
    '[class*="image-upload"]',
    '[class*="media_info"]',
    '[class*="ProductImage"]',
    '.page_edit_item',
];

function normalizeImageUrl(raw) {
    const url = String(raw ?? '').trim();
    if (!url.startsWith('http'))
        return '';
    try {
        const u = new URL(url);
        return u.href;
    }
    catch {
        return '';
    }
}

function scoreImage(url, width, height) {
    return (
        (width || 0) * (height || 0) +
        (PREFER_URL.test(url) ? 1_000_000 : 0)
    );
}

/**
 * @param {Document} [root]
 * @returns {{ url: string, width: number, height: number, index: number }[]}
 */
export function listProductImageCandidates(root = document) {
    const containers = IMAGE_SCOPE_SELECTORS.map((sel) =>
        root.querySelector(sel),
    ).filter(Boolean);
    const scope = containers[0] ?? root;
    const seen = new Set();
    /** @type {{ url: string, width: number, height: number, score: number }[]} */
    const rows = [];

    const push = (rawUrl, el) => {
        const url = normalizeImageUrl(rawUrl);
        if (!url || SKIP_URL.test(url) || seen.has(url))
            return;
        seen.add(url);
        const width = el?.naturalWidth || el?.width || 0;
        const height = el?.naturalHeight || el?.height || 0;
        rows.push({
            url,
            width,
            height,
            score: scoreImage(url, width, height),
        });
    };

    for (const img of scope.querySelectorAll('img[src], img[data-src]')) {
        push(img.currentSrc || img.src || img.dataset.src, img);
    }

    for (const el of scope.querySelectorAll('[style*="background"]')) {
        const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (match?.[1])
            push(match[1], el);
    }

    rows.sort((a, b) => b.score - a.score);
    return rows.map(({ url, width, height }, i) => ({
        url,
        width,
        height,
        index: i + 1,
    }));
}

/** Chọn URL ảnh lớn nhất trong form chỉnh sửa (Shopee / BigSeller). */
export function pickBestProductImageUrl(root = document) {
    return listProductImageCandidates(root)[0]?.url ?? '';
}
