(function () {
    const flag = '__bigsellerAiShopeeEntry';
    if (globalThis[flag])
        return;
    globalThis[flag] = true;
    void import(chrome.runtime.getURL('src/content/shopee/index.js'));
})();
