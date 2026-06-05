export { parseGeminiProductJson } from './storage.js';

function stripMarkdownJsonFence(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (fenced ? fenced[1] : text).trim();
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
    const loose = trimmed.match(/\{[\s\S]*?"keywords"[\s\S]*?\}/i);
    if (loose) {
        const parsed = tryParse(loose[0]);
        if (parsed)
            return parsed;
    }
    return null;
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
