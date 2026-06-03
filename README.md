# BigSeller AI

Extension Chrome/Edge (Manifest V3) giúp **copy prompt SEO** cho Google Gemini, **áp dụng JSON** vào form sản phẩm và **tính giá bán** theo công thức tùy chỉnh, hỗ trợ **Shopee Seller Center** và **BigSeller**.

## Tính năng

- **Đọc / ghi form sản phẩm** trên `banhang.shopee.*` và `www.bigseller.com` (selector lấy từ DOM thực tế + fallback).
- **Panel nổi (Shadow DOM)**: *Copy prompt* → dán Gemini thủ công → copy JSON phản hồi → *Áp dụng vào form*.
- **Mở tab Gemini** nếu chưa có (không tự điền/gửi/đọc phản hồi trên trang Google).
- **Parse JSON** `{title, description}` từ clipboard khi áp dụng.
- **Công thức giá an toàn** (không dùng `eval`), biến: `cost`, `profitRate`, `shopeeFee`, `shippingSubsidy`, `voucherRate`.
- **Trang Cài đặt**: chỉnh prompt template, ngôn ngữ, công thức và biến mặc định.

## Cài đặt (dev)

```bash
npm install
npm run build
```

Sau `npm run build`, chọn **một** trong hai thư mục khi **Tải tiện ích đã giải nén**:

- `bigseller-AI` (thư mục gốc — có `manifest.json` sau build), hoặc
- `bigseller-AI/dist`

Nếu báo *「Tệp kê khai bị thiếu」*: chưa chạy `npm run build`, hoặc chọn nhầm thư mục không có `manifest.json`. Xem thêm `CAI-DAT-EXTENSION.txt`.

1. Mở Chrome/Edge → `chrome://extensions` hoặc `edge://extensions`
2. Bật **Chế độ nhà phát triển**
3. **Load unpacked** → chọn thư mục gốc dự án hoặc `dist`

## Sử dụng

1. Mở trang **chỉnh sửa sản phẩm** trên Shopee Seller hoặc BigSeller.
2. Nhấn nút **AI** góc phải dưới → panel BigSeller AI.
3. **Copy prompt** (mở tab Gemini nếu chưa có) → dán vào Gemini → lấy phản hồi JSON.
4. Copy phản hồi từ Gemini → **Áp dụng vào form** (đọc từ clipboard).
5. Nút **$** (FAB): tính giá theo công thức trong Cài đặt.

## Cấu hình

Nhấn icon extension → **Cài đặt**, hoặc mở Options từ trang extensions.

- **Prompt template**: biến `{title}`, `{description}`, `{language}`.
- **Công thức mặc định**:
  `(cost * (1 + profitRate) + shippingSubsidy) / (1 - shopeeFee - voucherRate)`

## Cấu trúc dự án

```
src/
  background/service-worker.ts   # Mở tab Gemini khi cần
  content/shopee/                # Adapter Shopee Seller
  content/bigseller/             # Adapter BigSeller
  content/shared/                # Panel + DOM utils
  pricing/                       # Formula engine
  options/                       # Trang cài đặt
  popup/                         # Popup extension
  shared/                        # Types, messaging, storage
public/                          # Icon
```

## Lưu ý

- Cần đăng nhập Gemini; giao diện Gemini có thể thay đổi — extension dùng nhiều selector fallback.
- Extension chỉ chạy trên các domain đã khai báo trong `host_permissions`.
- Dữ liệu cài đặt lưu qua `chrome.storage.sync`.

## Phát triển

```bash
npm run dev    # Vite + CRX HMR
```

## Giấy phép

Private — dùng nội bộ.
