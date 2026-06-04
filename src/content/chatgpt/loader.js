(function () {
    const flag = '__bigsellerAiChatgptEntry';
    if (globalThis[flag])
        return;
    globalThis[flag] = true;
    void import(chrome.runtime.getURL('src/content/chatgpt/index.js'));
})();
