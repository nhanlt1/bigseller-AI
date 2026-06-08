const TOOLBAR_STYLE_ID = 'bigseller-ai-editor-toolbar-style';

const TOOLBAR_CSS = `
  .bigseller-ai-editor-toolbar {
    position: fixed;
    z-index: 2147483645;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 6px;
    pointer-events: auto;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .bigseller-ai-editor-toolbar .bs-ai-btn.primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
  }
  .bs-ai-btn {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #111827;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
  }
  .bs-ai-btn:hover:not(:disabled) { filter: brightness(0.97); }
  .bs-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .bs-ai-btn.primary { color: #fff; }
  .bs-ai-btn.ghost {
    background: rgba(255,255,255,.96);
  }
  .bigseller-ai-editor-toolbar[data-wrap="1"] {
    flex-wrap: wrap;
    row-gap: 4px;
  }
`;

function ensureToolbarStyles() {
    if (document.getElementById(TOOLBAR_STYLE_ID))
        return;
    const style = document.createElement('style');
    style.id = TOOLBAR_STYLE_ID;
    style.textContent = TOOLBAR_CSS;
    document.head.appendChild(style);
}

/**
 * @param {{
 *   hostId: string,
 *   tone?: 'image' | 'text',
 *   align?: 'right-top' | 'right-below' | 'between',
 *   getAnchor?: () => Element | null,
 *   getPlacement?: () => { mode: 'between', left: Element, right: Element } | { mode: 'right-of', left: Element, boundary: Element } | { mode: 'anchor', anchor: Element, align?: string } | null,
 *   buttons: { id: string, label: string, primary?: boolean, ghost?: boolean, onClick: () => void | Promise<void> }[],
 *   wrap?: boolean,
 * }} config
 */
export function mountFloatingEditorToolbar(config) {
    ensureToolbarStyles();
    let host = document.getElementById(config.hostId);
    if (!host) {
        host = document.createElement('div');
        host.id = config.hostId;
        host.className = 'bigseller-ai-editor-toolbar';
        host.dataset.tone = config.tone ?? 'text';
        if (config.wrap)
            host.dataset.wrap = '1';
        document.body.appendChild(host);
        for (const btn of config.buttons) {
            const el = document.createElement('button');
            el.type = 'button';
            el.id = `${config.hostId}-${btn.id}`;
            el.className =
                'bs-ai-btn' +
                (btn.primary ? ' primary' : '') +
                (btn.ghost ? ' ghost' : '');
            el.textContent = btn.label;
            el.addEventListener('click', () => {
                void btn.onClick();
            });
            host.appendChild(el);
        }
        const reposition = () => positionToolbar(host, config);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        host._reposition = reposition;
    }
    positionToolbar(host, config);
    requestAnimationFrame(() => positionToolbar(host, config));
    return host;
}

function positionToolbar(host, config) {
    const placement = config.getPlacement?.() ?? null;
    if (placement?.mode === 'between') {
        const { left, right } = placement;
        if (!left.isConnected || !right.isConnected) {
            host.style.display = 'none';
            return;
        }
        host.style.display = 'flex';
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const gapStart = leftRect.right;
        const gapEnd = rightRect.left;
        if (gapEnd <= gapStart + 8) {
            host.style.display = 'none';
            return;
        }
        const centerX = (gapStart + gapEnd) / 2;
        const top = Math.min(leftRect.top, rightRect.top);
        const height = Math.max(leftRect.height, rightRect.height);
        host.style.maxWidth = `${Math.max(0, gapEnd - gapStart - 8)}px`;
        host.style.top = `${top + Math.max(0, (height - host.offsetHeight) / 2)}px`;
        host.style.left = `${Math.max(8, centerX - host.offsetWidth / 2)}px`;
        host.style.right = 'auto';
        return;
    }

    if (placement?.mode === 'right-of') {
        const { left, boundary } = placement;
        if (!left.isConnected || !boundary.isConnected) {
            host.style.display = 'none';
            return;
        }
        host.style.display = 'flex';
        const leftRect = left.getBoundingClientRect();
        const boundRect = boundary.getBoundingClientRect();
        const gap = 10;
        let x = leftRect.right + gap;
        const minX = boundRect.left + 8;
        const maxX = boundRect.right - host.offsetWidth - 8;
        x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
        host.style.maxWidth = `${Math.max(160, boundRect.right - x - 8)}px`;
        host.style.top = `${leftRect.top + Math.max(0, (leftRect.height - host.offsetHeight) / 2)}px`;
        host.style.left = `${x}px`;
        host.style.right = 'auto';
        return;
    }

    const anchor =
        placement?.mode === 'anchor'
            ? placement.anchor
            : config.getAnchor?.();
    if (!anchor || !anchor.isConnected) {
        host.style.display = 'none';
        return;
    }
    host.style.display = 'flex';
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    const align =
        placement?.mode === 'anchor'
            ? (placement.align ?? config.align ?? 'right-top')
            : (config.align ?? 'right-top');
    host.style.maxWidth = `${Math.min(window.innerWidth - 16, Math.max(rect.width, 280))}px`;
    if (align === 'right-below') {
        host.style.top = `${rect.bottom + gap}px`;
        host.style.left = `${Math.max(8, rect.right - host.offsetWidth)}px`;
        host.style.right = 'auto';
    }
    else {
        host.style.top = `${rect.top + Math.max(0, (rect.height - host.offsetHeight) / 2)}px`;
        host.style.left = `${Math.max(8, rect.right - host.offsetWidth)}px`;
        host.style.right = 'auto';
    }
}

export function refreshEditorToolbar(hostId) {
    const host = document.getElementById(hostId);
    host?._reposition?.();
}

/**
 * @param {string} hostId
 * @param {boolean} busy
 * @param {{ only?: string[], except?: string[] }} [options]
 *   only — chỉ đổi trạng thái các nút có id suffix (vd. `rewrite-title`);
 *   except — bỏ qua các nút đó (ưu tiên thấp hơn `only`).
 */
export function setEditorToolbarBusy(hostId, busy, options) {
    const host = document.getElementById(hostId);
    if (!host)
        return;
    const only = options?.only;
    const except = options?.except ?? [];
    host.querySelectorAll('button').forEach((btn) => {
        const suffix = btn.id.startsWith(`${hostId}-`)
            ? btn.id.slice(hostId.length + 1)
            : btn.id;
        if (only && !only.includes(suffix))
            return;
        if (!only && except.includes(suffix))
            return;
        btn.disabled = busy;
    });
}

export function removeEditorToolbar(hostId) {
    const host = document.getElementById(hostId);
    if (!host)
        return;
    if (host._reposition) {
        window.removeEventListener('scroll', host._reposition, true);
        window.removeEventListener('resize', host._reposition);
    }
    host.remove();
}
