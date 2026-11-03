// Parity: the app's rules engine must give exactly the dashboard's rule states on the same data.
// The dashboard's own calc code (reference/dashboard-calcs.js) runs in a sandbox with a frozen clock,
// next to packages/rules, for many moments in time, and the results are compared exactly.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { computeAll, nyClock, utcDay, type RuleInputs } from '../src';
import { parseCsv } from '../../data/src/csv';

const ROOT = join(__dirname, '..', '..', '..');
const REF_SRC = readFileSync(join(ROOT, 'reference', 'dashboard-calcs.js'), 'utf8');
const CALCS = ['crypto_trend', 'equity_health', 'equity_weekly', 'macro_cycle', 'range_watch', 'setup_watch'] as const;

type Def = { inputs: string[]; fn: (...a: unknown[]) => unknown };

/** Load the dashboard calcs into a sandbox whose `new Date()` returns `now`. */
function loadReference(now: Date): Record<string, Def> {
  const calcs: Record<string, Def> = {};
  const T = now.getTime();
  const ctx: Record<string, unknown> = { dash: { calc: (id: string, def: Def) => { calcs[id] = def; } }, Intl };
  ctx.Date = class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(T); else super(...(a as [number])); }
    static now() { return T; }
  };
  vm.createContext(ctx);
  vm.runInContext(REF_SRC, ctx);
  return calcs;
}

/** Run the dashboard calcs in dependency order, the way the page feeds them. */
function runReference(now: Date, data: Record<string, unknown>) {
  const defs = loadReference(now);
  const out: Record<string, unknown> = {};
  const get = (id: string) => (id in out ? out[id] : data[id]);
  for (const id of ['crypto_trend', 'equity_health', 'equity_weekly', 'macro_cycle', 'range_watch', 'setup_watch']) {
    out[id] = defs[id].fn(...defs[id].inputs.map(get));
  }
  return out;
}

/** What FMP would have returned at `now`: no bars dated after that day (UTC for crypto, New York for US). */
function asOf(inp: RuleInputs, now: Date): RuleInputs {
  const u = utcDay(now), ny = nyClock(now).nyDay;
  const cut = <T extends { date: string }>(rows: T[], d: string) => rows.filter(r => String(r.date).slice(0, 10) <= d);
  return {
    ...inp,
    btc_daily: cut(inp.btc_daily, u), eth_daily: cut(inp.eth_daily, u), ohlc_btc: cut(inp.ohlc_btc, u), ohlc_eth: cut(inp.ohlc_eth, u),
    spx_daily: cut(inp.spx_daily, ny), ndx_daily: cut(inp.ndx_daily, ny), ohlc_es: cut(inp.ohlc_es, ny), ohlc_qqq: cut(inp.ohlc_qqq, ny), ohlc_spx: cut(inp.ohlc_spx, ny),
  };
}

function loadFixture(dir: string): RuleInputs {
  const j = (n: string) => JSON.parse(readFileSync(join(dir, n + '.json'), 'utf8')).rows;
  return {
    btc_daily: j('btc_daily'), eth_daily: j('eth_daily'), spx_daily: j('spx_daily'), ndx_daily: j('ndx_daily'),
    ohlc_btc: j('ohlc_btc'), ohlc_eth: j('ohlc_eth'), ohlc_es: j('ohlc_es'), ohlc_qqq: j('ohlc_qqq'), ohlc_spx: j('ohlc_spx'),
    // The dashboard reads attached CSV files as text cells; so does the reference here.
    range_levels: parseCsv(readFileSync(join(dir, 'range_levels.csv'), 'utf8')) as never,
    weekly_plan: parseCsv(readFileSync(join(dir, 'weekly_plan.csv'), 'utf8')) as never,
  };
}

/** Moments to test: every hour of the 7 days before the fixture was taken, at :05 and :35,
 *  plus the minutes either side of every session cut-off the rules use. */
function moments(fetchedAt: Date): Date[] {
  const out: Date[] = [];
  for (let t = fetchedAt.getTime() - 7 * 864e5; t <= fetchedAt.getTime(); t += 36e5) {
    const h = new Date(t); h.setUTCMinutes(5, 0, 0); out.push(new Date(h)); h.setUTCMinutes(35); out.push(new Date(h));
  }
  // Cut-offs in New York time: 16:14/16:16 (cash close + 15 min) and 16:59/17:01 (futures session).
  for (let d = 0; d < 8; d++) {
    const day = new Date(fetchedAt.getTime() - d * 864e5);
    for (const [hh, mm] of [[16, 14], [16, 16], [16, 59], [17, 1]]) {
      for (const off of [4, 5]) { // EDT before 1 Nov, EST after
        const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh + off, mm));
        if (t <= fetchedAt) out.push(t);
      }
    }
    // UTC midnight either side (crypto daily close).
    out.push(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 1)));
    out.push(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59)));
  }
  return out.filter(t => t <= fetchedAt).sort((a, b) => a.getTime() - b.getTime());
}

for (const name of readdirSync(join(ROOT, 'fixtures'))) {
  const dir = join(ROOT, 'fixtures', name);
  const full = loadFixture(dir);
  const fetchedAt = new Date(JSON.parse(readFileSync(join(dir, 'btc_daily.json'), 'utf8')).fetched_at);
  const times = moments(fetchedAt);

  // Run both engines once per moment, then compare calc by calc.
  const runs = times.map(now => {
    const inp = asOf(full, now);
    return { now, ref: runReference(now, inp as unknown as Record<string, unknown>), app: computeAll(inp, now) as Record<string, unknown> };
  });

  describe(`parity with the dashboard, fixture ${name} (${times.length} moments)`, () => {
    for (const calc of CALCS) {
      it(`${calc} matches exactly`, () => {
        // JSON comparison: exact numbers and exact strings, across the sandbox boundary.
        const bad = runs.filter(r => JSON.stringify(r.app[calc]) !== JSON.stringify(r.ref[calc]));
        if (bad.length) expect(JSON.stringify(bad[0].app[calc]), `${calc} at ${bad[0].now.toISOString()} (${bad.length} moments differ)`).toBe(JSON.stringify(bad[0].ref[calc]));
        expect(bad.length).toBe(0);
      });
    }
    it('the moments cover real state changes (the test is not trivially equal)', () => {
      const days = new Set(runs.map(r => JSON.stringify((r.app.crypto_trend as { day: string }[]).map(x => x.day))));
      const live = new Set(runs.map(r => (r.app.equity_health as { live: boolean }[])[0].live));
      expect(days.size).toBeGreaterThan(5);
      expect(live.size).toBe(2);
    });
  });
}

import { rangeBars, rangeWatch, fourHourBars, nyToUtcMs } from '../src';

describe('helpers used by the alert engine', () => {
  const dir = join(ROOT, 'fixtures', '2026-11-03');
  const full = loadFixture(dir);
  const fetchedAt = new Date(JSON.parse(readFileSync(join(dir, 'btc_daily.json'), 'utf8')).fetched_at);
  it('rangeBars ends on the same bar as rangeWatch at every moment', () => {
    for (const now of moments(fetchedAt)) {
      const inp = asOf(full, now);
      const rw = rangeWatch(inp.range_levels, inp.ohlc_btc, inp.ohlc_eth, inp.ohlc_es, inp.ohlc_qqq, inp.ohlc_spx, now);
      const rb = rangeBars(inp.range_levels, inp.ohlc_btc, inp.ohlc_eth, inp.ohlc_es, inp.ohlc_qqq, inp.ohlc_spx, now);
      for (const w of rw) {
        const b = rb.find(x => x.asset === w.asset)!;
        const last = b.bars[b.bars.length - 1];
        expect([last.date, last.c]).toEqual([w.day, w.close]);
      }
    }
  });
  it('reads New York intraday timestamps across the clock change', () => {
    expect(new Date(nyToUtcMs('2026-10-30 20:00:00')).toISOString()).toBe('2026-10-31T00:00:00.000Z'); // EDT, UTC-4
    expect(new Date(nyToUtcMs('2026-11-02 19:00:00')).toISOString()).toBe('2026-11-03T00:00:00.000Z'); // EST, UTC-5
  });
  it('builds 4H candles that match the ones in Claude\'s alert log', () => {
    const hourly = JSON.parse(readFileSync(join(dir, 'hourly_eth.json'), 'utf8')).rows;
    const bars = fourHourBars(hourly, fetchedAt);
    const at = (iso: string) => bars.find(b => b.start === iso)?.close;
    // Claude's alerts: "00:00 UTC bar 2,307, 04:00 UTC bar 2,281.89" (2 Nov) and "12:00 UTC bar closed at 2,298.11 after 2,263.39" (3 Nov).
    expect(at('2026-11-02T00:00:00.000Z')).toBeCloseTo(2306.05, 2);
    expect(at('2026-11-03T12:00:00.000Z')).toBeCloseTo(2298.1096, 4);
    expect(at('2026-11-03T08:00:00.000Z')).toBeCloseTo(2263.39, 2);
  });
});
