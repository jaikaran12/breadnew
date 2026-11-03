import type { DiscountRule } from '../billMath';
import { IconBook, IconCash, IconPhone, IconReturn } from '../icons';
import { amount, rupees } from '../money';
import { billTotals, t } from '../store';
import type { BillLine, PaymentMode, ReturnLine } from '../types';

export const PAYMENT_ICON: Record<PaymentMode, typeof IconCash> = { cash: IconCash, upi: IconPhone, credit: IconBook };

export function paymentLabel(mode: PaymentMode): string {
  return mode === 'cash' ? t('cash') : mode === 'upi' ? t('upi') : t('creditLong');
}

/** "5% off" / "₹2 off each" in the driver's language. */
export function discountText(rule: DiscountRule): string {
  return rule.kind === 'percent' ? t('pctOff', { n: String(rule.value / 100) }) : t('amtOff', { amount: rupees(rule.value) });
}

/**
 * True if the returns of a bill were valued and taken off its total. Bills made by older app versions
 * swapped expired items free of charge, so nothing was taken off.
 */
export function returnsCounted(returns: ReturnLine[]): boolean {
  return returns.some((r) => (r.creditPaise ?? 0) > 0);
}

/** "Net amount ₹95" or, below zero, "Give back to shop ₹89". */
export function netLabel(totalPaise: number): { label: string; amount: string } {
  return totalPaise < 0
    ? { label: t('giveBack'), amount: rupees(-totalPaise) }
    : { label: t('netAmount'), amount: rupees(totalPaise) };
}

export function PaymentTag(props: { mode: PaymentMode }) {
  const Icon = PAYMENT_ICON[props.mode];
  return (
    <span className={`pay-tag pay-${props.mode}`}>
      <Icon size={16} /> {paymentLabel(props.mode)}
    </span>
  );
}

/** Expired items swapped free of charge, under a bill made by an older app version. */
export function ReturnsList(props: { returns: ReturnLine[]; struck?: boolean }) {
  if (props.returns.length === 0) return null;
  const total = props.returns.reduce((acc, r) => acc + r.quantity, 0);
  return (
    <div className={`returns-box ${props.struck ? 'bill-struck' : ''}`} data-testid="bill-returns">
      <div className="returns-head">
        <IconReturn size={20} /> {t('returnsTitle')}
        <span className="returns-free">{t('noCharge')}</span>
      </div>
      <ul className="returns-list">
        {props.returns.map((r) => (
          <li key={r.productId}>
            <span>{r.name}</span>
            <strong>{r.quantity}</strong>
          </li>
        ))}
      </ul>
      <div className="returns-total">{t('returnedPcs', { n: total })}</div>
    </div>
  );
}

/**
 * The bill: what was given (with discounts), the expired items taken back, and the net amount
 * (given − returned) the shop pays.
 */
export function BillTable(props: { lines: BillLine[]; totalPaise: number; quantity: number; returns?: ReturnLine[]; struck?: boolean }) {
  const returns = props.returns ?? [];
  const totals = billTotals(props.lines, returns);
  const counted = returnsCounted(returns);
  const net = netLabel(props.totalPaise);
  const netPieces = props.quantity - totals.returnedQuantity;
  return (
    <>
      <div className={`bill ${props.struck ? 'bill-struck' : ''}`}>
        <table className="bill-table">
          <thead>
            <tr>
              <th>{t('item')}</th>
              <th className="num">{t('qty')}</th>
              <th className="num">{t('rate')}</th>
              <th className="num">{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="bill-nothing">
                  {t('nothingSold')}
                </td>
              </tr>
            ) : (
              props.lines.map((l) => <BillRows key={l.productId} line={l} />)
            )}
          </tbody>
          {counted && (
            <tbody data-testid="bill-returns">
              <tr className="bill-section-row">
                <td colSpan={4}>
                  <IconReturn size={18} /> {t('returnsTitle')}
                </td>
              </tr>
              {returns.map((r) => (
                <ReturnRow key={r.productId} line={r} />
              ))}
            </tbody>
          )}
        </table>
        {totals.discountPaise > 0 && (
          <div className="bill-discount" data-testid="bill-discount">
            <span>{t('discount')}</span>
            <strong>−{rupees(totals.discountPaise)}</strong>
          </div>
        )}
        {counted ? (
          <>
            <div className="bill-sums">
              <div className="bill-sum" data-testid="bill-given">
                <span>
                  {t('given')} <small>({props.quantity} {t('pcs')})</small>
                </span>
                <strong>{rupees(totals.givenPaise)}</strong>
              </div>
              <div className="bill-sum bill-sum-return" data-testid="bill-returned">
                <span>
                  {t('returnedLabel')} <small>({totals.returnedQuantity} {t('pcs')})</small>
                </span>
                <strong>−{rupees(totals.returnedPaise)}</strong>
              </div>
            </div>
            <div className={`bill-total ${props.totalPaise < 0 ? 'bill-total-back' : ''}`}>
              <span>
                {net.label}
                {netPieces >= 0 && (
                  <small>
                    {' '}
                    ({netPieces} {t('pcs')})
                  </small>
                )}
              </span>
              <strong data-testid="bill-net">{net.amount}</strong>
            </div>
          </>
        ) : (
          <div className="bill-total">
            <span>
              {t('total')} <small>({props.quantity} {t('pcs')})</small>
            </span>
            <strong>{rupees(props.totalPaise)}</strong>
          </div>
        )}
      </div>
      {!counted && <ReturnsList returns={returns} struck={props.struck} />}
    </>
  );
}

function BillRows(props: { line: BillLine }) {
  const l = props.line;
  const gross = l.unitPricePaise * l.quantity;
  const off = l.discountPaise ?? 0;
  return (
    <>
      <tr className={off > 0 ? 'bill-row-has-discount' : ''}>
        <td>{l.name}</td>
        <td className="num strong">{l.quantity}</td>
        <td className="num">{amount(l.unitPricePaise)}</td>
        <td className="num strong">{amount(gross)}</td>
      </tr>
      {off > 0 && l.discount && (
        <tr className="bill-discount-row">
          <td colSpan={3}>{discountText(l.discount)}</td>
          <td className="num">−{amount(off)}</td>
        </tr>
      )}
    </>
  );
}

/** One expired line taken back: its value (after the shop's discount) comes off the bill. */
function ReturnRow(props: { line: ReturnLine }) {
  const r = props.line;
  const credit = r.creditPaise ?? 0;
  return (
    <tr className="bill-row-return">
      <td>
        {r.name}
        {r.discount && (r.discountPaise ?? 0) > 0 && <span className="bill-return-off">{discountText(r.discount)}</span>}
      </td>
      <td className="num strong">{r.quantity}</td>
      <td className="num">{r.unitPricePaise !== undefined ? amount(r.unitPricePaise) : ''}</td>
      <td className="num strong">{credit > 0 ? `−${amount(credit)}` : t('noCharge')}</td>
    </tr>
  );
}
