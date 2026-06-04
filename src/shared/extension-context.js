/** Content script cũ sau khi Reload extension trên chrome://extensions */
export function isExtensionContextAlive() {
    try {
        return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
    }
    catch {
        return false;
    }
}

export function isExtensionContextInvalidated(err) {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /extension context invalidated/i.test(msg) ||
        /context invalidated/i.test(msg);
}

let reloadHintShown = false;

/** Nhắc F5 trang — gọi tối đa một lần mỗi tab */
export function notifyExtensionReloadNeeded() {
    if (reloadHintShown || typeof document === 'undefined')
        return;
    reloadHintShown = true;
    const id = 'bigseller-ai-reload-hint';
    if (document.getElementById(id))
        return;
    const el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: 'min(420px, calc(100vw - 24px))',
        padding: '10px 14px',
        background: '#1f2937',
        color: '#fff',
        font: '600 12px/1.4 system-ui, sans-serif',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,.25)',
        textAlign: 'center',
    });
    el.textContent =
        'BigSeller AI: đã Reload extension — vui lòng F5 trang này để dùng lại.';
    document.body.appendChild(el);
}
