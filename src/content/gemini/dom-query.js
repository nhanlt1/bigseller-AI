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
/** `el` nằm sau `anchor` trong cây document (kể cả shadow DOM). */
export function followsInDocument(anchor, el) {
    if (!anchor || !el || anchor === el)
        return false;
    return (anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
function compareDocumentOrder(a, b) {
    if (a === b)
        return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING)
        return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING)
        return 1;
    const topDiff = a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    if (Math.abs(topDiff) > 1)
        return topDiff < 0 ? -1 : 1;
    return 0;
}
/** Bubble model đầu tiên xuất hiện sau `afterEl` theo thứ tự document. */
export function getFirstModelResponseAfter(scope, afterEl) {
    if (!afterEl)
        return null;
    const models = getModelResponseElements(scope);
    const following = models.filter((m) => followsInDocument(afterEl, m));
    if (following.length === 0)
        return null;
    following.sort(compareDocumentOrder);
    return following[0];
}
/**
 * Neo theo user bubble mới nhất sau Send.
 * @returns {{ userEl: Element, modelEl: Element | null, modelIndex: number } | null}
 */
export function resolveWatchBubbleAfterUser(scope, userCount) {
    const users = getUserQueryElements(scope);
    if (users.length <= userCount)
        return null;
    const userEl = users[users.length - 1];
    const modelEl = getFirstModelResponseAfter(scope, userEl);
    if (!modelEl) {
        return { userEl, modelEl: null, modelIndex: -1 };
    }
    const models = getModelResponseElements(scope);
    const modelIndex = models.indexOf(modelEl);
    return { userEl, modelEl, modelIndex };
}
