// Shared helpers. Ported verbatim from the macro dashboard's calcs so the
// arithmetic (and therefore every rounding) is identical. Do not "tidy" the
// formulas: the parity tests compare results bit for bit.

/** EMA seeded with the simple average of the first n values, then e = x*k + e*(1-k). */
export function ema(v: number[], n: number): (number | null)[] {
  const k = 2 / (n + 1);
  const o: (number | null)[] = [];
  let e: number | null = null;
  v.forEach((x, i) => {
    if (i < n - 1) { o.push(null); return; }
    e = e === null ? v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n : x * k + e * (1 - k);
    o.push(e);
  });
  return o;
}

/** Wilder RSI, as in the dashboard's macro_cycle calc. */
export function rsi(v: number[], n: number): (number | null)[] {
  const o: (number | null)[] = v.map(() => null);
  if (v.length <= n) return o;
  let au = 0, al = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; au += Math.max(d, 0) / n; al += Math.max(-d, 0) / n; }
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    au = (au * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    o[i] = 100 - 100 / (1 + au / Math.max(al, 1e-12));
  }
  return o;
}

/** ISO week key "yyyy-w" for a yyyy-mm-dd date string. */
export function isoWeek(s: string): string {
  const d = new Date(s + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const f = new Date(Date.UTC(y, 0, 4));
  return y + '-' + Math.round(((d.getTime() - f.getTime()) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7 + 1);
}

/** Round to d decimals the way the dashboard does. */
export const rd = (x: number, d: number): number => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

/** New York calendar day (yyyy-mm-dd) and minutes after midnight for a given instant. */
export function nyClock(now: Date): { nyDay: string; nyMin: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const g = (t: string) => (parts.find(p => p.type === t) || ({} as Intl.DateTimeFormatPart)).value;
  return {
    nyDay: g('year') + '-' + g('month') + '-' + g('day'),
    nyMin: (Number(g('hour')) % 24) * 60 + Number(g('minute')),
  };
}

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Rows as FMP "eod-light" returns them. */
export interface CloseRow { date: string; price: number | string; [k: string]: unknown }
/** Rows as FMP "eod-full" returns them. */
export interface OhlcRow { date: string; open: number | string; high: number | string; low: number | string; close: number | string; volume: number | string; [k: string]: unknown }

/** Nasdaq 100 points per QQQ dollar. Recalibrate every couple of months (see dashboard_operations.md). */
export const DEFAULT_NDX_PER_QQQ = 41.10;
