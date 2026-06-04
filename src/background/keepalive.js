/** Giữ service worker thức khi chờ Gemini/ChatGPT (tránh channel message đóng sớm). */
export async function withServiceWorkerKeepalive(work) {
    const interval = setInterval(() => {
        void chrome.runtime.getPlatformInfo(() => { });
    }, 20_000);
    try {
        return await work();
    }
    finally {
        clearInterval(interval);
    }
}
