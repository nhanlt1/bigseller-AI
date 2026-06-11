export const DEFAULT_SHOPEE_FEE_CONFIG = {
    commissionRate: 0.13,
    /** Phí xử lý GD — Shopee thường tính trên (tiền hàng + phí ship khách trên đơn) */
    paymentFeeRate: 0.06,
    /** Voucher Xtra: % giá trị SP/đơn, tối đa 50.000đ/SP (từ 23/05/2026: 5,5%) */
    voucherXtraRate: 0.055,
    voucherXtraCapPerUnit: 50_000,
    useVoucherXtra: true,
    infrastructureFeePerOrder: 3000,
    piShipFeePerOrder: 2700,
    usePiShip: false,
    /** Thuế trên tiền hàng (khớp dòng Thuế GTGT / TNCN trên đơn) */
    vatRate: 0.01,
    pitRate: 0.005,
    /** Phí NTTD — 1% tiền hàng (popup $ / tính giá); đối soát đơn chỉ khi có dòng trên đơn */
    nttdDisplayRate: 0.01,
    useNttdInPricing: true,
};
/** Phí Voucher Xtra cho một đơn vị SP: % × đơn giá, tối đa cap/SP. */
export function calcVoucherXtraFeePerUnit(unitPrice, config) {
    if (!config.useVoucherXtra || unitPrice <= 0)
        return 0;
    const fee = Math.round(unitPrice * config.voucherXtraRate);
    return Math.min(fee, config.voucherXtraCapPerUnit);
}

/**
 * Tổng Voucher Xtra = Σ (phí/SP × số lượng) theo từng dòng.
 * Đơn giá/SP = thành tiền dòng ÷ số lượng (không tính trên tổng đơn một lần).
 *
 * @param {number} productBase — fallback khi không có productLines
 * @param {import('./platform-fee-config.js').DEFAULT_SHOPEE_FEE_CONFIG} config
 * @param {number} [quantity=1]
 * @param {{ subtotal?: number, quantity?: number, unitPrice?: number }[]} [productLines]
 */
export function calcVoucherXtraFee(productBase, config, quantity = 1, productLines = null) {
    if (!config.useVoucherXtra)
        return 0;
    if (Array.isArray(productLines) && productLines.length > 0) {
        let total = 0;
        for (const line of productLines) {
            const q = Math.max(1, Math.floor(line.quantity ?? 1));
            const unit =
                line.unitPrice > 0
                    ? line.unitPrice
                    : (line.subtotal ?? 0) / q;
            if (unit <= 0)
                continue;
            total += calcVoucherXtraFeePerUnit(unit, config) * q;
        }
        return total;
    }
    if (productBase <= 0)
        return 0;
    const q = Math.max(1, Math.floor(quantity));
    const unitPrice = productBase / q;
    return calcVoucherXtraFeePerUnit(unitPrice, config) * q;
}
export function getRateSum(config) {
    let sum = config.commissionRate + config.paymentFeeRate;
    if (config.useVoucherXtra)
        sum += config.voucherXtraRate;
    if (config.useNttdInPricing !== false)
        sum += config.nttdDisplayRate ?? 0.01;
    return sum;
}
export function getFixedFeesPerOrder(config) {
    let fixed = config.infrastructureFeePerOrder;
    if (config.usePiShip)
        fixed += config.piShipFeePerOrder;
    return fixed;
}
