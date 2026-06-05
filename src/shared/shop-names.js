/**
 * Tên gian hàng theo shop Shopee (subaccount) / BigSeller (select cửa hàng).
 */

/** Shopee: class subaccount-name — id → tên thương hiệu trong mô tả */
export const SHOPEE_SHOP_ID_TO_BRAND = {
  hangtieudung02: "NPP VĂN PHÒNG PHẨM THIÊN TRANG",
  vpp_rosyruby: "Rosy Ruby Stationery",
};

/** Hai shop cùng hệ — shopId số từ URL sản phẩm Shopee */
export const SIBLING_SHOPEE_SHOPS = [
  {
    shopId: "265264853",
    account: "hangtieudung02",
    brand: "NPP VĂN PHÒNG PHẨM THIÊN TRANG",
  },
  {
    shopId: "590382538",
    account: "vpp_rosyruby",
    brand: "Rosy Ruby Stationery",
  },
];

const SIBLING_SHOP_BY_NUMERIC_ID = Object.fromEntries(
  SIBLING_SHOPEE_SHOPS.map((s) => [s.shopId, s]),
);

export function isSiblingShopId(shopId) {
  const id = String(shopId ?? "").trim();
  return id !== "" && id in SIBLING_SHOP_BY_NUMERIC_ID;
}

/** @returns {{ shopId: string, account: string, brand: string } | null} */
export function resolveSiblingShopMeta(shopId) {
  const id = String(shopId ?? "").trim();
  return SIBLING_SHOP_BY_NUMERIC_ID[id] ?? null;
}

/** Tên shop cũ / shop khác — gỡ khỏi mô tả gốc và kết quả AI (trừ allowedShopName). */
const SHOP_NAME_ALIASES = [
  "HAN.X - SHOP BÁCH HOÁ",
  "HAN.X - SHOP BACH HOA",
  "HAN.X - SHOP BACH HÓA",
  "HAN.X SHOP BÁCH HOÁ",
  "HAN.X SHOP BACH HOA",
  "HAN.X",
];

/** Kiểu "ABC - SHOP TÊN CỬA HÀNG" */
const FOREIGN_SHOP_BRAND_PATTERNS = [
  /\bHAN\.X\s*[-–—]?\s*SHOP\s+B[ÁA]CH\s+H[OÓ]A\b/giu,
  /\b[A-Z0-9][A-Z0-9.\s]{0,32}\s*[-–—]\s*SHOP\s+[A-ZÀ-ỸA-Z][A-ZÀ-ỹA-Z0-9\s]{2,48}\b/gu,
];

const BIGSELLER_SHOP_SELECTORS = [
  ".page_edit .com_card_body .page_edit_item .ant-select-selection-selected-value",
  ".page_edit_item .ant-select-selection-selected-value",
  ".ant-select-selection-selected-value",
];

const SHOPEE_SUBACCOUNT_SELECTORS = [
  "span.subaccount-name",
  ".subaccount-name",
];

/** Bỏ tiền tố kiểu "(Ngọc) " trên tên gian BigSeller */
export function normalizeBigsellerShopLabel(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  return text.replace(/^\([^)]{1,48}\)\s*/, "").trim();
}

function pickBigsellerShopLabel(raw) {
  if (!raw || !/[a-zA-ZÀ-ỹ0-9]/.test(raw)) return "";
  const name = normalizeBigsellerShopLabel(raw);
  if (!name || name.length < 2) return "";
  if (/^(chọn|select|tất cả|all)$/i.test(name)) return "";
  return name;
}

export function readBigsellerShopBrand(root = document) {
  for (const sel of BIGSELLER_SHOP_SELECTORS) {
    const nodes = root.querySelectorAll(sel);
    for (const el of nodes) {
      const raw =
        el.textContent?.trim() || el.getAttribute("title")?.trim() || "";
      const name = pickBigsellerShopLabel(raw);
      if (name) return name;
    }
  }
  return "";
}

export function readShopeeShopId(root = document) {
  for (const sel of SHOPEE_SUBACCOUNT_SELECTORS) {
    const el = root.querySelector(sel);
    const id = el?.textContent?.trim();
    if (id) return id;
  }
  return "";
}

export function resolveShopeeShopBrand(shopId) {
  if (!shopId) return "";
  const key = shopId.trim().toLowerCase();
  return SHOPEE_SHOP_ID_TO_BRAND[key] ?? "";
}

export function resolveShopBrandName(platform, root = document) {
  if (platform === "bigseller") return readBigsellerShopBrand(root);
  if (platform === "shopee") {
    const id = readShopeeShopId(root);
    return resolveShopeeShopBrand(id);
  }
  return "";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForCompare(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function aliasesToStrip(allowedShopName) {
  const allowed = normalizeForCompare(allowedShopName);
  return [...SHOP_NAME_ALIASES]
    .filter((name) => {
      const n = normalizeForCompare(name);
      if (!n) return false;
      if (!allowed) return true;
      if (n === allowed) return false;
      if (allowed.includes(n) || n.includes(allowed)) return false;
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

function applyForeignShopPatterns(text, allowedShopName) {
  let result = text;
  const allowed = normalizeForCompare(allowedShopName);
  for (const re of FOREIGN_SHOP_BRAND_PATTERNS) {
    result = result.replace(re, (match) => {
      if (allowed && normalizeForCompare(match).includes(allowed)) return match;
      return " ";
    });
  }
  return result;
}

function tidyDescriptionLines(text) {
  return text
    .split("\n")
    .map((line) => {
      const lineOut = line.replace(/[ \t]{2,}/g, " ").trimEnd();
      if (/^[-•*]\s*🤝\s*$/i.test(lineOut.trim())) return "";
      return lineOut;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Gỡ tên gian hàng khác (alias + kiểu "X - SHOP Y"). Giữ allowedShopName nếu có.
 */
export function stripShopNamesFromText(text, opts = {}) {
  const allowedShopName = opts.allowedShopName?.trim() ?? "";
  let result = String(text ?? "");
  for (const name of aliasesToStrip(allowedShopName)) {
    const re = new RegExp(escapeRegExp(name), "gi");
    result = result.replace(re, " ");
  }
  result = applyForeignShopPatterns(result, allowedShopName);
  result = result.replace(/\(\s*Ngọc\s*\)\s*/gi, " ");
  result = result.replace(/\(\s*Ngoc\s*\)\s*/gi, " ");
  return tidyDescriptionLines(result);
}

/** Gỡ mọi tên gian hàng đã khai báo khỏi mô tả gốc (AI chỉ dùng shopName trong prompt). */
export function stripShopNamesFromDescription(description) {
  return stripShopNamesFromText(description, { allowedShopName: "" });
}

const COMMITMENT_HEADING = /🛡️\s*Cam kết/i;

/** Phần cam kết: nhắc đúng tên gian nếu chưa có (sau khi gỡ shop lạ). */
export function ensureShopNameInCommitment(text, shopName) {
  const name = shopName?.trim() ?? "";
  if (!name || text.toLowerCase().includes(name.toLowerCase())) return text;
  const commitmentMatch = text.match(COMMITMENT_HEADING);
  if (!commitmentMatch || commitmentMatch.index == null) return text;
  const headIdx = commitmentMatch.index;
  const before = text.slice(0, headIdx);
  const after = text.slice(headIdx);
  const handshake = after.match(/^([-•*]\s*🤝)\s*/m);
  if (handshake) {
    const replaced = after.replace(/^([-•*]\s*🤝)\s*/m, `$1 ${name} `);
    return before + replaced;
  }
  const insert = `\n- 🤝 ${name} xin chân thành cảm ơn Quý Khách đã tin tưởng lựa chọn sản phẩm.`;
  const headingEnd = after.indexOf("\n");
  if (headingEnd < 0) return text + insert;
  return (
    before +
    after.slice(0, headingEnd + 1) +
    insert +
    after.slice(headingEnd + 1)
  );
}

/** Làm sạch title/description sau Gemini: gỡ shop lạ, giữ đúng shopName. */
export function sanitizeRewrittenProduct(product, shopName = "") {
  const allowed = shopName?.trim() ?? "";
  const title = stripShopNamesFromText(product.title ?? "", {
    allowedShopName: allowed,
  });
  let description = stripShopNamesFromText(product.description ?? "", {
    allowedShopName: allowed,
  });
  if (allowed) description = ensureShopNameInCommitment(description, allowed);
  return { title, description };
}

/**
 * Chuẩn bị title/description + tên gian cho prompt Gemini.
 */
export function buildPromptProductContext(product, platform) {
  const shopName = resolveShopBrandName(platform);
  const description = stripShopNamesFromDescription(product.description ?? "");
  return {
    title: product.title ?? "",
    description,
    shopName,
  };
}
