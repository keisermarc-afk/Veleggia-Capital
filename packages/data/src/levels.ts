// Range levels: validation and the exact CSV format the dashboard's range_levels dataset reads
// (see claude/dashboard_operations.md, "Range levels").

export const ASSETS = ['BTC', 'ETH', 'SPX', 'NDX'] as const;
export type Asset = (typeof ASSETS)[number];

/** How each asset is shown to Marc: index levels are futures levels (ES1!, NQ1!). */
export const ASSET_LABEL: Record<Asset, string> = { BTC: 'BTC', ETH: 'ETH', SPX: 'ES (S&P)', NDX: 'NQ (est.)' };

export const LEVEL_COLUMNS = ['asset', 'range_high', 'mid', 'range_low', 'set_on', 'note', 'proxy_ratio', 'watch_levels', 'long_trigger_4h', 'trigger_tf'] as const;
export type LevelRow = Record<(typeof LEVEL_COLUMNS)[number], string>;

export interface FieldError { field: string; message: string }

/**
 * Read a number as Marc might type it ("87300", "87,300", "87'300", "7620.25") and return it
 * in plain form ("87300", "7620.25"), keeping the decimals he typed. Empty stays empty.
 * Returns null when it is not a number.
 */
export function normNumber(raw: unknown): string | null {
  let s = String(raw ?? '').trim().replace(/\s/g, '').replace(/[’']/g, '');
  if (s === '') return '';
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));

/** The fields that count as "the levels changed" (a note edit does not move set_on). */
const LEVEL_FIELDS = ['range_high', 'mid', 'range_low', 'watch_levels', 'long_trigger_4h', 'trigger_tf', 'proxy_ratio'] as const;

/**
 * Validate one asset's levels. `previous` is the stored row (if any): set_on moves to `today`
 * only when a level actually changed, otherwise it keeps its date.
 */
export function validateLevel(input: Record<string, unknown>, today: string, previous?: LevelRow | null):
  { ok: true; row: LevelRow } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const asset = String(input.asset ?? '').trim().toUpperCase() as Asset;
  if (!ASSETS.includes(asset)) errors.push({ field: 'asset', message: 'Asset must be BTC, ETH, SPX or NDX.' });

  const num = (f: string, label: string, required: boolean) => {
    const v = normNumber(input[f]);
    if (v === null) { errors.push({ field: f, message: `${label} is not a number.` }); return ''; }
    if (required && v === '') { errors.push({ field: f, message: `${label} is required.` }); return ''; }
    if (v !== '' && !(Number(v) > 0)) { errors.push({ field: f, message: `${label} must be above zero.` }); return ''; }
    return v;
  };
  const range_high = num('range_high', 'Range high', true);
  const range_low = num('range_low', 'Range low', true);
  const mid = num('mid', 'Mid', false);
  const long_trigger_4h = num('long_trigger_4h', 'Long trigger', false);
  // Trigger timeframe (added 8 Nov 2026): '' = 4H (default), '1H' = two 1H closes. 1H only for crypto (no index intraday data).
  let trigger_tf = String(input.trigger_tf ?? '').trim().toUpperCase();
  if (trigger_tf === '4H') trigger_tf = '';
  if (trigger_tf !== '' && trigger_tf !== '1H') errors.push({ field: 'trigger_tf', message: 'Trigger timeframe must be 4H or 1H.' });
  if (asset === 'SPX' || asset === 'NDX' || !long_trigger_4h) trigger_tf = '';
  let proxy_ratio = num('proxy_ratio', 'NQ ratio', asset === 'NDX');
  if (asset !== 'NDX') proxy_ratio = '';

  if (range_high && range_low && !(Number(range_high) > Number(range_low))) errors.push({ field: 'range_high', message: 'Range high must be above range low.' });
  if (mid && range_high && range_low && !(Number(mid) > Number(range_low) && Number(mid) < Number(range_high))) errors.push({ field: 'mid', message: 'Mid must sit between range low and range high.' });

  const watchParts = String(input.watch_levels ?? '').split(/[;\s]+/).map(s => s.trim()).filter(Boolean);
  const watch: string[] = [];
  for (const p of watchParts) {
    const v = normNumber(p);
    if (v === null || v === '' || !(Number(v) > 0)) { errors.push({ field: 'watch_levels', message: `Watch level "${p}" is not a number.` }); continue; }
    watch.push(v);
  }
  const note = String(input.note ?? '').trim().replace(/\s*\n\s*/g, ' ');
  if (note.length > 300) errors.push({ field: 'note', message: 'Note is longer than 300 characters.' });

  if (errors.length) return { ok: false, errors };
  const row: LevelRow = { asset, range_high, mid, range_low, set_on: today, note, proxy_ratio, watch_levels: watch.join(';'), long_trigger_4h, trigger_tf };
  if (previous && LEVEL_FIELDS.every(f => (previous[f] ?? '') === row[f]) && isDate(previous.set_on)) row.set_on = previous.set_on;
  return { ok: true, row };
}

/** Rows in the dashboard's order (BTC, ETH, SPX, NDX). */
export const sortLevels = (rows: LevelRow[]) => rows.slice().sort((a, b) => ASSETS.indexOf(a.asset as Asset) - ASSETS.indexOf(b.asset as Asset));
