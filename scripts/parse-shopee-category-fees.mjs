/**
 * Parse "danh mục ngành hàng.xlsx" (bảng phí cố định Shopee chuẩn, non-Mall)
 * → src/pricing/data/shopee-category-fees.data.js
 *
 * Cột: A=STT, B=cấp 1, C=cấp 2, D=cấp 3, E=% phí.
 * cat1/cat2/cat3 ghi ra dạng chữ không dấu + lowercase (khớp normalize lúc lookup).
 *
 * Chạy: node scripts/parse-shopee-category-fees.mjs
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { normalizeCategoryText } from '../src/pricing/category-normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const inputXlsx = path.join(root, 'src', 'pricing', 'data', 'danh mục ngành hàng.xlsx');
const outputJs = path.join(root, 'src', 'pricing', 'data', 'shopee-category-fees.data.js');

/* ---------- Đọc file trong xlsx (zip) — chỉ cần store/deflate ---------- */
function readZipEntries(buf) {
    // Tìm End Of Central Directory (0x06054b50) từ cuối file
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('Không tìm thấy EOCD — file xlsx hỏng?');
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50)
            throw new Error('Central directory lỗi tại entry ' + i);
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const localOff = buf.readUInt32LE(off + 42);
        const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
        entries.set(name, { method, compSize, localOff });
        off += 46 + nameLen + extraLen + commentLen;
    }
    return {
        read(name) {
            const e = entries.get(name);
            if (!e)
                throw new Error('Không có ' + name + ' trong xlsx');
            const lNameLen = buf.readUInt16LE(e.localOff + 26);
            const lExtraLen = buf.readUInt16LE(e.localOff + 28);
            const start = e.localOff + 30 + lNameLen + lExtraLen;
            const data = buf.subarray(start, start + e.compSize);
            return e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
        },
    };
}

/* ---------- Parse sheet1 ---------- */
const decodeXml = (s) =>
    s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

function parseSharedStrings(xml) {
    return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''),
    );
}

function parseRowCells(xml, strings) {
    const cells = {};
    for (const c of xml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>|<c\s+([^>]*)\/>/g)) {
        const attrs = c[1] ?? c[3] ?? '';
        const inner = c[2] ?? '';
        const col = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        if (!col)
            continue;
        const type = attrs.match(/t="(\w+)"/)?.[1];
        let val = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ??
            inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1] ?? '';
        if (type === 's')
            val = strings[Number(val)] ?? '';
        cells[col] = decodeXml(String(val)).replace(/\s+/g, ' ').trim();
    }
    return cells;
}

function parseXlsxRows(file) {
    const zip = readZipEntries(fs.readFileSync(file));
    const strings = parseSharedStrings(zip.read('xl/sharedStrings.xml').toString('utf8'));
    const sheet = zip.read('xl/worksheets/sheet1.xml').toString('utf8');
    const rows = [];
    for (const m of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const c = parseRowCells(m[1], strings);
        const stt = Number(c.A);
        const ratePct = Number(c.E);
        if (!Number.isInteger(stt) || !Number.isFinite(ratePct) || !c.B)
            continue; // header / dòng trống
        rows.push({
            stt,
            ratePct,
            rate: ratePct / 100,
            cat1: c.B ?? '',
            cat2: c.C ?? '',
            cat3: c.D ?? '',
        });
    }
    return rows;
}

/* ---------- Serialize data.js: từng dòng, nhóm theo %, chữ không dấu ---------- */
const q = (s) => `'${String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function serializeRow(row) {
    const fields = [
        `stt: ${row.stt}`,
        `ratePct: ${row.ratePct}`,
        `rate: ${row.rate}`,
        `cat1: ${q(row.cat1)}`,
        `cat2: ${q(row.cat2)}`,
        `cat3: ${q(row.cat3)}`,
    ];
    return `        { ${fields.join(', ')} },`;
}

export function serializeFeeData({ meta, rows, l1Fallbacks }) {
    const asciiRows = rows.map((row) => ({
        ...row,
        cat1: normalizeCategoryText(row.cat1),
        cat2: normalizeCategoryText(row.cat2),
        cat3: normalizeCategoryText(row.cat3),
    }));
    const groups = new Map();
    for (const row of asciiRows) {
        if (!groups.has(row.ratePct))
            groups.set(row.ratePct, []);
        groups.get(row.ratePct).push(row);
    }
    const lines = [];
    lines.push('/**');
    lines.push(' * Biểu phí cố định Shopee theo danh mục (non-Mall) — sinh bởi scripts/parse-shopee-category-fees.mjs');
    lines.push(' * từ src/pricing/data/danh mục ngành hàng.xlsx.');
    lines.push(' * cat1/cat2/cat3 đã bỏ dấu + lowercase (dò bằng chữ không dấu). KHÔNG sửa tay — sửa xlsx rồi chạy lại script.');
    lines.push(' */');
    lines.push('export default {');
    lines.push(`    meta: ${JSON.stringify(meta)},`);
    lines.push('    l1Fallbacks: [');
    for (const fb of l1Fallbacks)
        lines.push(`        { match: ${q(normalizeCategoryText(fb.match))}, rate: ${fb.rate} },`);
    lines.push('    ],');
    lines.push('    rows: [');
    for (const ratePct of [...groups.keys()].sort((a, b) => a - b)) {
        const groupRows = groups.get(ratePct);
        lines.push('');
        lines.push(`        // ===== ${ratePct}% (${groupRows.length} dòng) =====`);
        for (const row of groupRows)
            lines.push(serializeRow(row));
    }
    lines.push('    ],');
    lines.push('};');
    return lines.join('\n') + '\n';
}

/* ---------- Main ---------- */
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

const rows = parseXlsxRows(inputXlsx);
if (rows.length < 1000)
    throw new Error(`Chỉ parse được ${rows.length} dòng — kiểm tra lại xlsx`);

const meta = {
    sourceFile: 'src/pricing/data/danh mục ngành hàng.xlsx',
    sourceUrl: 'https://banhang.shopee.vn/edu/article/27540',
    effectiveFrom: '2026-05-23',
    sellerType: 'non-mall',
    parsedAt: new Date().toISOString().slice(0, 10),
    rowCount: rows.length,
};

fs.writeFileSync(outputJs, serializeFeeData({ meta, rows, l1Fallbacks }), 'utf8');
console.log(`Wrote ${rows.length} rows → ${outputJs}`);
