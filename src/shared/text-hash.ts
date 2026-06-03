/** Bỏ dòng rác UI Gemini (không đọc lại toàn bộ lịch sử — chỉ chuẩn hóa 1 bubble) */
const UI_NOISE_LINE =
  /^(copy|copy code|copied|share|regenerate|thử lại|good response|bad response|đề xuất)$/i;

export function normalizeResponseText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !UI_NOISE_LINE.test(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mã nội dung form — đổi khi user sửa tiêu đề/mô tả (lần rewrite thứ 2+) */
export function hashProductContent(title: string, description: string): string {
  return hashText(`${title}\n---\n${description}`);
}

/** Mã băm cố định (hex) — FNV-1a 32-bit, trên text đã chuẩn hóa */
export function hashText(text: string): string {
  const normalized = normalizeResponseText(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
