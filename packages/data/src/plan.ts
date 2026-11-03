// Weekly plan: validation and the exact CSV format the dashboard's weekly_plan dataset reads
// (see claude/dashboard_operations.md, "Weekly plan").
import { ASSETS, ASSET_LABEL, normNumber, type Asset, type FieldError } from './levels';

export const PLAN_COLUMNS = ['id', 'week', 'week_start', 'week_end', 'written', 'section', 'asset', 'market', 'title', 'trigger', 'stop', 'target', 'risk_class', 'level', 'note'] as const;
export type PlanRow = Record<(typeof PLAN_COLUMNS)[number], string>;

export const SECTIONS = ['headline', 'exit', 'long', 'short', 'rule', 'risk'] as const;
export type Section = (typeof SECTIONS)[number];
const PREFIX: Record<Section, string> = { headline: 'h', exit: 'x', long: 'l', short: 's', rule: 'r', risk: 'e' };

/** ISO week number of a yyyy-mm-dd date. */
export function isoWeekNumber(day: string): number {
  const d = new Date(day + 'T00:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** Monday of the week that `day` falls in. */
export const mondayOf = (day: string) => { const wd = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(day, -wd); };

export interface PlanInput { week_start: string; written?: string; rows: Record<string, unknown>[] }

const clean = (v: unknown, max = 600) => String(v ?? '').trim().replace(/\s*\n\s*/g, ' ').slice(0, max);

/**
 * Validate a whole week's plan. week, week_end and missing ids are filled in;
 * every row carries the same week fields, as the dashboard expects.
 */
export function validatePlan(input: PlanInput, today: string): { ok: true; rows: PlanRow[] } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const ws = String(input.week_start ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws) || isNaN(Date.parse(ws + 'T00:00:00Z'))) errors.push({ field: 'week_start', message: 'Week start must be a date (yyyy-mm-dd).' });
  else if (mondayOf(ws) !== ws) errors.push({ field: 'week_start', message: 'Week start must be a Monday.' });
  const written = String(input.written || today).trim();
  const rowsIn = Array.isArray(input.rows) ? input.rows : [];
  if (!rowsIn.length) errors.push({ field: 'rows', message: 'The plan has no rows.' });
  if (rowsIn.length > 60) errors.push({ field: 'rows', message: 'The plan has more than 60 rows.' });
  if (errors.length) return { ok: false, errors };

  const week = 'Week ' + isoWeekNumber(ws), week_end = addDays(ws, 6);
  const used = new Set<string>(), counters: Record<string, number> = {};
  const out: PlanRow[] = [];
  rowsIn.forEach((r, i) => {
    const at = (f: string) => `rows.${i}.${f}`;
    const section = clean(r.section).toLowerCase() as Section;
    if (!SECTIONS.includes(section)) { errors.push({ field: at('section'), message: `Row ${i + 1}: unknown section.` }); return; }
    const title = clean(r.title);
    if (!title) errors.push({ field: at('title'), message: `Row ${i + 1}: title is required.` });
    let asset = clean(r.asset).toUpperCase();
    if (section === 'exit' || section === 'long') {
      if (!ASSETS.includes(asset as Asset)) errors.push({ field: at('asset'), message: `Row ${i + 1}: pick the market (BTC, ETH, SPX or NDX).` });
    } else asset = '';
    const row: PlanRow = {
      id: '', week, week_start: ws, week_end, written, section, asset,
      market: asset ? (clean(r.market, 40) || ASSET_LABEL[asset as Asset]) : '',
      title, trigger: '', stop: '', target: '', risk_class: '', level: '', note: clean(r.note),
    };
    if (section === 'long') {
      for (const f of ['trigger', 'stop', 'target', 'risk_class'] as const) {
        row[f] = clean(r[f], 200);
        if (!row[f]) errors.push({ field: at(f), message: `Row ${i + 1}: ${f.replace('_', ' ')} is required for a long setup.` });
      }
      const lv = normNumber(r.level);
      if (lv === null || (lv !== '' && !(Number(lv) > 0))) errors.push({ field: at('level'), message: `Row ${i + 1}: trigger level is not a number.` });
      else row.level = lv;
    }
    let id = clean(r.id, 20);
    if (!/^[a-z]\d{1,3}$/.test(id) || used.has(id)) {
      const p = PREFIX[section];
      do { counters[p] = (counters[p] || 0) + 1; id = p + counters[p]; } while (used.has(id));
    }
    used.add(id); row.id = id;
    out.push(row);
  });
  if (out.filter(r => r.section === 'headline').length > 1) errors.push({ field: 'rows', message: 'Only one headline row per week.' });
  if (errors.length) return { ok: false, errors };
  const order = (s: string) => SECTIONS.indexOf(s as Section);
  return { ok: true, rows: out.map((r, i) => ({ r, i })).sort((a, b) => order(a.r.section) - order(b.r.section) || a.i - b.i).map(x => x.r) };
}
