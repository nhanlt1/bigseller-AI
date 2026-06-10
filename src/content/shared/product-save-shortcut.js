const UPDATE_LABEL = /^cập nhật$/i;

function isSaveShortcut(e) {
    return (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 's' || e.key === 'S' || e.code === 'KeyS');
}

function buttonLabel(btn) {
    return btn.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function isActionableButton(btn) {
    if (!btn || btn.disabled)
        return false;
    if (btn.getAttribute('aria-disabled') === 'true')
        return false;
    return btn.offsetParent !== null || btn.closest('.fixed-bottom, .edit_header');
}

function findBigsellerUpdateButton() {
    const header = document.querySelector('.page_edit .edit_header');
    if (!header)
        return null;
    for (const btn of header.querySelectorAll('button.ant-btn-primary, button.ant-btn')) {
        if (UPDATE_LABEL.test(buttonLabel(btn)) && isActionableButton(btn))
            return btn;
    }
    return header.querySelector('.content_right button.ant-btn-primary:not([disabled])');
}

function findShopeeUpdateButton() {
    const selectors = [
        '.product-detail-button-container button.eds-button--primary',
        '.fix-container.fixed-bottom button.eds-button--primary',
        '.product-edit button.eds-button--primary',
    ];
    const seen = new Set();
    for (const sel of selectors) {
        for (const btn of document.querySelectorAll(sel)) {
            if (seen.has(btn))
                continue;
            seen.add(btn);
            if (UPDATE_LABEL.test(buttonLabel(btn)) && isActionableButton(btn))
                return btn;
        }
    }
    return null;
}

function findUpdateButton(platform) {
    return platform === 'bigseller'
        ? findBigsellerUpdateButton()
        : findShopeeUpdateButton();
}

function isProductEditPage(platform) {
    if (platform === 'bigseller')
        return !!document.querySelector('.page_edit');
    return !!document.querySelector('.product-edit');
}

/** @type {Set<string>} */
const mountedPlatforms = new Set();

/** Ctrl+S / Cmd+S → bấm nút «Cập nhật» trên form sửa SP. */
export function mountProductSaveShortcut(platform) {
    if (mountedPlatforms.has(platform))
        return;
    mountedPlatforms.add(platform);
    document.addEventListener('keydown', (e) => {
        if (!isSaveShortcut(e) || !isProductEditPage(platform))
            return;
        const btn = findUpdateButton(platform);
        if (!btn)
            return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
    }, true);
}
