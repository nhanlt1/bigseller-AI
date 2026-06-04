import { calcVoucherXtraFee, getRateSum } from './platform-fee-config.js';

/** Parse "₫84.000", "-₫41.000" → số nguyên VND */
export function parseVndText(text) {
    const raw = String(text ?? '').trim();
    const neg = /[-−]/.test(raw);
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits)
        return 0;
    const n = Number.parseInt(digits, 10);
    return neg ? -n : n;
}

function normalizeLabel(label) {
    return String(label ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/\s+/g, ' ');
}

/**
 * Cấu trúc DOM Shopee (đơn mẫu đã đối soát):
 * - group[1]: ship/voucher — không vào thu nhập
 * - strong[1]: seller chịu ship
 * - group[2][0]: phí cố định % (hoa hồng)
 * - group[2][1]: phí dịch vụ = Phí hạ tầng + Voucher Xtra
 * - group[2][2]: phí xử lý GD (trên tiền hàng + ship khách)
 * - strong[2]: tổng Phụ phí
 * - group[3][0]: GTGT 1% tiền hàng
 * - group[3][1]: TNCN 0,5% tiền hàng
 * - strong[3]: tổng Thuế
 */
export function inferIncomeRowRole({ isSubtotal, subtotalIndex, groupIndex, itemIndex, isHighlighted, }) {
    if (isHighlighted)
        return 'sellerIncome';
    if (isSubtotal) {
        if (subtotalIndex === 0)
            return 'productTotal';
        if (subtotalIndex === 1)
            return 'sellerShippingBurden';
        if (subtotalIndex === 2)
            return 'platformFeesTotal';
        if (subtotalIndex === 3)
            return 'taxTotal';
        return 'subtotalOther';
    }
    if (groupIndex === 1)
        return 'shippingDetail';
    if (groupIndex === 2) {
        if (itemIndex === 0)
            return 'commission';
        if (itemIndex === 1)
            return 'serviceBundle';
        if (itemIndex === 2)
            return 'payment';
        return 'platformFeeDetail';
    }
    if (groupIndex === 3) {
        if (itemIndex === 0)
            return 'vatGtgt';
        if (itemIndex === 1)
            return 'pitTncn';
        return 'taxDetail';
    }
    return 'other';
}

export function classifyIncomeRow(label) {
    const l = normalizeLabel(label);
    if (/thu nhap|thuc nhan|tien ve|doanh thu/.test(l))
        return 'sellerIncome';
    if (/phu phi/.test(l))
        return 'platformFeesTotal';
    if (/thue/.test(l) && /tong/.test(l))
        return 'taxTotal';
    if (/gtgt|vat/.test(l))
        return 'vatGtgt';
    if (/tncn|thu nhap ca nhan/.test(l))
        return 'pitTncn';
    if (/phi co dinh(?!.*xu ly)|hoa hong/.test(l))
        return 'commission';
    if (/phi dich vu|ha tang|xtra/.test(l))
        return 'serviceBundle';
    if (/xu ly|thanh toan|giao dich/.test(l))
        return 'payment';
    if (/tong tien hang|gia san pham|thanh tien|tien hang/.test(l))
        return 'productTotal';
    if (/van chuyen|phi ship|voucher/.test(l))
        return 'shippingDetail';
    return 'other';
}

export function resolveRowRole(row) {
    if (row.role)
        return row.role;
    return classifyIncomeRow(row.label);
}

export function buildSettlementFromRows(rows) {
    const data = {
        productTotal: 0,
        sellerShippingBurden: 0,
        /** Chỉ dùng tính phí GD, không cộng vào thu nhập */
        shippingBuyerForPayment: 0,
        quantity: 1,
    };
    for (const row of rows) {
        const role = resolveRowRole(row);
        const v = row.value;
        if (role === 'productTotal' && v > data.productTotal)
            data.productTotal = v;
        if (role === 'sellerShippingBurden')
            data.sellerShippingBurden = v;
        if (role === 'shippingDetail' && v > 0 && data.shippingBuyerForPayment === 0)
            data.shippingBuyerForPayment = v;
    }
    if (!data.productTotal) {
        const first = rows.find((r) => resolveRowRole(r) === 'productTotal' || r.value > 1000);
        if (first)
            data.productTotal = Math.abs(first.value);
    }
    return data;
}

/**
 * Công thức đối soát / tính giá ngược (cùng một nguồn).
 * Thu nhập = tiền hàng + seller chịu ship − Phụ phí − Thuế.
 */
export function computeSellerSettlement(data, feeConfig) {
    const productBase = Math.max(0, data.productTotal);
    const quantity = Math.max(1, Math.floor(data.quantity ?? 1));
    const shippingBuyer = Math.max(0, data.shippingBuyerForPayment ?? 0);
    const sellerShippingBurden = data.sellerShippingBurden ?? 0;
    const paymentBase = productBase + shippingBuyer;
    const commission = Math.round(productBase * feeConfig.commissionRate);
    const voucherXtra = calcVoucherXtraFee(productBase, feeConfig, quantity);
    const infrastructure = feeConfig.infrastructureFeePerOrder;
    const serviceBundle = infrastructure + voucherXtra;
    const payment = Math.round(paymentBase * feeConfig.paymentFeeRate);
    const platformFeesTotal = commission + serviceBundle + payment;
    const vat = Math.round(productBase * (feeConfig.vatRate ?? 0));
    const pit = Math.round(productBase * (feeConfig.pitRate ?? 0));
    const taxTotal = vat + pit;
    const sellerIncome = data.productTotal +
        sellerShippingBurden -
        platformFeesTotal -
        taxTotal;
    return {
        productTotal: data.productTotal,
        quantity,
        shippingBuyerForPayment: shippingBuyer,
        sellerShippingBurden,
        productBase,
        paymentBase,
        rateSum: getRateSum(feeConfig),
        commission,
        voucherXtra,
        infrastructure,
        serviceBundle,
        payment,
        platformFeesTotal,
        vatGtgt: vat,
        pitTncn: pit,
        taxTotal,
        sellerIncome,
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
        commission: -s.commission,
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
        case 'shippingDetail':
        case 'taxDetail':
        case 'platformFeeDetail':
        case 'subtotalOther':
        case 'other':
            return null;
        case 'commission':
            return calc.commission;
        case 'serviceBundle':
            return calc.serviceBundle;
        case 'payment':
            return calc.payment;
        case 'platformFeesTotal':
            return calc.platformFeesTotal;
        case 'vatGtgt':
            return calc.vatGtgt;
        case 'pitTncn':
            return calc.pitTncn;
        case 'taxTotal':
            return calc.taxTotal;
        case 'sellerShippingBurden':
            return calc.sellerShippingBurden;
        case 'productTotal':
            return calc.productTotal > 0 ? calc.productTotal : null;
        case 'sellerIncome':
            return calc.sellerIncome;
        default:
            return null;
    }
}

export function rowCheckTitle(role, calc) {
    if (role === 'serviceBundle') {
        return `Phí dịch vụ = Hạ tầng ${formatSigned(calc.infrastructure)} + Voucher Xtra ${formatSigned(calc.voucherXtra)} (5,5%×tiền hàng, tối đa 50k/SP)`;
    }
    if (role === 'payment') {
        return `Phí xử lý GD trên tiền hàng + phí ship khách (cơ số ${calc.paymentBase.toLocaleString('vi-VN')}đ)`;
    }
    if (role === 'vatGtgt')
        return `GTGT 1% × tiền hàng`;
    if (role === 'pitTncn')
        return `TNCN 0,5% × tiền hàng`;
    return '';
}

function formatSigned(n) {
    const v = Math.round(n);
    return v < 0 ? `−₫${Math.abs(v).toLocaleString('vi-VN')}` : `₫${v.toLocaleString('vi-VN')}`;
}

export function amountsMatch(shopeeValue, expected, tolerance = 2) {
    if (expected == null)
        return null;
    return Math.abs(shopeeValue - expected) <= tolerance;
}
