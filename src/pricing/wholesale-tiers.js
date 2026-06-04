import { evaluateOrderProfit, solveMinUnitPrice } from './order-profit.js';
const MAX_TIERS = 5;
export function normalizeTiers(tiers) {
    return tiers
        .filter((t) => t.qtyMin > 0 && t.qtyMax >= t.qtyMin)
        .slice(0, MAX_TIERS);
}
export function evaluateTiers(tiers, costPerUnit, desiredProfitPerUnit, feeConfig) {
    return normalizeTiers(tiers).map((tier, index) => {
        const computed = solveMinUnitPrice(tier.qtyMin, costPerUnit, desiredProfitPerUnit, feeConfig) ?? 0;
        const profitAtMin = computed > 0
            ? evaluateOrderProfit({
                quantity: tier.qtyMin,
                unitPrice: computed,
                costPerUnit,
                feeConfig,
            }).profitPerUnit
            : 0;
        const profitAtMax = computed > 0
            ? evaluateOrderProfit({
                quantity: tier.qtyMax,
                unitPrice: computed,
                costPerUnit,
                feeConfig,
            }).profitPerUnit
            : 0;
        return {
            tierIndex: index + 1,
            qtyMin: tier.qtyMin,
            qtyMax: tier.qtyMax,
            computedUnitPrice: computed,
            profitPerUnitAtMin: Math.round(profitAtMin),
            profitPerUnitAtMax: Math.round(profitAtMax),
            meetsTarget: computed > 0 && profitAtMin >= desiredProfitPerUnit,
        };
    });
}
export function emptyTiers() {
    return Array.from({ length: MAX_TIERS }, () => ({
        qtyMin: 0,
        qtyMax: 0,
        unitPrice: 0,
    }));
}
