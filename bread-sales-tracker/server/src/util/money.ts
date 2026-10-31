/** Paise -> "1234.50" (plain number for CSV / Excel). */
export function paiseToRupeesString(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${negative ? '-' : ''}${rupees}.${rest.toString().padStart(2, '0')}`;
}
