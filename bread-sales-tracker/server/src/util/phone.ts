/**
 * Normalises an Indian mobile number to 10 digits: "+91 98765-43210" -> "9876543210".
 * Returns null when it does not look like a 10 digit number.
 */
export function normalizeMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** Lenient clean-up for shop phone numbers (optional field). */
export function cleanPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return normalizeMobile(trimmed) ?? trimmed.replace(/[^\d+\- ]/g, '').slice(0, 20);
}
