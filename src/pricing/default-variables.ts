import type { PricingVariables } from '../shared/types';

export const DEFAULT_PRICING_VARIABLES: PricingVariables = {
  cost: 50000,
  profitRate: 0.25,
  shopeeFee: 0.05,
  shippingSubsidy: 15000,
  voucherRate: 0.02,
};

export const PRICING_VARIABLE_LABELS: Record<string, string> = {
  cost: 'Giá vốn (VND)',
  profitRate: 'Tỷ lệ lợi nhuận (0–1)',
  shopeeFee: 'Phí Shopee (0–1)',
  shippingSubsidy: 'Trợ giá ship (VND)',
  voucherRate: 'Tỷ lệ voucher (0–1)',
};
