import type { ExtensionSettings, PricingVariables } from './types';
import { DEFAULT_PRICING_VARIABLES } from '../pricing/default-variables';
import { DEFAULT_SHOPEE_FEE_CONFIG } from '../pricing/platform-fee-config';

export const STORAGE_KEYS = {
  settings: 'bigseller_ai_settings',
  /** Mã băm phản hồi Gemini hoàn tất gần nhất — so sánh lần rewrite tiếp theo */
  geminiLastResponseHash: 'bigseller_ai_gemini_last_response_hash',
} as const;

/**
 * Mã băm Gemini — dùng storage.local (content script không được dùng storage.session).
 */
export async function getGeminiLastResponseHash(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(
      STORAGE_KEYS.geminiLastResponseHash,
    );
    const v = result[STORAGE_KEYS.geminiLastResponseHash];
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setGeminiLastResponseHash(hash: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.geminiLastResponseHash]: hash,
    });
  } catch {
    /* content script / SW — bỏ qua nếu storage tạm không khả dụng */
  }
}

/** Luôn ghép vào cuối prompt gửi Gemini — bắt buộc đầu ra JSON để extension trích xuất */
export const REWRITE_JSON_OUTPUT_RULES = `---
ĐẦU RA BẮT BUỘC (chỉ JSON, không markdown, không giải thích trước/sau):
- Trả về đúng một object JSON hợp lệ UTF-8.
- Không dùng \`\`\`json hay văn bản ngoài JSON.
- Schema:
  {"title": string, "description": string}
- title: tối đa 120 ký tự (tiêu đề Shopee).
- description: tối đa 3000 ký tự, xuống dòng trong chuỗi dùng \\n.
- Ví dụ đúng: {"title":"Áo thun nam form rộng","description":"Chất cotton...\\nSize S-XL"}`;

export const DEFAULT_PROMPT_TEMPLATE = `Bạn là chuyên gia SEO Shopee Việt Nam. Viết lại tiêu đề và mô tả bằng tiếng {language} từ nội dung gốc bên dưới. Chỉ dùng thông tin có trong bản gốc hoặc suy ra hợp lý từ ngành hàng; không bịa thương hiệu, thông số, cam kết.

=== BƯỚC 1 — TÌM TỪ KHÓA VÀNG (làm trước khi viết tiêu đề/mô tả) ===
1) Xác định người mua chính và NỖI ĐAU / lo lắng / mong muốn khi mua loại sản phẩm này (đọc kỹ tiêu đề + mô tả gốc).
   Ví dụ nỗi đau: con viết xấu, sai thế ngón tay, hay đau tay, hao pin, da dầu mụn, quần áo bị lem màu…
2) Chuyển mỗi nỗi đau thành 1–3 CỤM TỪ KHÓA mà nhiều khách sẽ gõ trên Shopee (tiếng Việt có dấu, 2–5 từ/cụm).
   Ví dụ: nỗi đau "con tập viết sai ngón" → từ khóa vàng: "tập viết", "định vị ngón tay".
3) Chọn 2–4 từ khóa vàng mạnh nhất; PHẢI đưa vào tiêu đề (ưu tiên ~40 ký tự đầu) và mở đầu mô tả. Không thay bằng từ chung chung (chất lượng, cao cấp, giá rẻ).
4) Chỉ dùng từ khóa vàng đúng với sản phẩm — không bịa nỗi đau không có trong bản gốc/ngành hàng.

=== TIÊU ĐỀ SHOPEE (tối đa 120 ký tự) ===
Công thức: [Loại SP ngắn] + [Từ khóa vàng từ bước 1] + [Đặc tính kỹ thuật] + [Thương hiệu/Model]
- Ví dụ: Bút Chì 2B Tập Viết Định Vị Ngón Tay DELI E206.
- Từ khóa mua hàng quan trọng nhất đặt trong ~30 ký tự đầu.
- Dài khuyến nghị 80–120 ký tự, tiếng Việt có dấu, viết hoa chữ cái đầu (không IN HOA cả dòng).
- Khớp ảnh sản phẩm; ghi rõ Combo/Bộ nếu là set.
- Cấm: emoji, #@$%…, Freeship/Giảm giá/Bán chạy/Hot/Top/Rẻ nhất, nhồi từ khóa lạ.

=== MÔ TẢ SHOPEE (tối đa 3000 ký tự, text thuần) ===
Cấu trúc 4 phần, xuống dòng rõ (dùng \\n trong JSON):
1) Mở đầu ngắn: nêu nỗi đau khách hàng + cách sản phẩm giải quyết; lồng từ khóa vàng (bước 1).
2) Thông số: chất liệu, kích thước, xuất xứ, màu/size, hạn dùng… (bullet "- ").
3) Hướng dẫn dùng + bảo quản.
4) Cam kết/bảo hành/đổi trả (chỉ nếu bản gốc có).
- Mỗi tính năng kèm lợi ích; từ khóa chính lặp 2–3 lần tự nhiên.
- Đoạn ngắn, dễ quét trên điện thoại; ~300–800 từ nếu đủ dữ liệu.
- Cuối mô tả: 3–5 hashtag liên quan, ví dụ #tukhoa1 #tukhoa2

Tiêu đề gốc:
{title}

Mô tả gốc:
{description}`;

export const DEFAULT_PRICING_FORMULA =
  '(cost * (1 + profitRate) + shippingSubsidy) / (1 - shopeeFee - voucherRate)';

export const DEFAULT_PRICING_CALCULATOR = {
  costPerUnit: 6300,
  desiredProfitPerUnit: 10000,
  retailUnitPrice: 0,
  wholesaleTiers: [
    { qtyMin: 2, qtyMax: 5, unitPrice: 0 },
    { qtyMin: 6, qtyMax: 10, unitPrice: 0 },
    { qtyMin: 11, qtyMax: 19, unitPrice: 0 },
    { qtyMin: 20, qtyMax: 49, unitPrice: 0 },
    { qtyMin: 50, qtyMax: 99, unitPrice: 0 },
  ],
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  language: 'Việt',
  pricingFormula: DEFAULT_PRICING_FORMULA,
  pricingVariables: { ...DEFAULT_PRICING_VARIABLES },
  pricingCalculator: {
    ...DEFAULT_PRICING_CALCULATOR,
    wholesaleTiers: DEFAULT_PRICING_CALCULATOR.wholesaleTiers.map((t) => ({ ...t })),
  },
  platformFeeConfig: { ...DEFAULT_SHOPEE_FEE_CONFIG },
};

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  const stored = result[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    pricingVariables: {
      ...DEFAULT_PRICING_VARIABLES,
      ...stored?.pricingVariables,
    },
    pricingCalculator: {
      ...DEFAULT_SETTINGS.pricingCalculator,
      ...stored?.pricingCalculator,
      wholesaleTiers:
        stored?.pricingCalculator?.wholesaleTiers?.length === 5
          ? stored.pricingCalculator.wholesaleTiers
          : DEFAULT_SETTINGS.pricingCalculator.wholesaleTiers,
    },
    platformFeeConfig: {
      ...DEFAULT_SHOPEE_FEE_CONFIG,
      ...stored?.platformFeeConfig,
    },
  };
}

export async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({
    [STORAGE_KEYS.settings]: { ...current, ...partial },
  });
}

export function fillPromptTemplate(
  template: string,
  vars: { title: string; description: string; language: string },
): string {
  const body = template
    .replace(/\{title\}/g, vars.title)
    .replace(/\{description\}/g, vars.description)
    .replace(/\{language\}/g, vars.language)
    .trim();

  if (body.includes('ĐẦU RA BẮT BUỘC')) {
    return body;
  }
  return `${body}\n\n${REWRITE_JSON_OUTPUT_RULES}`;
}

function stripMarkdownJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Tìm object JSON đầu tiên parse được trong phản hồi Gemini */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = stripMarkdownJsonFence(text.trim());
  if (!trimmed) return null;

  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* next candidate */
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  const slice = trimmed.slice(start);
  for (let end = slice.length - 1; end >= 0; end--) {
    if (slice[end] !== '}') continue;
    const parsed = tryParse(slice.slice(0, end + 1));
    if (parsed) return parsed;
  }

  const loose = text.match(
    /\{[\s\S]*?"(?:title|tieu_de)"[\s\S]*?"(?:description|mo_ta|desc)"[\s\S]*?\}/i,
  );
  if (loose) {
    const parsed = tryParse(loose[0]);
    if (parsed) return parsed;
  }
  return null;
}

export function parseGeminiProductJson(text: string): {
  title: string;
  description: string;
} | null {
  const parsed = extractJsonObject(text);
  if (!parsed) return null;

  const title = String(parsed.title ?? parsed.tieu_de ?? '').trim();
  const description = String(
    parsed.description ?? parsed.mo_ta ?? parsed.desc ?? '',
  ).trim();
  if (!title && !description) return null;
  return { title, description };
}

export function mergePricingVariables(
  base: PricingVariables,
  overrides?: Partial<PricingVariables>,
): PricingVariables {
  const merged: PricingVariables = { ...base };
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined) merged[key] = val;
    }
  }
  return merged;
}
