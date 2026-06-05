import {
    findSimilarProductCards,
    parseProductIdsFromUrl,
    readSimilarCardTitle,
    titleVisibleApprox,
} from './similar-products-scraper.js';
import { formatPositionHighlightLabel } from './similar-products-title-position.js';

const STYLE_ID = 'bigseller-ai-card-highlight-style';
const LAYER_ID = 'bigseller-ai-card-highlight-layer';

const HIGHLIGHT_CSS = `
@keyframes bigseller-halo-pulse {
  0%, 100% {
    opacity: 0.75;
    transform: scale(1);
    filter: hue-rotate(0deg) brightness(1.05);
  }
  50% {
    opacity: 1;
    transform: scale(1.02);
    filter: hue-rotate(25deg) brightness(1.2);
  }
}
@keyframes bigseller-sparkle-twinkle {
  0%, 100% { opacity: 0.4; transform: rotate(45deg) scale(0.8); }
  50% { opacity: 1; transform: rotate(45deg) scale(1.25); }
}
#${LAYER_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
  overflow: visible;
}
.bigseller-hl-box {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
}
.bigseller-hl-halo {
  border-radius: 14px;
  background: transparent;
  box-shadow:
    0 0 0 4px rgba(255, 255, 255, 0.95),
    0 0 0 7px rgba(59, 130, 246, 0.85),
    0 0 28px 10px rgba(59, 130, 246, 0.75),
    0 0 52px 18px rgba(168, 85, 247, 0.55),
    0 0 72px 28px rgba(250, 204, 21, 0.35);
  animation: bigseller-halo-pulse 1.1s ease-in-out infinite;
}
.bigseller-hl-ring-wrap {
  border-radius: 12px;
  background: transparent;
  border: 5px solid rgba(255, 255, 255, 0.98);
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.95),
    0 0 22px rgba(96, 165, 250, 0.9),
    0 0 38px rgba(232, 121, 248, 0.55),
    inset 0 0 18px rgba(255, 255, 255, 0.4);
  animation: bigseller-halo-pulse 1.1s ease-in-out infinite;
}
.bigseller-hl-sparkle {
  position: fixed;
  width: 14px;
  height: 14px;
  background: linear-gradient(135deg, #fff 0%, #bae6fd 35%, #f0abfc 70%, #fde68a 100%);
  box-shadow:
    0 0 10px rgba(255, 255, 255, 1),
    0 0 18px rgba(96, 165, 250, 0.9);
  animation: bigseller-sparkle-twinkle 1.2s ease-in-out infinite;
  pointer-events: none;
}
.bigseller-hl-label {
  position: fixed;
  pointer-events: none;
  z-index: 2;
  max-width: min(92vw, 440px);
  padding: 7px 14px;
  border-radius: 10px;
  font: 600 12px/1.4 system-ui, -apple-system, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%);
  border: 2px solid rgba(255, 255, 255, 0.92);
  box-shadow:
    0 4px 18px rgba(37, 99, 235, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.25);
  text-align: center;
  white-space: normal;
  word-break: break-word;
}
`;

let highlightCleanup = null;
let highlightRafId = 0;

function ensureHighlightStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HIGHLIGHT_CSS;
    document.head.appendChild(style);
}

function removeCardHighlight() {
    if (highlightRafId) {
        cancelAnimationFrame(highlightRafId);
        highlightRafId = 0;
    }
    document.getElementById(LAYER_ID)?.remove();
    highlightCleanup?.();
    highlightCleanup = null;
}

function normalizeTitleForMatch(title) {
    return String(title ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function titleMatchScore(query, rowTitle) {
    const a = normalizeTitleForMatch(query);
    const b = normalizeTitleForMatch(rowTitle);
    if (!a || !b)
        return 0;
    if (a === b)
        return 100;
    if (b.startsWith(a) || a.startsWith(b))
        return 85;
    if (b.includes(a) || a.includes(b))
        return 70;
    return 0;
}

function getCurrentPageNumber() {
    return (
        Number.parseInt(
            new URLSearchParams(location.search).get('page') ?? '1',
            10,
        ) || 1
    );
}

/**
 * @param {Record<string, unknown>} row
 * @returns {HTMLElement | null}
 */
export function findProductCardElementForRow(row) {
    if (!row)
        return null;
    const cards = findSimilarProductCards(document);
    const itemId = String(row.itemId ?? '').trim();
    const shopId = String(row.shopId ?? '').trim();
    const title = String(row.title ?? row.matchedTitle ?? '').trim();
    const rank = Number.parseInt(String(row.rank ?? ''), 10);
    const rowPage = Number.parseInt(String(row.page ?? ''), 10);
    const currentPage = getCurrentPageNumber();

    if (itemId) {
        for (const card of cards) {
            const link =
                card.querySelector('a.contents[href], a[href*="shopee.vn"]');
            const ids = parseProductIdsFromUrl(link?.href ?? '');
            if (ids.itemId === itemId && (!shopId || ids.shopId === shopId))
                return card;
        }
    }

    if (
        Number.isFinite(rank) &&
        rank > 0 &&
        (!Number.isFinite(rowPage) || rowPage === currentPage)
    ) {
        const byRank = cards[rank - 1];
        if (byRank)
            return byRank;
    }

    if (title) {
        let best = null;
        let bestScore = 0;
        for (const card of cards) {
            const score = titleMatchScore(title, readSimilarCardTitle(card));
            if (score > bestScore) {
                bestScore = score;
                best = card;
            }
        }
        const minScore = title.length < 10 ? 85 : 70;
        if (best && bestScore >= minScore)
            return best;
    }

    return null;
}

/**
 * Overlay cố định — chỉ đọc getBoundingClientRect(), không sửa DOM/CSS thẻ Shopee.
 * @param {DOMRect} rect
 * @param {HTMLElement} layer
 */
function layoutHighlightOverlay(rect, layer) {
    const pad = 8;
    const haloPad = 14;
    const top = rect.top - pad;
    const left = rect.left - pad;
    const width = rect.width + pad * 2;
    const height = rect.height + pad * 2;

    const halo = layer.querySelector('.bigseller-hl-halo');
    const ringWrap = layer.querySelector('.bigseller-hl-ring-wrap');
    if (halo) {
        halo.style.top = `${top - haloPad}px`;
        halo.style.left = `${left - haloPad}px`;
        halo.style.width = `${width + haloPad * 2}px`;
        halo.style.height = `${height + haloPad * 2}px`;
    }
    if (ringWrap) {
        ringWrap.style.top = `${top}px`;
        ringWrap.style.left = `${left}px`;
        ringWrap.style.width = `${width}px`;
        ringWrap.style.height = `${height}px`;
    }

    const sparkles = layer.querySelectorAll('.bigseller-hl-sparkle');
    const corners = [
        [left, top],
        [left + width, top],
        [left, top + height],
        [left + width, top + height],
    ];
    sparkles.forEach((gem, i) => {
        const [cx, cy] = corners[i] ?? corners[0];
        gem.style.left = `${cx - 7}px`;
        gem.style.top = `${cy - 7}px`;
    });

    const label = layer.querySelector('.bigseller-hl-label');
    if (label && label.textContent) {
        const labelH = label.offsetHeight || 36;
        const centerX = left + width / 2;
        const aboveTop = top - labelH - 12;
        if (aboveTop >= 8) {
            label.style.top = `${aboveTop}px`;
        }
        else {
            label.style.top = `${top + height + 12}px`;
        }
        label.style.left = `${centerX}px`;
        label.style.transform = 'translateX(-50%)';
        label.style.maxWidth = `${Math.min(Math.max(width + 48, 200), window.innerWidth - 16)}px`;
    }
}

function createHighlightLayer() {
    const layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('data-bigseller-overlay', 'card-highlight');

    const halo = document.createElement('div');
    halo.className = 'bigseller-hl-box bigseller-hl-halo';

    const ringWrap = document.createElement('div');
    ringWrap.className = 'bigseller-hl-box bigseller-hl-ring-wrap';

    const label = document.createElement('div');
    label.className = 'bigseller-hl-label';
    label.hidden = true;

    layer.append(halo, ringWrap, label);
    for (let i = 0; i < 4; i++) {
        const gem = document.createElement('span');
        gem.className = 'bigseller-hl-sparkle';
        gem.style.animationDelay = `${i * 0.2}s`;
        layer.appendChild(gem);
    }
    return layer;
}

/**
 * @param {HTMLElement} card — chỉ dùng để đo vị trí, không chỉnh style/class thẻ gốc
 * @param {{ durationMs?: number, labelText?: string }} [options]
 */
export function highlightProductCard(card, options = {}) {
    const durationMs = options.durationMs ?? 6000;
    const labelText = String(options.labelText ?? '').trim();

    removeCardHighlight();
    ensureHighlightStyles();

    const layer = createHighlightLayer();
    const label = layer.querySelector('.bigseller-hl-label');
    if (label) {
        if (labelText) {
            label.textContent = labelText;
            label.hidden = false;
        }
        else {
            label.textContent = '';
            label.hidden = true;
        }
    }
    document.body.appendChild(layer);

    const sync = () => {
        layoutHighlightOverlay(card.getBoundingClientRect(), layer);
    };

    sync();
    const onReflow = () => {
        if (highlightRafId)
            cancelAnimationFrame(highlightRafId);
        highlightRafId = requestAnimationFrame(sync);
    };
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);

    highlightCleanup = () => {
        window.removeEventListener('scroll', onReflow, true);
        window.removeEventListener('resize', onReflow);
        if (highlightRafId) {
            cancelAnimationFrame(highlightRafId);
            highlightRafId = 0;
        }
    };
    window.setTimeout(removeCardHighlight, durationMs);
}

function resolveHighlightLabel(row, positionMeta) {
    if (positionMeta?.found) {
        return formatPositionHighlightLabel({
            page: positionMeta.page,
            rank: positionMeta.rank,
            gridVisible: positionMeta.gridVisible,
        });
    }
    return formatPositionHighlightLabel({
        page: row?.page,
        rank: row?.rank,
        gridVisible:
            String(row?.titleVisibleApprox ?? '').trim() ||
            titleVisibleApprox(String(row?.title ?? row?.matchedTitle ?? '')),
    });
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ found?: boolean, page?: unknown, rank?: unknown, gridVisible?: string }} [positionMeta]
 */
export function focusProductCardForRow(row, positionMeta) {
    const rowPage = Number.parseInt(String(row?.page ?? ''), 10);
    const currentPage = getCurrentPageNumber();
    const card = findProductCardElementForRow(row);
    if (!card) {
        if (Number.isFinite(rowPage) && rowPage !== currentPage) {
            return {
                ok: false,
                message: `SP ở trang ${rowPage} — mở trang ${rowPage} trên Shopee rồi bấm lại vị trí.`,
            };
        }
        return {
            ok: false,
            message: 'Không tìm thấy thẻ SP trên trang hiện tại.',
        };
    }

    const labelText = resolveHighlightLabel(row, positionMeta);

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
        highlightProductCard(card, { labelText });
    }, 400);

    return {
        ok: true,
        message: `Đã focus SP #${row.rank ?? '?'} trên trang.`,
    };
}
