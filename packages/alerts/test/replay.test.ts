// Replays the last week hour by hour on the fixture data and checks that the app raises the same
// close-based alerts as Claude's 3-hour alert task did (dashboard alerts log, 27 Oct to 3 Nov 2026).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine, type AlertState, type Alert, type EngineInput } from '../src';
import { nyClock, utcDay } from '../../rules/src';
import { parseCsv } from '../../data/src/csv';

const DIR = join(__dirname, '..', '..', '..', 'fixtures', '2026-11-03');
const j = (f: string) => JSON.parse(readFileSync(join(DIR, f + '.json'), 'utf8'));
const full: EngineInput = {
  btc_daily: j('btc_daily').rows, eth_daily: j('eth_daily').rows, spx_daily: j('spx_daily').rows, ndx_daily: j('ndx_daily').rows,
  ohlc_btc: j('ohlc_btc').rows, ohlc_eth: j('ohlc_eth').rows, ohlc_es: j('ohlc_es').rows, ohlc_qqq: j('ohlc_qqq').rows, ohlc_spx: j('ohlc_spx').rows,
  range_levels: parseCsv(readFileSync(join(DIR, 'range_levels.csv'), 'utf8')) as never,
  weekly_plan: parseCsv(readFileSync(join(DIR, 'weekly_plan.csv'), 'utf8')) as never,
  hourly: { ETH: j('hourly_eth').rows },
};
const fetchedAt = new Date(j('btc_daily').fetched_at);

/** What FMP would have returned at `now` (no bars from the future). */
function asOf(now: Date): EngineInput {
  const u = utcDay(now), ny = nyClock(now).nyDay;
  const cut = <T extends { date: string }>(rows: T[], d: string) => rows.filter(r => String(r.date).slice(0, 10) <= d);
  const hourCut = (rows: { date: string }[]) => rows.filter(r => { const [d, t] = r.date.split(' '); return d < ny || (d === ny && Number(t.slice(0, 2)) * 60 <= nyClock(now).nyMin); });
  return {
    ...full,
    btc_daily: cut(full.btc_daily, u), eth_daily: cut(full.eth_daily, u), ohlc_btc: cut(full.ohlc_btc, u), ohlc_eth: cut(full.ohlc_eth, u),
    spx_daily: cut(full.spx_daily, ny), ndx_daily: cut(full.ndx_daily, ny), ohlc_es: cut(full.ohlc_es, ny), ohlc_qqq: cut(full.ohlc_qqq, ny), ohlc_spx: cut(full.ohlc_spx, ny),
    hourly: { ETH: hourCut(full.hourly!.ETH) as never },
  };
}

function replay() {
  let state: AlertState | null = null;
  const log: (Alert & { at: string })[] = [];
  // The app's schedule: every hour at :05, plus 16:20 New York on weekdays (20:20 and 21:20 UTC).
  for (let t = Date.UTC(2026, 9, 27, 0, 5); t <= fetchedAt.getTime(); t += 36e5) {
    for (const now of [new Date(t), new Date(t + 15 * 6e4)]) {
      if (now.getUTCMinutes() === 20 && !(now.getUTCHours() === 20 || now.getUTCHours() === 21)) continue;
      if (now > fetchedAt) continue;
      const r = runEngine(state, asOf(now), now);
      state = r.state;
      r.alerts.forEach(a => log.push({ ...a, at: now.toISOString().slice(0, 16) }));
    }
  }
  return log;
}

describe('alert replay, 27 Oct to 3 Nov 2026', () => {
  const log = replay();
  const has = (pred: (a: Alert) => boolean) => log.some(pred);

  it('prints the replay', () => {
    for (const a of log) console.log(a.at, a.asset.padEnd(6), a.type.padEnd(16), a.level.padEnd(4), a.message);
    expect(log.length).toBeGreaterThan(0);
  });

  it('raises the rule alerts Claude raised (on final data)', () => {
    expect(has(a => a.asset === 'BTC' && a.type === 'Trend exit rule' && a.key.endsWith('2026-10-30'))).toBe(true);
    expect(has(a => a.asset === 'NAS100' && a.type === 'Trend exit rule' && a.key.endsWith('2026-10-30'))).toBe(true);
    expect(has(a => a.asset === 'SPX' && a.type === 'Trend exit rule' && a.key.endsWith('2026-11-02'))).toBe(true);
    expect(has(a => a.asset === 'NAS100' && a.type === 'Index state' && /Below EMA200/.test(a.message))).toBe(true);
    expect(has(a => a.asset === 'ETH' && a.type === '200 hold rule' && a.level === 'warn')).toBe(true);
    expect(has(a => a.asset === 'SPX' && a.type === 'EMA100 break' && a.level === 'warn')).toBe(true);
    expect(has(a => a.asset === 'NAS100' && a.type === 'EMA100 break' && a.level === 'warn')).toBe(true);
    expect(has(a => a.asset === 'BTC' && a.type === 'Early signal' && /Bearish/.test(a.message) && a.key.endsWith('2026-11-02'))).toBe(true);
  });

  it('raises the ETH 4H trigger alerts at the same candles as Claude', () => {
    expect(has(a => a.key === 'ETH|trigger4h|2280|1|2026-11-02T00:00:00.000Z')).toBe(true);
    expect(has(a => a.key === 'ETH|trigger4h|2280|2|2026-11-02T04:00:00.000Z')).toBe(true);
    expect(has(a => a.key === 'ETH|trigger4h|2280|1|2026-11-03T12:00:00.000Z')).toBe(true);
  });

  it('raises the range alerts on the current levels', () => {
    expect(has(a => a.asset === 'SPX' && a.type === 'Range' && /Rejected at mid/.test(a.message) && /2026-11-02/.test(a.message))).toBe(true);
    expect(has(a => a.asset === 'ETH' && a.type === 'Range' && /Broke below the range/.test(a.message))).toBe(true);
  });

  it('alerts a range break once, not every day it continues', () => {
    expect(log.filter(a => a.asset === 'ETH' && /Broke below the range/.test(a.message)).length).toBe(1);
  });

  it('never repeats an alert', () => {
    const keys = log.map(a => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is faster than the 3-hour task', () => {
    // The second 4H close above 2,280 completed at 08:00 UTC on 2 Nov; Claude alerted at 09:34 Zurich (08:34 UTC).
    const t = log.find(a => a.key === 'ETH|trigger4h|2280|2|2026-11-02T04:00:00.000Z')!.at;
    expect(t).toBe('2026-11-02T08:05');
  });
});
