import { GEMINI_GENERATING_SELECTORS, GEMINI_MODEL_RESPONSE_SELECTOR, GEMINI_USER_QUERY_SELECTOR, } from './selectors.js';
const THOUGHTS_ANCESTOR = 'model-thoughts, .thoughts-container, .thoughts-content, [class*="thoughts-panel"]';
function isInsideThoughts(el) {
    return !!el.closest(THOUGHTS_ANCESTOR);
}
function isUserMessage(el) {
    if (el.matches('user-query, .user-query, [data-message-author-role="user"]'))
        return true;
    if (el.classList.contains('user-query'))
        return true;
    return !!el.closest('user-query, .user-query, [data-message-author-role="user"]');
}
function walkShadowHosts(el, selector, out) {
    const shadow = el.shadowRoot;
    if (shadow) {
        out.push(...shadow.querySelectorAll(selector));
        for (const child of shadow.children) {
            if (child instanceof Element)
                walkShadowHosts(child, selector, out);
        }
    }
    for (const child of el.children) {
        if (child instanceof Element)
            walkShadowHosts(child, selector, out);
    }
}
/** querySelectorAll kèm duyệt shadow DOM (Gemini dùng web components). */
export function queryAllDeep(root, selector) {
    const found = [];
    found.push(...root.querySelectorAll(selector));
    const hosts = root instanceof Element
        ? [root]
        : Array.from(root.querySelectorAll('*'));
    for (const host of hosts) {
        walkShadowHosts(host, selector, found);
    }
    return [...new Set(found)];
}
/** Bỏ phần tử cha khi con cũng khớp selector (tránh đếm đôi structured-content + message-content). */
export function dedupeNestedBubbles(nodes) {
    return nodes.filter((el) => !nodes.some((other) => other !== el && el.contains(other)));
}
export function getModelResponseElements(scope) {
    const raw = queryAllDeep(scope, GEMINI_MODEL_RESPONSE_SELECTOR);
    const filtered = raw.filter((el) => !isInsideThoughts(el) && !isUserMessage(el));
    return dedupeNestedBubbles(filtered);
}
export function getUserQueryElements(scope) {
    const raw = queryAllDeep(scope, GEMINI_USER_QUERY_SELECTOR);
    const filtered = raw.filter((el) => !isInsideThoughts(el));
    return dedupeNestedBubbles(filtered);
}
export function isGeminiGenerating() {
    for (const selector of GEMINI_GENERATING_SELECTORS) {
        const matches = queryAllDeep(document, selector);
        for (const btn of matches) {
            if (!(btn instanceof HTMLButtonElement) || btn.disabled)
                continue;
            const rect = btn.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1)
                continue;
            return true;
        }
    }
    return false;
}
