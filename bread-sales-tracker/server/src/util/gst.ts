/**
 * Indian GSTIN and pincode checks, so that a typing mistake is caught when the shop is saved
 * instead of when the bills are imported into Tally.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 2-digit state code, 10-character PAN, entity number, "Z", check character. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The 15th character of a GSTIN, worked out from the first 14 (Luhn mod 36, as used by the GST system). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/**
 * Normalises a GSTIN as typed (spaces removed, capital letters). Empty → null.
 * Returns an error message instead when it cannot be a valid GSTIN.
 */
export function cleanGstin(raw: string | null | undefined): { value: string | null; error?: string } {
  const value = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!value) return { value: null };
  if (!GSTIN_PATTERN.test(value)) {
    return { value: null, error: 'GSTIN should be 15 letters and digits, like 01ABCDE1234F1ZE' };
  }
  if (gstinCheckChar(value.slice(0, 14)) !== value[14]) {
    return { value: null, error: 'This GSTIN has a typing mistake (its last character does not match). Please check it.' };
  }
  return { value };
}

/** Normalises a 6-digit Indian pincode (spaces removed). Empty → null. */
export function cleanPincode(raw: string | number | null | undefined): { value: string | null; error?: string } {
  const value = String(raw ?? '').replace(/\s/g, '');
  if (!value) return { value: null };
  if (!/^[1-9][0-9]{5}$/.test(value)) return { value: null, error: 'Pincode should be 6 digits, like 180001' };
  return { value };
}
