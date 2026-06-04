const IMAGE_PROMPT_HEADER = `Tạo ảnh quảng cáo sản phẩm Shopee gây ấn tượng với người mua (nổi bật hơn so với các sản phẩm cùng loại trong lưới hiển thị).

Yêu cầu bắt buộc:
- Tên sản phẩm phải được đặt ở trên cùng ảnh, nhưng không được che khuất sản phẩm
- Ít chữ trên ảnh
- Không tự chế logo thương hiệu hay nhãn hiệu không có trong ảnh tham khảo
- Bám sát hình ảnh sản phẩm trong ảnh đính kèm (màu sắc, hình dáng, chi tiết)
- Nền sáng, sản phẩm rõ, phù hợp thumbnail Shopee (vuông / gần vuông)

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
