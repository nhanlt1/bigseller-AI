import { hashText } from '../../shared/text-hash.js';
import { GEMINI_MODEL_RESPONSE_SELECTOR } from './selectors.js';
import { queryAllDeep } from './dom-query.js';
/** Bật true khi cần panel + console debug bubble Gemini */
export const GEMINI_BUBBLE_DEBUG = false;
const LOG_PREFIX = '[BigSeller AI · Gemini bubble]';
const PANEL_ID = 'bigseller-gemini-bubble-debug';
const MAX_PANEL_LINES = 120;
function timeLabel() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}
function describeEl(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    const role = el.getAttribute('role');
    const testId = el.getAttribute('data-test-id');
    const extra = [role && `role=${role}`, testId && `data-test-id=${testId}`]
        .filter(Boolean)
        .join(' ');
    return `${tag}${id}${cls}${extra ? ` (${extra})` : ''}`;
}
function describeScope(scope) {
    if (scope === document)
        return 'document';
    if (scope instanceof Element)
        return describeEl(scope);
    return String(scope);
}
function readText(el) {
    return (el.innerText ?? el.textContent ?? '').trim();
}
function isInsideThoughts(el) {
    return !!el.closest('model-thoughts, .thoughts-container, .thoughts-content, [class*="thoughts-panel"]');
}
export function buildBubbleRows(nodes) {
    return nodes.map((el, index) => {
        const text = readText(el);
        return {
            index,
            tag: el.tagName.toLowerCase(),
            id: el.id || '—',
            classHint: typeof el.className === 'string'
                ? el.className.trim().split(/\s+/).slice(0, 4).join(' ') || '—'
                : '—',
            textLen: text.length,
            hash: hashText(text),
            preview: text.length > 0 ? `${text.slice(0, 72)}${text.length > 72 ? '…' : ''}` : '(rỗng)',
            inThoughts: isInsideThoughts(el),
        };
    });
}
export function probeSelectorCounts(scope) {
    const parts = GEMINI_MODEL_RESPONSE_SELECTOR.split(',').map((s) => s.trim());
    const out = {};
    for (const sel of parts) {
        out[sel] = queryAllDeep(scope, sel).length;
    }
    return out;
}
function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel)
        return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
        position: 'fixed',
        bottom: '12px',
        left: '12px',
        zIndex: '2147483646',
        width: 'min(420px, 94vw)',
        maxHeight: '40vh',
        overflow: 'auto',
        background: 'rgba(15,23,42,.94)',
        color: '#e2e8f0',
        border: '1px solid #475569',
        borderRadius: '8px',
        padding: '8px 10px',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: '10px',
        lineHeight: '1.4',
        boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    });
    const title = document.createElement('div');
    title.style.cssText =
        'font-weight:700;color:#38bdf8;margin-bottom:6px;font-size:11px';
    title.textContent = 'Gemini bubble debug — BigSeller AI';
    panel.appendChild(title);
    const body = document.createElement('div');
    body.id = `${PANEL_ID}-lines`;
    panel.appendChild(body);
    document.body.appendChild(panel);
    return panel;
}
function appendPanelLine(text, color = '#e2e8f0') {
    const panel = ensurePanel();
    const body = panel.querySelector(`#${PANEL_ID}-lines`);
    if (!body)
        return;
    const row = document.createElement('div');
    row.style.color = color;
    row.style.marginBottom = '3px';
    row.style.wordBreak = 'break-word';
    row.textContent = text;
    body.appendChild(row);
    while (body.childNodes.length > MAX_PANEL_LINES) {
        body.removeChild(body.firstChild);
    }
    panel.scrollTop = panel.scrollHeight;
}
export function geminiDebugLog(category, message, detail) {
    if (!GEMINI_BUBBLE_DEBUG)
        return;
    const line = `[${timeLabel()}] [${category}] ${message}`;
    console.log(LOG_PREFIX, category, message, detail ?? '');
    appendPanelLine(line);
    if (detail !== undefined && detail !== null) {
        const extra = typeof detail === 'object'
            ? JSON.stringify(detail, null, 0).slice(0, 500)
            : String(detail);
        if (extra.length > 0) {
            appendPanelLine(`  → ${extra}`, '#94a3b8');
        }
    }
}
export function geminiDebugTable(category, title, rows, watchIndex) {
    if (!GEMINI_BUBBLE_DEBUG)
        return;
    geminiDebugLog(category, title, {
        total: rows.length,
        watchIndex: watchIndex ?? null,
    });
    console.log(LOG_PREFIX, title);
    console.table(rows.map((r) => ({
        '#': r.index,
        watch: r.index === watchIndex ? '◀' : '',
        tag: r.tag,
        len: r.textLen,
        hash: r.hash.slice(0, 8),
        thoughts: r.inThoughts ? 'yes' : '',
        preview: r.preview,
    })));
    for (const r of rows) {
        const mark = r.index === watchIndex ? ' ◀ĐANG THEO DÕI' : '';
        appendPanelLine(`  [${r.index}] len=${r.textLen} hash=${r.hash.slice(0, 8)} ${r.tag}${mark}`, r.index === watchIndex ? '#fbbf24' : '#94a3b8');
        if (r.preview !== '(rỗng)') {
            appendPanelLine(`      ${r.preview}`, '#64748b');
        }
    }
}
export function geminiDebugClearPanel() {
    document.getElementById(PANEL_ID)?.remove();
}
export function describeScopeForLog(scope) {
    return describeScope(scope);
}
