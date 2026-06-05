import { openChatGPTProductImage } from './image-actions.js';
import { getImageToolbarPlacement } from './product-editor-anchors.js';
import {
    mountFloatingEditorToolbar,
    refreshEditorToolbar,
    setEditorToolbarBusy,
} from './product-editor-toolbar.js';

export const IMAGE_TOOLBAR_ID = 'bigseller-ai-image-toolbar';

let imageBusy = false;

async function runImageMode(adapter, mode) {
    if (imageBusy)
        return;
    imageBusy = true;
    setEditorToolbarBusy(IMAGE_TOOLBAR_ID, true);
    try {
        await openChatGPTProductImage(adapter, mode);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Không tạo ảnh được';
        alert(msg);
    }
    finally {
        imageBusy = false;
        setEditorToolbarBusy(IMAGE_TOOLBAR_ID, false);
    }
}

/** Hai nút prompt ảnh — neo theo vùng hình ảnh (BigSeller / Shopee). */
export function mountImageFab(adapter) {
    document.getElementById('bigseller-ai-image-fab')?.remove();
    document.getElementById('bigseller-ai-image-menu-host')?.remove();
    const platform = adapter.platform ?? 'shopee';
    mountFloatingEditorToolbar({
        hostId: IMAGE_TOOLBAR_ID,
        tone: 'image',
        getPlacement: () => getImageToolbarPlacement(platform),
        buttons: [
            {
                id: 'title-only',
                label: 'Ảnh: chỉ tên',
                primary: true,
                onClick: () => runImageMode(adapter, 'title-only'),
            },
            {
                id: 'title-desc',
                label: 'Ảnh: tên + mô tả',
                primary: true,
                onClick: () => runImageMode(adapter, 'title-and-description'),
            },
        ],
    });
}

export function refreshImageToolbar() {
    refreshEditorToolbar(IMAGE_TOOLBAR_ID);
}
