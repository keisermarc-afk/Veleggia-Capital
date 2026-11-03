import { nyClock, utcDay, type OhlcRow } from './util';

/** One row of Marc's range levels (same columns as the dashboard's range_levels.csv). */
export interface RangeLevel {
  asset: string; range_high: number | string; mid?: number | string | null; range_low: number | string;
  set_on?: string; note?: string; proxy_ratio?: number | string | null;
  watch_levels?: string; long_trigger_4h?: number | string | null;
}

export type SignalKind = 'short' | 'long' | 'up' | 'down' | 'target' | 'watch' | 'none';

export interface RangeWatch {
  asset: 'BTC' | 'ETH' | 'SPX' | 'NDX';
  range_low: number; mid: number | null; mid_side: string; range_high: number;
  day: string; close: number; position: number; zone: string;
  signal: string; signal_kind: SignalKind; signal_day: string; volume_ratio: number | null;
  set_on: string; note: string;
}

const ALIAS: Record<string, RangeWatch['asset']> = { BTCUSD: 'BTC', XBT: 'BTC', ETHUSD: 'ETH', US500: 'SPX', SP500: 'SPX', GSPC: 'SPX', NAS100: 'NDX', US100: 'NDX', NQ: 'NDX' };

/**
 * Range levels (framework 6.4) on the last 3 completed daily bars.
 * S&P levels are ES1! levels checked against ES bars; Nasdaq levels are NQ1! levels checked
 * against QQQ x proxy_ratio x the ES futures premium (median of the last 5 days).
 * Port of the dashboard calc `range_watch`.
 */
export function rangeWatch(range_levels: RangeLevel[], ohlc_btc: OhlcRow[], ohlc_eth: OhlcRow[], ohlc_es: OhlcRow[], ohlc_qqq: OhlcRow[], ohlc_spx: OhlcRow[], now: Date): RangeWatch[] {
  const SRC: Record<RangeWatch['asset'], [OhlcRow[], boolean]> = { BTC: [ohlc_btc, true], ETH: [ohlc_eth, true], SPX: [ohlc_es, false], NDX: [ohlc_qqq, false] };
  const todayUTC = utcDay(now);
  const { nyDay, nyMin } = nyClock(now);
  const out: RangeWatch[] = [];
  const spxC: Record<string, number> = {};
  (ohlc_spx || []).forEach(x => { const c = Number(x.close); if (c > 0) spxC[String(x.date).slice(0, 10)] = c; });
  const basisPts = (ohlc_es || []).map(x => { const d = String(x.date).slice(0, 10); return { d, q: Number(x.close) / spxC[d] }; })
    .filter(p => isFinite(p.q) && p.q > 0.9 && p.q < 1.1).sort((a, b) => a.d < b.d ? -1 : 1);
  const basisOn = (d: string) => { const p = basisPts.filter(b => b.d <= d).slice(-5).map(b => b.q).sort((a, b) => a - b); return p.length ? p[Math.floor(p.length / 2)] : null; };
  (range_levels || []).forEach(lv => {
    const raw = String(lv.asset || '').trim().toUpperCase().replace(/[\s^\/-]/g, '');
    const asset = (raw in SRC ? raw : ALIAS[raw]) as RangeWatch['asset'] | undefined;
    const RH = Number(lv.range_high), RL = Number(lv.range_low);
    if (!asset || !(RH > RL) || !(RL > 0)) return;
    const MID = Number(lv.mid) > 0 ? Number(lv.mid) : null;
    const k = asset === 'NDX' ? Number(lv.proxy_ratio) : 1;
    if (!(k > 0)) return;
    const [rows0, crypto] = SRC[asset];
    let r = (rows0 || []).map(x => {
      const date = String(x.date).slice(0, 10);
      const m = k * (asset === 'NDX' ? (basisOn(date) || 1) : 1);
      return { date, o: Number(x.open) * m, h: Number(x.high) * m, l: Number(x.low) * m, c: Number(x.close) * m, v: Number(x.volume) };
    }).filter(x => isFinite(x.c)).sort((a, b) => a.date < b.date ? -1 : 1);
    r = r.filter(x => {
      if (crypto) return x.date < todayUTC;
      if (asset === 'SPX') { const wd = new Date(x.date + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !(x.date === nyDay && nyMin < 1020); }
      return !(x.date === nyDay && nyMin < 975);
    });
    if (r.length < 3) return;
    const n = r.length - 1, last = r[n];
    const vr = (j: number) => {
      const p = r.slice(Math.max(0, j - 20), j).map(x => x.v).filter(v => v > 0);
      return p.length && r[j].v > 0 ? Math.round(r[j].v / (p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100 : null;
    };
    let signal = '', sday = '', svol: number | null = null, kind: SignalKind | '' = '';
    if (r[n].c > RH * 1.01 && r[n - 1].c > RH * 1.01) { signal = 'Broke above the range (2 closes)'; kind = 'up'; sday = last.date; svol = vr(n); }
    else if (r[n].c < RL * 0.99 && r[n - 1].c < RL * 0.99) { signal = 'Broke below the range (2 closes)'; kind = 'down'; sday = last.date; svol = vr(n); }
    else {
      for (let j = n; j >= Math.max(0, n - 2) && !signal; j--) {
        const x = r[j];
        if (x.h > RH && x.c < RH) { signal = 'Swing failure at range high'; kind = 'short'; }
        else if (x.l < RL && x.c > RL) { signal = 'Swing failure at range low'; kind = 'long'; }
        else if (MID && j > 0 && r[j - 1].c < MID && x.h > MID && x.c < MID && x.h < RH) { signal = 'Rejected at mid'; kind = 'short'; }
        else if (MID && j > 0 && r[j - 1].c > MID && x.l < MID && x.c > MID && x.l > RL) { signal = 'Held mid (wick below, close above)'; kind = 'long'; }
        else if (MID && j > 0 && r[j - 1].c < MID && x.c > MID) { signal = 'Closed back above mid'; kind = 'long'; }
        else if (MID && j > 0 && r[j - 1].c > MID && x.c < MID) { signal = 'Lost mid (close below)'; kind = 'short'; }
        if (signal) { sday = x.date; svol = vr(j); }
      }
      if (!signal && last.l <= RL * 1.005) { signal = 'At range low (short target)'; kind = 'target'; sday = last.date; svol = vr(n); }
      else if (!signal && last.h >= RH * 0.995) { signal = 'Testing range high'; kind = 'watch'; sday = last.date; svol = vr(n); }
    }
    const pos = (last.c - RL) / (RH - RL);
    const zone = pos > 1 ? 'Above the range' : pos < 0 ? 'Below the range' : pos >= 2 / 3 ? 'Upper third' : pos <= 1 / 3 ? 'Lower third' : 'Middle third';
    out.push({
      asset, range_low: RL, mid: MID == null ? null : Math.round(MID * 100) / 100, mid_side: MID == null ? '' : (last.c >= MID ? 'above mid' : 'below mid'),
      range_high: RH, day: last.date, close: last.c, position: Math.round(pos * 1000) / 1000, zone,
      signal: signal || 'No signal', signal_kind: (kind || 'none') as SignalKind, signal_day: sday, volume_ratio: svol,
      set_on: String(lv.set_on || ''), note: String(lv.note || ''),
    });
  });
  return out;
}

/** One row of the weekly plan (same columns as the dashboard's weekly_plan.csv). */
export interface PlanRow {
  id: string; week?: string; week_start?: string; week_end?: string; written?: string;
  section: 'headline' | 'exit' | 'long' | 'short' | 'rule' | 'risk' | string;
  asset?: string; market?: string; title?: string; trigger?: string; stop?: string; target?: string;
  risk_class?: string; level?: number | string | null; note?: string;
}

export interface SetupWatch { id: string; asset: string; level: number; close: number; day: string; dist: number }

/** Long setups vs the last completed close in range_watch. Port of the dashboard calc `setup_watch`. */
export function setupWatch(weekly_plan: PlanRow[], range_watch: RangeWatch[]): SetupWatch[] {
  return (weekly_plan || []).filter(p => p.section === 'long' && Number(p.level) > 0).map(p => {
    const r = (range_watch || []).find(x => x.asset === p.asset);
    return r ? { id: p.id, asset: String(p.asset), level: Number(p.level), close: r.close, day: r.day, dist: Math.round((r.close / Number(p.level) - 1) * 10000) / 10000 } : null;
  }).filter((x): x is SetupWatch => x !== null);
}
