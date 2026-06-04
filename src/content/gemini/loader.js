(function () {
    const flag = '__bigsellerAiGeminiEntry';
    if (globalThis[flag])
        return;
    globalThis[flag] = true;
    void import(chrome.runtime.getURL('src/content/gemini/index.js'));
})();
