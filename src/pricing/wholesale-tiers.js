import {
    buildPricingOrderInput,
    evaluateOrderProfit,
    resolvePricingTarget,
    solveMinUnitPriceByTarget,
} from './order-profit.js';
const MAX_TIERS = 5;
export function normalizeTiers(tiers) {
    return tiers
        .filter((t) => t.qtyMin > 0 && t.qtyMax >= t.qtyMin)
        .slice(0, MAX_TIERS);
}
export function evaluateTiers(tiers, costPerUnit, calc, feeConfig, orderOpts = {}) {
    const target = resolvePricingTarget(calc);
    return normalizeTiers(tiers).map((tier, index) => {
        const computed = target
            ? solveMinUnitPriceByTarget(tier.qtyMin, costPerUnit, target, feeConfig, orderOpts) ?? 0
            : 0;
        const profitInput = (qty) =>
            buildPricingOrderInput({
                quantity: qty,
                unitPrice: computed,
                costPerUnit,
                feeConfig,
                pricingCalculator: calc,
            });
        const profitAtMin = computed > 0
            ? evaluateOrderProfit(profitInput(tier.qtyMin)).profitPerUnit
            : 0;
        const profitAtMax = computed > 0
            ? evaluateOrderProfit(profitInput(tier.qtyMax)).profitPerUnit
            : 0;
        const incomeAtMin = computed > 0
            ? evaluateOrderProfit(profitInput(tier.qtyMin)).sellerIncome / tier.qtyMin
            : 0;
        const meetsTarget = computed > 0 &&
            (target?.kind === 'netReceive'
                ? incomeAtMin >= (target.perUnit ?? 0)
                : profitAtMin >= (target?.perUnit ?? 0));
        return {
            tierIndex: index + 1,
            qtyMin: tier.qtyMin,
            qtyMax: tier.qtyMax,
            computedUnitPrice: computed,
            profitPerUnitAtMin: Math.round(profitAtMin),
            profitPerUnitAtMax: Math.round(profitAtMax),
            netReceivePerUnitAtMin: Math.round(incomeAtMin),
            meetsTarget,
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
