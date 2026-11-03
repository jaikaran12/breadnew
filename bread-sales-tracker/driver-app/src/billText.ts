import { discountText, netLabel, paymentLabel, returnsCounted } from './components/Bill';
import { dateText, timeText } from './dates';
import { rupees } from './money';
import { billTotals, getState, t, timezone } from './store';
import type { BillView } from './types';

const RULE = '------------------------------';

/** Plain-text bill for WhatsApp. */
export function billText(bill: BillView): string {
  const s = getState();
  const head = s.catalog?.businessName ?? t('appName');
  const totals = billTotals(bill.items, bill.returns);
  const counted = returnsCounted(bill.returns);
  const paid = bill.totalPaise !== 0 ? `  (${paymentLabel(bill.paymentMode)})` : '';
  const lines = [
    `*${head}*`,
    `${bill.id ? t('billNo', { n: bill.id }) : t('billsFor')} · ${dateText(bill.saleDate, s.lang)} ${timeText(bill.soldAt, timezone())}`,
    `${bill.storeName}`,
    RULE,
    ...bill.items.map((i) => {
      const gross = `${i.name}\n   ${i.quantity} × ${rupees(i.unitPricePaise)} = ${rupees(i.unitPricePaise * i.quantity)}`;
      return i.discount && i.discountPaise ? `${gross}\n   ${discountText(i.discount)} −${rupees(i.discountPaise)}` : gross;
    }),
    ...(bill.items.length === 0 ? [t('nothingSold')] : []),
    RULE,
  ];
  if (totals.discountPaise > 0) lines.push(`${t('discount')}: −${rupees(totals.discountPaise)}`);
  if (counted) {
    // What was given, the expired items taken back, and the difference.
    lines.push(
      `${t('given')} (${totals.quantity} ${t('pcs')}): ${rupees(totals.givenPaise)}`,
      '',
      `*${t('returnsTitle')}*`,
      ...bill.returns.map((r) => {
        const credit = r.creditPaise ?? 0;
        const rate = r.unitPricePaise !== undefined ? ` × ${rupees(r.unitPricePaise)}` : '';
        const off = r.discount && r.discountPaise ? ` (${discountText(r.discount)})` : '';
        return `${r.name}\n   ${r.quantity}${rate}${off} = ${credit > 0 ? `−${rupees(credit)}` : t('noCharge')}`;
      }),
      `${t('returnedLabel')} (${totals.returnedQuantity} ${t('pcs')}): −${rupees(totals.returnedPaise)}`,
      RULE,
    );
    const net = netLabel(bill.totalPaise);
    lines.push(`*${net.label}: ${net.amount}*${paid}`);
  } else {
    lines.push(`*${t('total')}: ${rupees(bill.totalPaise)}*${paid}`);
    if (bill.returns.length > 0) {
      lines.push('', `*${t('returnsTitle')}* (${t('noCharge')})`, ...bill.returns.map((r) => `${r.name} × ${r.quantity}`));
    }
  }
  if (bill.state === 'cancelled') lines.push(`*${t('cancelled').toUpperCase()}*`);
  const footer = s.catalog?.billFooter;
  if (footer) lines.push('', footer);
  if (s.catalog?.businessPhone) lines.push(s.catalog.businessPhone);
  return lines.join('\n');
}
