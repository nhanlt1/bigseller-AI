import type { PlatformFeeConfig } from './platform-fee-config';
import { getFixedFeesPerOrder, getRateSum } from './platform-fee-config';

export interface OrderProfitInput {
  quantity: number;
  unitPrice: number;
  costPerUnit: number;
  shopVoucherTotal?: number;
  feeConfig: PlatformFeeConfig;
}

export interface OrderProfitResult {
  orderGross: number;
  netBase: number;
  platformFees: number;
  revenue: number;
  totalProfit: number;
  profitPerUnit: number;
}

export function evaluateOrderProfit(input: OrderProfitInput): OrderProfitResult {
  const q = Math.max(1, Math.floor(input.quantity));
  const p = Math.max(0, input.unitPrice);
  const shopVoucher = Math.max(0, input.shopVoucherTotal ?? 0);
  const orderGross = p * q;
  const netBase = Math.max(0, orderGross - shopVoucher);
  const rateSum = getRateSum(input.feeConfig);
  const fixed = getFixedFeesPerOrder(input.feeConfig);
  const platformFees = Math.round(netBase * rateSum + fixed);
  const revenue = orderGross - platformFees;
  const totalProfit = revenue - input.costPerUnit * q;
  const profitPerUnit = totalProfit / q;

  return {
    orderGross,
    netBase,
    platformFees,
    revenue,
    totalProfit,
    profitPerUnit,
  };
}

/** Đơn giá tối thiểu để đạt desiredProfitPerUnit (không voucher shop) */
export function solveMinUnitPrice(
  quantity: number,
  costPerUnit: number,
  desiredProfitPerUnit: number,
  feeConfig: PlatformFeeConfig,
): number | null {
  const q = Math.max(1, Math.floor(quantity));
  const rateSum = getRateSum(feeConfig);
  if (rateSum >= 1) return null;

  const fixed = getFixedFeesPerOrder(feeConfig);
  const numerator = q * (costPerUnit + desiredProfitPerUnit) + fixed;
  const denominator = q * (1 - rateSum);
  if (denominator <= 0) return null;

  return Math.ceil(numerator / denominator);
}
