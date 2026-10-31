const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12345 paise -> "₹123.45", 12300 -> "₹123", 12345600 -> "₹1,23,456" */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const text = abs % 100 === 0 ? whole.format(abs / 100) : withPaise.format(abs / 100);
  return `${sign}₹${text}`;
}

/** Same as rupees() but without the ₹ sign (for tables). */
export function amount(paise: number): string {
  return rupees(paise).replace('₹', '');
}
