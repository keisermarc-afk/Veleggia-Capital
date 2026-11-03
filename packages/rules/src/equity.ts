import { ema, rd, isoWeek, nyClock, DEFAULT_NDX_PER_QQQ, type CloseRow } from './util';

export interface EquityHealth {
  ticker: 'SPX' | 'NAS100'; name: string; day: string; live: boolean;
  close: number; prev_close: number; change_pct: number;
  ema12: number; ema21: number; ema50: number; ema100: number; ema200: number;
  dist50: number; dist100: number; dist200: number;
  state: 'Healthy' | 'Below EMA200';
  wave: 'Wave up' | 'Wave down' | 'Inside wave';
  ema50_status: string; below50: number;
}

/**
 * US index EMA stack on the cash index (^GSPC) and QQQ x ratio (Nasdaq 100).
 * Port of the dashboard calc `equity_health`.
 */
export function equityHealth(spx_daily: CloseRow[], ndx_daily: CloseRow[], now: Date, ndxPerQqq = DEFAULT_NDX_PER_QQQ): EquityHealth[] {
  const ndx = (ndx_daily || []).map(x => ({ ...x, price: Number(x.price) * ndxPerQqq }));
  const { nyDay, nyMin } = nyClock(now);
  const label = 'Nasdaq 100 (QQQ x ' + ndxPerQqq.toFixed(2) + ')';
  return ([['SPX', 'S&P 500', spx_daily], ['NAS100', label, ndx]] as const).map(([ticker, name, rows]) => {
    const r = (rows as CloseRow[]).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const c = r.map(x => Number(x.price));
    const e12 = ema(c, 12) as number[], e21 = ema(c, 21) as number[], e50 = ema(c, 50) as number[],
      e100 = ema(c, 100) as number[], e200 = ema(c, 200) as number[];
    const i = c.length - 1;
    const live = String(r[i].date).slice(0, 10) === nyDay && nyMin < 16 * 60 + 15;
    const n = live ? i - 1 : i;
    let below = 0; for (let j = n; j >= 0 && c[j] < e50[j]; j--) below++;
    const near = (j: number) => c[j] / e50[j] - 1 <= 0.01;
    let st50: string;
    if (below >= 2) st50 = 'Exit in force (' + below + ' closes below 50)';
    else if (below === 1) st50 = '1 of 2 closes below 50';
    else if (live && c[i] < e50[i]) st50 = 'Below 50 intraday, not a close';
    else if (near(n)) st50 = 'Testing 50';
    else { let t = false; for (let j = n - 9; j < n; j++) if (j > 0 && near(j)) t = true; st50 = t ? 'Retest held' : 'Above 50'; }
    const wave = c[i] > Math.max(e12[i], e21[i]) ? 'Wave up' : c[i] < Math.min(e12[i], e21[i]) ? 'Wave down' : 'Inside wave';
    return {
      ticker, name, day: r[i].date, live, close: c[i], prev_close: c[i - 1], change_pct: rd(c[i] / c[i - 1] - 1, 6),
      ema12: rd(e12[i], 2), ema21: rd(e21[i], 2), ema50: rd(e50[i], 2), ema100: rd(e100[i], 2), ema200: rd(e200[i], 2),
      dist50: rd(c[i] / e50[i] - 1, 4), dist100: rd(c[i] / e100[i] - 1, 4), dist200: rd(c[i] / e200[i] - 1, 4),
      state: c[i] > e200[i] ? 'Healthy' : 'Below EMA200', wave, ema50_status: st50, below50: below,
    } as EquityHealth;
  });
}

export interface EquityWeekly {
  ticker: 'SPX' | 'NAS100'; week: string; wclose: number; wema12: number; wema21: number;
  state: 'Uptrend intact' | 'Below both' | 'Between' | null; weeks: number;
  live: number; live_day: string; live_state: 'above both' | 'below both' | 'between';
}

/**
 * Weekly rule: completed weekly closes vs weekly EMA12 and EMA21.
 * Port of the dashboard calc `equity_weekly`.
 */
export function equityWeekly(spx_daily: CloseRow[], ndx_daily: CloseRow[], now: Date, ndxPerQqq = DEFAULT_NDX_PER_QQQ): EquityWeekly[] {
  const ndx = (ndx_daily || []).map(x => ({ ...x, price: Number(x.price) * ndxPerQqq }));
  const wd = now.getUTCDay();
  const curWeek = isoWeek(now.toISOString().slice(0, 10));
  const weekDone = wd === 6 || wd === 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const stOf = (c: number, a: number, b: number) => c > Math.max(a, b) ? 'Uptrend intact' : c < Math.min(a, b) ? 'Below both' : 'Between';
  return ([['SPX', spx_daily], ['NAS100', ndx]] as const).map(([ticker, rows]) => {
    const r = (rows as CloseRow[]).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const last: Record<string, CloseRow> = {};
    r.forEach(x => { last[isoWeek(x.date)] = x; });
    const weeks = Object.keys(last).map(k => last[k]).sort((a, b) => a.date < b.date ? -1 : 1)
      .filter(x => weekDone || isoWeek(x.date) !== curWeek);
    const c = weeks.map(x => Number(x.price)), e12 = ema(c, 12) as number[], e21 = ema(c, 21) as number[], i = c.length - 1;
    const st = c.map((x, j) => j < 20 ? null : stOf(x, e12[j], e21[j]));
    let n = 0; for (let j = i; j >= 20 && st[j] === st[i]; j--) n++;
    const lv = Number(r[r.length - 1].price);
    const ls = stOf(lv, e12[i], e21[i]);
    return {
      ticker, week: weeks[i].date, wclose: c[i], wema12: r2(e12[i]), wema21: r2(e21[i]), state: st[i], weeks: n,
      live: lv, live_day: r[r.length - 1].date,
      live_state: ls === 'Uptrend intact' ? 'above both' : ls === 'Below both' ? 'below both' : 'between',
    } as EquityWeekly;
  });
}
