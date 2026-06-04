import { DEFAULT_PRICING_VARIABLES } from '../pricing/default-variables.js';
import { DEFAULT_SHOPEE_FEE_CONFIG } from '../pricing/platform-fee-config.js';
import {
    isExtensionContextAlive,
    isExtensionContextInvalidated,
    notifyExtensionReloadNeeded,
} from './extension-context.js';
export const STORAGE_KEYS = {
    settings: 'bigseller_ai_settings',
    /** Mã băm phản hồi Gemini hoàn tất gần nhất — so sánh lần rewrite tiếp theo */
    geminiLastResponseHash: 'bigseller_ai_gemini_last_response_hash',
};
/**
 * Mã băm Gemini — dùng storage.local (content script không được dùng storage.session).
 */
export async function getGeminiLastResponseHash() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.geminiLastResponseHash);
        const v = result[STORAGE_KEYS.geminiLastResponseHash];
        return typeof v === 'string' && v.length > 0 ? v : null;
    }
    catch {
        return null;
    }
}
export async function setGeminiLastResponseHash(hash) {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEYS.geminiLastResponseHash]: hash,
        });
    }
    catch {
        /* content script / SW — bỏ qua nếu storage tạm không khả dụng */
    }
}
/** Luôn ghép vào cuối prompt gửi Gemini — bắt buộc đầu ra JSON để extension trích xuất */
export const REWRITE_JSON_OUTPUT_RULES = `---
ĐẦU RA BẮT BUỘC (chỉ JSON, không markdown, không giải thích trước/sau):
- Trả về đúng một object JSON hợp lệ UTF-8.
- Không dùng \`\`\`json hay văn bản ngoài JSON.
- Bước 1 (tìm từ khóa vàng, nỗi đau, danh sách cụm từ): chỉ làm nội bộ trước khi viết — KHÔNG ghi các bước đó, bảng phân tích, hay danh sách từ khóa vàng vào JSON hay trước/sau JSON.
- Schema:
  {"title": string, "description": string}
- title: tối đa 120 ký tự (tiêu đề Shopee).
- description: tối đa 3000 ký tự, xuống dòng trong chuỗi dùng \\n.
- Không dùng dấu nháy kép \`"\` bên trong title/description (dùng nháy đơn hoặc viết không dấu); mọi \`"\` trong chuỗi phải escape thành \`\\"\`.
- Ví dụ đúng: {"title":"Áo thun nam form rộng","description":"Chất cotton...\\nSize S-XL"}`;
/** Luôn ghép vào prompt (kể cả template cũ trong storage chưa có {shopName}) */
export const SHOP_NAME_PROMPT_BLOCK = `=== GIAN HÀNG (bắt buộc trong mô tả) ===
Tên gian hàng duy nhất được phép nhắc trong mô tả mới: {shopName}
- PHẢI viết lại tiêu đề và mô tả (không copy nguyên văn bản gốc).
- PHẢI nhắc đúng tên gian hàng trên ít nhất một lần (mở đầu hoặc phần 🛡️ Cam kết), viết tự nhiên.
- Cấm mọi tên shop/gian hàng khác (vd HAN.X, HAN.X - SHOP BÁCH HOÁ, tên shop cũ trong cam kết). Phần cam kết PHẢI viết lại chỉ nhắc {shopName}.
- Mô tả gốc đã gỡ tên shop lạ; không thêm tên cửa hàng nào khác ngoài {shopName}.
- Nếu không có tên gian hàng: không chèn tên shop vào mô tả.`;

export const DEFAULT_PROMPT_TEMPLATE = `Bạn là chuyên gia SEO Shopee Việt Nam. Viết lại tiêu đề và mô tả bằng tiếng {language} từ nội dung gốc bên dưới. Chỉ dùng thông tin có trong bản gốc hoặc suy ra hợp lý từ ngành hàng; không bịa thương hiệu, thông số, cam kết.

${SHOP_NAME_PROMPT_BLOCK}

=== BƯỚC 1 — TÌM TỪ KHÓA VÀNG (làm trước khi viết tiêu đề/mô tả; không xuất ra JSON) ===
Làm bước này trong suy nghĩ — chỉ đưa kết quả (từ khóa đã chọn) vào title/description; không liệt kê nỗi đau, bước 1–4, hay bảng từ khóa vàng trong đầu ra.
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
1) Mở đầu ngắn: nêu nỗi đau khách hàng + cách sản phẩm giải quyết; lồng từ khóa vàng (bước 1); nhắc tên gian hàng {shopName} nếu có.
2) Thông số: chất liệu, kích thước, xuất xứ, màu/size, hạn dùng… (bullet "- ").
3) Hướng dẫn dùng + bảo quản.
4) Cam kết/bảo hành/đổi trả (chỉ nếu bản gốc có): viết lại, chỉ nhắc {shopName}, không giữ tên shop cũ.
- Emoji (chỉ trong mô tả, không dùng trong tiêu đề): thêm emoji phù hợp ngành hàng để dễ đọc trên điện thoại.
  • Đặt 1 emoji đầu mỗi phần / tiêu đề nhóm (vd ✨ mở đầu, 📋 thông số, 📖 hướng dẫn, 🛡️ cam kết).
  • Mỗi bullet quan trọng có thể thêm 1 emoji đầu dòng (✅ lợi ích, 📦 quy cách, 🎨 màu/size, ⚠️ lưu ý, 💡 mẹo dùng).
  • Chọn emoji đơn giản, phổ biến (✨ ✅ 📦 🎯 💡 ⚠️ 🛡️ 🎁 📏 🧼 🔋 …); tối đa ~1 emoji mỗi dòng, không spam, không thay nội dung bằng emoji.
- Mỗi tính năng kèm lợi ích; từ khóa chính lặp 2–3 lần tự nhiên.
- Đoạn ngắn, dễ quét trên điện thoại; ~300–800 từ nếu đủ dữ liệu.
- Cuối mô tả: 3–5 hashtag liên quan, ví dụ #tukhoa1 #tukhoa2

Tiêu đề gốc:
{title}

Mô tả gốc:
{description}`;
export const DEFAULT_PRICING_FORMULA = '(cost * (1 + profitRate) + shippingSubsidy) / (1 - shopeeFee - voucherRate)';
export const DEFAULT_PRICING_CALCULATOR = {
    costPerUnit: 6300,
    desiredProfitPerUnit: 10000,
    /** true = dùng lợi nhuận/sp; false = dùng giá muốn nhận về/sp */
    useProfitTarget: true,
    /** Thu nhập sau phí sàn muốn nhận/sp (khi không nhập lợi nhuận) */
    desiredNetReceivePerUnit: 0,
    retailUnitPrice: 0,
    /** Số lượng SP/đơn — tab tính giá thực nhận */
    receiveQuantity: 1,
    wholesaleTiers: [
        { qtyMin: 2, qtyMax: 5, unitPrice: 0 },
        { qtyMin: 6, qtyMax: 10, unitPrice: 0 },
        { qtyMin: 11, qtyMax: 19, unitPrice: 0 },
        { qtyMin: 20, qtyMax: 49, unitPrice: 0 },
        { qtyMin: 50, qtyMax: 99, unitPrice: 0 },
    ],
};
export const DEFAULT_SETTINGS = {
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
function mergeStoredSettings(stored) {
    const storedTemplate = stored?.promptTemplate?.trim() ?? '';
    const promptTemplate =
        storedTemplate && storedTemplate.includes('{shopName}')
            ? storedTemplate
            : DEFAULT_PROMPT_TEMPLATE;
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        promptTemplate,
        pricingVariables: {
            ...DEFAULT_PRICING_VARIABLES,
            ...stored?.pricingVariables,
        },
        pricingCalculator: {
            ...DEFAULT_SETTINGS.pricingCalculator,
            ...stored?.pricingCalculator,
            useProfitTarget: stored?.pricingCalculator?.useProfitTarget ??
                (stored?.pricingCalculator?.desiredProfitPerUnit ?? DEFAULT_PRICING_CALCULATOR.desiredProfitPerUnit) > 0,
            wholesaleTiers: stored?.pricingCalculator?.wholesaleTiers?.length === 5
                ? stored.pricingCalculator.wholesaleTiers
                : DEFAULT_SETTINGS.pricingCalculator.wholesaleTiers,
        },
        platformFeeConfig: {
            ...DEFAULT_SHOPEE_FEE_CONFIG,
            ...stored?.platformFeeConfig,
        },
    };
}

export async function getSettings() {
    if (!isExtensionContextAlive()) {
        notifyExtensionReloadNeeded();
        return mergeStoredSettings(undefined);
    }
    try {
        const result = await chrome.storage.sync.get(STORAGE_KEYS.settings);
        return mergeStoredSettings(result[STORAGE_KEYS.settings]);
    }
    catch (err) {
        if (isExtensionContextInvalidated(err)) {
            notifyExtensionReloadNeeded();
            return mergeStoredSettings(undefined);
        }
        throw err;
    }
}
export async function saveSettings(partial) {
    if (!isExtensionContextAlive()) {
        notifyExtensionReloadNeeded();
        return;
    }
    try {
        const current = await getSettings();
        await chrome.storage.sync.set({
            [STORAGE_KEYS.settings]: { ...current, ...partial },
        });
    }
    catch (err) {
        if (isExtensionContextInvalidated(err)) {
            notifyExtensionReloadNeeded();
            return;
        }
        throw err;
    }
}
function ensureShopBlockInTemplate(template) {
    if (template.includes('{shopName}'))
        return template;
    return `${SHOP_NAME_PROMPT_BLOCK}\n\n${template.trim()}`;
}

export function fillPromptTemplate(template, vars) {
    const shopName = vars.shopName?.trim() ?? '';
    const shopLabel =
        shopName ||
        '(chưa đọc được tên gian — không chèn tên shop vào mô tả)';
    const withShop = ensureShopBlockInTemplate(template);
    const body = withShop
        .replace(/\{title\}/g, vars.title ?? '')
        .replace(/\{description\}/g, vars.description ?? '')
        .replace(/\{language\}/g, vars.language ?? 'Việt')
        .replace(/\{shopName\}/g, shopLabel)
        .trim();
    if (body.includes('ĐẦU RA BẮT BUỘC')) {
        return body;
    }
    return `${body}\n\n${REWRITE_JSON_OUTPUT_RULES}`;
}
function stripMarkdownJsonFence(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (fenced ? fenced[1] : text).trim();
}
function unescapeJsonString(s) {
    return s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}
/**
 * Gemini đôi khi trả JSON với dấu " chưa escape trong description (vd "Dust-Free").
 * Trích title/description theo ranh giới key thay vì JSON.parse.
 */
function extractLooseGeminiFields(text) {
    const trimmed = stripMarkdownJsonFence(text.trim());
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    const block = trimmed.slice(start, end + 1);
    const titleKey = block.match(/"(?:title|tieu_de)"\s*:\s*"/i);
    if (!titleKey)
        return null;
    const afterTitle = block.slice(titleKey.index + titleKey[0].length);
    const titleBoundary = afterTitle.match(/^([\s\S]*?)"\s*,\s*"(?:description|mo_ta|desc)"\s*:/i);
    if (!titleBoundary)
        return null;
    const title = unescapeJsonString(titleBoundary[1]).trim();
    const descKey = block.match(/"(?:description|mo_ta|desc)"\s*:\s*"/i);
    if (!descKey)
        return null;
    const descStart = descKey.index + descKey[0].length;
    const descChunk = block.slice(descStart, block.length - 1);
    const lastQuote = descChunk.lastIndexOf('"');
    if (lastQuote < 0)
        return null;
    const description = unescapeJsonString(descChunk.slice(0, lastQuote)).trim();
    if (!title && !description)
        return null;
    return { title, description };
}
/** Tìm object JSON đầu tiên parse được trong phản hồi Gemini */
function extractJsonObject(text) {
    const trimmed = stripMarkdownJsonFence(text.trim());
    if (!trimmed)
        return null;
    const tryParse = (candidate) => {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            /* next candidate */
        }
        return null;
    };
    const direct = tryParse(trimmed);
    if (direct)
        return direct;
    const start = trimmed.indexOf('{');
    if (start < 0)
        return null;
    const slice = trimmed.slice(start);
    for (let end = slice.length - 1; end >= 0; end--) {
        if (slice[end] !== '}')
            continue;
        const parsed = tryParse(slice.slice(0, end + 1));
        if (parsed)
            return parsed;
    }
    const loose = text.match(/\{[\s\S]*?"(?:title|tieu_de)"[\s\S]*?"(?:description|mo_ta|desc)"[\s\S]*?\}/i);
    if (loose) {
        const parsed = tryParse(loose[0]);
        if (parsed)
            return parsed;
    }
    return extractLooseGeminiFields(trimmed);
}
export function parseGeminiProductJson(text) {
    const parsed = extractJsonObject(text);
    if (!parsed)
        return null;
    const title = String(parsed.title ?? parsed.tieu_de ?? '').trim();
    const description = String(parsed.description ?? parsed.mo_ta ?? parsed.desc ?? '').trim();
    if (!title && !description)
        return null;
    return { title, description };
}
export function mergePricingVariables(base, overrides) {
    const merged = { ...base };
    if (overrides) {
        for (const [key, val] of Object.entries(overrides)) {
            if (val !== undefined)
                merged[key] = val;
        }
    }
    return merged;
}
