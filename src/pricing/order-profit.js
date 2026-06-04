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

/**
 * Giá bán/sp tối thiểu để đạt lợi nhuận mong muốn (công thức ngược từ đối soát).
 */
export function solveMinUnitPrice(quantity, costPerUnit, desiredProfitPerUnit, feeConfig, orderOpts = {}) {
    const q = Math.max(1, Math.floor(quantity));
    const opts = {
        shippingBuyerForPayment: orderOpts.shippingBuyerForPayment ?? 0,
        sellerShippingBurden: orderOpts.sellerShippingBurden ?? 0,
    };
    if (profitPerUnitAtPrice(1, q, costPerUnit, feeConfig, opts) >= desiredProfitPerUnit)
        return 1;
    let lo = 1;
    let hi = Math.max(100_000, (costPerUnit + desiredProfitPerUnit) * 4);
    while (profitPerUnitAtPrice(hi, q, costPerUnit, feeConfig, opts) < desiredProfitPerUnit) {
        hi *= 2;
        if (hi > 50_000_000)
            return null;
    }
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (profitPerUnitAtPrice(mid, q, costPerUnit, feeConfig, opts) >= desiredProfitPerUnit)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}
