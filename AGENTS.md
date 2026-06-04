# BigSeller AI — hướng dẫn cho agent

## Chrome

Load unpacked từ **thư mục gốc** (`manifest.json`).

- Sửa logic trong `src/**/*.js` (không tạo `.ts`).
- **Không chạy npm build** — content script dùng `loader.js` + `import()`; service worker / popup / options là ES module.
- User **Reload** trên `chrome://extensions`.

## Manifest

- `manifest.json` ở gốc — `content_scripts` trỏ `src/content/*/loader.js`; module `index.js` khai báo trong `web_accessible_resources`.

## Cấu trúc

- `src/background/service-worker.js`
- `src/content/{shopee,bigseller,chatgpt,gemini}/loader.js` + `index.js`
- `src/options/`, `src/popup/`
- `public/` — icon
