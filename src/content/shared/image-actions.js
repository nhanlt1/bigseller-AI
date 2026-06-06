import { fetchImagesAsBase64 } from '../../shared/image-fetch.js';
import { MessageType, sendMessage } from '../../shared/messaging.js';
import { buildProductImagePrompt } from '../../shared/product-image-prompt.js';
import {
    listProductImageCandidates,
} from '../../shared/product-image-url.js';
import { promptProductImagePicker } from './image-picker.js';

export async function openChatGPTProductImage(adapter, mode) {
    const product = adapter.extract();
    if (!product?.title?.trim()) {
        throw new Error('Không đọc được tên sản phẩm từ trang');
    }
    if (mode === 'title-and-description' && !product.description?.trim()) {
        throw new Error('Không đọc được mô tả — chọn「Chỉ tên sản phẩm」');
    }

    const candidates = listProductImageCandidates();
    if (!candidates.length) {
        throw new Error('Không thấy ảnh sản phẩm trên trang — thêm ảnh rồi thử lại');
    }

    const imageUrls = await promptProductImagePicker(candidates);
    if (imageUrls === null) {
        return;
    }

    const images = imageUrls.length
        ? await fetchImagesAsBase64(imageUrls)
        : [];
    if (imageUrls.length && !images.length) {
        throw new Error('Không tải được ảnh sản phẩm — reload trang Shopee/BigSeller rồi thử lại');
    }

    const prompt = buildProductImagePrompt(
        product.title,
        product.description ?? '',
        mode,
    );
    const result = await sendMessage({
        type: MessageType.OPEN_CHATGPT_IMAGE,
        payload: {
            prompt,
            images,
            imageUrls: imageUrls.length ? imageUrls : undefined,
        },
    });
    if (!result.ok) {
        throw new Error(result.error ?? 'Không mở được ChatGPT');
    }
}
