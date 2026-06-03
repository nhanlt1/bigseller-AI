/** Cấu hình % phí sàn trên netBase (sau voucher shop) + phí cố định/đơn */
export interface PlatformFeeConfig {
  commissionRate: number;
  paymentFeeRate: number;
  voucherXtraRate: number;
  useVoucherXtra: boolean;
  infrastructureFeePerOrder: number;
  piShipFeePerOrder: number;
  usePiShip: boolean;
}

export const DEFAULT_SHOPEE_FEE_CONFIG: PlatformFeeConfig = {
  commissionRate: 0.13,
  paymentFeeRate: 0.06,
  voucherXtraRate: 0.055,
  useVoucherXtra: true,
  infrastructureFeePerOrder: 3000,
  piShipFeePerOrder: 2700,
  usePiShip: false,
};

export function getRateSum(config: PlatformFeeConfig): number {
  let sum = config.commissionRate + config.paymentFeeRate;
  if (config.useVoucherXtra) sum += config.voucherXtraRate;
  return sum;
}

export function getFixedFeesPerOrder(config: PlatformFeeConfig): number {
  let fixed = config.infrastructureFeePerOrder;
  if (config.usePiShip) fixed += config.piShipFeePerOrder;
  return fixed;
}
