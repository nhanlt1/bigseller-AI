import type { PlatformFeeConfig } from '../pricing/platform-fee-config';

export interface ProductData {
  title: string;
  description: string;
}

export interface ProductAdapter {
  canHandle(url: string): boolean;
  extract(): ProductData | null;
  apply(data: ProductData): boolean;
}

export type PanelState = 'idle' | 'busy' | 'done' | 'error';

export interface PricingVariables {
  cost: number;
  profitRate: number;
  shopeeFee: number;
  shippingSubsidy: number;
  voucherRate: number;
  [key: string]: number;
}

export interface WholesaleTierInput {
  qtyMin: number;
  qtyMax: number;
  unitPrice: number;
}

export interface PricingCalculatorState {
  costPerUnit: number;
  desiredProfitPerUnit: number;
  retailUnitPrice: number;
  wholesaleTiers: WholesaleTierInput[];
}

export interface ExtensionSettings {
  promptTemplate: string;
  language: string;
  pricingFormula: string;
  pricingVariables: PricingVariables;
  pricingCalculator: PricingCalculatorState;
  platformFeeConfig: PlatformFeeConfig;
}

export interface OpenGeminiTabResult {
  ok: boolean;
  error?: string;
}

export interface RewriteProductPayload {
  title: string;
  description: string;
  language?: string;
  requestId?: string;
}

export interface RewriteResultPayload {
  requestId: string;
  ok: boolean;
  data?: ProductData;
  error?: string;
}

export interface GeminiSendPromptPayload {
  prompt: string;
  requestId: string;
  title?: string;
  description?: string;
}

export interface GeminiResponsePayload {
  requestId: string;
  text: string;
  error?: string;
  responseHash?: string;
  baselineHash?: string;
}

export interface ChatGPTFillPromptPayload {
  prompt: string;
}

export interface OpenChatGPTImageResult {
  ok: boolean;
  error?: string;
}
