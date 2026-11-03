import { discountText, paymentLabel } from './components/Bill';
import { dateText, timeText } from './dates';
import { rupees } from './money';
import { getState, t, timezone } from './store';
import type { BillView } from './types';

/** Plain-text bill for WhatsApp. */
export function billText(bill: BillView): string {
  const s = getState();
  const head = s.catalog?.businessName ?? t('appName');
  const lines = [
    `*${head}*`,
    `${bill.id ? t('billNo', { n: bill.id }) : t('billsFor')} · ${dateText(bill.saleDate, s.lang)} ${timeText(bill.soldAt, timezone())}`,
    `${bill.storeName}`,
    '------------------------------',
    ...bill.items.map((i) => {
      const gross = `${i.name}\n   ${i.quantity} × ${rupees(i.unitPricePaise)} = ${rupees(i.unitPricePaise * i.quantity)}`;
      return i.discount && i.discountPaise ? `${gross}\n   ${discountText(i.discount)} −${rupees(i.discountPaise)}` : gross;
    }),
    ...(bill.items.length === 0 ? [t('nothingSold')] : []),
    '------------------------------',
  ];
  const discount = bill.items.reduce((acc, i) => acc + (i.discountPaise ?? 0), 0);
  if (discount > 0) lines.push(`${t('discount')}: −${rupees(discount)}`);
  lines.push(
    bill.items.length > 0 ? `*${t('total')}: ${rupees(bill.totalPaise)}*  (${paymentLabel(bill.paymentMode)})` : `*${t('total')}: ${rupees(0)}*`,
  );
  if (bill.returns.length > 0) {
    lines.push('', `*${t('returnsTitle')}* (${t('noCharge')})`, ...bill.returns.map((r) => `${r.name} × ${r.quantity}`));
  }
  if (bill.state === 'cancelled') lines.push(`*${t('cancelled').toUpperCase()}*`);
  const footer = s.catalog?.billFooter;
  if (footer) lines.push('', footer);
  if (s.catalog?.businessPhone) lines.push(s.catalog.businessPhone);
  return lines.join('\n');
}
