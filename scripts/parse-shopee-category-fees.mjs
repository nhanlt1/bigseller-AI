/**
 * Parse Firecrawl markdown export of Shopee category fee PDF → JSON lookup.
 * Source: https://banhang.shopee.vn/edu/article/27540 (PDF link in article)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, '.firecrawl', 'shopee-fee-pdf.md');
const output = path.join(root, 'src', 'pricing', 'data', 'shopee-category-fees.json');

const md = fs.readFileSync(input, 'utf8');
const rows = [];
const lineRe =
    /^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\|\s*([\d.]+)%\s*\|/;

for (const line of md.split('\n')) {
    const m = line.match(lineRe);
    if (!m)
        continue;
    const [, stt, c1, c2, c3, ratePct] = m;
    const rate = Number(ratePct) / 100;
    if (!Number.isFinite(rate))
        continue;
    rows.push({
        stt: Number(stt),
        cat1: c1.trim(),
        cat2: c2.trim(),
        cat3: c3.trim(),
        rate,
        ratePct: Number(ratePct),
    });
}

/** Summary fallbacks (non-Mall, từ 23/05/2026) — article 27540 */
const l1Fallbacks = [
    { match: 'mẹ & bé', rate: 0.105 },
    { match: 'thực phẩm', rate: 0.1 },
    { match: 'chăm sóc thú cưng', rate: 0.14 },
    { match: 'sắc đẹp', rate: 0.17 },
    { match: 'sức khỏe', rate: 0.16 },
    { match: 'sở thích', rate: 0.16 },
    { match: 'sách', rate: 0.145 },
    { match: 'văn phòng', rate: 0.135 },
    { match: 'thời trang', rate: 0.15 },
    { match: 'máy tính', rate: 0.09 },
    { match: 'điện thoại', rate: 0.15 },
    { match: 'nhà cửa', rate: 0.145 },
    { match: 'mô tô', rate: 0.015 },
    { match: 'ô tô', rate: 0.035 },
];

const meta = {
    sourceUrl: 'https://banhang.shopee.vn/edu/article/27540',
    pdfUrl:
        'https://mms.file.susercontent.com/api/v4/11195002/mms/vn-11195002-bmlg7-mo9l5o5t9kaz4f',
    effectiveFrom: '2026-05-23',
    sellerType: 'non-mall',
    parsedAt: new Date().toISOString().slice(0, 10),
    rowCount: rows.length,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
    output,
    JSON.stringify({ meta, rows, l1Fallbacks }, null, 0),
    'utf8',
);
console.log(`Wrote ${rows.length} rows → ${output}`);
