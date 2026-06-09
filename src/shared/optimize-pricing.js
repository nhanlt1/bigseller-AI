import { formatVnd } from '../pricing/formula-engine.js';
import {
    buildPricingOrderInput,
    evaluateOrderProfit,
    pricingOrderOptsFromCalc,
    solveMinUnitPrice,
} from '../pricing/order-profit.js';
import { getSettings } from './storage.js';

/**
 * Lợi nhuận/sp mục tiêu cho pipeline tối ưu — luôn theo chế độ lợi nhuận popup $,
 * không dùng «giá muốn nhận về» (không xét giá vốn).
 * @param {import('./storage.js').AppSettings['pricingCalculator']} calc
 */
export function resolveOptimizeProfitTarget(calc) {
    if (calc?.useProfitTarget === false)
        return 0;
    return Math.max(0, calc?.desiredProfitPerUnit ?? 0);
}

/**
 * Tính giá bán sàn tối thiểu: giá bán − phí sàn = giá vốn (+ lợi nhuận mục tiêu/sp nếu có).
 * @param {number} costPerUnit
 * @param {import('./storage.js').AppSettings} [settings]
 */
export async function computeMinSellPrice(costPerUnit, settings) {
    const cost = Number(costPerUnit);
    if (!Number.isFinite(cost) || cost <= 0)
        return { minSellPrice: null, profitTargetPerUnit: 0 };
    const s = settings ?? (await getSettings());
    const calc = s.pricingCalculator ?? {};
    const feeConfig = s.platformFeeConfig ?? {};
    const profitTargetPerUnit = resolveOptimizeProfitTarget(calc);
    const orderOpts = pricingOrderOptsFromCalc(feeConfig, calc);
    const minSellPrice = solveMinUnitPrice(1, cost, profitTargetPerUnit, feeConfig, orderOpts);
    return {
        minSellPrice: minSellPrice ?? null,
        profitTargetPerUnit,
    };
}

/**
 * @param {number} minSellPrice
 * @param {number} costPerUnit
 * @param {number} profitTargetPerUnit
 */
const COMBO_QTY = [5, 10];

function roundRetailPrice(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v <= 0)
        return null;
    if (v >= 10_000)
        return Math.round(v / 100) * 100;
    return v;
}

/**
 * Giá /sp combo 5 & 10 từ giá đề xuất cạnh tranh (lẻ).
 * Có giá vốn: giữ cùng lợi nhuận/sp như khi bán lẻ ở giá đề xuất.
 * Không vốn: giảm nhẹ % so với giá lẻ (gợi ý tham khảo).
 * @param {{
 *   suggestedPrice: number,
 *   costPerUnit?: number | null,
 *   feeConfig?: Record<string, unknown>,
 *   pricingCalculator?: Record<string, unknown>,
 * }} input
 * @returns {{ combo5: number | null, combo10: number | null, derivedWithoutCost: boolean }}
 */
export function computeComboUnitPrices(input) {
    const suggested = Number(input.suggestedPrice);
    if (!Number.isFinite(suggested) || suggested <= 0)
        return { combo5: null, combo10: null, derivedWithoutCost: false };
    const cost = Number(input.costPerUnit);
    const feeConfig = input.feeConfig ?? {};
    const calc = input.pricingCalculator ?? {};
    const orderOpts = pricingOrderOptsFromCalc(feeConfig, calc);
    if (!Number.isFinite(cost) || cost <= 0) {
        return {
            combo5: roundRetailPrice(suggested * 0.97),
            combo10: roundRetailPrice(suggested * 0.95),
            derivedWithoutCost: true,
        };
    }
    const retailEv = evaluateOrderProfit(buildPricingOrderInput({
        quantity: 1,
        unitPrice: suggested,
        costPerUnit: cost,
        feeConfig,
        pricingCalculator: calc,
    }));
    const targetProfit = Math.round(retailEv.profitPerUnit);
    const combo5 = solveMinUnitPrice(COMBO_QTY[0], cost, targetProfit, feeConfig, orderOpts);
    const combo10 = solveMinUnitPrice(COMBO_QTY[1], cost, targetProfit, feeConfig, orderOpts);
    return {
        combo5: combo5 != null ? roundRetailPrice(combo5) : null,
        combo10: combo10 != null ? roundRetailPrice(combo10) : null,
        derivedWithoutCost: false,
    };
}

export function formatMinSellPricePreview(minSellPrice, costPerUnit, profitTargetPerUnit) {
    const price = formatVnd(minSellPrice);
    if (profitTargetPerUnit > 0) {
        return `Giá bán sàn tối thiểu: <strong>${price}</strong><br>`
            + `<span class="preview-note">Giá bán − phí sàn = vốn ${formatVnd(costPerUnit)} + lợi nhuận mục tiêu ${formatVnd(profitTargetPerUnit)}/sp</span>`;
    }
    return `Giá bán sàn tối thiểu: <strong>${price}</strong><br>`
        + `<span class="preview-note">Giá bán trừ phí sàn = giá vốn (${formatVnd(costPerUnit)})</span>`;
}
