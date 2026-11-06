// The 4H sweep-and-reclaim rule, on BTC's real hourly bars of 6 Nov 2026: the 13:00-17:00 Zurich
// candle traded down to 74,788 (below the 75,000 range low) and closed at 75,746. Marc's Week 45
// plan trigger "4H sweep of 75,000 that closes back above" was met at 17:00 Zurich.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine, type EngineInput } from '../src';
import { parseCsv } from '../../data/src/csv';

const DIR = join(__dirname, '..', '..', '..', 'fixtures', '2026-11-03');
const j = (f: string) => JSON.parse(readFileSync(join(DIR, f + '.json'), 'utf8'));
const btcHourly = j('hourly_btc_2026-11-06').rows;
const base: EngineInput = {
  btc_daily: j('btc_daily').rows, eth_daily: j('eth_daily').rows, spx_daily: j('spx_daily').rows, ndx_daily: j('ndx_daily').rows,
  ohlc_btc: j('ohlc_btc').rows, ohlc_eth: j('ohlc_eth').rows, ohlc_es: j('ohlc_es').rows, ohlc_qqq: j('ohlc_qqq').rows, ohlc_spx: j('ohlc_spx').rows,
  range_levels: parseCsv(readFileSync(join(DIR, 'range_levels.csv'), 'utf8')) as never,
  weekly_plan: parseCsv(readFileSync(join(DIR, 'weekly_plan.csv'), 'utf8')) as never,
};
/** Hourly bars FMP would have returned by `now` (New York timestamps = bar start; only bars that have started). */
const upTo = (now: Date) => btcHourly.filter((r: { date: string }) => Date.parse(r.date.replace(' ', 'T') + '-05:00') <= now.getTime());

describe('4H sweep and reclaim', () => {
  it('alerts the BTC sweep of 75,000 at 17:05 Zurich, not before', () => {
    const t0 = new Date('2026-11-06T13:05:00Z'), t1 = new Date('2026-11-06T15:05:00Z'), t2 = new Date('2026-11-06T16:05:00Z');
    const s0 = runEngine(null, { ...base, hourly: { BTC: upTo(t0) } }, t0).state;          // baseline
    const r1 = runEngine(s0, { ...base, hourly: { BTC: upTo(t1) } }, t1);                    // candle still open
    expect(r1.alerts.filter(a => a.type === '4H sweep')).toEqual([]);
    const r2 = runEngine(r1.state, { ...base, hourly: { BTC: upTo(t2) } }, t2);              // candle closed 16:00 UTC
    const sweep = r2.alerts.filter(a => a.type === '4H sweep');
    expect(sweep).toHaveLength(1);
    expect(sweep[0].key).toBe('BTC|sweep4h|75000|low|2026-11-06T12:00:00.000Z');
    expect(sweep[0].level).toBe('good');
    expect(sweep[0].message).toContain('4H sweep of your range low 75,000 and close back above (06 Nov 13:00–17:00 Zurich candle: low 74,788, close 75,746)');
    console.log(sweep[0].message);
    // The next run does not repeat it.
    const r3 = runEngine(r2.state, { ...base, hourly: { BTC: upTo(new Date('2026-11-06T17:05:00Z')) } }, new Date('2026-11-06T17:05:00Z'));
    expect(r3.alerts.filter(a => a.type === '4H sweep')).toEqual([]);
  });

  it('does not alert a touch that stays above the level', () => {
    const bars = [
      { date: '2026-11-06 07:00:00', open: 75100, high: 75300, low: 75035, close: 75200 },
      { date: '2026-11-06 08:00:00', open: 75200, high: 75400, low: 75100, close: 75300 },
      { date: '2026-11-06 09:00:00', open: 75300, high: 75500, low: 75200, close: 75400 },
      { date: '2026-11-06 10:00:00', open: 75400, high: 75600, low: 75300, close: 75500 },
    ];
    const t0 = new Date('2026-11-06T12:05:00Z'), t1 = new Date('2026-11-06T16:05:00Z');
    const s0 = runEngine(null, { ...base, hourly: { BTC: [] } }, t0).state;
    const r = runEngine(s0, { ...base, hourly: { BTC: bars as never } }, t1);
    expect(r.alerts.filter(a => a.type === '4H sweep')).toEqual([]);
  });

  it('alerts a failed push above the range high as a warning', () => {
    const bars = [0, 1, 2, 3].map(i => ({ date: `2026-11-06 0${7 + i}:00:00`, open: 87000, high: i === 2 ? 87600 : 87200, low: 86800, close: 87000 }));
    const t0 = new Date('2026-11-06T12:05:00Z'), t1 = new Date('2026-11-06T16:05:00Z');
    const s0 = runEngine(null, { ...base, hourly: { BTC: [] } }, t0).state;
    const r = runEngine(s0, { ...base, hourly: { BTC: bars as never } }, t1);
    const sw = r.alerts.filter(a => a.type === '4H sweep');
    expect(sw.map(a => [a.key, a.level])).toEqual([['BTC|sweep4h|87300|high|2026-11-06T12:00:00.000Z', 'warn']]);
  });
});
