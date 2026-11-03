import type { DiscountRule } from '../billMath';
import { IconBook, IconCash, IconPhone, IconReturn } from '../icons';
import { amount, rupees } from '../money';
import { t } from '../store';
import type { BillLine, PaymentMode, ReturnLine } from '../types';

export const PAYMENT_ICON: Record<PaymentMode, typeof IconCash> = { cash: IconCash, upi: IconPhone, credit: IconBook };

export function paymentLabel(mode: PaymentMode): string {
  return mode === 'cash' ? t('cash') : mode === 'upi' ? t('upi') : t('creditLong');
}

/** "5% off" / "₹2 off each" in the driver's language. */
export function discountText(rule: DiscountRule): string {
  return rule.kind === 'percent' ? t('pctOff', { n: String(rule.value / 100) }) : t('amtOff', { amount: rupees(rule.value) });
}

export function PaymentTag(props: { mode: PaymentMode }) {
  const Icon = PAYMENT_ICON[props.mode];
  return (
    <span className={`pay-tag pay-${props.mode}`}>
      <Icon size={16} /> {paymentLabel(props.mode)}
    </span>
  );
}

/** Expired items taken back and replaced (no money), shown under a bill. */
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

export function BillTable(props: { lines: BillLine[]; totalPaise: number; quantity: number; returns?: ReturnLine[]; struck?: boolean }) {
  const discountPaise = props.lines.reduce((acc, l) => acc + (l.discountPaise ?? 0), 0);
  return (
    <>
      <div className={`bill ${props.struck ? 'bill-struck' : ''}`}>
        {props.lines.length === 0 ? (
          <div className="bill-nothing">{t('nothingSold')}</div>
        ) : (
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
              {props.lines.map((l) => (
                <BillRows key={l.productId} line={l} />
              ))}
            </tbody>
          </table>
        )}
        {discountPaise > 0 && (
          <div className="bill-discount" data-testid="bill-discount">
            <span>{t('discount')}</span>
            <strong>−{rupees(discountPaise)}</strong>
          </div>
        )}
        <div className="bill-total">
          <span>
            {t('total')} <small>({props.quantity} {t('pcs')})</small>
          </span>
          <strong>{rupees(props.totalPaise)}</strong>
        </div>
      </div>
      {props.returns && <ReturnsList returns={props.returns} struck={props.struck} />}
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
