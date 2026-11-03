// Alert engine: compares the rule states now with the last stored state and returns the alerts,
// following the rules of Claude's "Dashboard change alerts" task (claude/dashboard_operations.md),
// for everything that comes from closes. Pure function, clock passed in.
//
// Covered: 1 regime confirmed, 1b early signal, 2 crypto EMA50/EMA200 close side + trend exit,
// 4 index EMA200 state, 4a index EMA50/EMA100 close side + trend exit, 4b weekly trend,
// 4d macro cycle, 4e 200 hold rule, 4f range signals, 4g watch levels and the 4H long trigger.
// Not covered here (stay in the Claude task): 3 and 4c intraday price checks, 5 ETF flows,
// 6 funding, 6b insider trades.
import {
  computeAll, rangeBars, fourHourBars,
  type RuleInputs, type CryptoTrend, type EquityHealth, type EquityWeekly, type MacroCycle, type RangeWatch,
} from '../../rules/src';

export type Level = 'warn' | 'good' | 'info';
export interface Alert { key: string; asset: string; type: string; level: Level; message: string }

interface CryptoState { day: string; state: string; confirmed: string | null; vs50: string; vs200: string; below50: number; macro: string; hold200: boolean }
interface IndexState { day: string; state: string; vs50: string; vs100: string; below50: number; weekly_state: string | null; weekly_week: string; macro: string; hold200: boolean }
export interface AlertState {
  v: 1;
  crypto: Record<string, CryptoState>;
  index: Record<string, IndexState>;
  /** Range / watch / 4H signal ids already alerted (newest last). */
  seen: string[];
  updated: string;
}

export interface EngineInput extends RuleInputs {
  /** FMP hourly bars per crypto asset with a 4H trigger, e.g. { ETH: [...] }. */
  hourly?: Record<string, { date: string; open: number | string; high: number | string; low: number | string; close: number | string }[]>;
}

const RANGE_NAME: Record<string, string> = { BTC: 'BTC', ETH: 'ETH', SPX: 'ES (S&P)', NDX: 'NQ (est.)' };
const dec = (asset: string) => asset === 'BTC' || asset === 'NAS100' || asset === 'NDX' ? 0 : 2;
const n = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const side = (dist: number) => dist >= 0 ? 'above' : 'below';
const MAX_SEEN = 120;

export function runEngine(prev: AlertState | null, inp: EngineInput, now: Date): { alerts: Alert[]; state: AlertState; rules: ReturnType<typeof computeAll> } {
  const rules = computeAll(inp, now);
  const alerts: Alert[] = [];
  const first = !prev;
  const state: AlertState = { v: 1, crypto: { ...(prev?.crypto || {}) }, index: { ...(prev?.index || {}) }, seen: [...(prev?.seen || [])], updated: now.toISOString() };
  const push = (a: Alert) => { if (!first) alerts.push(a); };
  const macroOf = (asset: string) => rules.macro_cycle.find(m => m.asset === asset) as MacroCycle;

  // ---------- Crypto: completed UTC daily closes ----------
  for (const ct of rules.crypto_trend as CryptoTrend[]) {
    const a = ct.asset, d = dec(a), m = macroOf(a), p = prev?.crypto[a];
    const cur: CryptoState = {
      day: ct.day, state: ct.state, confirmed: ct.confirmed, vs50: side(ct.dist50), vs200: side(ct.dist200),
      below50: ct.below50, macro: m.cycle, hold200: p ? p.hold200 : m.closes_below200 >= 2,
    };
    if (p) {
      const newDay = ct.day !== p.day;
      const revised = newDay ? '' : ' (revised data)';
      const on = ` on ${ct.day}${revised}`;
      if (ct.confirmed !== p.confirmed && ct.confirmed) {
        push({ key: `${a}|regime|${ct.confirmed}|${ct.day}`, asset: a, type: 'Regime confirmed', level: ct.confirmed === 'Bearish' ? 'warn' : ct.confirmed === 'Bullish' ? 'good' : 'info',
          message: `${a} regime confirmed ${ct.confirmed} (was ${p.confirmed ?? 'none'})${on}: close ${n(ct.close, d)}, EMA12 ${n(ct.ema12, d)}, EMA21 ${n(ct.ema21, d)}. Three closes confirmed it.` });
      } else if (newDay && ct.state !== p.state && ct.state !== 'Transition') {
        push({ key: `${a}|early|${ct.state}|${ct.day}`, asset: a, type: 'Early signal', level: 'info',
          message: `${a} closed ${ct.state}${on}: close ${n(ct.close, d)} vs EMA12 ${n(ct.ema12, d)} and EMA21 ${n(ct.ema21, d)}. Unconfirmed${ct.pending ? ', ' + ct.pending : ''}; confirmed regime still ${ct.confirmed}.` });
      }
      for (const [ema, vsKey, dist, val] of [['EMA50', 'vs50', ct.dist50, ct.ema50], ['EMA200', 'vs200', ct.dist200, ct.ema200]] as const) {
        if (cur[vsKey] !== p[vsKey]) {
          push({ key: `${a}|${ema}|${cur[vsKey]}|${ct.day}`, asset: a, type: `${ema} break`, level: cur[vsKey] === 'below' ? 'warn' : 'good',
            message: `${a} closed ${cur[vsKey]} the daily ${ema}${on}: close ${n(ct.close, d)} vs ${ema} ${n(val, d)} (${pct(dist)}).` });
        }
      }
      if (ct.below50 === 2 && p.below50 !== 2) {
        push({ key: `${a}|exit50|${ct.day}`, asset: a, type: 'Trend exit rule', level: 'warn',
          message: `${a} closed below the daily EMA50 for the second day in a row${on}: close ${n(ct.close, d)} vs EMA50 ${n(ct.ema50, d)} (${pct(ct.dist50)}). Two daily closes below the EMA50 is the long trend-trade exit.` });
      }
      macroAndHold(a, m, p, cur, ct.close, d, on);
    }
    state.crypto[a] = cur;
  }

  // ---------- Indices: only on a completed cash close ----------
  for (const eh of rules.equity_health as EquityHealth[]) {
    const a = eh.ticker, d = dec(a), m = macroOf(a), p = prev?.index[a];
    const ew = (rules.equity_weekly as EquityWeekly[]).find(w => w.ticker === a)!;
    if (eh.live) { // session still open: keep the stored close state, but the weekly rule uses completed weeks only
      if (p && ew.week !== p.weekly_week) weekly(a, ew, p);
      if (p) state.index[a] = { ...p, weekly_state: ew.state, weekly_week: ew.week };
      continue;
    }
    const cur: IndexState = {
      day: eh.day, state: eh.state, vs50: side(eh.dist50), vs100: side(eh.dist100), below50: eh.below50,
      weekly_state: ew.state, weekly_week: ew.week, macro: m.cycle, hold200: p ? p.hold200 : m.closes_below200 >= 2,
    };
    if (p) {
      const on = ` on ${eh.day}${eh.day === p.day ? ' (revised data)' : ''}`;
      if (eh.state !== p.state) {
        push({ key: `${a}|state|${eh.state}|${eh.day}`, asset: a, type: 'Index state', level: eh.state === 'Healthy' ? 'good' : 'warn',
          message: `${a} closed ${eh.state === 'Healthy' ? 'back above' : 'below'} its EMA200${on}: close ${n(eh.close, d)} vs EMA200 ${n(eh.ema200, d)} (${pct(eh.dist200)}), state ${p.state} to ${eh.state}.` });
      }
      for (const [ema, vsKey, dist, val] of [['EMA50', 'vs50', eh.dist50, eh.ema50], ['EMA100', 'vs100', eh.dist100, eh.ema100]] as const) {
        if (cur[vsKey] !== p[vsKey]) {
          push({ key: `${a}|${ema}|${cur[vsKey]}|${eh.day}`, asset: a, type: `${ema} break`, level: cur[vsKey] === 'below' ? 'warn' : 'good',
            message: `${a} closed ${cur[vsKey]} the daily ${ema}${on}: close ${n(eh.close, d)} vs ${ema} ${n(val, d)} (${pct(dist)}).` });
        }
      }
      if (eh.below50 === 2 && p.below50 !== 2) {
        push({ key: `${a}|exit50|${eh.day}`, asset: a, type: 'Trend exit rule', level: 'warn',
          message: `${a} closed below its EMA50 for the second day in a row${on}: close ${n(eh.close, d)} vs EMA50 ${n(eh.ema50, d)} (${pct(eh.dist50)}). A held test of the 50 is a retest; two closes below is the warning to get out.` });
      }
      if (ew.week !== p.weekly_week) weekly(a, ew, p);
      macroAndHold(a, m, p, cur, eh.close, d, on);
    }
    state.index[a] = cur;
  }

  // ---------- Ranges (4f), watch levels and the 4H trigger (4g) ----------
  const seen = new Set(state.seen);
  const mark = (id: string) => { if (!seen.has(id)) { seen.add(id); state.seen.push(id); return true; } return false; };
  const bars = rangeBars(inp.range_levels, inp.ohlc_btc, inp.ohlc_eth, inp.ohlc_es, inp.ohlc_qqq, inp.ohlc_spx, now);
  for (const rw of rules.range_watch as RangeWatch[]) {
    if (rw.signal_kind === 'none') continue;
    const id = `${rw.asset}|${rw.signal}|${rw.signal_day}`;
    if (!mark(id)) continue;
    // A break that simply continues (same break already alerted on the bar before) is not a new alert.
    if (/^Broke /.test(rw.signal)) {
      const b = bars.find(x => x.asset === rw.asset)?.bars;
      const i = b ? b.findIndex(x => x.date === rw.signal_day) : -1;
      if (i > 0 && seen.has(`${rw.asset}|${rw.signal}|${b![i - 1].date}`)) continue;
    }
    const a = rw.asset, d = dec(a), name = RANGE_NAME[a];
    const lv = /mid/i.test(rw.signal) ? rw.mid! : /high/i.test(rw.signal) || /above the range/.test(rw.signal) ? rw.range_high : rw.range_low;
    const level: Level = /range high|Rejected at mid|Lost mid|below the range/.test(rw.signal) ? 'warn' : /range low \(short/.test(rw.signal) ? 'info' : rw.signal_kind === 'watch' ? 'info' : 'good';
    let msg = `${name}: ${rw.signal} on ${rw.signal_day}. Close ${n(rw.close, d)}, level ${n(lv, d)}${rw.volume_ratio != null ? `, volume ${rw.volume_ratio.toFixed(2)}x the 20-day average` : ''}.`;
    if (/Swing failure at range high|Rejected at mid/.test(rw.signal)) msg += ` Short trigger, stop above the high, target the range low ${n(rw.range_low, d)}.`;
    if (a === 'NDX') {
      const b = bars.find(x => x.asset === 'NDX')?.bars.find(x => x.date === rw.signal_day);
      if (b && Math.min(Math.abs(b.h / lv - 1), Math.abs(b.l / lv - 1)) <= 0.0015) msg += ' Estimate, check your NQ1! chart.';
    }
    push({ key: id, asset: a, type: 'Range', level, message: msg });
  }
  for (const lb of bars) {
    const a = lb.asset, d = dec(a), name = RANGE_NAME[a], r = lb.bars;
    const watch = String(lb.level.watch_levels || '').split(/[;\s]+/).map(Number).filter(x => x > 0).sort((x, y) => y - x);
    if (r.length >= 2 && watch.length) {
      const last = r[r.length - 1], prevBar = r[r.length - 2];
      for (const w of watch) {
        if (last.l <= w && last.c > w) {
          const id = `${a}|watch|${w}|swept|${last.date}`;
          if (mark(id)) push({ key: id, asset: a, type: 'Range', level: 'good', message: `${name}: swept ${n(w, d)} and closed back above on ${last.date} (low ${n(last.l, d)}, close ${n(last.c, d)}).` });
        } else if (last.c < w && prevBar.c > w) {
          const id = `${a}|watch|${w}|closed_below|${last.date}`;
          const next = watch.find(x => x < w);
          if (mark(id)) push({ key: id, asset: a, type: 'Range', level: 'warn', message: `${name}: closed below ${n(w, d)} on ${last.date} (close ${n(last.c, d)}).${next ? ` Next watch level ${n(next, d)}.` : ''}` });
        }
      }
    }
    const trig = Number(lb.level.long_trigger_4h);
    const hourly = inp.hourly?.[a];
    if (trig > 0 && hourly?.length) {
      const fh = fourHourBars(hourly, now);
      const k = fh.length - 1;
      if (k >= 2) {
        const above = (i: number) => fh[i].close > trig;
        const t = (iso: string) => iso.slice(11, 16) + ' UTC';
        if (above(k) && above(k - 1) && !above(k - 2)) {
          const id = `${a}|trigger4h|${trig}|2|${fh[k].start}`;
          if (mark(id)) {
            const m = macroOf(a), ct = (rules.crypto_trend as CryptoTrend[]).find(x => x.asset === a);
            const over: string[] = [];
            if (ct && fh[k].close < ct.ema200) over.push(`daily EMA200 ${n(ct.ema200, d)}`);
            if (fh[k].close < lb.RL) over.push(`range low ${n(lb.RL, d)}`);
            push({ key: id, asset: a, type: 'Range', level: 'good',
              message: `${name}: two 4H closes above ${n(trig, d)}, your long trigger is met (${t(fh[k - 1].start)} bar ${n(fh[k - 1].close, d)}, ${t(fh[k].start)} bar ${n(fh[k].close, d)}).${over.length ? ' Next overhead: ' + over.join(', ') + '.' : ''}${m.cycle !== 'Uptrend intact' ? ` Macro cycle is ${m.cycle}, so a long is Setup Only risk.` : ''}` });
          }
        } else if (above(k) && !above(k - 1)) {
          const id = `${a}|trigger4h|${trig}|1|${fh[k].start}`;
          if (mark(id)) push({ key: id, asset: a, type: 'Range', level: 'info',
            message: `${name}: first 4H close above your ${n(trig, d)} long trigger (1 of 2): the ${t(fh[k].start)} bar closed at ${n(fh[k].close, d)} after ${n(fh[k - 1].close, d)}. Unconfirmed until a second 4H close above.` });
        }
      }
    }
  }
  state.seen = state.seen.slice(-MAX_SEEN);
  return { alerts, state, rules };

  function weekly(a: string, ew: EquityWeekly, p: IndexState) {
    if (ew.state && ew.state !== p.weekly_state) {
      const d = dec(a);
      push({ key: `${a}|weekly|${ew.state}|${ew.week}`, asset: a, type: 'Weekly trend', level: ew.state === 'Below both' ? 'warn' : ew.state === 'Uptrend intact' ? 'good' : 'info',
        message: `${a} weekly trend ${p.weekly_state ?? 'none'} to ${ew.state}${ew.state === 'Below both' ? ' (pay attention)' : ''}: week to ${ew.week} closed ${n(ew.wclose, d)} vs weekly EMA12 ${n(ew.wema12, d)} and EMA21 ${n(ew.wema21, d)}.` });
    }
  }

  function macroAndHold(a: string, m: MacroCycle, p: CryptoState | IndexState, cur: CryptoState | IndexState, close: number, d: number, on: string) {
    if (m.cycle !== p.macro) {
      push({ key: `${a}|macro|${m.cycle}|${m.day}`, asset: a, type: 'Macro cycle', level: m.cycle === 'Exhaustion warning' ? 'warn' : m.cycle === 'Uptrend intact' ? 'good' : 'info',
        message: `${a} macro cycle ${p.macro} to ${m.cycle}${on}: ${m.why}. ${m.meaning}.` });
    }
    if (!p.hold200 && m.closes_below200 >= 2) {
      cur.hold200 = true;
      push({ key: `${a}|hold200|start|${m.day}`, asset: a, type: '200 hold rule', level: 'warn',
        message: `${a} closed below the daily EMA200 for the second day in a row${on} (close ${n(close, d)}, ${pct(m.dist200)}). Shorts are held until two closes back above the 200.` });
    } else if (p.hold200 && m.hold200.startsWith('Off')) {
      cur.hold200 = false;
      push({ key: `${a}|hold200|end|${m.day}`, asset: a, type: '200 hold rule', level: 'good',
        message: `${a} closed back above the daily EMA200 for the second day in a row${on} (close ${n(close, d)}, ${pct(m.dist200)}). The 200 hold rule ends.` });
    } else cur.hold200 = p.hold200;
  }
}
