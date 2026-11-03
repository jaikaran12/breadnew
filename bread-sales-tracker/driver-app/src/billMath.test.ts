import { describe, expect, it } from 'vitest';
import { lineDiscount, lineTotal } from './billMath';

// The same table of cases is in server/test/discounts-returns.test.ts: phone and server must agree to the paisa.
const CASES: Array<[kind: 'percent' | 'amount' | null, value: number, unit: number, qty: number, discount: number]> = [
  [null, 0, 4000, 10, 0],
  ['percent', 500, 4000, 10, 2000],
  ['percent', 500, 4250, 3, 638],
  ['percent', 250, 4250, 1, 106],
  ['percent', 1000, 4500, 7, 3150],
  ['percent', 10000, 3000, 2, 6000],
  ['percent', 333, 999, 1, 33],
  ['amount', 200, 4000, 10, 2000],
  ['amount', 5000, 4000, 2, 8000],
  ['amount', 150, 0, 5, 0],
  ['percent', 500, 4000, 0, 0],
];

describe('bill arithmetic (same as the server)', () => {
  it('works out discounts exactly to the paisa', () => {
    for (const [kind, value, unit, qty, discount] of CASES) {
      const rule = kind ? { kind, value } : null;
      expect(lineDiscount(rule, unit, qty), `${kind} ${value} ${unit}×${qty}`).toBe(discount);
      expect(lineTotal(rule, unit, qty)).toBe(unit * qty - discount);
    }
  });
});
