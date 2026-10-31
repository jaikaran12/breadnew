/** YYYY-MM-DD of an instant in a time zone (the business day used by the server). */
export function dateIn(timeZone: string, instant: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  } catch {
    const d = instant;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function timeText(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

export function dateText(date: string, lang: 'en' | 'hi'): string {
  const d = new Date(`${date}T12:00:00Z`);
  try {
    return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return date;
  }
}
