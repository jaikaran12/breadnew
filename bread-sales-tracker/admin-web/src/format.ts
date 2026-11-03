const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let timeZone = 'Asia/Kolkata';
export function setTimeZone(tz: string) {
  timeZone = tz;
}
export function getTimeZone() {
  return timeZone;
}

export function rupees(paise: number | null | undefined): string {
  const p = Number(paise ?? 0);
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  return `${sign}₹${abs % 100 === 0 ? whole.format(abs / 100) : two.format(abs / 100)}`;
}

export function num(n: number | null | undefined): string {
  return whole.format(Number(n ?? 0));
}

/** "42.5" / "42.50" / "₹1,042" -> 4250 paise. Returns null if not a valid amount. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [r, p = ''] = clean.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

export function paiseToInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function todayIn(tz = timeZone): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

export function time(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', credit: 'Udhaar' };

/** "5%" / "2.5%" / "₹2 off each" */
export function discountLabel(rule: { kind: 'percent' | 'amount'; value: number }): string {
  return rule.kind === 'percent' ? `${rule.value / 100}% off` : `${rupees(rule.value)} off each`;
}

/** "5" / "2.5" -> 500 hundredths of a percent; null if not a percentage between 0.01 and 100. */
export function parsePercent(text: string): number | null {
  const clean = text.replace(/[%\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  return value >= 1 && value <= 10000 ? value : null;
}

/** Price for the shop after its discount on one unit (percent rounded to the paisa, like the bills). */
export function priceAfter(rule: { kind: 'percent' | 'amount'; value: number } | null, pricePaise: number): number {
  if (!rule) return pricePaise;
  if (rule.kind === 'percent') return pricePaise - Math.floor((pricePaise * rule.value + 5000) / 10000);
  return pricePaise - Math.min(rule.value, pricePaise);
}
