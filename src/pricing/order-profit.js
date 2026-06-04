import { computeSellerSettlement } from './order-settlement.js';

export function pricingOrderOptions(input) {
    return {
        shippingBuyerForPayment: input.shippingBuyerForPayment ?? 0,
        sellerShippingBurden: input.sellerShippingBurden ?? 0,
    };
}

/** Lợi nhuận/sp sau cùng công thức đối soát đơn Shopee */
export function evaluateOrderProfit(input) {
    const q = Math.max(1, Math.floor(input.quantity));
    const p = Math.max(0, input.unitPrice);
    const productTotal = p * q;
    const opts = pricingOrderOptions(input);
    const settlement = computeSellerSettlement({
        productTotal,
        quantity: q,
        ...opts,
    }, input.feeConfig);
    const totalProfit = settlement.sellerIncome - input.costPerUnit * q;
    return {
        orderGross: productTotal,
        sellerIncome: settlement.sellerIncome,
        platformFees: settlement.platformFeesTotal,
        taxTotal: settlement.taxTotal,
        totalProfit,
        profitPerUnit: totalProfit / q,
        settlement,
    };
}

function profitPerUnitAtPrice(unitPrice, quantity, costPerUnit, feeConfig, orderOpts) {
    if (unitPrice <= 0)
        return -Infinity;
    return evaluateOrderProfit({
        quantity,
        unitPrice,
        costPerUnit,
        feeConfig,
        ...orderOpts,
    }).profitPerUnit;
}

function sellerIncomePerUnitAtPrice(unitPrice, quantity, feeConfig, orderOpts) {
    if (unitPrice <= 0)
        return -Infinity;
    const q = Math.max(1, Math.floor(quantity));
    return evaluateOrderProfit({
        quantity: q,
        unitPrice,
        costPerUnit: 0,
        feeConfig,
        ...orderOpts,
    }).sellerIncome / q;
}

function binarySearchMinPrice(quantity, meetsAtPrice, seedHi) {
    const q = Math.max(1, Math.floor(quantity));
    if (meetsAtPrice(1))
        return 1;
    let lo = 1;
    let hi = seedHi;
    while (!meetsAtPrice(hi)) {
        hi *= 2;
        if (hi > 50_000_000)
            return null;
    }
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (meetsAtPrice(mid))
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}

/** @typedef {{ kind: 'profit', perUnit: number } | { kind: 'netReceive', perUnit: number }} PricingTarget */

export function resolvePricingTarget(calc) {
    if (calc?.useProfitTarget)
        return { kind: 'profit', perUnit: calc.desiredProfitPerUnit ?? 0 };
    if ((calc?.desiredNetReceivePerUnit ?? 0) > 0)
        return { kind: 'netReceive', perUnit: calc.desiredNetReceivePerUnit };
    return null;
}

/**
 * Giá bán/sp tối thiểu để đạt lợi nhuận mong muốn (công thức ngược từ đối soát).
 */
export function solveMinUnitPrice(quantity, costPerUnit, desiredProfitPerUnit, feeConfig, orderOpts = {}) {
    const q = Math.max(1, Math.floor(quantity));
    const opts = pricingOrderOptions(orderOpts);
    const meets = (p) => profitPerUnitAtPrice(p, q, costPerUnit, feeConfig, opts) >= desiredProfitPerUnit;
    return binarySearchMinPrice(q, meets, Math.max(100_000, (costPerUnit + desiredProfitPerUnit) * 4));
}

/** Giá bán/sp tối thiểu để thu nhập sau phí sàn ≥ mức muốn nhận về/sp (chưa trừ vốn). */
export function solveMinUnitPriceForNetReceive(quantity, desiredNetReceivePerUnit, feeConfig, orderOpts = {}) {
    const q = Math.max(1, Math.floor(quantity));
    const opts = pricingOrderOptions(orderOpts);
    const meets = (p) => sellerIncomePerUnitAtPrice(p, q, feeConfig, opts) >= desiredNetReceivePerUnit;
    return binarySearchMinPrice(q, meets, Math.max(100_000, desiredNetReceivePerUnit * 4));
}

export function solveMinUnitPriceByTarget(quantity, costPerUnit, target, feeConfig, orderOpts = {}) {
    if (!target)
        return null;
    if (target.kind === 'profit')
        return solveMinUnitPrice(quantity, costPerUnit, target.perUnit, feeConfig, orderOpts);
    return solveMinUnitPriceForNetReceive(quantity, target.perUnit, feeConfig, orderOpts);
}
