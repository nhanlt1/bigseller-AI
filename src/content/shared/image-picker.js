const HOST_ID = 'bigseller-ai-image-picker-host';

const PICKER_CSS = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  :host([data-visible="1"]) { display: block; }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.5);
  }
  .card {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 24px));
    max-height: min(80vh, 640px);
    overflow: auto;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
    padding: 18px 18px 14px;
    color: #111827;
  }
  .title {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 700;
    color: #ee4d2d;
  }
  .hint {
    margin: 0 0 14px;
    font-size: 12px;
    line-height: 1.45;
    color: #6b7280;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .item {
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    padding: 6px;
    background: #f9fafb;
    cursor: pointer;
    text-align: center;
  }
  .item:hover { border-color: #fdba74; }
  .item[aria-selected="true"] {
    border-color: #ee4d2d;
    background: #fff7ed;
    box-shadow: 0 0 0 1px #ee4d2d;
  }
  .item img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    border-radius: 6px;
    background: #fff;
  }
  .item .label {
    margin-top: 4px;
    font-size: 10px;
    color: #6b7280;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
    color: #fff;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;

/** @type {HTMLElement | null} */
let host = null;
/** @type {ShadowRoot | null} */
let shadow = null;

function ensureHost() {
    if (host && shadow)
        return;
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${PICKER_CSS}</style>
      <div class="backdrop" part="backdrop"></div>
      <div class="card" role="dialog" aria-labelledby="picker-title">
        <p class="title" id="picker-title">Chọn ảnh gửi ChatGPT</p>
        <p class="hint">Chọn ảnh sản phẩm làm tham chiếu tạo ảnh quảng cáo (1 ảnh).</p>
        <div class="grid" id="picker-grid"></div>
        <div class="actions">
          <button type="button" class="btn" id="picker-cancel">Hủy</button>
          <button type="button" class="btn primary" id="picker-ok">Tiếp tục</button>
        </div>
      </div>`;
    document.body.appendChild(host);
}

/**
 * @param {{ url: string, width?: number, height?: number, index?: number }[]} candidates
 * @returns {Promise<string|null>} URL đã chọn, null nếu hủy
 */
export function promptProductImagePicker(candidates) {
    const list = (candidates ?? []).filter((c) => c?.url?.trim());
    if (list.length === 0)
        return Promise.resolve('');

    ensureHost();
    return new Promise((resolve) => {
        let selectedUrl = list[0].url;
        const grid = shadow.getElementById('picker-grid');
        const okBtn = shadow.getElementById('picker-ok');
        const cancelBtn = shadow.getElementById('picker-cancel');
        if (!grid || !okBtn || !cancelBtn) {
            resolve(list[0].url);
            return;
        }

        grid.replaceChildren();
        for (const item of list) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'item';
            btn.setAttribute('aria-selected', item.url === selectedUrl ? 'true' : 'false');
            const img = document.createElement('img');
            img.src = item.url;
            img.alt = `Ảnh ${item.index ?? ''}`.trim();
            img.loading = 'lazy';
            const label = document.createElement('div');
            label.className = 'label';
            const dim =
                item.width && item.height
                    ? `${item.width}×${item.height}`
                    : `Ảnh ${item.index ?? ''}`;
            label.textContent = dim;
            btn.append(img, label);
            btn.addEventListener('click', () => {
                selectedUrl = item.url;
                for (const el of grid.querySelectorAll('.item')) {
                    el.setAttribute(
                        'aria-selected',
                        el === btn ? 'true' : 'false',
                    );
                }
            });
            grid.appendChild(btn);
        }

        const close = (url) => {
            host?.removeAttribute('data-visible');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            shadow.querySelector('.backdrop')?.removeEventListener('click', onCancel);
            resolve(url);
        };
        const onOk = () => close(selectedUrl);
        const onCancel = () => close(null);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        shadow.querySelector('.backdrop')?.addEventListener('click', onCancel);
        host.setAttribute('data-visible', '1');
    });
}
