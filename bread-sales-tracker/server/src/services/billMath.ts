/**
 * Bill arithmetic. The same file is in server/src/services/billMath.ts and driver-app/src/billMath.ts:
 * both sides must give the same answer to the paisa, so keep the two files identical (a server test checks).
 */

/** A shop's discount on one product: percent (in hundredths of a percent: 250 = 2.5%) or paise off each unit. */
export interface DiscountRule {
  kind: 'percent' | 'amount';
  value: number;
}

/** Largest amount (paise) of one bill line, so the percent calculation below stays exact. */
export const MAX_LINE_PAISE = 1_000_000_000;

/**
 * Discount (paise) on one bill line. Percent: of the line amount, rounded to the nearest paisa (half up).
 * Amount: that many paise off each unit, never more than the unit price.
 */
export function lineDiscount(rule: DiscountRule | null | undefined, unitPricePaise: number, quantity: number): number {
  if (!rule || quantity <= 0 || unitPricePaise <= 0 || rule.value <= 0) return 0;
  if (rule.kind === 'percent') {
    const basisPoints = Math.min(rule.value, 10000);
    return Math.floor((unitPricePaise * quantity * basisPoints + 5000) / 10000);
  }
  return Math.min(rule.value, unitPricePaise) * quantity;
}

/** What the shop pays for one line. */
export function lineTotal(rule: DiscountRule | null | undefined, unitPricePaise: number, quantity: number): number {
  return unitPricePaise * quantity - lineDiscount(rule, unitPricePaise, quantity);
}

export function sameRule(a: DiscountRule | null | undefined, b: DiscountRule | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && a.value === b.value;
}

/** "5%", "2.5%", "₹2 off each" style label (English; the apps translate their own). */
export function ruleLabel(rule: DiscountRule): string {
  if (rule.kind === 'percent') return `${(rule.value / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const rupees = rule.value % 100 === 0 ? String(rule.value / 100) : (rule.value / 100).toFixed(2);
  return `₹${rupees} off each`;
}
