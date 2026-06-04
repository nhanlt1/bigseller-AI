export const DEFAULT_SHOPEE_FEE_CONFIG = {
    commissionRate: 0.13,
    paymentFeeRate: 0.06,
    voucherXtraRate: 0.055,
    useVoucherXtra: true,
    infrastructureFeePerOrder: 3000,
    piShipFeePerOrder: 2700,
    usePiShip: false,
};
export function getRateSum(config) {
    let sum = config.commissionRate + config.paymentFeeRate;
    if (config.useVoucherXtra)
        sum += config.voucherXtraRate;
    return sum;
}
export function getFixedFeesPerOrder(config) {
    let fixed = config.infrastructureFeePerOrder;
    if (config.usePiShip)
        fixed += config.piShipFeePerOrder;
    return fixed;
}
