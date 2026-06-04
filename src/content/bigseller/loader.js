(function () {
    const flag = '__bigsellerAiBigsellerEntry';
    if (globalThis[flag])
        return;
    globalThis[flag] = true;
    void import(chrome.runtime.getURL('src/content/bigseller/index.js'));
})();
