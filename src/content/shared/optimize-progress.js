import { MessageType, safeSendResponse } from '../../shared/messaging.js';

const HOST_ID = 'bigseller-ai-optimize-progress-host';

const OVERLAY_CSS = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  :host([data-visible="1"]) {
    display: block;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.42);
  }
  .card {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    padding: 20px 20px 16px;
    color: #111827;
  }
  .title {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 700;
    color: #ee4d2d;
  }
  .step {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.5;
    color: #374151;
    min-height: 2.8em;
  }
  .captcha-hint {
    display: none;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    font-size: 12px;
    line-height: 1.45;
    color: #9a3412;
  }
  :host([data-captcha="1"]) .captcha-hint {
    display: block;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #111827;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    line-height: 1.2;
  }
  .btn:hover:not(:disabled) {
    filter: brightness(0.97);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
    color: #fff;
  }
  .btn.resume {
    display: none;
  }
  :host([data-captcha="1"]) .btn.resume {
    display: inline-block;
  }
`;

/** @type {HTMLElement | null} */
let host = null;
/** @type {ShadowRoot | null} */
let shadow = null;
/** @type {{ onCancel?: () => void, onResume?: () => void, onDone?: () => void, onError?: (message: string) => void }} */
let callbacks = {};
/** @type {((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean) | null} */
let messageListener = null;

function ensureHost() {
    if (host && shadow)
        return;
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div class="backdrop" part="backdrop"></div>
      <div class="card" role="dialog" aria-labelledby="optimize-title" aria-live="polite">
        <p class="title" id="optimize-title">Tự động tối ưu SEO</p>
        <p class="step" id="optimize-step">Đang khởi động…</p>
        <p class="captcha-hint" id="optimize-captcha-hint">
          Shopee yêu cầu xác minh — giải CAPTCHA trên tab tìm kiếm, rồi bấm <strong>Tiếp tục</strong>.
        </p>
        <div class="actions">
          <button type="button" class="btn" id="optimize-cancel">Hủy</button>
          <button type="button" class="btn primary resume" id="optimize-resume">Tiếp tục</button>
        </div>
      </div>`;
    shadow.getElementById('optimize-cancel')?.addEventListener('click', () => {
        callbacks.onCancel?.();
    });
    shadow.getElementById('optimize-resume')?.addEventListener('click', () => {
        callbacks.onResume?.();
    });
    document.body.appendChild(host);
}

function renderState(text, options = {}) {
    ensureHost();
    const stepEl = shadow.getElementById('optimize-step');
    if (stepEl)
        stepEl.textContent = text || 'Đang xử lý…';
    const waitingCaptcha = Boolean(options.waitingCaptcha);
    host.dataset.captcha = waitingCaptcha ? '1' : '0';
}

/**
 * @param {string} text
 * @param {{ waitingCaptcha?: boolean }} [options]
 */
export function showOptimizeProgress(text, options) {
    ensureHost();
    renderState(text, options);
    host.dataset.visible = '1';
}

/**
 * @param {string} text
 * @param {{ waitingCaptcha?: boolean }} [options]
 */
export function updateOptimizeProgress(text, options) {
    if (!host)
        return;
    renderState(text, options);
}

export function hideOptimizeProgress() {
    if (!host)
        return;
    host.dataset.visible = '0';
    host.dataset.captcha = '0';
}

export function isOptimizeProgressVisible() {
    return host?.dataset.visible === '1';
}

/**
 * @param {{ onCancel?: () => void, onResume?: () => void }} next
 */
export function setOptimizeProgressCallbacks(next) {
    callbacks = { ...next };
}

export function clearOptimizeProgressCallbacks() {
    callbacks = {};
}

function handleProgressMessage(payload) {
    if (payload?.hidden || payload?.done) {
        hideOptimizeProgress();
        callbacks.onDone?.();
        clearOptimizeProgressCallbacks();
        return;
    }
    if (payload?.error) {
        const message = String(payload.error);
        updateOptimizeProgress(message, { waitingCaptcha: false });
        callbacks.onError?.(message);
        window.setTimeout(() => {
            hideOptimizeProgress();
            clearOptimizeProgressCallbacks();
        }, 2800);
        return;
    }
    const text = payload?.text ?? payload?.step ?? 'Đang xử lý…';
    const waitingCaptcha =
        Boolean(payload?.waitingCaptcha) ||
        payload?.status === 'waiting_captcha';
    if (host?.dataset.visible === '1') {
        updateOptimizeProgress(text, { waitingCaptcha });
    }
    else {
        showOptimizeProgress(text, { waitingCaptcha });
    }
}

export function mountOptimizeProgressListener() {
    if (messageListener)
        return;
    messageListener = (message, _sender, sendResponse) => {
        if (message?.type !== MessageType.OPTIMIZE_PROGRESS)
            return false;
        handleProgressMessage(message.payload ?? {});
        safeSendResponse(sendResponse, { ok: true });
        return false;
    };
    chrome.runtime.onMessage.addListener(messageListener);
}

export function unmountOptimizeProgressListener() {
    if (!messageListener)
        return;
    chrome.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
}
