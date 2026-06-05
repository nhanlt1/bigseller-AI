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
export function calcVoucherXtraFee(productBase, config, quantity = 1) {
    if (!config.useVoucherXtra || productBase <= 0)
        return 0;
    const q = Math.max(1, Math.floor(quantity));
    const perOrder = Math.round(productBase * config.voucherXtraRate);
    const cap = config.voucherXtraCapPerUnit * q;
    return Math.min(perOrder, cap);
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
