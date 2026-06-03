import { MessageType } from '../../shared/messaging';
import type { ProductAdapter, ProductData } from '../../shared/types';

export function listenForProductApply(adapter: ProductAdapter): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MessageType.PING) {
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type !== MessageType.APPLY_PRODUCT) return false;
    const data = message.payload as ProductData;
    const ok = adapter.apply(data);
    sendResponse({ ok });
    return true;
  });
}
