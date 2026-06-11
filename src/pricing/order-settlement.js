import { calcVoucherXtraFee, getRateSum } from "./platform-fee-config.js";

/** Parse "₫84.000", "-₫41.000" → số nguyên VND */
export function parseVndText(text) {
  const raw = String(text ?? "").trim();
  const neg = /[-−]/.test(raw);
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return neg ? -n : n;
}

function normalizeLabel(label) {
  return String(label ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * DOM chi tiết thanh toán đơn (2026) — ưu tiên nhãn `.income-label-text`:
 * strong[0] Tổng tiền SP · group[0] Giá SP · strong[1] Tổng ship ước tính
 * group[1] chi tiết ship · strong[2] Phụ phí
 * group[2]: Phí cố định · Phí Dịch Vụ · Phí xử lý GD · Hoa hồng Tiếp thị liên kết (DOM) · NTTD 1%
 * strong[3] Thuế · group[3] GTGT/TNCN · strong[4] phụ DV người mua · highlighted Doanh thu
 */
export function classifyIncomeRow(label) {
  const l = normalizeLabel(label);
  if (/nttd|hien thi nttd/.test(l)) return "nttdDisplayFee";
  if (/doanh thu/.test(l)) return "sellerIncome";
  if (/piship|pi\s*ship/.test(l)) return "piShip";
  if (/tiep thi lien ket|hoa hong.*tiep thi|affiliate/.test(l))
    return "affiliateCommission";
  if (/phi co dinh/.test(l)) return "commission";
  if (/phi dich vu/.test(l)) return "serviceBundle";
  if (/phi xu ly|xu ly.*giao dich/.test(l)) return "payment";
  if (/^phu phi$/.test(l) || /tong phu phi/.test(l)) return "platformFeesTotal";
  if (/^thue$/.test(l)) return "taxTotal";
  if (/gtgt/.test(l)) return "vatGtgt";
  if (/tncn|thu nhap ca nhan/.test(l)) return "pitTncn";
  if (/tong tien.*san pham/.test(l)) return "productTotal";
  if (/^gia san pham$/.test(l)) return "productLine";
  if (/tong phi van chuyen.*uoc tinh/.test(l)) return "shippingEstimateSubtotal";
  if (/phu dich vu.*gia tri|gia tri gia tang/.test(l)) return "buyerAddonSubtotal";
  if (/seller.*chiu|nguoi ban chiu/.test(l)) return "sellerShippingBurden";
  if (/tro gia/.test(l) || /ma giam gia.*(cua )?shop/.test(l))
    return "shopProductDiscount";
  if (/van chuyen|phi ship|voucher/.test(l)) return "shippingDetail";
  return "other";
}

export function resolveIncomeRowRole(ctx) {
  const {
    label = "",
    isSubtotal = false,
    isHighlighted = false,
    groupIndex = null,
  } = ctx;
  if (isHighlighted) return "sellerIncome";
  const byLabel = classifyIncomeRow(label);
  if (byLabel !== "other") return byLabel;
  if (isSubtotal) return "subtotalOther";
  if (groupIndex === 1) return "shippingDetail";
  if (groupIndex === 3) {
    const l = normalizeLabel(label);
    if (/gtgt/.test(l)) return "vatGtgt";
    if (/tncn/.test(l)) return "pitTncn";
  }
  return "other";
}

/** @deprecated dùng resolveIncomeRowRole */
export function inferIncomeRowRole(ctx) {
  return resolveIncomeRowRole(ctx);
}

export function resolveRowRole(row) {
  if (row.role) return row.role;
  return classifyIncomeRow(row.label);
}

/** Bỏ SVG/CSS/tooltip Shopee khỏi nhãn (copy đối soát, phân loại dòng). */
export function sanitizeIncomeLabel(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/\.cls-\d+\{[^}]*\}/gi, "");
  s = s.replace(/\{fill-rule:[^}]*\}/gi, "");
  s = s.replace(/question/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  const known = [
    "Tổng tiền sản phẩm",
    "Giá sản phẩm",
    "Tổng phí vận chuyển ước tính",
    "Phí vận chuyển Người mua trả",
    "Phí vận chuyển ước tính",
    "Trợ giá",
    "Phụ phí",
    "Phí cố định",
    "Phí Dịch Vụ",
    "Phí xử lý giao dịch",
    "Phí hoa hồng Tiếp thị liên kết",
    "Phí dịch vụ hiển thị NTTD",
    "Tổng phụ dịch vụ giá trị gia tăng cho người mua",
    "Doanh thu đơn hàng ước tính",
  ];
  for (const phrase of known) {
    const idx = s.indexOf(phrase);
    if (idx === -1) continue;
    const fromPhrase = s.slice(idx);
    if (fromPhrase.startsWith(phrase)) return phrase;
  }
  const voucher = s.match(/^(Mã giảm giá[^.]{0,80})/i);
  if (voucher) return voucher[1].trim();
  const beforeCls = s.split(/\.\s*cls-/i)[0]?.trim();
  if (beforeCls && beforeCls.length < s.length) return beforeCls;
  if (s.length > 72) return s.slice(0, 72).trim();
  return s;
}

function labelTextWithoutIcons(el) {
  const clone = el.cloneNode(true);
  clone
    .querySelectorAll("svg, style, script, [class*='icon']")
    .forEach((n) => n.remove());
  return clone.textContent ?? "";
}

export function extractIncomeLabel(item) {
  const textEl = item.querySelector(".income-label-text");
  if (textEl) {
    const t = sanitizeIncomeLabel(labelTextWithoutIcons(textEl));
    if (t) return t;
  }
  const labelEl = item.querySelector(
    '.income-label, .income-name, [class*="label"]',
  );
  const valueEl = item.querySelector(".income-value");
  const raw = (labelEl ? labelTextWithoutIcons(labelEl) : item.textContent ?? "").trim();
  if (!valueEl) return sanitizeIncomeLabel(raw);
  return sanitizeIncomeLabel(
    raw.replace(valueEl.textContent ?? "", "").trim(),
  );
}

/** Cộng trợ giá / mã shop — tránh đếm trùng cùng một số tiền hai dòng. */
function accumulateShopProductDiscount(data, amount) {
  if (!amount || amount >= 0) return;
  const key = Math.abs(Math.round(amount));
  if (!data._shopDiscountSeen) data._shopDiscountSeen = new Set();
  if (data._shopDiscountSeen.has(key)) return;
  data._shopDiscountSeen.add(key);
  data.shopProductAdjustment += amount;
}

/**
 * Dòng SP trên trang chi tiết đơn — `.product-list-item` (subtotal ÷ qty = đơn giá VX).
 * @param {ParentNode} [root]
 * @returns {{ subtotal: number, quantity: number, unitPrice: number }[]}
 */
export function parseOrderProductLines(root = document) {
  /** @type {{ subtotal: number, quantity: number, unitPrice: number }[]} */
  const lines = [];
  const items = root.querySelectorAll(
    ".order-detail .product-list-item, .product-payment-wrapper .product-list-item",
  );
  for (const item of items) {
    const subtotalEl = item.querySelector(".subtotal");
    const qtyEl = item.querySelector(".qty");
    if (!subtotalEl || !qtyEl)
      continue;
    const subtotal = parseVndText(subtotalEl.textContent);
    const quantity = Math.max(1, parseVndText(qtyEl.textContent) || 1);
    if (subtotal <= 0)
      continue;
    lines.push({
      subtotal,
      quantity,
      unitPrice: subtotal / quantity,
    });
  }
  return lines;
}

export function buildSettlementFromRows(rows, options = {}) {
  const productLines = Array.isArray(options.productLines)
    ? options.productLines
    : [];
  const data = {
    productTotal: 0,
    shopProductAdjustment: 0,
    sellerShippingBurden: 0,
    shippingBuyerForPayment: 0,
    quantity: 1,
    productLines,
    domCommission: null,
    domPayment: null,
    domPiShip: null,
    domAffiliateCommission: null,
    domNttdDisplay: null,
    hasNttdRow: false,
    hasTaxRows: false,
  };
  for (const row of rows) {
    const role = resolveRowRole(row);
    const v = row.value;
    if (role === "productTotal" && v > data.productTotal) data.productTotal = v;
    if (role === "shopProductDiscount")
      accumulateShopProductDiscount(data, v);
    if (role === "sellerShippingBurden") data.sellerShippingBurden = v;
    if (role === "commission" && v !== 0)
      data.domCommission = Math.abs(v);
    if (role === "payment" && v !== 0) data.domPayment = Math.abs(v);
    if (role === "piShip" && v !== 0) data.domPiShip = Math.abs(v);
    if (role === "affiliateCommission" && v !== 0)
      data.domAffiliateCommission = Math.abs(v);
    if (role === "nttdDisplayFee") {
      data.hasNttdRow = true;
      if (v !== 0) data.domNttdDisplay = Math.abs(v);
    }
    if (role === "vatGtgt" || role === "pitTncn" || role === "taxTotal")
      data.hasTaxRows = true;
    if (
      role === "shippingDetail" &&
      v > 0 &&
      data.shippingBuyerForPayment === 0
    )
      data.shippingBuyerForPayment = v;
  }
  delete data._shopDiscountSeen;
  if (productLines.length > 0) {
    data.quantity = productLines.reduce(
      (sum, line) => sum + Math.max(1, Math.floor(line.quantity ?? 1)),
      0,
    );
  }
  if (!data.productTotal) {
    const first = rows.find(
      (r) => resolveRowRole(r) === "productTotal" || r.value > 1000,
    );
    if (first) data.productTotal = Math.abs(first.value);
  }
  return data;
}

/**
 * Thu nhập = tiền hàng + seller chịu ship − Phụ phí − Thuế.
 * Phụ phí = cố định + DV + GD + PiShip (DOM) + tiếp thị liên kết (DOM) + NTTD.
 * NTTD: đơn có dòng → DOM hoặc 1%; tính giá ($) → 1% khi useNttdInPricing.
 */
export function computeSellerSettlement(data, feeConfig) {
  const shopAdj = data.shopProductAdjustment ?? 0;
  const productBase = Math.max(0, data.productTotal + shopAdj);
  const quantity = Math.max(1, Math.floor(data.quantity ?? 1));
  const shippingBuyer = Math.max(0, data.shippingBuyerForPayment ?? 0);
  const sellerShippingBurden = data.sellerShippingBurden ?? 0;
  const paymentBase = productBase + shippingBuyer;
  const commission =
    data.domCommission != null
      ? Math.round(data.domCommission)
      : Math.round(productBase * feeConfig.commissionRate);
  const piShip =
    data.domPiShip != null
      ? Math.round(data.domPiShip)
      : 0;
  const voucherXtra = calcVoucherXtraFee(
    productBase,
    feeConfig,
    quantity,
    data.productLines,
  );
  const infrastructure = feeConfig.infrastructureFeePerOrder;
  const serviceBundle = infrastructure + voucherXtra;
  const payment =
    data.domPayment != null
      ? Math.round(data.domPayment)
      : Math.round(paymentBase * feeConfig.paymentFeeRate);
  const affiliateCommission =
    data.domAffiliateCommission != null
      ? Math.round(data.domAffiliateCommission)
      : 0;
  const applyNttd =
    data.hasNttdRow ||
    (data.includeNttdInPricing === true &&
      feeConfig.useNttdInPricing !== false);
  const nttdDisplay = applyNttd
    ? data.hasNttdRow && data.domNttdDisplay != null
      ? Math.round(data.domNttdDisplay)
      : Math.round(productBase * (feeConfig.nttdDisplayRate ?? 0.01))
    : 0;
  const platformFeesTotal =
    commission +
    piShip +
    serviceBundle +
    payment +
    affiliateCommission +
    nttdDisplay;
  const vat = data.hasTaxRows
    ? Math.round(productBase * (feeConfig.vatRate ?? 0))
    : 0;
  const pit = data.hasTaxRows
    ? Math.round(productBase * (feeConfig.pitRate ?? 0))
    : 0;
  const taxTotal = vat + pit;
  const sellerIncome =
    data.productTotal +
    shopAdj +
    sellerShippingBurden -
    platformFeesTotal -
    taxTotal;
  return {
    productTotal: data.productTotal,
    shopProductAdjustment: shopAdj,
    netProductBase: productBase,
    quantity,
    shippingBuyerForPayment: shippingBuyer,
    sellerShippingBurden,
    productBase,
    paymentBase,
    rateSum: getRateSum(feeConfig),
    commission,
    piShip,
    voucherXtra,
    infrastructure,
    serviceBundle,
    payment,
    affiliateCommission,
    nttdDisplay,
    platformFeesTotal,
    vatGtgt: vat,
    pitTncn: pit,
    taxTotal,
    sellerIncome,
    usedDomCommission: data.domCommission != null,
    usedDomPayment: data.domPayment != null,
    usedDomPiShip: data.domPiShip != null,
    usedDomAffiliate: data.domAffiliateCommission != null,
    hasNttdRow: !!data.hasNttdRow,
    usedDomNttd: data.domNttdDisplay != null,
  };
}

/** Dòng phí lấy trực tiếp từ đơn Shopee (không tính % extension). */
export function isSettlementRowFromDom(role, calc) {
  switch (role) {
    case "commission":
      return !!calc.usedDomCommission;
    case "payment":
      return !!calc.usedDomPayment;
    case "piShip":
      return !!calc.usedDomPiShip;
    case "affiliateCommission":
      return !!calc.usedDomAffiliate;
    case "nttdDisplayFee":
      return !!calc.usedDomNttd;
    default:
      return false;
  }
}

/** Kết quả âm cho UI đối soát đơn */
export function computeExtensionSettlement(data, feeConfig) {
  const s = computeSellerSettlement(data, feeConfig);
  return {
    ...data,
    productTotal: s.productTotal,
    netProductBase: s.netProductBase,
    shopProductAdjustment: s.shopProductAdjustment,
    productBase: s.productBase,
    paymentBase: s.paymentBase,
    rateSum: s.rateSum,
    usedDomCommission: s.usedDomCommission,
    usedDomPayment: s.usedDomPayment,
    usedDomPiShip: s.usedDomPiShip,
    usedDomAffiliate: s.usedDomAffiliate,
    hasNttdRow: s.hasNttdRow,
    usedDomNttd: s.usedDomNttd,
    commission: -s.commission,
    piShip: -s.piShip,
    serviceBundle: -s.serviceBundle,
    infrastructure: -s.infrastructure,
    voucherXtra: -s.voucherXtra,
    payment: -s.payment,
    affiliateCommission: -s.affiliateCommission,
    nttdDisplay: -s.nttdDisplay,
    platformFeesTotal: -s.platformFeesTotal,
    vatGtgt: -s.vatGtgt,
    pitTncn: -s.pitTncn,
    taxTotal: -s.taxTotal,
    sellerIncome: s.sellerIncome,
  };
}

export function expectedValueForRow(role, calc) {
  switch (role) {
    case "shippingDetail":
    case "taxDetail":
    case "platformFeeDetail":
    case "subtotalOther":
    case "productLine":
    case "shippingEstimateSubtotal":
    case "buyerAddonSubtotal":
    case "other":
      return null;
    case "commission":
      return calc.commission;
    case "piShip":
      return calc.piShip;
    case "serviceBundle":
      return calc.serviceBundle;
    case "payment":
      return calc.payment;
    case "affiliateCommission":
      return calc.affiliateCommission;
    case "nttdDisplayFee":
      return calc.hasNttdRow ? calc.nttdDisplay : null;
    case "platformFeesTotal":
      return calc.platformFeesTotal;
    case "vatGtgt":
      return calc.vatGtgt;
    case "pitTncn":
      return calc.pitTncn;
    case "taxTotal":
      return calc.taxTotal;
    case "sellerShippingBurden":
      return calc.sellerShippingBurden;
    case "productTotal":
      return calc.productTotal > 0 ? calc.productTotal : null;
    case "sellerIncome":
      return calc.sellerIncome;
    default:
      return null;
  }
}

export function rowCheckTitle(role, calc) {
  if (role === "commission" && calc.usedDomCommission) {
    return "Phí cố định — lấy từ đơn Shopee";
  }
  if (role === "piShip" && calc.usedDomPiShip) {
    return `Phí PiShip — lấy từ đơn (${formatSigned(calc.piShip)})`;
  }
  if (role === "payment" && calc.usedDomPayment) {
    return "Phí xử lý GD — lấy từ đơn Shopee";
  }
  if (role === "affiliateCommission" && calc.usedDomAffiliate) {
    return "Hoa hồng Tiếp thị liên kết — lấy từ đơn (seller cài)";
  }
  if (role === "nttdDisplayFee" && calc.hasNttdRow) {
    if (calc.usedDomNttd) return "Phí NTTD — lấy từ đơn Shopee";
    return `Phí NTTD = 1% × tiền hàng (${calc.netProductBase?.toLocaleString("vi-VN") ?? "?"}đ)`;
  }
  if (role === "serviceBundle") {
    const netHint =
      calc.netProductBase != null && calc.netProductBase !== calc.productTotal
        ? ` (VX trên ${calc.netProductBase.toLocaleString("vi-VN")}đ sau trợ giá/shop)`
        : "";
    return `Phí Dịch Vụ = Hạ tầng ${formatSigned(calc.infrastructure)} + Voucher Xtra ${formatSigned(calc.voucherXtra)} (min(đơn giá×5,5%, 50k/SP)×SL từng dòng)${netHint}`;
  }
  if (role === "payment") {
    return `Phí xử lý GD (cơ số ${calc.paymentBase.toLocaleString("vi-VN")}đ)`;
  }
  if (role === "vatGtgt") return "Thuế GTGT × tiền hàng";
  if (role === "pitTncn") return "Thuế TNCN × tiền hàng";
  if (role === "shippingDetail") {
    return "Chi tiết ship/voucher — không vào thu nhập";
  }
  return "";
}

function formatSigned(n) {
  const v = Math.round(n);
  return v < 0
    ? `−₫${Math.abs(v).toLocaleString("vi-VN")}`
    : `₫${v.toLocaleString("vi-VN")}`;
}

export function amountsMatch(shopeeValue, expected, tolerance = 2) {
  if (expected == null) return null;
  return Math.abs(shopeeValue - expected) <= tolerance;
}
