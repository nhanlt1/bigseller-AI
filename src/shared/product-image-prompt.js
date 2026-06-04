const IMAGE_PROMPT_HEADER = `Tạo ảnh vuông 1:1 quảng cáo sản phẩm Shopee gây ấn tượng với người mua (hình ảnh này phải nổi bật hơn so với các sản phẩm cùng loại trong lưới hiển thị).
Lưu ý:
- Bám sát hình ảnh sản phẩm trong ảnh đính kèm (màu sắc, hình dáng, chi tiết)

Thông tin sản phẩm (chỉ để hiểu ngữ cảnh, không nhồi chữ lên ảnh):
Tên sản phẩm:`;
/** Prompt gửi ChatGPT — user đính kèm ảnh sản phẩm sau đó */
export function buildProductImagePrompt(title, description, mode) {
    const titleLine = title.trim() || '(chưa có tên)';
    const fullDescription = description.trim();
    if (mode === 'title-only') {
        return `${IMAGE_PROMPT_HEADER} ${titleLine}`;
    }
    const descBlock = fullDescription ? `\nMô tả:\n${fullDescription}` : '';
    return `${IMAGE_PROMPT_HEADER} ${titleLine}${descBlock}`;
}
