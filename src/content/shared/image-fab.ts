import type { ProductAdapter } from '../../shared/types';
import type { ProductImagePromptMode } from '../../shared/product-image-prompt';
import { openChatGPTProductImage } from './image-actions';
import {
  FAB_GAP_PX,
  FAB_IMAGE_RIGHT_PX,
  FAB_ROW_BOTTOM_PX,
  FAB_SIZE_PX,
} from './panel';

const FAB_ID = 'bigseller-ai-image-fab';
const MENU_HOST_ID = 'bigseller-ai-image-menu-host';

let menuOpen = false;
let busy = false;

export function mountImageFab(adapter: ProductAdapter): void {
  if (document.getElementById(FAB_ID)) return;

  const host = document.createElement('div');
  host.id = MENU_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);

  const btn = document.createElement('button');
  btn.id = FAB_ID;
  btn.type = 'button';
  btn.title = 'Tạo ảnh sản phẩm';
  btn.setAttribute('aria-label', 'Tạo ảnh sản phẩm');
  btn.textContent = '🖼';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: `${FAB_ROW_BOTTOM_PX}px`,
    right: `${FAB_IMAGE_RIGHT_PX}px`,
    zIndex: '2147483645',
    width: `${FAB_SIZE_PX}px`,
    height: `${FAB_SIZE_PX}px`,
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, #10a37f, #1a7f64)',
    color: '#fff',
    fontWeight: '700',
    fontSize: '20px',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(16,163,127,.45)',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const renderMenu = (visible: boolean) => {
    menuOpen = visible;
    shadow.innerHTML = visible
      ? `
      <style>
        .menu {
          position: fixed;
          bottom: ${FAB_ROW_BOTTOM_PX + FAB_SIZE_PX + FAB_GAP_PX}px;
          right: ${FAB_IMAGE_RIGHT_PX}px;
          z-index: 2147483647;
          min-width: 200px;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 8px 28px rgba(0,0,0,.18);
          border: 1px solid #e5e7eb;
          padding: 6px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          font-size: 13px;
        }
        .menu-title {
          margin: 4px 10px 6px;
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
        }
        button.option {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          border: none;
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: #111827;
        }
        button.option:hover { background: #f0fdf4; }
        button.option:disabled { opacity: .5; cursor: not-allowed; }
      </style>
      <div class="menu" role="menu">
        <p class="menu-title">Nguồn prompt</p>
        <button type="button" class="option" data-mode="title-only">Chỉ tên sản phẩm</button>
        <button type="button" class="option" data-mode="title-and-description">Tên + mô tả</button>
      </div>
    `
      : '';

    if (!visible) return;

    shadow.querySelector('.menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    shadow.querySelectorAll<HTMLButtonElement>('button.option').forEach((el) => {
      el.disabled = busy;
      el.addEventListener('click', () => {
        const mode = el.dataset.mode as ProductImagePromptMode;
        void pickMode(adapter, mode, renderMenu);
      });
    });
  };

  let closeOnOutside: (() => void) | null = null;

  const closeMenu = () => {
    renderMenu(false);
    if (closeOnOutside) {
      document.removeEventListener('click', closeOnOutside);
      closeOnOutside = null;
    }
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (busy) return;
    if (menuOpen) {
      closeMenu();
      return;
    }
    renderMenu(true);
    closeOnOutside = () => closeMenu();
    setTimeout(() => {
      if (closeOnOutside) document.addEventListener('click', closeOnOutside);
    }, 0);
  });

  document.body.appendChild(btn);
}

async function pickMode(
  adapter: ProductAdapter,
  mode: ProductImagePromptMode,
  renderMenu: (visible: boolean) => void,
): Promise<void> {
  renderMenu(false);
  busy = true;
  const fab = document.getElementById(FAB_ID) as HTMLButtonElement | null;
  if (fab) fab.style.opacity = '0.6';

  try {
    await openChatGPTProductImage(adapter, mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Không tạo ảnh được';
    alert(msg);
  } finally {
    busy = false;
    if (fab) fab.style.opacity = '1';
  }
}
