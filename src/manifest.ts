import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'BigSeller AI',
  version: '1.0.33',
  description:
    'SEO Gemini, tạo ảnh ChatGPT, áp dụng JSON vào form Shopee/BigSeller và tính giá bán.',
  permissions: ['storage', 'tabs', 'scripting', 'activeTab', 'clipboardRead'],
  host_permissions: [
    'https://banhang.shopee.vn/*',
    'https://banhang.shopee.com/*',
    'https://*.shopee.vn/*',
    'https://www.bigseller.com/*',
    'https://gemini.google.com/*',
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'BigSeller AI',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://banhang.shopee.vn/*', 'https://banhang.shopee.com/*'],
      js: ['src/content/shopee/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.bigseller.com/*'],
      js: ['src/content/bigseller/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      js: ['src/content/chatgpt/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://gemini.google.com/*'],
      js: ['src/content/gemini/index.ts'],
      run_at: 'document_idle',
    },
  ],
  icons: {
    '16': 'public/icon16.png',
    '48': 'public/icon48.png',
    '128': 'public/icon128.png',
  },
});
