import { MessageType, sendMessage } from '../shared/messaging.js';
const optionsBtn = document.getElementById('options-btn');
const pingBtn = document.getElementById('ping-btn');
const statusEl = document.getElementById('status');
const logoEl = document.getElementById('logo');
logoEl.src = chrome.runtime.getURL('public/icon48.png');
optionsBtn.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
});
pingBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Đang kiểm tra…';
    statusEl.classList.remove('error');
    try {
        const res = await sendMessage({ type: MessageType.PING });
        statusEl.textContent = res?.ok ? 'Extension hoạt động bình thường' : 'Không phản hồi';
        if (!res?.ok)
            statusEl.classList.add('error');
    }
    catch {
        statusEl.textContent = 'Lỗi kết nối service worker';
        statusEl.classList.add('error');
    }
});
