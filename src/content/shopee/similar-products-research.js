import { MessageType, sendMessage } from '../../shared/messaging.js';
import { isSiblingShopId, SIBLING_SHOPEE_SHOPS } from '../../shared/shop-names.js';
import { copyTableToClipboard, downloadCsv } from '../../shared/table-export.js';
import { FAB_IMAGE_RIGHT_PX, FAB_ROW_BOTTOM_PX, FAB_SIZE_PX } from '../shared/panel.js';
import {
    installSearchLayoutWatch,
    syncShopeeSearchPageLayout,
} from './similar-products-search-layout.js';
import { buildSimilarProductsTitleResearchPrompt } from './similar-products-title-prompt.js';
import {
    deriveTitlesByShopFromList,
    loadMyProductTitlesList,
    normalizePastedProductTitle,
    renderMyTitlesSectionHtml,
    saveMyProductTitlesList,
} from './similar-products-my-titles.js';
import { focusProductCardForRow } from './similar-products-card-focus.js';
import { resolveMyProductDisplayPosition } from './similar-products-title-position.js';
import {
    RESEARCH_EXPORT_COLUMNS,
    RESEARCH_TABLE_COLUMNS,
    buildTableRows,
    detectShopeeCurrentPage,
    scrapeCurrentPage,
} from './similar-products-scraper.js';

const FAB_ID = 'bigseller-ai-similar-research-fab';
const PANEL_HOST_ID = 'bigseller-ai-similar-research-host';
const SIDEBAR_WIDTH_KEY = 'bigseller-ai-similar-sidebar-width';
const SIDEBAR_DISMISSED_KEY = 'bigseller-ai-similar-sidebar-dismissed';
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_DEFAULT_WIDTH = 420;

let panelInstance = null;
let researchFabEl = null;
let lastAutoIngestFingerprint = '';
let lastIngestPage = null;
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

/** @type {{ sessionKey: string, rows: Record<string, unknown>[], seenKeys: Set<string>, myProductTitles: string[] }} */
const researchStore = {
    sessionKey: '',
    rows: [],
    seenKeys: new Set(),
    myProductTitles: [],
};

function getSidebarMaxWidth() {
    return Math.min(window.innerWidth * 0.5, 720);
}

function clampSidebarWidth(px) {
    return Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(getSidebarMaxWidth(), Number(px) || SIDEBAR_DEFAULT_WIDTH),
    );
}

function loadSidebarWidth() {
    try {
        const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
        if (raw)
            return clampSidebarWidth(Number.parseInt(raw, 10));
    }
    catch {
        /* private mode */
    }
    return SIDEBAR_DEFAULT_WIDTH;
}

function shouldAutoOpenSidebar() {
    try {
        return sessionStorage.getItem(SIDEBAR_DISMISSED_KEY) !== '1';
    }
    catch {
        return true;
    }
}

function updateFabPosition() {
    const fab = researchFabEl ?? document.getElementById(FAB_ID);
    if (!fab)
        return;
    if (panelInstance?.visible) {
        fab.style.right = `${panelInstance.getSidebarWidth() + 12}px`;
    }
    else {
        fab.style.right = `${FAB_IMAGE_RIGHT_PX}px`;
    }
}

function syncSearchPageLayout() {
    const open = !!panelInstance?.visible;
    syncShopeeSearchPageLayout({
        open,
        sidebarWidth: panelInstance?.getSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH,
    });
    installSearchLayoutWatch(
        open,
        () => panelInstance?.getSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH,
    );
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
    researchStore.myProductTitles = loadMyProductTitlesList(sessionKey);
    lastAutoIngestFingerprint = '';
    lastIngestPage = null;
    panelInstance?.applyMyProductTitleToInput();
    try {
        sessionStorage.removeItem(SIDEBAR_DISMISSED_KEY);
    }
    catch {
        /* private mode */
    }
    if (panelInstance && shouldAutoOpenSidebar() && !panelInstance.visible)
        panelInstance.open();
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
    const onNav = () => {
        lastAutoIngestFingerprint = '';
        scheduleAutoCollect();
    };
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
    document.addEventListener(
        'click',
        (ev) => {
            const t = ev.target;
            if (!(t instanceof Element))
                return;
            if (
                !t.closest(
                    '.shopee-page-controller, .shopee-mini-page-controller, [class*="page-controller"]',
                )
            )
                return;
            onNav();
        },
        true,
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
    const page = detectShopeeCurrentPage();
    if (lastIngestPage != null && lastIngestPage !== page)
        lastAutoIngestFingerprint = '';
    lastIngestPage = page;
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
    if (panelInstance?.visible)
        syncSearchPageLayout();
    return { added, total };
}

class SimilarResearchPanel {
    host;
    shadow;
    visible = false;
    sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
    /** @type {Record<number, ReturnType<typeof resolveMyProductDisplayPosition>>} */
    lastPositions = {};
    rows = researchStore.rows;

    constructor() {
        const existing = document.getElementById(PANEL_HOST_ID);
        if (existing)
            existing.remove();
        this.host = document.createElement('div');
        this.host.id = PANEL_HOST_ID;
        this.host.setAttribute('data-open', '0');
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        document.body.appendChild(this.host);
        this.applySidebarWidth(loadSidebarWidth());
        this.render();
    }

    getSidebarWidth() {
        return this.sidebarWidth;
    }

    applySidebarWidth(px) {
        this.sidebarWidth = clampSidebarWidth(px);
        this.host.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);
        try {
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(this.sidebarWidth));
        }
        catch {
            /* private mode */
        }
        updateFabPosition();
        syncSearchPageLayout();
    }

    open() {
        if (this.visible)
            return;
        this.visible = true;
        this.host.setAttribute('data-open', '1');
        ensureResearchSession();
        this.applyMyProductTitleToInput();
        scheduleAutoCollect();
        updateFabPosition();
        syncSearchPageLayout();
        const total = researchStore.rows.length;
        this.syncFromStore(
            total > 0
                ? `Bảng ${total} dòng — tự động lấy trang ${detectShopeeCurrentPage()} đang xem.`
                : `Đang chờ trang ${detectShopeeCurrentPage()} tải xong…`,
        );
    }

    close(dismiss = true) {
        if (!this.visible)
            return;
        this.persistMyProductTitleFromInput();
        this.visible = false;
        this.host.setAttribute('data-open', '0');
        if (dismiss) {
            try {
                sessionStorage.setItem(SIDEBAR_DISMISSED_KEY, '1');
            }
            catch {
                /* private mode */
            }
        }
        updateFabPosition();
        syncSearchPageLayout();
    }

    persistMyProductTitleFromInput() {
        this.syncMyProductTitlesFromDom();
    }

    syncMyProductTitlesFromDom() {
        const wrap = this.shadow.getElementById('my-title-badges');
        if (!wrap)
            return;
        const next = [];
        wrap.querySelectorAll('.my-title-chip-input').forEach((input) => {
            const value = normalizePastedProductTitle(input.value);
            if (value)
                next.push(value);
        });
        if (
            next.length === researchStore.myProductTitles.length &&
            next.every((t, i) => t === researchStore.myProductTitles[i])
        ) {
            return;
        }
        researchStore.myProductTitles = next;
        if (researchStore.sessionKey)
            saveMyProductTitlesList(researchStore.sessionKey, next);
    }

    saveMyProductTitles(titles) {
        ensureResearchSession();
        researchStore.myProductTitles = saveMyProductTitlesList(
            researchStore.sessionKey,
            titles,
        );
        this.renderMyTitleBadges();
        this.updateMyTitlePositionHints();
    }

    addMyProductTitle(raw) {
        const value = normalizePastedProductTitle(raw);
        if (!value)
            return;
        const titles = [...this.getMyProductTitleList()];
        if (titles.some((t) => t === value))
            return;
        titles.push(value);
        this.saveMyProductTitles(titles);
    }

    removeMyProductTitle(index) {
        const titles = [...this.getMyProductTitleList()];
        if (index < 0 || index >= titles.length)
            return;
        titles.splice(index, 1);
        this.saveMyProductTitles(titles);
    }

    updateMyProductTitle(index, raw) {
        const value = normalizePastedProductTitle(raw);
        const titles = [...this.getMyProductTitleList()];
        if (index < 0 || index >= titles.length)
            return;
        if (!value) {
            titles.splice(index, 1);
            this.saveMyProductTitles(titles);
            return;
        }
        if (titles.some((t, i) => i !== index && t === value))
            return;
        titles[index] = value;
        this.saveMyProductTitles(titles);
    }

    clearAllMyProductTitles() {
        this.saveMyProductTitles([]);
        const paste = this.shadow.getElementById('my-title-paste');
        if (paste)
            paste.value = '';
    }

    toggle() {
        if (this.visible) {
            this.close(true);
            return;
        }
        try {
            sessionStorage.removeItem(SIDEBAR_DISMISSED_KEY);
        }
        catch {
            /* private mode */
        }
        this.open();
    }

    syncFromStore(statusText) {
        this.persistMyProductTitleFromInput();
        purgeDomMainRows();
        this.rows = researchStore.rows;
        this.renderTable();
        this.renderMyTitleBadges();
        this.updateMyTitlePositionHints();
        if (statusText)
            this.setStatus(statusText);
    }

    renderMyTitleBadges() {
        const wrap = this.shadow.getElementById('my-title-badges');
        if (!wrap)
            return;
        const titles = researchStore.myProductTitles;
        if (!titles.length) {
            wrap.innerHTML = '<p class="my-title-empty">Chưa có tên SP — dán vào ô bên dưới.</p>';
            return;
        }
        wrap.innerHTML = titles
            .map((title, index) => {
                const pos = this.lastPositions[index];
                const posHidden = !pos || pos.empty;
                const posHtml = posHidden
                    ? ''
                    : `<p class="my-title-position" data-index="${index}"
                        data-found="${pos.found ? '1' : '0'}"
                        data-clickable="${pos.found ? '1' : '0'}"
                        title="${pos.found ? 'Bấm để cuộn tới SP và highlight trên trang Shopee' : ''}">${escapeHtml(pos.uiText)}</p>`;
                return `<div class="my-title-chip" data-index="${index}">
            <div class="my-title-chip-row">
              <input type="text" class="my-title-chip-input" data-index="${index}"
                value="${escapeAttr(title)}" autocomplete="off" spellcheck="false" />
              <button type="button" class="my-title-chip-remove" data-index="${index}"
                title="Xóa tên SP" aria-label="Xóa">×</button>
            </div>
            ${posHtml}
          </div>`;
            })
            .join('');
    }

    applyMyProductTitleToInput() {
        this.renderMyTitleBadges();
    }

    getMyProductTitleList() {
        this.syncMyProductTitlesFromDom();
        return [...researchStore.myProductTitles];
    }

    getMyProductTitles() {
        return deriveTitlesByShopFromList(
            researchStore.rows,
            this.getMyProductTitleList(),
        );
    }

    onMyProductTitleChipInput(index, value) {
        const titles = [...researchStore.myProductTitles];
        if (index < 0 || index >= titles.length)
            return;
        titles[index] = value;
        researchStore.myProductTitles = titles;
        this.refreshSinglePositionHint(index, value);
    }

    refreshSinglePositionHint(index, title) {
        const wrap = this.shadow.getElementById('my-title-badges');
        if (!wrap)
            return;
        const position = resolveMyProductDisplayPosition(
            researchStore.rows,
            title ?? '',
            { shopLabel: `SP ${index + 1}` },
        );
        this.lastPositions[index] = position;
        const chip = wrap.querySelector(`.my-title-chip[data-index="${index}"]`);
        if (!chip)
            return;
        let posEl = chip.querySelector('.my-title-position');
        if (position.empty) {
            posEl?.remove();
            return;
        }
        if (!posEl) {
            posEl = document.createElement('p');
            posEl.className = 'my-title-position';
            posEl.dataset.index = String(index);
            chip.appendChild(posEl);
        }
        posEl.textContent = position.uiText;
        posEl.dataset.found = position.found ? '1' : '0';
        posEl.dataset.clickable = position.found ? '1' : '0';
        posEl.title = position.found
            ? 'Bấm để cuộn tới SP và highlight trên trang Shopee'
            : '';
    }

    updateMyTitlePositionHints() {
        const titles = this.getMyProductTitleList();
        this.lastPositions = {};
        for (let i = 0; i < titles.length; i++) {
            this.lastPositions[i] = resolveMyProductDisplayPosition(
                researchStore.rows,
                titles[i] ?? '',
                { shopLabel: `SP ${i + 1}` },
            );
        }
        this.renderMyTitleBadges();
    }

    async onPositionHintClick(index) {
        const titles = this.getMyProductTitleList();
        const position = this.lastPositions[index] ??
            resolveMyProductDisplayPosition(
                researchStore.rows,
                titles[index] ?? '',
                { shopLabel: `SP ${index + 1}` },
            );
        if (!position?.found || !position.matchedRow) {
            this.setStatus('Không tìm thấy vị trí hiển thị trên trang.');
            return;
        }
        const result = focusProductCardForRow(position.matchedRow, position);
        if (result.ok) {
            this.setStatus(`Đã highlight SP #${position.rank} trên trang.`);
        }
        else {
            this.setStatus(result.message);
        }
    }

    async onTableSiblingTitleClick(rowIndex) {
        const row = this.rows[rowIndex];
        if (!row || !isSiblingShopId(row.shopId)) {
            this.setStatus('Chỉ bấm được tên SP thuộc shop cùng hệ.');
            return;
        }
        const result = focusProductCardForRow(row);
        if (result.ok) {
            this.setStatus(`Đã highlight SP #${row.rank ?? '?'} trên trang.`);
        }
        else {
            this.setStatus(result.message);
        }
    }

    async onCopyTableTitle(rowIndex) {
        const title = String(this.rows[rowIndex]?.title ?? '').trim();
        if (!title) {
            this.setStatus('Không có tên SP để copy.');
            return;
        }
        try {
            await navigator.clipboard.writeText(title);
            this.setStatus('Đã copy tên SP.');
        }
        catch {
            this.setStatus('Không copy được tên SP.');
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
      <div class="sidebar-shell">
        <div class="resize-handle" id="resize-handle" title="Kéo để chỉnh độ rộng" aria-hidden="true"></div>
        <div class="panel" role="dialog" aria-label="Nghiên cứu SP tương tự">
        <header class="header">
          <span class="title">Nghiên cứu SP tương tự</span>
          <div class="header-actions">
            <button type="button" class="btn-close" id="close-btn" title="Đóng">×</button>
          </div>
        </header>
        <div class="toolbar">
          <button type="button" class="btn accent sm" id="title-research-btn" disabled>Tên SP</button>
          <button type="button" class="btn sm" id="copy-btn" disabled>Copy</button>
          <button type="button" class="btn sm" id="csv-btn" disabled>CSV</button>
        </div>
        <div class="my-title-bars">
          ${renderMyTitlesSectionHtml()}
        </div>
        <p class="status" id="status">Tự động lấy trang đang xem — sang trang 2, 3… thì cộng dồn.</p>
        <div class="body">
          <div class="table-scroll" id="table-scroll">
            <div class="table-wrap" id="table-wrap"></div>
          </div>
        </div>
        </div>
      </div>
    `;
        this.bindEvents();
        ensureResearchSession();
        this.applyMyProductTitleToInput();
        this.renderTable();
        this.updateMyTitlePositionHints();
    }

    bindResizeHandle() {
        const handle = this.shadow.getElementById('resize-handle');
        if (!handle)
            return;
        let dragging = false;
        let startX = 0;
        let startW = 0;
        const onMove = (ev) => {
            if (!dragging)
                return;
            const clientX = ev.touches?.[0]?.clientX ?? ev.clientX;
            this.applySidebarWidth(startW + (startX - clientX));
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
        };
        handle.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            dragging = true;
            startX = ev.clientX;
            startW = this.sidebarWidth;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        handle.addEventListener('touchstart', (ev) => {
            dragging = true;
            startX = ev.touches[0].clientX;
            startW = this.sidebarWidth;
            document.addEventListener('touchmove', onMove, { passive: true });
            document.addEventListener('touchend', onUp);
        }, { passive: true });
    }

    bindMyTitleEvents() {
        const paste = this.shadow.getElementById('my-title-paste');
        paste?.addEventListener('paste', (ev) => {
            const text = ev.clipboardData?.getData('text/plain') ?? '';
            if (!String(text).trim())
                return;
            ev.preventDefault();
            this.addMyProductTitle(text);
            paste.value = '';
        });
        paste?.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey)
                return;
            const text = paste.value;
            if (!String(text).trim())
                return;
            ev.preventDefault();
            this.addMyProductTitle(text);
            paste.value = '';
        });
        this.shadow.getElementById('my-titles-clear-all')?.addEventListener('click', () => {
            this.clearAllMyProductTitles();
        });
        const badges = this.shadow.getElementById('my-title-badges');
        badges?.addEventListener('input', (ev) => {
            const input = ev.target.closest('.my-title-chip-input');
            if (!input)
                return;
            const index = Number.parseInt(input.dataset.index ?? '', 10);
            if (Number.isFinite(index))
                this.onMyProductTitleChipInput(index, input.value);
        });
        badges?.addEventListener('click', (ev) => {
            const removeBtn = ev.target.closest('.my-title-chip-remove');
            if (removeBtn) {
                ev.preventDefault();
                const index = Number.parseInt(removeBtn.dataset.index ?? '', 10);
                if (Number.isFinite(index))
                    this.removeMyProductTitle(index);
                return;
            }
            const posEl = ev.target.closest('.my-title-position[data-clickable="1"]');
            if (posEl) {
                const index = Number.parseInt(posEl.dataset.index ?? '', 10);
                if (Number.isFinite(index))
                    void this.onPositionHintClick(index);
            }
        });
        badges?.addEventListener('blur', (ev) => {
            const input = ev.target.closest('.my-title-chip-input');
            if (!input)
                return;
            const index = Number.parseInt(input.dataset.index ?? '', 10);
            if (!Number.isFinite(index))
                return;
            this.updateMyProductTitle(index, input.value);
        }, true);
    }

    bindEvents() {
        this.bindResizeHandle();
        this.bindMyTitleEvents();
        this.shadow.getElementById('close-btn')?.addEventListener('click', () => {
            this.close(true);
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
        this.shadow.getElementById('table-wrap')?.addEventListener('click', (ev) => {
            const copyBtn = ev.target.closest('.title-copy-btn');
            if (copyBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                const idx = Number.parseInt(copyBtn.dataset.rowIndex ?? '', 10);
                if (Number.isFinite(idx))
                    void this.onCopyTableTitle(idx);
                return;
            }
            const btn = ev.target.closest('.title-nav-btn');
            if (!btn)
                return;
            ev.preventDefault();
            const idx = Number.parseInt(btn.dataset.rowIndex ?? '', 10);
            if (Number.isFinite(idx))
                void this.onTableSiblingTitleClick(idx);
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
        const titles = this.getMyProductTitleList();
        const prompt = buildSimilarProductsTitleResearchPrompt(
            this.rows,
            this.getMyProductTitles(),
            {
                productTitles: titles,
                filledSlotCount: titles.length,
            },
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
            .map((row, rowIndex) => {
                const rowClasses = [];
                if (row.kind === 'Chính')
                    rowClasses.push('row-main');
                const siblingRow = isSiblingShopId(row.shopId);
                if (siblingRow)
                    rowClasses.push('row-sibling-shop');
                const classAttr = rowClasses.length
                    ? ` class="${rowClasses.join(' ')}"`
                    : '';
                const cells = RESEARCH_TABLE_COLUMNS.map((c) => {
                    const v = row[c.key];
                    const cls = c.colClass ?? '';
                    let text;
                    if (c.key === 'productUrl' && v) {
                        text = `<a href="${escapeAttr(v)}" target="_blank" rel="noopener">Mở</a>`;
                    }
                    else if (c.key === 'title' && siblingRow && v) {
                        text = `<div class="title-nav-cell">
              <button type="button" class="title-nav-btn" data-row-index="${rowIndex}" title="Bấm để cuộn tới SP trên trang Shopee">${escapeHtml(v)}</button>
              <button type="button" class="title-copy-btn" data-row-index="${rowIndex}" title="Copy tên SP" aria-label="Copy tên SP">Copy</button>
            </div>`;
                    }
                    else {
                        text = escapeHtml(v);
                    }
                    return `<td class="${cls}">${text}</td>`;
                }).join('');
                return `<tr${classAttr}>${cells}</tr>`;
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
        researchFabEl = document.getElementById(FAB_ID);
        installSimilarProductsNavigationWatch();
        installSimilarProductsCardWatch();
        installSimilarProductsScrollWatch();
        const panel = getPanel();
        if (shouldAutoOpenSidebar())
            panel.open();
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
    researchFabEl = btn;
    const panel = getPanel();
    btn.addEventListener('click', () => panel.toggle());
    document.body.appendChild(btn);
    installSimilarProductsNavigationWatch();
    installSimilarProductsCardWatch();
    installSimilarProductsScrollWatch();
    scheduleAutoCollect();
    if (shouldAutoOpenSidebar())
        panel.open();
    window.addEventListener('resize', () => {
        panelInstance?.applySidebarWidth(panelInstance.getSidebarWidth());
    });
}

const PANEL_STYLES = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: var(--sidebar-width, ${SIDEBAR_DEFAULT_WIDTH}px);
    z-index: 2147483646;
    transform: translateX(100%);
    transition: transform 0.22s ease;
    pointer-events: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
    box-sizing: border-box;
  }
  :host([data-open="1"]) {
    transform: translateX(0);
    pointer-events: auto;
  }
  :host *, :host *::before, :host *::after { box-sizing: border-box; }
  .sidebar-shell {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .resize-handle {
    flex: 0 0 6px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
    background: transparent;
    touch-action: none;
  }
  .resize-handle:hover,
  .resize-handle:active {
    background: rgba(37, 99, 235, 0.12);
  }
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    background: #fff;
    color: #111827;
    border-radius: 0;
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
    border-left: 1px solid #e5e7eb;
    overflow: hidden;
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
  .my-title-bars {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-bottom: 1px solid #f3f4f6;
  }
  .my-title-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 6px;
    flex-shrink: 0;
  }
  .my-title-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .my-title-heading {
    font-size: 11px;
    font-weight: 700;
    color: #374151;
  }
  .my-title-clear-btn {
    padding: 2px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #fff;
    font-size: 10px;
    font-weight: 600;
    color: #6b7280;
    cursor: pointer;
  }
  .my-title-clear-btn:hover {
    color: #b91c1c;
    border-color: #fecaca;
    background: #fef2f2;
  }
  .my-title-badges {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow-y: auto;
  }
  .my-title-empty {
    margin: 0;
    font-size: 10px;
    color: #9ca3af;
    font-style: italic;
  }
  .my-title-chip {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .my-title-chip-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .my-title-chip-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.35;
    color: #1e3a8a;
    background: #eff6ff;
  }
  .my-title-chip-input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
    background: #fff;
  }
  .my-title-chip-remove {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #fff;
    color: #6b7280;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .my-title-chip-remove:hover {
    color: #b91c1c;
    border-color: #fecaca;
    background: #fef2f2;
  }
  .my-title-paste {
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px dashed #d1d5db;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.35;
    color: #111827;
    background: #fafafa;
    resize: vertical;
  }
  .my-title-paste:focus {
    outline: none;
    border-color: #2563eb;
    border-style: solid;
    background: #fff;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
  }
  .my-title-paste::placeholder { color: #9ca3af; }
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
  .data-table th.col-title,
  .data-table td.col-title {
    min-width: 140px;
    max-width: 280px;
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
  .data-table tr.row-sibling-shop td {
    background: #ecfdf5;
  }
  .data-table tr.row-sibling-shop.row-main td {
    background: #dbeafe;
  }
  .title-nav-cell {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
  }
  .title-nav-btn {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: #047857;
    text-align: left;
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    line-height: inherit;
  }
  .title-nav-btn:hover {
    color: #065f46;
    text-decoration-style: solid;
  }
  .title-nav-btn:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
    border-radius: 2px;
  }
  .title-copy-btn {
    flex: 0 0 auto;
    margin: 0;
    padding: 2px 6px;
    border: 1px solid #a7f3d0;
    border-radius: 4px;
    background: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.3;
    color: #047857;
    cursor: pointer;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }
  .title-nav-cell:hover .title-copy-btn,
  .title-nav-cell:focus-within .title-copy-btn {
    opacity: 1;
    pointer-events: auto;
  }
  .title-copy-btn:hover {
    background: #ecfdf5;
    border-color: #6ee7b7;
    color: #065f46;
  }
  .title-copy-btn:focus-visible {
    opacity: 1;
    pointer-events: auto;
    outline: 2px solid #2563eb;
    outline-offset: 1px;
  }
  .data-table a { color: #2563eb; }
  .empty {
    padding: 24px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
  }
`;
