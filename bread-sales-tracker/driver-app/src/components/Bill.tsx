import { IconBook, IconCash, IconPhone } from '../icons';
import { amount, rupees } from '../money';
import { t } from '../store';
import type { BillLine, PaymentMode } from '../types';

export const PAYMENT_ICON: Record<PaymentMode, typeof IconCash> = { cash: IconCash, upi: IconPhone, credit: IconBook };

export function paymentLabel(mode: PaymentMode): string {
  return mode === 'cash' ? t('cash') : mode === 'upi' ? t('upi') : t('creditLong');
}

export function PaymentTag(props: { mode: PaymentMode }) {
  const Icon = PAYMENT_ICON[props.mode];
  return (
    <span className={`pay-tag pay-${props.mode}`}>
      <Icon size={16} /> {paymentLabel(props.mode)}
    </span>
  );
}

export function BillTable(props: { lines: BillLine[]; totalPaise: number; quantity: number; struck?: boolean }) {
  return (
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
          {props.lines.map((l) => (
            <tr key={l.productId}>
              <td>{l.name}</td>
              <td className="num strong">{l.quantity}</td>
              <td className="num">{amount(l.unitPricePaise)}</td>
              <td className="num strong">{amount(l.lineTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bill-total">
        <span>
          {t('total')} <small>({props.quantity} {t('pcs')})</small>
        </span>
        <strong>{rupees(props.totalPaise)}</strong>
      </div>
    </div>
  );
}
