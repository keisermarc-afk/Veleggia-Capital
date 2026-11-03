// FMP data for the rule checks: the same endpoints and windows the dashboard uses
// (900 days of daily closes, 40 days of daily bars), plus hourly crypto bars for 4H triggers.
// The API key comes only from the Worker secret FMP_API_KEY and never appears in errors or logs.
import { HISTORY_DAYS, OHLC_DAYS } from '../../../packages/rules/src';

const FMP = 'https://financialmodelingprep.com/stable';
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class FmpError extends Error {}

async function get(base: string, key: string, path: string, params: Record<string, string>): Promise<unknown[]> {
  const q = new URLSearchParams({ ...params, apikey: key });
  let res: Response;
  try { res = await fetch(`${base}/${path}?${q}`, { headers: { Accept: 'application/json' } }); }
  catch { throw new FmpError(`FMP ${path} ${params.symbol}: network error`); }
  if (!res.ok) throw new FmpError(`FMP ${path} ${params.symbol}: HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) throw new FmpError(`FMP ${path} ${params.symbol}: unexpected answer${data && typeof data === 'object' && 'Error Message' in data ? ' (plan or key problem)' : ''}`);
  return data;
}

/** `base` is only overridden in local development (a mock server with the test fixtures). */
export async function fetchMarketData(key: string, now: Date, hourlyFor: string[], base = FMP) {
  if (!key) throw new FmpError('FMP_API_KEY is not set in the Worker secrets.');
  const t = now.getTime();
  const hist = day(t - HISTORY_DAYS * 864e5), ohlc = day(t - OHLC_DAYS * 864e5), hrs = day(t - 3 * 864e5);
  const light = (symbol: string) => get(base, key, 'historical-price-eod/light', { symbol, from: hist });
  const fullBars = (symbol: string) => get(base, key, 'historical-price-eod/full', { symbol, from: ohlc });
  const [btc_daily, eth_daily, spx_daily, ndx_daily, ohlc_btc, ohlc_eth, ohlc_es, ohlc_qqq, ohlc_spx, ...hourlyRows] = await Promise.all([
    light('BTCUSD'), light('ETHUSD'), light('^GSPC'), light('QQQ'),
    fullBars('BTCUSD'), fullBars('ETHUSD'), fullBars('ESUSD'), fullBars('QQQ'), fullBars('^GSPC'),
    ...hourlyFor.map(a => get(base, key, 'historical-chart/1hour', { symbol: a + 'USD', from: hrs })),
  ]);
  const hourly: Record<string, never[]> = {};
  hourlyFor.forEach((a, i) => { hourly[a] = hourlyRows[i] as never[]; });
  return { btc_daily, eth_daily, spx_daily, ndx_daily, ohlc_btc, ohlc_eth, ohlc_es, ohlc_qqq, ohlc_spx, hourly } as unknown as Record<string, never>;
}
