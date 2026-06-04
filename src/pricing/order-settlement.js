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
 * group[2]: Phí cố định · PiShip (tuỳ đơn) · Phí Dịch Vụ · Phí xử lý GD
 * strong[3] Thuế · group[3] GTGT/TNCN · strong[4] phụ DV người mua · highlighted Doanh thu
 */
export function classifyIncomeRow(label) {
  const l = normalizeLabel(label);
  if (/doanh thu/.test(l)) return "sellerIncome";
  if (/piship|pi\s*ship/.test(l)) return "piShip";
  if (/phi co dinh|hoa hong/.test(l)) return "commission";
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
  if (/van chuyen|phi ship|voucher|tro gia/.test(l)) return "shippingDetail";
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

export function extractIncomeLabel(item) {
  const textEl = item.querySelector(".income-label-text");
  if (textEl?.textContent?.trim()) return textEl.textContent.trim();
  const labelEl = item.querySelector(
    '.income-label, .income-name, [class*="label"]',
  );
  const valueEl = item.querySelector(".income-value");
  const raw = (labelEl?.textContent ?? item.textContent ?? "").trim();
  if (!valueEl) return raw;
  return raw.replace(valueEl.textContent ?? "", "").trim();
}

export function buildSettlementFromRows(rows) {
  const data = {
    productTotal: 0,
    sellerShippingBurden: 0,
    shippingBuyerForPayment: 0,
    quantity: 1,
    domCommission: null,
    domPayment: null,
    domPiShip: null,
  };
  for (const row of rows) {
    const role = resolveRowRole(row);
    const v = row.value;
    if (role === "productTotal" && v > data.productTotal) data.productTotal = v;
    if (role === "sellerShippingBurden") data.sellerShippingBurden = v;
    if (role === "commission" && v !== 0)
      data.domCommission = Math.abs(v);
    if (role === "payment" && v !== 0) data.domPayment = Math.abs(v);
    if (role === "piShip" && v !== 0) data.domPiShip = Math.abs(v);
    if (
      role === "shippingDetail" &&
      v > 0 &&
      data.shippingBuyerForPayment === 0
    )
      data.shippingBuyerForPayment = v;
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
 * Phụ phí = phí cố định (DOM) + PiShip (DOM nếu có) + phí dịch vụ (tính) + phí GD (DOM).
 */
export function computeSellerSettlement(data, feeConfig) {
  const productBase = Math.max(0, data.productTotal);
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
  const voucherXtra = calcVoucherXtraFee(productBase, feeConfig, quantity);
  const infrastructure = feeConfig.infrastructureFeePerOrder;
  const serviceBundle = infrastructure + voucherXtra;
  const payment =
    data.domPayment != null
      ? Math.round(data.domPayment)
      : Math.round(paymentBase * feeConfig.paymentFeeRate);
  const platformFeesTotal = commission + piShip + serviceBundle + payment;
  const vat = Math.round(productBase * (feeConfig.vatRate ?? 0));
  const pit = Math.round(productBase * (feeConfig.pitRate ?? 0));
  const taxTotal = vat + pit;
  const sellerIncome =
    data.productTotal + sellerShippingBurden - platformFeesTotal - taxTotal;
  return {
    productTotal: data.productTotal,
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
    platformFeesTotal,
    vatGtgt: vat,
    pitTncn: pit,
    taxTotal,
    sellerIncome,
    usedDomCommission: data.domCommission != null,
    usedDomPayment: data.domPayment != null,
    usedDomPiShip: data.domPiShip != null,
  };
}

/** Kết quả âm cho UI đối soát đơn */
export function computeExtensionSettlement(data, feeConfig) {
  const s = computeSellerSettlement(data, feeConfig);
  return {
    ...data,
    productBase: s.productBase,
    paymentBase: s.paymentBase,
    rateSum: s.rateSum,
    usedDomCommission: s.usedDomCommission,
    usedDomPayment: s.usedDomPayment,
    usedDomPiShip: s.usedDomPiShip,
    commission: -s.commission,
    piShip: -s.piShip,
    serviceBundle: -s.serviceBundle,
    infrastructure: -s.infrastructure,
    voucherXtra: -s.voucherXtra,
    payment: -s.payment,
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
  if (role === "serviceBundle") {
    return `Phí Dịch Vụ = Hạ tầng ${formatSigned(calc.infrastructure)} + Voucher Xtra ${formatSigned(calc.voucherXtra)}`;
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
