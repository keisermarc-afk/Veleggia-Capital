export * from './util';
export * from './crypto';
export * from './equity';
export * from './macro';
export * from './ranges';

import { cryptoTrend } from './crypto';
import { equityHealth, equityWeekly } from './equity';
import { macroCycle } from './macro';
import { rangeWatch, setupWatch, type RangeLevel, type PlanRow } from './ranges';
import { DEFAULT_NDX_PER_QQQ, type CloseRow, type OhlcRow } from './util';

/**
 * Inputs mirror the dashboard datasets one to one (same FMP endpoints):
 *   btc_daily, eth_daily  crypto  cryptocurrency-historical-price-eod-light  from today - 900 days
 *   spx_daily             indexes index-historical-price-eod-light ^GSPC      from today - 900 days
 *   ndx_daily             chart   historical-price-eod-light QQQ             from today - 900 days
 *   ohlc_btc, ohlc_eth    crypto  cryptocurrency-historical-price-eod-full    from today - 40 days
 *   ohlc_es               chart   historical-price-eod-full ESUSD            from today - 40 days
 *   ohlc_qqq              chart   historical-price-eod-full QQQ              from today - 40 days
 *   ohlc_spx              indexes index-historical-price-eod-full ^GSPC       from today - 40 days
 * The 900-day window matters: every EMA is seeded from the first closes in the window,
 * so a different window gives (slightly) different EMA values.
 */
export interface RuleInputs {
  btc_daily: CloseRow[]; eth_daily: CloseRow[]; spx_daily: CloseRow[]; ndx_daily: CloseRow[];
  ohlc_btc: OhlcRow[]; ohlc_eth: OhlcRow[]; ohlc_es: OhlcRow[]; ohlc_qqq: OhlcRow[]; ohlc_spx: OhlcRow[];
  range_levels: RangeLevel[]; weekly_plan: PlanRow[];
}

export const HISTORY_DAYS = 900;
export const OHLC_DAYS = 40;

/** Every rule state the dashboard shows, computed for one instant. */
export function computeAll(inp: RuleInputs, now: Date, ndxPerQqq = DEFAULT_NDX_PER_QQQ) {
  const range_watch = rangeWatch(inp.range_levels, inp.ohlc_btc, inp.ohlc_eth, inp.ohlc_es, inp.ohlc_qqq, inp.ohlc_spx, now);
  return {
    crypto_trend: cryptoTrend(inp.btc_daily, inp.eth_daily, now),
    equity_health: equityHealth(inp.spx_daily, inp.ndx_daily, now, ndxPerQqq),
    equity_weekly: equityWeekly(inp.spx_daily, inp.ndx_daily, now, ndxPerQqq),
    macro_cycle: macroCycle(inp.btc_daily, inp.eth_daily, inp.spx_daily, inp.ndx_daily, now, ndxPerQqq),
    range_watch,
    setup_watch: setupWatch(inp.weekly_plan, range_watch),
  };
}
