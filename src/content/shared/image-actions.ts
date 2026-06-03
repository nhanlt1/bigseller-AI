import { MessageType, sendMessage } from '../../shared/messaging';
import {
  buildProductImagePrompt,
  type ProductImagePromptMode,
} from '../../shared/product-image-prompt';
import type { OpenChatGPTImageResult, ProductAdapter } from '../../shared/types';

export async function openChatGPTProductImage(
  adapter: ProductAdapter,
  mode: ProductImagePromptMode,
): Promise<void> {
  const product = adapter.extract();
  if (!product?.title?.trim()) {
    throw new Error('Không đọc được tên sản phẩm từ trang');
  }
  if (mode === 'title-and-description' && !product.description?.trim()) {
    throw new Error('Không đọc được mô tả — chọn「Chỉ tên sản phẩm」');
  }

  const prompt = buildProductImagePrompt(
    product.title,
    product.description ?? '',
    mode,
  );

  const result = await sendMessage<OpenChatGPTImageResult>({
    type: MessageType.OPEN_CHATGPT_IMAGE,
    payload: { prompt },
  });

  if (!result.ok) {
    throw new Error(result.error ?? 'Không mở được ChatGPT');
  }
}
