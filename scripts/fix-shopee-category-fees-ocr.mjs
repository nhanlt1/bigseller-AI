/**
 * Sửa lỗi OCR trong biểu phí danh mục Shopee (parse từ PDF Firecrawl).
 *
 * Lookup (category-commission.js) so khớp sau khi bỏ dấu + lowercase, nên chỉ cần
 * sửa các lỗi làm sai dạng ASCII: ký tự CJK nuốt chữ (Th尬 → Thiết), Cyrillic/Greek
 * lookalike, U+FFFD, token sai (Magy → Máy, Bj → Bị, cura → cửa…), thiếu khoảng trắng.
 *
 * Dùng:
 *   node scripts/fix-shopee-category-fees-ocr.mjs            # đọc + ghi lại data.js
 *   import { fixCategoryFeeRows, serializeFeeData } from './fix-shopee-category-fees-ocr.mjs'
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { normalizeCategoryText } from '../src/pricing/category-normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataJsPath = path.join(root, 'src', 'pricing', 'data', 'shopee-category-fees.data.js');
const reportPath = path.join(root, 'scripts', 'ocr-fix-report.json');

/* ---------- Lớp 0: ký tự lookalike (Cyrillic / Greek / số) → Latin ---------- */
const LOOKALIKE_CHARS = {
    а: 'a', е: 'e', о: 'o', с: 'c', р: 'p', х: 'x', у: 'y', і: 'i', // Cyrillic thường
    А: 'A', Е: 'E', О: 'O', С: 'C', Р: 'P', Х: 'X', М: 'M', Н: 'H', В: 'B', Т: 'T', К: 'K',
    ό: 'ô', ο: 'o', // Greek
    ı: 'i', // Turkish dotless i (mayı)
    Ⅳ: 'Ĩ', // ĐⅣa → Đĩa (roman numeral IV)
};

function fixLookalikes(s) {
    let out = '';
    for (const ch of s)
        out += LOOKALIKE_CHARS[ch] ?? ch;
    return out;
}

/* ---------- Lớp 1: cụm chứa CJK / U+FFFD — sửa theo ngữ cảnh (trước khi strip) ---------- */
const PHRASE_FIXES = [
    // Thiết / Thời / Thể bị CJK nuốt chữ
    [/Th[尬恤]\s*[Bb]i?j/g, 'Thiết Bị'],
    [/Th\s*discret\s*Bj/g, 'Thiết Bị'],
    [/Thielt\s*Bj/g, 'Thiết Bị'],
    [/Thligt\s*Bj/g, 'Thiết Bị'],
    [/Thi[eệ]t\s*[Bb]i?j/g, 'Thiết Bị'],
    [/Thi[ée]t\s*Bj/g, 'Thiết Bị'],
    [/Th[尬恤]\s*b/g, 'Thiết b'],
    [/Th(?:历时|价比|神色|言情|\uFFFD\uFFFD?)\s*[Tt]rang/g, 'Thời Trang'],
    [/Th(?:历时|价比|神色|言情)\s*tr/g, 'Thời tr'],
    [/Th(?:骼|\s*perí)\s*[Tt]hao/g, 'Thể Thao'],
    [/Phu\s*k育人\s*Th历时\s*Trang/g, 'Phụ Kiện Thời Trang'],
    [/Phu\s*k育人历时/g, 'Phụ kiện thời trang'],
    [/Phu\s*kienza历时/g, 'Phụ kiện thời trang'],
    [/Phu\s*kiên\s*th历时/g, 'Phụ kiện thời trang'],
    // Đồ bị CJK nuốt
    [/[ĐD][哗淆]/g, 'Đồ'],
    [/D团委\s*sông/g, 'Đời sống'],
    [/Đ\uFFFD i\s*sông/g, 'Đời sống'],
    [/Đ\uFFFDi\s*sông/g, 'Đời sống'],
    // Đồng hồ
    [/[Hh]汨/g, 'Hồ'],
    [/hồcáp/g, 'hồ cặp'],
    [/kiênđồng/g, 'kiện đồng'],
    [/\{dong/g, ' đồng'],
    [/\{dung/g, ' đựng'],
    [/<liu\)?/g, ' liệu'],
    [/\bm€/g, 'mẹ'],
    // lót / lò
    [/l讶/g, 'lót'],
    [/lotlin/g, 'lót'],
    // khác
    [/B饪/g, 'Bột'],
    [/ĐⅣa/g, 'Đĩa'],
    [/m乍/g, 'máy'],
    [/Khное/g, 'Khỏe'],
    [/Súc\s*Khổ\b/g, 'Sức Khỏe'],
    [/nh\uFFFDn/g, 'nhân'],
    [/ch\uFFFDn/g, 'chân'],
    [/kho\uFFFDn/g, 'khoản'],
    [/ph\uFFFDng/g, 'phòng'],
    [/M\uFFFDn\s*Hinh/g, 'Màn Hình'],
    [/c資/g, 'cửa'],
    [/nha\s*clua/g, 'nhà cửa'],
    [/Nguyễn<liu/g, 'Nguyên liệu'],
    [/S\s*sựKIEN/g, 'Sự Kiện'],
    [/S況KIEN/g, 'Sự Kiện'],
    [/SựKIEN/g, 'Sự Kiện'],
    [/Phanh\s*Mём/g, 'Phần Mềm'],
    [/Sūra/g, 'Sữa'],
    [/-\s*trirement/g, '- trứng'],
    [/-\s*tr修士/g, '- trứng'],
    [/Sữa\s*-\s*trưởng/g, 'Sữa - trứng'],
    [/mutzer/g, 'mứt'],
    [/án\s*variat/g, 'ăn vặt'],
    [/Thướclá/g, 'Thuốc lá'],
    [/tinhàng\b/g, 'tính bảng'],
    [/Macy\s*Scan/g, 'Máy Scan'],
    [/Tulièrement/g, 'Túi'],
    [/Glìy/g, 'Giày'],
    [/Giály/g, 'Giấy'],
    [/Giány/g, 'Giấy'],
    [/Hồ\s*Bùt\b/g, 'Hộp Bút'],
    [/Tủi\s*Vi\b/g, 'Túi Ví'],
    [/Tủ\s*Vi\b/g, 'Túi Ví'],
    [/\bNür\b/gi, 'Nữ'],
    [/nür/g, 'nữ'],
    [/Sucedkhôe/g, 'Sức khỏe'],
    [/Sứckhôe/g, 'Sức khỏe'],
    [/lamddep/g, 'làm đẹp'],
    [/Lâmdep/g, 'Làm đẹp'],
    [/lamd\s/g, 'làm '],
    [/thorn\b/g, 'thơm'],
    [/dungnhà/g, 'dụng nhà'],
    [/x[EÉeé]Pnha/g, 'xếp nhà'],
    [/xépnha/g, 'xếp nhà'],
    [/KiENAME/g, 'Kiện'],
    [/kiENAME/g, 'kiện'],
    [/PhuKIEN\s*gi[àâa]y[ıi]?dep/gi, 'Phụ kiện giày dép'],
    [/Phu\s*kiêntui/g, 'Phụ kiện túi'],
    [/Phu\s*kiên\s*cho\s*m€/g, 'Phụ kiện cho mẹ'],
    [/thy?uy[泽东ến]+/g, 'thuyền'],
    [/Tau\s*thuyen/g, 'Tàu thuyền'],
    [/Tài\s*thyuen/g, 'Tàu thuyền'],
    [/tài\s*nàng/g, 'tải nâng'],
    [/tái\s*n[gâ]ang?/g, 'tải nâng'],
    [/\b0\s*tố\b/g, 'ô tô'],
    [/\bỞ\s*tô\b/g, 'Ô tô'],
    [/Magyinh/g, 'Máy tính'],
    [/Magy/g, 'Máy'],
    [/Thoaai/g, 'Thoại'],
    [/\bphurong\b/gi, 'phương'],
    [/\bPhurong\b/g, 'Phương'],
    [/Phu\s*tuning/g, 'Phụ tùng'],
    [/\bcura\b/g, 'cửa'],
    [/Nhha/g, 'Nhà'],
    [/\bLuru\b/gi, 'Lưu'],
    [/\bluru\b/g, 'lưu'],
    [/\bSuur\b/gi, 'Sưu'],
    [/\bsuur\b/g, 'sưu'],
    [/\bthick\b/g, 'thích'],
    [/Du\s*lichi\b/g, 'Du lịch'],
    [/Dích\s*vuj/g, 'Dịch vụ'],
    [/Dích\s*vu\b/g, 'Dịch vụ'],
    [/Th[ué]\s*Tin\b/g, 'Thu Tiền'],
    [/Bô\{/g, 'Bộ '],
];

/* ---------- Lớp 2: token đơn (word boundary) ---------- */
const TOKEN_FIXES = [
    [/\bBi?j\b/g, 'Bị'],
    [/\bbi?j\b/g, 'bị'],
    [/\bBût\b/g, 'Bút'],
    [/\bmayı\b/g, 'máy'],
];

/* ---------- Lớp 3: map cat1 chuẩn (theo dạng ASCII đã normalize) ---------- */
function asciiKey(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/&/g, ' & ')
        .replace(/[^a-z0-9& ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Tên ngành cấp 1 chuẩn Shopee VN */
const CAT1_CANONICAL = [
    'Cameras & Flycam',
    'Chăm Sóc Thú Cưng',
    'Điện Thoại & Phụ Kiện',
    'Du lịch & Hành lý',
    'Gaming & Console',
    'Giày Dép Nữ',
    'Giày Dép Nam',
    'Máy Tính & Laptop',
    'Mẹ & Bé',
    'Muslim Fashion',
    'Mô tô, Xe máy',
    'Nhà Cửa & Đời Sống',
    'Ô Tô',
    'Phụ Kiện Thời Trang',
    'Phụ tùng và Phụ kiện cho Phương tiện',
    'Sắc Đẹp',
    'Sách & Tạp Chí',
    'Sức Khỏe',
    'Sở Thích & Sưu Tầm',
    'Thể Thao & Dã Ngoại',
    'Thiết Bị Âm Thanh',
    'Thiết Bị Điện Gia Dụng',
    'Thời Trang Nam',
    'Thời Trang Nữ',
    'Thời trang trẻ em & trẻ sơ sinh',
    'Thực phẩm và đồ uống',
    'Túi Ví Nam',
    'Túi Ví Nữ',
    'Voucher & Dịch vụ',
    'Văn Phòng Phẩm',
    'Đồng Hồ',
];

/** Key ASCII lệch nhẹ (sau token fix) → tên chuẩn */
const CAT1_ALIASES = {
    'cham soc thu cung': 'Chăm Sóc Thú Cưng',
    'dien thoai & phu kien': 'Điện Thoại & Phụ Kiện',
    'dien thoai & phu kien1': 'Điện Thoại & Phụ Kiện',
    'du lich & hanh ly': 'Du lịch & Hành lý',
    'giay dep nu': 'Giày Dép Nữ',
    'giay dep nam': 'Giày Dép Nam',
    'may tinh & laptop': 'Máy Tính & Laptop',
    'me & be': 'Mẹ & Bé',
    'me be': 'Mẹ & Bé',
    'mo to xe may': 'Mô tô, Xe máy',
    'nha cua & doi song': 'Nhà Cửa & Đời Sống',
    'nha cua & d song': 'Nhà Cửa & Đời Sống',
    'o to': 'Ô Tô',
    'phu kien thoi trang': 'Phụ Kiện Thời Trang',
    'phu tung va phu kien cho phuong tien': 'Phụ tùng và Phụ kiện cho Phương tiện',
    'sac dep': 'Sắc Đẹp',
    'suc dep': 'Sắc Đẹp',
    'sach & tap chi': 'Sách & Tạp Chí',
    'suc khoe': 'Sức Khỏe',
    'so thich & suu tam': 'Sở Thích & Sưu Tầm',
    'the thao & da ngoai': 'Thể Thao & Dã Ngoại',
    'thiet bi am thanh': 'Thiết Bị Âm Thanh',
    'thiet bi dien gia dung': 'Thiết Bị Điện Gia Dụng',
    'thoi trang nam': 'Thời Trang Nam',
    'thoi trang nu': 'Thời Trang Nữ',
    'thoi trang tra em & tra so sinh': 'Thời trang trẻ em & trẻ sơ sinh',
    'thoi trang tra em & tre so sinh': 'Thời trang trẻ em & trẻ sơ sinh',
    'thoi trang em & tra so sinh': 'Thời trang trẻ em & trẻ sơ sinh',
    'thoi tra em & tre so sinh': 'Thời trang trẻ em & trẻ sơ sinh',
    'thuc pham va do uong': 'Thực phẩm và đồ uống',
    'tui vi nam': 'Túi Ví Nam',
    'tui vi nu': 'Túi Ví Nữ',
    'voucher & dich vu': 'Voucher & Dịch vụ',
    'van phong pham': 'Văn Phòng Phẩm',
    'dong ho': 'Đồng Hồ',
};

const CAT1_BY_KEY = new Map(CAT1_CANONICAL.map((name) => [asciiKey(name), name]));
for (const [k, v] of Object.entries(CAT1_ALIASES))
    CAT1_BY_KEY.set(k, v);

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
            row[j - 1] = prev;
            prev = next;
        }
        row[b.length] = prev;
    }
    return row[b.length];
}

function canonicalizeCat1(value) {
    const key = asciiKey(value);
    const direct = CAT1_BY_KEY.get(key);
    if (direct)
        return direct;
    // Fuzzy về canonical gần nhất (PDF có thể sinh biến thể mới)
    let best = null;
    for (const [ck, name] of CAT1_BY_KEY) {
        const dist = levenshtein(key, ck);
        const sim = 1 - dist / Math.max(key.length, ck.length);
        if (sim >= 0.8 && (!best || sim > best.sim))
            best = { name, sim };
    }
    return best?.name ?? value;
}

/* ---------- Pipeline ---------- */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const SUSPICIOUS_RE = /[\u3400-\u9fff\uf900-\ufaff\uFFFD€<{]|\b(?:Magy|Bj|bij|cura|Luru|Suur|phurong|KIEN[A-Z])\b/;

function fixField(value) {
    let s = String(value ?? '');
    if (!s)
        return s;
    s = fixLookalikes(s);
    for (const [re, rep] of PHRASE_FIXES)
        s = s.replace(re, rep);
    for (const [re, rep] of TOKEN_FIXES)
        s = s.replace(re, rep);
    // CJK còn sót: thường là 1 ký tự thay cho cụm — strip rồi ghi nhận trong report
    s = s.replace(CJK_RE, ' ');
    s = s.replace(/\uFFFD/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array<{stt:number,cat1:string,cat2:string,cat3:string,rate:number,ratePct:number}>} rows
 * @returns {{ rows: typeof rows, report: object }}
 */
export function fixCategoryFeeRows(rows) {
    let changed = 0;
    const suspicious = [];
    const fixed = rows.map((row) => {
        const cat1 = canonicalizeCat1(fixField(row.cat1));
        const cat2 = fixField(row.cat2);
        const cat3 = fixField(row.cat3);
        if (cat1 !== row.cat1 || cat2 !== row.cat2 || cat3 !== row.cat3)
            changed++;
        const out = { ...row, cat1, cat2, cat3 };
        if (SUSPICIOUS_RE.test(`${row.cat1}|${row.cat2}|${row.cat3}`) &&
            SUSPICIOUS_RE.test(`${cat1}|${cat2}|${cat3}`)) {
            suspicious.push({ stt: row.stt, cat1, cat2, cat3 });
        }
        return out;
    });
    const cat1Variants = new Set(fixed.map((r) => r.cat1));
    return {
        rows: fixed,
        report: {
            total: rows.length,
            changed,
            cat1VariantCount: cat1Variants.size,
            cat1Variants: [...cat1Variants].sort(),
            suspiciousRemaining: suspicious.length,
            suspicious,
        },
    };
}

/* ---------- Serialize data.js: từng dòng, nhóm theo %, kèm trường không dấu ---------- */
const q = (s) => `'${String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function serializeRow(row) {
    const fields = [
        `stt: ${row.stt}`,
        `ratePct: ${row.ratePct}`,
        `rate: ${row.rate}`,
        `cat1: ${q(row.cat1)}`,
        `cat2: ${q(row.cat2)}`,
        `cat3: ${q(row.cat3)}`,
        `a1: ${q(row.a1)}`,
        `a2: ${q(row.a2)}`,
        `a3: ${q(row.a3)}`,
    ];
    return `        { ${fields.join(', ')} },`;
}

/** Thêm trường không dấu a1/a2/a3 (cùng normalize với lookup runtime) */
export function withAsciiFields(rows) {
    return rows.map((row) => ({
        ...row,
        a1: normalizeCategoryText(row.cat1),
        a2: normalizeCategoryText(row.cat2),
        a3: normalizeCategoryText(row.cat3),
    }));
}

/**
 * Sinh nội dung shopee-category-fees.data.js: rows từng dòng một,
 * nhóm theo % phí tăng dần, l1Fallbacks dùng match không dấu.
 */
export function serializeFeeData({ meta, rows, l1Fallbacks }) {
    const withAscii = withAsciiFields(rows);
    const groups = new Map();
    for (const row of withAscii) {
        if (!groups.has(row.ratePct))
            groups.set(row.ratePct, []);
        groups.get(row.ratePct).push(row);
    }
    const lines = [];
    lines.push('/**');
    lines.push(' * Biểu phí cố định Shopee theo danh mục (non-Mall) — sinh bởi scripts/parse-shopee-category-fees.mjs.');
    lines.push(' * a1/a2/a3 = cat1/cat2/cat3 đã bỏ dấu (dò bằng chữ không dấu). KHÔNG sửa tay — sửa qua script.');
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

/* ---------- CLI: đọc data.js hiện tại → fix → ghi lại data.js ---------- */
const isMain = process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    const { default: payload } = await import(pathToFileURL(dataJsPath).href);
    const { rows, report } = fixCategoryFeeRows(payload.rows);
    const meta = {
        ...payload.meta,
        ocrFixedAt: new Date().toISOString().slice(0, 10),
    };
    fs.writeFileSync(
        dataJsPath,
        serializeFeeData({ meta, rows, l1Fallbacks: payload.l1Fallbacks }),
        'utf8',
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Fixed ${report.changed}/${report.total} rows; cat1 variants: ${report.cat1VariantCount}`);
    console.log(`Suspicious remaining: ${report.suspiciousRemaining} → ${reportPath}`);
}
