import { MessageType, sendMessage } from '../../shared/messaging.js';
import { buildProductImagePrompt, } from '../../shared/product-image-prompt.js';
export async function openChatGPTProductImage(adapter, mode) {
    const product = adapter.extract();
    if (!product?.title?.trim()) {
        throw new Error('Không đọc được tên sản phẩm từ trang');
    }
    if (mode === 'title-and-description' && !product.description?.trim()) {
        throw new Error('Không đọc được mô tả — chọn「Chỉ tên sản phẩm」');
    }
    const prompt = buildProductImagePrompt(product.title, product.description ?? '', mode);
    const result = await sendMessage({
        type: MessageType.OPEN_CHATGPT_IMAGE,
        payload: { prompt },
    });
    if (!result.ok) {
        throw new Error(result.error ?? 'Không mở được ChatGPT');
    }
}
