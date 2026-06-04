# BigSeller AI

Extension **Chrome** (Manifest V3): SEO Gemini, ảnh ChatGPT, JSON vào form Shopee/BigSeller, tính giá bán.

**JavaScript thuần** — không cần npm, không build.

## Cài extension

1. Chrome → `chrome://extensions` → **Chế độ nhà phát triển**
2. **Load unpacked** → chọn thư mục **`bigseller-AI`** (thư mục có `manifest.json`)

## Sửa code

- Sửa file trong `src/` (`.js`) → **Reload** trên `chrome://extensions`

Chi tiết: `CAI-DAT-EXTENSION.txt`.

## Sử dụng

1. Trang chỉnh sửa sản phẩm Shopee Seller hoặc BigSeller.
2. Nút **AI** → panel → Gemini / áp dụng JSON.
3. Nút **$** → tính giá (Cài đặt).

## Cấu trúc

```
manifest.json
src/           ← JavaScript (ES modules)
public/        ← icon
```

## Icon (tùy chọn)

`npm run icons` — chỉ khi cần tạo lại PNG từ SVG.

## Giấy phép

Private — dùng nội bộ.
