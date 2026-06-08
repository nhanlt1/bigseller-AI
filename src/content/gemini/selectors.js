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
/** Bubble model — `message-content` lọc user bubble qua dom-query.isUserMessage */
export const GEMINI_MODEL_RESPONSE_SELECTOR = 'message-content.model-response-text, message-content, .model-response-text, [data-test-id="model-response"], [data-message-author-role="model"]';
/** Bubble tin nhắn người dùng (prompt vừa gửi). */
export const GEMINI_USER_QUERY_SELECTOR = 'user-query, message-content.user-query, .user-query, [data-message-author-role="user"]';
/** Chỉ nút dừng stream — tránh nhầm nút Cancel khác trên trang */
export const GEMINI_GENERATING_SELECTORS = [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Dừng phản hồi"]',
    'button[aria-label="Dừng tạo nội dung"]',
    'button[data-test-id="stop-button"]',
];
