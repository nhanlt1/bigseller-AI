import { MessageType, sendMessage } from '../../shared/messaging.js';
import { copyTableToClipboard, downloadCsv } from '../../shared/table-export.js';
import { FAB_IMAGE_RIGHT_PX, FAB_ROW_BOTTOM_PX, FAB_SIZE_PX } from '../shared/panel.js';
import { buildSimilarProductsTitleResearchPrompt } from './similar-products-title-prompt.js';
import { focusProductCardForRow } from './similar-products-card-focus.js';
import { resolveMyProductDisplayPosition } from './similar-products-title-position.js';
import {
    RESEARCH_EXPORT_COLUMNS,
    RESEARCH_TABLE_COLUMNS,
    buildTableRows,
    scrapeCurrentPage,
} from './similar-products-scraper.js';

const FAB_ID = 'bigseller-ai-similar-research-fab';
const PANEL_HOST_ID = 'bigseller-ai-similar-research-host';

let panelInstance = null;
let lastAutoIngestFingerprint = '';
let autoCollectScheduleTimer = null;
let navigationWatchInstalled = false;
let cardWatchInstalled = false;
let scrollWatchInstalled = false;
const AUTO_COLLECT_SETTLE_MS = 800;

const SIMILAR_PAGE_READY_SELECTORS = [
    'div[role="group"][aria-label^="Product card"]',
    '[data-sqe="item"]',
    '.shopee-search-item-result',
    '.XwdvuO',
    '.rBfdm_.row',
];

const MY_TITLE_STORAGE_PREFIX = 'bigseller-ai-my-product-title:';
const MY_TITLE_GLOBAL_KEY = 'bigseller-ai-my-product-title-global';

/** @type {{ sessionKey: string, rows: Record<string, unknown>[], seenKeys: Set<string>, myProductTitle: string }} */
const researchStore = {
    sessionKey: '',
    rows: [],
    seenKeys: new Set(),
    myProductTitle: '',
};

function myTitleStorageKey(sessionKey) {
    return `${MY_TITLE_STORAGE_PREFIX}${sessionKey}`;
}

function loadMyProductTitle(sessionKey) {
    try {
        const perSession = sessionStorage.getItem(myTitleStorageKey(sessionKey));
        if (perSession != null && perSession !== '')
            return perSession;
        return localStorage.getItem(MY_TITLE_GLOBAL_KEY) ?? '';
    }
    catch {
        return '';
    }
}

function saveMyProductTitle(sessionKey, title) {
    try {
        sessionStorage.setItem(myTitleStorageKey(sessionKey), title);
        if (String(title ?? '').trim())
            localStorage.setItem(MY_TITLE_GLOBAL_KEY, title);
    }
    catch {
        /* private mode */
    }
}

function purgeDomMainRows() {
    researchStore.rows = researchStore.rows.filter((r) => r.kind !== 'Chính');
    for (const key of [...researchStore.seenKeys]) {
        if (key.startsWith('main:'))
            researchStore.seenKeys.delete(key);
    }
}

/** Khóa phiên theo URL (bỏ tham số page) — đổi SP thì reset, cùng SP thì cộng dồn */
export function getResearchSessionKey() {
    const url = new URL(location.href);
    url.searchParams.delete('page');
    return `${url.pathname}?${url.searchParams.toString()}`;
}

function rowDedupeKey(row) {
    if (row.kind === 'Chính') {
        const id = String(row.itemId ?? '').trim();
        return id ? `main:${id}` : `main:${row.title}`;
    }
    const id = String(row.itemId ?? '').trim();
    return id ? `sim:${id}` : `sim:${row.title}::${row.shopId}`;
}

function ensureResearchSession() {
    const sessionKey = getResearchSessionKey();
    if (researchStore.sessionKey === sessionKey)
        return;
    panelInstance?.persistMyProductTitleFromInput();
    researchStore.sessionKey = sessionKey;
    researchStore.rows = [];
    researchStore.seenKeys = new Set();
    const loaded = loadMyProductTitle(sessionKey);
    if (loaded || !researchStore.myProductTitle.trim())
        researchStore.myProductTitle = loaded;
    lastAutoIngestFingerprint = '';
    panelInstance?.applyMyProductTitleToInput();
}

function mergeResearchRows(newRows) {
    ensureResearchSession();
    let added = 0;
    for (const row of newRows) {
        const key = rowDedupeKey(row);
        if (row.kind === 'Chính')
            continue;
        if (!key || researchStore.seenKeys.has(key))
            continue;
        researchStore.seenKeys.add(key);
        researchStore.rows.push(row);
        added += 1;
    }
    if (added > 0)
        refreshPanelLive();
    return { added, total: researchStore.rows.length };
}

function refreshPanelLive(statusText) {
    if (!panelInstance?.visible)
        return;
    panelInstance.syncFromStore(statusText);
}

function isSimilarPageReady() {
    return SIMILAR_PAGE_READY_SELECTORS.some((sel) =>
        document.querySelector(sel),
    );
}

/** Theo dõi vùng SP — cập nhật khi DOM trang hiện tại thay đổi (thêm card, đổi trang) */
export function installSimilarProductsCardWatch() {
    if (cardWatchInstalled)
        return;
    cardWatchInstalled = true;
    let pending = false;
    const observer = new MutationObserver(() => {
        if (!isSimilarPageReady())
            return;
        if (pending)
            return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            scheduleAutoCollect();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/** Cuộn trang Shopee — lazy-load thêm card trên cùng một trang */
export function installSimilarProductsScrollWatch() {
    if (scrollWatchInstalled)
        return;
    scrollWatchInstalled = true;
    let scrollTimer = null;
    window.addEventListener(
        'scroll',
        () => {
            if (!isSimilarPageReady())
                return;
            if (scrollTimer)
                clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                scrollTimer = null;
                scheduleAutoCollect();
            }, 450);
        },
        { passive: true, capture: true },
    );
}

/** Theo URL (popstate / pushState) — user bấm trang 2, 3… */
export function installSimilarProductsNavigationWatch() {
    if (navigationWatchInstalled)
        return;
    navigationWatchInstalled = true;
    const onNav = () => scheduleAutoCollect();
    window.addEventListener('popstate', onNav);
    const { pushState, replaceState } = history;
    history.pushState = function (...args) {
        const result = pushState.apply(this, args);
        onNav();
        return result;
    };
    history.replaceState = function (...args) {
        const result = replaceState.apply(this, args);
        onNav();
        return result;
    };
}

function getCurrentPageNumber() {
    return (
        Number.parseInt(
            new URLSearchParams(location.search).get('page') ?? '1',
            10,
        ) || 1
    );
}

/** Tự động lấy trang đang xem — không tự chuyển trang */
export function scheduleAutoCollect() {
    if (autoCollectScheduleTimer)
        clearTimeout(autoCollectScheduleTimer);
    autoCollectScheduleTimer = setTimeout(() => {
        autoCollectScheduleTimer = null;
        autoIngestCurrentPage();
    }, AUTO_COLLECT_SETTLE_MS);
}

/** Tự động lấy dữ liệu trang hiện tại — cùng URL thì cộng dồn, không trùng */
export function autoIngestCurrentPage() {
    ensureResearchSession();
    if (!isSimilarPageReady())
        return { added: 0, total: researchStore.rows.length };
    const page = getCurrentPageNumber();
    const { similar } = scrapeCurrentPage();
    const fingerprint =
        getResearchSessionKey() +
        `|p${page}|` +
        similar.map((p) => p.itemId || p.title).join('|');
    if (fingerprint === lastAutoIngestFingerprint)
        return { added: 0, total: researchStore.rows.length };
    lastAutoIngestFingerprint = fingerprint;
    const { added, total } = mergeResearchRows(
        buildTableRows(null, similar),
    );
    if (added > 0) {
        refreshPanelLive(
            `Trang ${page}: +${added} dòng (tổng ${total}).`,
        );
    }
    return { added, total };
}

class SimilarResearchPanel {
    host;
    shadow;
    visible = false;
    compact = false;
    expanded = false;
    lastPosition = null;
    rows = researchStore.rows;

    constructor() {
        const existing = document.getElementById(PANEL_HOST_ID);
        if (existing)
            existing.remove();
        this.host = document.createElement('div');
        this.host.id = PANEL_HOST_ID;
        this.host.style.display = 'none';
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        document.body.appendChild(this.host);
        this.render();
    }

    setCompact(compact) {
        this.compact = compact;
        if (compact) {
            this.host.setAttribute('data-compact', '1');
            this.setExpanded(false);
        }
        else {
            this.host.removeAttribute('data-compact');
        }
        const panelEl = this.shadow.querySelector('.panel');
        panelEl?.classList.toggle('compact', compact);
        const expandBtn = this.shadow.getElementById('expand-btn');
        if (expandBtn)
            expandBtn.hidden = !compact;
        this.updateMaximizeButton();
    }

    setExpanded(expanded) {
        this.expanded = expanded;
        if (expanded)
            this.host.setAttribute('data-expanded', '1');
        else
            this.host.removeAttribute('data-expanded');
        this.updateMaximizeButton();
    }

    updateMaximizeButton() {
        const btn = this.shadow.getElementById('maximize-btn');
        if (!btn)
            return;
        btn.hidden = this.compact;
        btn.textContent = this.expanded ? '⊟' : '⛶';
        btn.title = this.expanded ? 'Thu nhỏ bảng' : 'Phóng to bảng';
    }

    persistMyProductTitleFromInput() {
        const el = this.shadow.getElementById('my-product-title');
        if (!el)
            return;
        const value = el.value;
        if (value === researchStore.myProductTitle)
            return;
        researchStore.myProductTitle = value;
        if (researchStore.sessionKey)
            saveMyProductTitle(researchStore.sessionKey, value);
    }

    toggle() {
        this.visible = !this.visible;
        this.host.style.display = this.visible ? 'block' : 'none';
        if (!this.visible) {
            this.setCompact(false);
            this.setExpanded(false);
        }
        if (this.visible) {
            ensureResearchSession();
            this.applyMyProductTitleToInput();
            scheduleAutoCollect();
            const total = researchStore.rows.length;
            this.syncFromStore(
                total > 0
                    ? `Bảng ${total} dòng — tự động lấy trang ${getCurrentPageNumber()} đang xem.`
                    : `Đang chờ trang ${getCurrentPageNumber()} tải xong…`,
            );
        }
    }

    syncFromStore(statusText) {
        this.persistMyProductTitleFromInput();
        purgeDomMainRows();
        this.rows = researchStore.rows;
        this.renderTable();
        this.applyMyProductTitleToInput();
        this.updateMyTitlePositionHint();
        if (statusText)
            this.setStatus(statusText);
    }

    applyMyProductTitleToInput() {
        const el = this.shadow.getElementById('my-product-title');
        if (!el)
            return;
        const saved = researchStore.myProductTitle ?? '';
        if (saved && el.value !== saved)
            el.value = saved;
        else if (!saved && el.value.trim()) {
            researchStore.myProductTitle = el.value;
            if (researchStore.sessionKey)
                saveMyProductTitle(researchStore.sessionKey, el.value);
        }
    }

    getMyProductTitle() {
        const fromInput =
            this.shadow.getElementById('my-product-title')?.value?.trim() ?? '';
        return fromInput || researchStore.myProductTitle.trim();
    }

    onMyProductTitleInput(value) {
        ensureResearchSession();
        researchStore.myProductTitle = value;
        saveMyProductTitle(researchStore.sessionKey, value);
        this.updateMyTitlePositionHint();
    }

    updateMyTitlePositionHint() {
        const el = this.shadow.getElementById('my-title-position');
        if (!el)
            return;
        const position = resolveMyProductDisplayPosition(
            researchStore.rows,
            this.getMyProductTitle(),
        );
        this.lastPosition = position;
        if (position.empty) {
            el.textContent = '';
            el.hidden = true;
            el.dataset.clickable = '0';
            return;
        }
        el.hidden = false;
        el.textContent = position.uiText;
        el.dataset.found = position.found ? '1' : '0';
        el.dataset.clickable = position.found ? '1' : '0';
        el.title = position.found
            ? 'Bấm để cuộn tới SP và highlight trên trang Shopee'
            : '';
    }

    async onPositionHintClick() {
        const position = this.lastPosition ??
            resolveMyProductDisplayPosition(
                researchStore.rows,
                this.getMyProductTitle(),
            );
        if (!position?.found || !position.matchedRow) {
            this.setStatus('Không tìm thấy vị trí hiển thị trên trang.');
            return;
        }
        const result = focusProductCardForRow(position.matchedRow, position);
        if (result.ok) {
            this.setCompact(true);
            this.setStatus(
                `Đã highlight SP #${position.rank} — bấm ⤢ để mở lại bảng.`,
            );
        }
        else {
            this.setStatus(result.message);
        }
    }

    setStatus(text) {
        const el = this.shadow.getElementById('status');
        if (el)
            el.textContent = text;
    }

    render() {
        this.shadow.innerHTML = `
      <style>${PANEL_STYLES}</style>
      <div class="panel" role="dialog" aria-label="Nghiên cứu SP tương tự">
        <header class="header">
          <span class="title">Nghiên cứu SP tương tự</span>
          <div class="header-actions">
            <button type="button" class="btn-expand" id="maximize-btn" title="Phóng to bảng">⛶</button>
            <button type="button" class="btn-expand" id="expand-btn" hidden title="Mở lại bảng sau highlight">⤢</button>
            <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
          </div>
        </header>
        <div class="toolbar">
          <button type="button" class="btn accent sm" id="title-research-btn" disabled>Tên SP</button>
          <button type="button" class="btn sm" id="copy-btn" disabled>Copy</button>
          <button type="button" class="btn sm" id="csv-btn" disabled>CSV</button>
        </div>
        <label class="my-title-bar">
          <span class="my-title-label">Tên sản phẩm của tôi</span>
          <input type="text" id="my-product-title" class="my-title-input"
            placeholder="Nhập tên SP hiện tại của bạn (không lấy từ trang)…" autocomplete="off" />
          <p class="my-title-position" id="my-title-position" hidden></p>
        </label>
        <p class="status" id="status">Tự động lấy trang đang xem — sang trang 2, 3… thì cộng dồn.</p>
        <div class="body">
          <div class="table-scroll" id="table-scroll">
            <div class="table-wrap" id="table-wrap"></div>
          </div>
        </div>
      </div>
    `;
        this.bindEvents();
        ensureResearchSession();
        this.applyMyProductTitleToInput();
        this.renderTable();
        this.updateMyTitlePositionHint();
        this.updateMaximizeButton();
    }

    bindEvents() {
        this.shadow.getElementById('my-product-title')?.addEventListener('input', (ev) => {
            this.onMyProductTitleInput(ev.target.value);
        });
        this.shadow.getElementById('maximize-btn')?.addEventListener('click', () => {
            this.setExpanded(!this.expanded);
            this.setStatus(
                this.expanded
                    ? 'Đã phóng to bảng — bấm ⊟ để thu nhỏ.'
                    : 'Đã thu nhỏ bảng.',
            );
        });
        this.shadow.getElementById('my-title-position')?.addEventListener('click', () => {
            void this.onPositionHintClick();
        });
        this.shadow.getElementById('expand-btn')?.addEventListener('click', () => {
            this.setCompact(false);
            this.setStatus('Đã mở rộng bảng nghiên cứu.');
        });
        this.shadow.getElementById('close-btn')?.addEventListener('click', () => {
            this.visible = false;
            this.host.style.display = 'none';
        });
        this.shadow.getElementById('copy-btn')?.addEventListener('click', () => {
            void this.copyTable();
        });
        this.shadow.getElementById('csv-btn')?.addEventListener('click', () => {
            this.downloadTable();
        });
        this.shadow.getElementById('title-research-btn')?.addEventListener('click', () => {
            void this.copyTitleResearchPrompt();
        });
        installTableScrollContainment(
            this.shadow.getElementById('table-scroll'),
        );
    }

    async copyTitleResearchPrompt() {
        if (!this.rows.length) {
            this.setStatus('Chưa có dữ liệu — đang chờ thu thập tự động.');
            return;
        }
        const prompt = buildSimilarProductsTitleResearchPrompt(
            this.rows,
            this.getMyProductTitle(),
        );
        try {
            const result = await sendMessage({
                type: MessageType.GEMINI_FILL_PROMPT,
                payload: { prompt },
            });
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Không điền được prompt vào Gemini');
            }
            this.setStatus(
                'Đã điền prompt vào Gemini — kiểm tra và bấm Gửi.',
            );
        }
        catch (err) {
            try {
                await navigator.clipboard.writeText(prompt);
                await sendMessage({ type: MessageType.OPEN_GEMINI_TAB });
                this.setStatus(
                    'Không tự điền được — đã copy prompt, mở Gemini và dán thủ công (Ctrl+V).',
                );
                return;
            }
            catch {
                /* fall through */
            }
            this.setStatus(
                err instanceof Error
                    ? err.message
                    : 'Không gửi được prompt nghiên cứu tên',
            );
        }
    }

    async copyTable() {
        if (!this.rows.length)
            return;
        try {
            await copyTableToClipboard(this.rows, RESEARCH_EXPORT_COLUMNS);
            this.setStatus(`Đã copy ${this.rows.length} dòng vào clipboard.`);
        }
        catch (err) {
            this.setStatus(
                err instanceof Error ? err.message : 'Không copy được',
            );
        }
    }

    downloadTable() {
        if (!this.rows.length)
            return;
        const stamp = new Date().toISOString().slice(0, 10);
        downloadCsv(
            this.rows,
            RESEARCH_EXPORT_COLUMNS,
            `shopee-similar-products-${stamp}.csv`,
        );
        this.setStatus(`Đã tải CSV (${this.rows.length} dòng).`);
    }

    renderTable() {
        const wrap = this.shadow.getElementById('table-wrap');
        const scrollEl = this.shadow.getElementById('table-scroll');
        const copyBtn = this.shadow.getElementById('copy-btn');
        const csvBtn = this.shadow.getElementById('csv-btn');
        const titleBtn = this.shadow.getElementById('title-research-btn');
        if (!wrap)
            return;
        const scrollTop = scrollEl?.scrollTop ?? 0;
        this.rows = researchStore.rows;
        const hasRows = this.rows.length > 0;
        if (copyBtn)
            copyBtn.disabled = !hasRows;
        if (csvBtn)
            csvBtn.disabled = !hasRows;
        if (titleBtn)
            titleBtn.disabled = !hasRows;
        if (!hasRows) {
            wrap.innerHTML =
                '<p class="empty">Chưa có dữ liệu — extension tự lấy SP trên <strong>trang đang xem</strong> khi tải xong.</p>';
            return;
        }
        const head = RESEARCH_TABLE_COLUMNS.map(
            (c) =>
                `<th class="${c.colClass ?? ''}">${escapeHtml(c.label)}</th>`,
        ).join('');
        const body = this.rows
            .map((row) => {
                const mainClass = row.kind === 'Chính' ? ' class="row-main"' : '';
                const cells = RESEARCH_TABLE_COLUMNS.map((c) => {
                    const v = row[c.key];
                    const cls = c.colClass ?? '';
                    const text = c.key === 'productUrl' && v
                        ? `<a href="${escapeAttr(v)}" target="_blank" rel="noopener">Mở</a>`
                        : escapeHtml(v);
                    return `<td class="${cls}">${text}</td>`;
                }).join('');
                return `<tr${mainClass}>${cells}</tr>`;
            })
            .join('');
        wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
        if (scrollEl)
            scrollEl.scrollTop = scrollTop;
    }
}

/** Giữ cuộn trong bảng — Shopee thường bắt wheel làm cuộn cả trang */
function installTableScrollContainment(scrollEl) {
    if (!scrollEl || scrollEl.dataset.scrollGuard === '1')
        return;
    scrollEl.dataset.scrollGuard = '1';
    scrollEl.addEventListener(
        'wheel',
        (ev) => {
            if (scrollEl.scrollHeight <= scrollEl.clientHeight)
                return;
            const { scrollTop, scrollHeight, clientHeight } = scrollEl;
            const delta = ev.deltaY;
            const atTop = scrollTop <= 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
            if ((delta < 0 && atTop) || (delta > 0 && atBottom))
                return;
            ev.preventDefault();
            ev.stopPropagation();
            scrollEl.scrollTop += delta;
        },
        { capture: true, passive: false },
    );
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
}

function getPanel() {
    if (!panelInstance)
        panelInstance = new SimilarResearchPanel();
    return panelInstance;
}

export function mountSimilarProductsResearch() {
    if (document.getElementById(FAB_ID)) {
        installSimilarProductsNavigationWatch();
        installSimilarProductsCardWatch();
        installSimilarProductsScrollWatch();
        return;
    }
    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.type = 'button';
    btn.title = 'Nghiên cứu SP tương tự';
    btn.setAttribute('aria-label', 'Nghiên cứu SP tương tự');
    btn.textContent = '📊';
    Object.assign(btn.style, {
        position: 'fixed',
        right: `${FAB_IMAGE_RIGHT_PX}px`,
        bottom: `${FAB_ROW_BOTTOM_PX}px`,
        zIndex: '2147483645',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        border: 'none',
        background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
        color: '#fff',
        fontWeight: '700',
        fontSize: '20px',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(37,99,235,.45)',
        lineHeight: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    });
    const panel = getPanel();
    btn.addEventListener('click', () => panel.toggle());
    document.body.appendChild(btn);
    installSimilarProductsNavigationWatch();
    installSimilarProductsCardWatch();
    installSimilarProductsScrollWatch();
    scheduleAutoCollect();
}

const PANEL_STYLES = `
  :host {
    all: initial;
    display: flex;
    flex-direction: column;
    position: fixed;
    right: ${FAB_IMAGE_RIGHT_PX}px;
    bottom: ${FAB_ROW_BOTTOM_PX + FAB_SIZE_PX + 12}px;
    z-index: 2147483646;
    width: min(520px, calc(100vw - 40px));
    height: min(62vh, 480px);
    max-height: min(62vh, 480px);
    min-height: 220px;
    pointer-events: auto;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
    box-sizing: border-box;
  }
  :host([data-expanded="1"]) {
    width: min(96vw, 1180px);
    height: min(88vh, 860px);
    max-height: min(88vh, 860px);
    right: 16px;
    bottom: 16px;
  }
  :host([data-compact="1"]) {
    width: min(300px, calc(100vw - 40px));
    height: auto;
    max-height: none;
    min-height: 0;
  }
  :host *, :host *::before, :host *::after { box-sizing: border-box; }
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: #fff;
    color: #111827;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.2);
    border: 1px solid #e5e7eb;
    overflow: hidden;
  }
  .panel.compact .toolbar,
  .panel.compact .my-title-bar,
  .panel.compact .status,
  .panel.compact .body {
    display: none;
  }
  .panel.compact .header {
    border-radius: 12px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 8px 10px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .title { font-weight: 700; font-size: 13px; }
  .btn-expand {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    line-height: 1;
    border-radius: 6px;
    padding: 4px 6px;
  }
  .btn-expand:hover { background: rgba(255, 255, 255, 0.32); }
  .btn-close {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 22px;
    cursor: pointer;
    line-height: 1;
  }
  .toolbar {
    display: flex;
    flex-wrap: nowrap;
    gap: 6px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }
  .my-title-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid #f3f4f6;
    flex-shrink: 0;
  }
  .my-title-label {
    font-size: 11px;
    font-weight: 700;
    color: #374151;
  }
  .my-title-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 11px;
    color: #111827;
    background: #fff;
  }
  .my-title-input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
  }
  .my-title-input::placeholder { color: #9ca3af; }
  .my-title-position {
    margin: 0;
    font-size: 10px;
    line-height: 1.35;
    color: #047857;
  }
  .my-title-position[data-found="0"] {
    color: #b45309;
  }
  .my-title-position[data-clickable="1"] {
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
  .my-title-position[data-clickable="1"]:hover {
    color: #065f46;
  }
  .btn {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: #111827;
  }
  .btn:hover:not(:disabled) { background: #f3f4f6; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }
  .btn.primary:hover:not(:disabled) { background: #1d4ed8; }
  .btn.accent {
    background: #7c3aed;
    border-color: #7c3aed;
    color: #fff;
  }
  .btn.accent:hover:not(:disabled) { background: #6d28d9; }
  .btn.sm {
    padding: 5px 8px;
    font-size: 10px;
    flex: 1 1 0;
    min-width: 0;
  }
  .status {
    margin: 0;
    padding: 5px 10px;
    font-size: 10px;
    color: #6b7280;
    border-bottom: 1px solid #f3f4f6;
    flex-shrink: 0;
  }
  .body {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }
  .table-scroll {
    flex: 1 1 0;
    min-height: 0;
    overflow-x: auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y;
    scrollbar-gutter: stable;
  }
  .table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
  .table-scroll::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;
  }
  .table-scroll::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
  .table-wrap {
    min-width: min-content;
    width: 100%;
  }
  .data-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 10px;
    color: #111827;
    background: #fff;
  }
  .data-table thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: #f9fafb;
    text-align: left;
    padding: 5px 6px;
    border-bottom: 2px solid #e5e7eb;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  }
  .data-table td {
    padding: 5px 6px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: top;
  }
  .data-table th.col-num,
  .data-table td.col-num,
  .data-table th.col-rating,
  .data-table td.col-rating,
  .data-table th.col-price,
  .data-table td.col-price,
  .data-table th.col-sold,
  .data-table td.col-sold,
  .data-table th.col-link,
  .data-table td.col-link {
    white-space: nowrap;
  }
  .data-table th.col-num,
  .data-table td.col-num { text-align: center; }
  :host([data-expanded="1"]) .data-table th.col-title,
  :host([data-expanded="1"]) .data-table td.col-title {
    min-width: 220px;
    max-width: 420px;
  }
  .data-table th.col-title,
  .data-table td.col-title {
    min-width: 140px;
    max-width: 200px;
    white-space: normal;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    line-height: 1.45;
    hyphens: auto;
  }
  .data-table td.col-price {
    font-weight: 600;
    color: #c2410c;
  }
  .data-table tr.row-main td {
    background: #eff6ff;
    font-weight: 600;
  }
  .data-table a { color: #2563eb; }
  .empty {
    padding: 24px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
  }
`;
