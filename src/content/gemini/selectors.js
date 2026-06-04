export const GEMINI_INPUT_SELECTORS = [
    '.rich-textarea.text-input-field_textarea .ql-editor',
    'rich-textarea .ql-editor',
    '.text-input-field_textarea .ql-editor',
    'div[contenteditable="true"][role="textbox"]',
];
export const GEMINI_SEND_SELECTORS = [
    'button[aria-label="Send message"]',
    'button[aria-label="Gửi tin nhắn"]',
    'button.send-button',
    'button[data-test-id="send-button"]',
    '.input-area button[type="submit"]',
    'button[mattooltip="Send message"]',
];
/** Một selector — dùng với queryAllDeep trong dom-query */
export const GEMINI_MODEL_RESPONSE_SELECTOR = 'message-content.model-response-text, message-content, .model-response-text, [data-test-id="model-response"], [data-message-author-role="model"]';
/** Chỉ nút dừng stream — tránh nhầm nút Cancel khác trên trang */
export const GEMINI_GENERATING_SELECTORS = [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Dừng phản hồi"]',
    'button[aria-label="Dừng tạo nội dung"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="Dừng"]',
    'button[data-test-id="stop-button"]',
];
