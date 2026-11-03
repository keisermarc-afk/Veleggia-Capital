import { ema, rsi, isoWeek, nyClock, utcDay, DEFAULT_NDX_PER_QQQ, type CloseRow } from './util';

export type MacroCycleState = 'Uptrend intact' | 'Exhaustion warning' | 'Uptrend weak';

export interface MacroCycle {
  asset: 'BTC' | 'ETH' | 'SPX' | 'NAS100';
  day: string; cycle: MacroCycleState; why: string; meaning: string;
  hold200: string; closes_below200: number; dist200: number; week_vs21: number;
}

/**
 * Macro cycle (framework 6.3) and the 200 hold rule (framework 6.4).
 * Port of the dashboard calc `macro_cycle`.
 */
export function macroCycle(btc_daily: CloseRow[], eth_daily: CloseRow[], spx_daily: CloseRow[], ndx_daily: CloseRow[], now: Date, ndxPerQqq = DEFAULT_NDX_PER_QQQ): MacroCycle[] {
  const ndx = (ndx_daily || []).map(x => ({ ...x, price: Number(x.price) * ndxPerQqq }));
  const today = utcDay(now), wd = now.getUTCDay(), curWeek = isoWeek(today);
  const pc1 = (x: number) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const { nyDay, nyMin } = nyClock(now);
  return ([['BTC', btc_daily, true], ['ETH', eth_daily, true], ['SPX', spx_daily, false], ['NAS100', ndx, false]] as const).map(([asset, rows, crypto]) => {
    const r = (rows as CloseRow[]).filter(x => !crypto || x.date < today).sort((a, b) => a.date < b.date ? -1 : 1);
    const c = r.map(x => Number(x.price)), e200 = ema(c, 200), i = c.length - 1;
    const last: Record<string, number> = {}; r.forEach((x, j) => { last[isoWeek(x.date)] = j; });
    let wk = Object.keys(last).map(k => last[k]).sort((a, b) => a - b);
    const done = crypto ? new Date(r[i].date + 'T00:00:00Z').getUTCDay() === 0 : (wd === 6 || wd === 0);
    if (!done) wk = wk.filter(j => isoWeek(r[j].date) !== curWeek);
    if (crypto && !done) wk = wk.filter(j => isoWeek(r[j].date) !== isoWeek(r[i].date));
    const wc = wk.map(j => c[j]), w21 = ema(wc, 21) as number[], wr = rsi(wc, 14), k = wc.length - 1;
    const sh: number[] = [];
    for (let q = 3; q <= k - 3; q++) { const win = wc.slice(q - 3, q + 4); if (wc[q] === Math.max(...win)) sh.push(q); }
    const known = sh.filter(q => q >= k - 30 && q <= k - 3);
    let lh = k - 3; for (let q = k - 3; q <= k; q++) if (wc[q] > wc[lh]) lh = q;
    if (wc[lh] >= Math.max(...wc.slice(lh - 3, lh + 1)) && !known.includes(lh) && (!known.length || lh > known[known.length - 1])) known.push(lh);
    let div: [number, number] | null = null, soft: [number, number] | null = null;
    for (let q = 1; q < known.length; q++) {
      const a = known[q - 1], b = known[q];
      const ra = wr[a], rb = wr[b];
      if (b >= k - 16 && wc[b] > wc[a] && ra != null && rb != null) {
        if (rb < ra - 5) div = [a, b]; else if (rb < ra - 2) soft = [a, b];
      }
    }
    const e200i = e200[i] as number;
    const above200 = c[i] > e200i, wAbove = wc[k] > w21[k], d200 = c[i] / e200i - 1, dW = wc[k] / w21[k] - 1;
    let cycle: MacroCycleState, why: string, meaning: string;
    if (above200 && div) { cycle = 'Exhaustion warning'; why = 'New weekly high on weaker weekly RSI (' + Math.round(wr[div[0]] as number) + ' then ' + Math.round(wr[div[1]] as number) + ')'; meaning = 'Serious: act on the exit'; }
    else if (above200 && wAbove) { cycle = 'Uptrend intact'; why = pc1(d200) + ' above the EMA200, week closed ' + pc1(dW) + ' above the weekly EMA21'; meaning = 'Mild: usually a retest'; }
    else { cycle = 'Uptrend weak'; why = above200 ? 'Week closed ' + pc1(dW) + ' vs the weekly EMA21, still ' + pc1(d200) + ' above the EMA200' : pc1(d200) + ' vs the EMA200'; meaning = 'Real warning: higher risk of a bigger drop'; }
    if (!div && soft && above200) why += '. Note: last weekly high came on weaker RSI (' + Math.round(wr[soft[0]] as number) + ' then ' + Math.round(wr[soft[1]] as number) + '), check the structure';
    // 200 EMA hold rule: two completed closes below it = hold shorts; two closes back above = reclaimed.
    let n = i;
    if (!crypto && String(r[i].date).slice(0, 10) === nyDay && nyMin < 975) n = i - 1;
    let below = 0; for (let q = n; q >= 0 && e200[q] != null && c[q] < (e200[q] as number); q--) below++;
    let aboveN = 0; for (let q = n; q >= 0 && e200[q] != null && c[q] > (e200[q] as number); q--) aboveN++;
    const hold200 = below >= 2 ? 'Active: ' + below + ' closes below the 200, hold shorts'
      : below === 1 ? '1 of 2 closes below the 200'
      : aboveN === 1 ? '1 of 2 closes back above the 200' : 'Off: above the 200';
    return { asset, day: r[i].date, cycle, why, meaning, hold200, closes_below200: below, dist200: Math.round(d200 * 1e4) / 1e4, week_vs21: Math.round(dW * 1e4) / 1e4 };
  });
}
