export const MessageType = {
  OPEN_GEMINI_TAB: 'OPEN_GEMINI_TAB',
  REWRITE_PRODUCT: 'REWRITE_PRODUCT',
  GEMINI_SEND_PROMPT: 'GEMINI_SEND_PROMPT',
  GEMINI_CANCEL: 'GEMINI_CANCEL',
  OPEN_CHATGPT_IMAGE: 'OPEN_CHATGPT_IMAGE',
  CHATGPT_FILL_IMAGE_PROMPT: 'CHATGPT_FILL_IMAGE_PROMPT',
  CHATGPT_PING: 'CHATGPT_PING',
  APPLY_PRODUCT: 'APPLY_PRODUCT',
  GET_SETTINGS: 'GET_SETTINGS',
  PING: 'PING',
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export interface ExtensionMessage<T = unknown> {
  type: MessageTypeName;
  payload?: T;
}

export function sendMessage<TResponse = unknown>(
  message: ExtensionMessage,
): Promise<TResponse> {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
}

export function sendTabMessage<TResponse = unknown>(
  tabId: number,
  message: ExtensionMessage,
): Promise<TResponse> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<TResponse>;
}
