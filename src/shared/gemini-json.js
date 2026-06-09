export { parseGeminiProductJson } from './storage.js';

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
 * Gemini đôi khi trả JSON với dấu " chưa escape trong description.
 * Trích title/description/suggestedPrice theo ranh giới key.
 * @param {string} text
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
    const titleBoundary = afterTitle.match(
        /^([\s\S]*?)"\s*,\s*"(?:description|mo_ta|desc)"\s*:/i,
    );
    if (!titleBoundary)
        return null;
    const title = unescapeJsonString(titleBoundary[1]).trim();
    const descKey = block.match(/"(?:description|mo_ta|desc)"\s*:\s*"/i);
    if (!descKey)
        return null;
    const descStart = descKey.index + descKey[0].length;
    const descChunk = block.slice(descStart);
    const descEnd = descChunk.match(
        /^([\s\S]*?)"\s*(?:,\s*"(?:suggestedPrice|suggested_price|gia|price)"\s*:|}\s*$)/i,
    );
    const description = unescapeJsonString(
        descEnd ? descEnd[1] : descChunk.slice(0, Math.max(0, descChunk.lastIndexOf('"'))),
    ).trim();
    const priceMatch = block.match(
        /"(?:suggestedPrice|suggested_price|gia|price)"\s*:\s*(\d+)/i,
    );
    const suggestedPrice = priceMatch ? Number.parseInt(priceMatch[1], 10) : undefined;
    if (!title && !description)
        return null;
    const out = { title, description };
    if (Number.isFinite(suggestedPrice) && suggestedPrice > 0)
        out.suggestedPrice = suggestedPrice;
    return out;
}

/** @param {string} text */
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
    const looseKeywords = trimmed.match(/\{[\s\S]*?"keywords"[\s\S]*?\}/i);
    if (looseKeywords) {
        const parsed = tryParse(looseKeywords[0]);
        if (parsed)
            return parsed;
    }
    const looseProduct = trimmed.match(
        /\{[\s\S]*?"(?:title|tieu_de)"[\s\S]*?"(?:description|mo_ta|desc)"[\s\S]*?\}/i,
    );
    if (looseProduct) {
        const parsed = tryParse(looseProduct[0]);
        if (parsed)
            return parsed;
    }
    return extractLooseGeminiFields(trimmed);
}

/**
 * Trích JSON từ khóa Gemini: {"keywords":["cụm 1","cụm 2",...]}
 * @param {string} text
 * @returns {{ keywords: string[] } | null}
 */
export function parseGeminiKeywordsJson(text) {
    const parsed = extractJsonObject(text);
    if (!parsed)
        return null;
    const raw = parsed.keywords ?? parsed.tu_khoa ?? parsed.keyword;
    if (!Array.isArray(raw))
        return null;
    const keywords = raw
        .map((k) => String(k ?? '').trim())
        .filter((k) => k.length > 0);
    if (keywords.length === 0)
        return null;
    return { keywords };
}

function parseSuggestedPrice(raw) {
    if (raw == null || raw === '')
        return null;
    const n = typeof raw === 'number'
        ? raw
        : Number(String(raw).replace(/[^\d]/g, ''));
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return Math.round(n);
}

/**
 * JSON tối ưu SEO: { title, description, suggestedPrice }
 * @param {string} text
 * @returns {{ title: string, description: string, suggestedPrice: number | null } | null}
 */
export function parseGeminiOptimizeJson(text) {
    if (!text?.trim())
        return null;
    const trimmed = String(text).trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const direct = JSON.parse(trimmed);
            if (direct && typeof direct === 'object') {
                const title = String(direct.title ?? direct.tieu_de ?? '').trim();
                const description = String(
                    direct.description ?? direct.mo_ta ?? direct.desc ?? '',
                ).trim();
                const suggestedPrice = parseSuggestedPrice(
                    direct.suggestedPrice ?? direct.suggested_price ?? direct.gia ?? direct.price,
                );
                if (title || description)
                    return { title, description, suggestedPrice };
            }
        }
        catch {
            /* fall through */
        }
    }
    const parsed = extractJsonObject(text);
    if (!parsed)
        return null;
    const title = String(parsed.title ?? parsed.tieu_de ?? '').trim();
    const description = String(
        parsed.description ?? parsed.mo_ta ?? parsed.desc ?? '',
    ).trim();
    const suggestedPrice = parseSuggestedPrice(
        parsed.suggestedPrice ?? parsed.suggested_price ?? parsed.gia ?? parsed.price,
    );
    if (!title && !description)
        return null;
    return { title, description, suggestedPrice };
}
