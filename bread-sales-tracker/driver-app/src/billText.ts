import { paymentLabel } from './components/Bill';
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
    ...bill.items.map((i) => `${i.name}\n   ${i.quantity} × ${rupees(i.unitPricePaise)} = ${rupees(i.lineTotalPaise)}`),
    '------------------------------',
    `*${t('total')}: ${rupees(bill.totalPaise)}*  (${paymentLabel(bill.paymentMode)})`,
  ];
  if (bill.state === 'cancelled') lines.push(`*${t('cancelled').toUpperCase()}*`);
  const footer = s.catalog?.billFooter;
  if (footer) lines.push('', footer);
  if (s.catalog?.businessPhone) lines.push(s.catalog.businessPhone);
  return lines.join('\n');
}
