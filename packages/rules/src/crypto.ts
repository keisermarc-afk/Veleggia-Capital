import { ema, rd, utcDay, type CloseRow } from './util';

export type CryptoState = 'Bullish' | 'Bearish' | 'Range' | 'Transition';

export interface CryptoTrend {
  asset: 'BTC' | 'ETH';
  day: string; close: number;
  ema12: number; ema21: number; ema50: number; ema100: number; ema200: number;
  dist50: number; dist200: number; crosses20: number;
  state: CryptoState;
  confirmed: Exclude<CryptoState, 'Transition'> | null;
  confirmed_since: string | null;
  pending: string;
  below50: number;
  exit_watch: string;
}

/**
 * Crypto trend rule (framework, 23 Oct 2026): daily EMA12/21 on completed UTC days.
 * Bullish above both, Bearish below both, Range when below both with 4+ EMA21 crosses
 * in 20 days, otherwise Transition. Confirmed regime changes only after 3 closes.
 * Port of the dashboard calc `crypto_trend`.
 */
export function cryptoTrend(btc_daily: CloseRow[], eth_daily: CloseRow[], now: Date): CryptoTrend[] {
  const today = utcDay(now);
  return ([['BTC', btc_daily], ['ETH', eth_daily]] as const).map(([asset, rows]) => {
    const r = rows.filter(x => x.date < today).sort((a, b) => a.date < b.date ? -1 : 1);
    const c = r.map(x => Number(x.price));
    const e12 = ema(c, 12) as number[], e21 = ema(c, 21) as number[], e50 = ema(c, 50) as number[],
      e100 = ema(c, 100) as number[], e200 = ema(c, 200) as number[];
    const i = c.length - 1;
    let crosses = 0;
    for (let j = i - 19; j <= i; j++) if ((c[j] > e21[j]) !== (c[j - 1] > e21[j - 1])) crosses++;
    const above = c[i] > e12[i] && c[i] > e21[i];
    const below = c[i] < e12[i] && c[i] < e21[i];
    const state: CryptoState = above ? 'Bullish' : below ? (crosses >= 4 ? 'Range' : 'Bearish') : 'Transition';
    // Confirmed regime: changes only after 3 closes in the new state (Transition days neither count nor reset).
    const stAt = (j: number) => {
      let cr = 0;
      for (let q = j - 19; q <= j; q++) if ((c[q] > e21[q]) !== (c[q - 1] > e21[q - 1])) cr++;
      const ab = c[j] > e12[j] && c[j] > e21[j], be = c[j] < e12[j] && c[j] < e21[j];
      return ab ? 'Bullish' : be ? (cr >= 4 ? 'Range' : 'Bearish') : null;
    };
    let conf: CryptoTrend['confirmed'] = null, since: string | null = null, cand: string | null = null, cnt = 0;
    for (let j = Math.max(45, i - 400); j <= i; j++) {
      const s = stAt(j);
      if (s !== null && s !== conf) {
        if (s === cand) cnt++; else { cand = s; cnt = 1; }
        if (cnt >= 3 || conf === null) { conf = s; since = r[j].date; cand = null; cnt = 0; }
      } else if (s === conf) { cand = null; cnt = 0; }
    }
    const countBelow50 = () => { let n = 0; for (let j = i; j >= 0 && c[j] < e50[j]; j--) n++; return n; };
    return {
      asset, day: r[i].date, close: c[i],
      ema12: rd(e12[i], 2), ema21: rd(e21[i], 2), ema50: rd(e50[i], 2), ema100: rd(e100[i], 2), ema200: rd(e200[i], 2),
      dist50: rd(c[i] / e50[i] - 1, 4), dist200: rd(c[i] / e200[i] - 1, 4), crosses20: crosses, state,
      confirmed: conf, confirmed_since: since, pending: cand ? cand + ' ' + cnt + ' of 3' : '',
      below50: countBelow50(),
      exit_watch: c[i] < e50[i]
        ? (c[i - 1] < e50[i - 1] ? 'Exit in force (' + countBelow50() + ' closes below 50)' : '1 of 2 closes below 50')
        : 'Hold (above 50)',
    };
  });
}
