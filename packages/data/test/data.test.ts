import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, toCsv, validateLevel, validatePlan, normNumber, LEVEL_COLUMNS, PLAN_COLUMNS, isoWeekNumber, type LevelRow } from '../src';

const FX = join(__dirname, '..', '..', '..', 'fixtures', '2026-11-03');
const levelsCsv = readFileSync(join(FX, 'range_levels.csv'), 'utf8');
const planCsv = readFileSync(join(FX, 'weekly_plan.csv'), 'utf8');

describe('numbers', () => {
  it('reads the ways Marc types levels', () => {
    expect(normNumber('87300')).toBe('87300');
    expect(normNumber('87,300')).toBe('87300');
    expect(normNumber("87'300")).toBe('87300');
    expect(normNumber(' 7620.25 ')).toBe('7620.25');
    expect(normNumber('41.10')).toBe('41.10');
    expect(normNumber('')).toBe('');
    expect(normNumber('7,620.25')).toBe('7620.25');
    expect(normNumber('7620,25')).toBeNull();
    expect(normNumber('abc')).toBeNull();
  });
});

describe('range levels', () => {
  const rows = parseCsv(levelsCsv) as LevelRow[];

  it('round-trips the dashboard file unchanged (same rows, same set_on dates)', () => {
    const out = rows.map(r => { const v = validateLevel(r, '2026-11-03', r); if (!v.ok) throw new Error(JSON.stringify(v.errors)); return v.row; });
    expect(parseCsv(toCsv(LEVEL_COLUMNS, out))).toEqual(rows);
  });

  it('moves set_on only when a level changes, not for a note edit', () => {
    const btc = rows.find(r => r.asset === 'BTC')!;
    const noteOnly = validateLevel({ ...btc, note: 'new note' }, '2026-11-05', btc);
    expect(noteOnly.ok && noteOnly.row.set_on).toBe(btc.set_on);
    const moved = validateLevel({ ...btc, range_low: '74500' }, '2026-11-05', btc);
    expect(moved.ok && moved.row.set_on).toBe('2026-11-05');
  });

  it('rejects impossible levels', () => {
    const bad = (x: Record<string, unknown>) => { const v = validateLevel(x, '2026-11-03'); return v.ok ? [] : v.errors.map(e => e.field); };
    expect(bad({ asset: 'BTC', range_high: '75000', range_low: '87300' })).toContain('range_high');
    expect(bad({ asset: 'BTC', range_high: '87300', range_low: '75000', mid: '90000' })).toContain('mid');
    expect(bad({ asset: 'NDX', range_high: '31000', range_low: '28200' })).toContain('proxy_ratio');
    expect(bad({ asset: 'ETH', range_high: '2780', range_low: '2350', watch_levels: '2178;abc' })).toContain('watch_levels');
    expect(bad({ asset: 'XRP', range_high: '3', range_low: '2' })).toContain('asset');
  });

  it('drops a ratio on assets that do not use one', () => {
    const v = validateLevel({ asset: 'BTC', range_high: '87300', range_low: '75000', proxy_ratio: '41.1' }, '2026-11-03');
    expect(v.ok && v.row.proxy_ratio).toBe('');
  });
});

describe('weekly plan', () => {
  const rows = parseCsv(planCsv);

  it('round-trips the dashboard file unchanged', () => {
    const v = validatePlan({ week_start: rows[0].week_start, written: rows[0].written, rows }, '2026-11-03');
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    expect(parseCsv(toCsv(PLAN_COLUMNS, v.rows))).toEqual(rows);
  });

  it('fills in week, week end, market names and ids', () => {
    const v = validatePlan({ week_start: '2026-11-09', rows: [
      { section: 'headline', title: 'Quiet week.' },
      { section: 'long', asset: 'spx', title: 'Mid reclaim', trigger: 'Two closes above 7,620', stop: 'Below the reclaim low', target: '7,895', risk_class: 'Normal', level: '7,620.25' },
    ] }, '2026-11-08');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.rows[0]).toMatchObject({ id: 'h1', week: 'Week 46', week_end: '2026-11-15', written: '2026-11-08' });
    expect(v.rows[1]).toMatchObject({ id: 'l1', asset: 'SPX', market: 'ES (S&P)', level: '7620.25' });
  });

  it('requires a Monday and the long-setup fields', () => {
    const v = validatePlan({ week_start: '2026-11-10', rows: [{ section: 'long', asset: 'BTC', title: 'x' }] }, '2026-11-08');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map(e => e.field)).toContain('week_start');
    const w = validatePlan({ week_start: '2026-11-09', rows: [{ section: 'long', asset: 'BTC', title: 'x' }] }, '2026-11-08');
    expect(!w.ok && w.errors.map(e => e.field)).toEqual(expect.arrayContaining(['rows.0.trigger', 'rows.0.stop', 'rows.0.target', 'rows.0.risk_class']));
  });

  it('numbers ISO weeks like the dashboard', () => {
    expect(isoWeekNumber('2026-11-02')).toBe(45);
    expect(isoWeekNumber('2026-12-28')).toBe(53);
    expect(isoWeekNumber('2027-01-04')).toBe(1);
  });
});
