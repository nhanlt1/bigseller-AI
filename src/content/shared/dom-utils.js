export function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
        const el = root.querySelector(selector);
        if (el)
            return el;
    }
    return null;
}
export function getInputValue(el) {
    return el.value?.trim() ?? '';
}
export function setInputValue(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
export function getPlainTextContainerValue(el) {
    return (el.textContent ?? '').trim();
}
export function setPlainTextContainerValue(el, text) {
    const target = el instanceof HTMLElement && el.isContentEditable
        ? el
        : el.querySelector('[contenteditable="true"]') ??
            el;
    target.focus?.();
    if (target.isContentEditable) {
        target.innerText = text;
        target.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    else {
        target.textContent = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
    }
}
export function getQuillText(container) {
    const editor = container.querySelector('.ql-editor');
    if (!editor)
        return '';
    return (editor.textContent ?? editor.innerHTML).trim();
}
export function setQuillText(container, text) {
    const editor = container.querySelector('.ql-editor');
    if (!editor)
        return;
    editor.focus();
    editor.innerHTML = '';
    const paragraphs = text.split(/\n/);
    for (const line of paragraphs) {
        const p = document.createElement('p');
        p.textContent = line;
        editor.appendChild(p);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
}
export function waitForElement(selectors, timeoutMs = 15000, root = document) {
    return new Promise((resolve) => {
        const existing = queryFirst(selectors, root);
        if (existing) {
            resolve(existing);
            return;
        }
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
            const el = queryFirst(selectors, root);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
            else if (Date.now() > deadline) {
                observer.disconnect();
                resolve(null);
            }
        });
        observer.observe(root === document ? document.body : root, {
            childList: true,
            subtree: true,
        });
        setTimeout(() => {
            observer.disconnect();
            resolve(queryFirst(selectors, root));
        }, timeoutMs);
    });
}
export function observeDomChanges(callback) {
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled)
            return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            callback();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
}
