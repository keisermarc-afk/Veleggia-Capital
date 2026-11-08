import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, toCsv, validatePlan, PLAN_COLUMNS } from '../packages/data/src';
const rows = parseCsv(readFileSync(process.argv[2], 'utf8')) as Record<string, string>[];
const v = validatePlan({ week_start: rows[0].week_start, written: rows[0].written, rows }, '2026-11-08');
if (!v.ok) { console.error(JSON.stringify(v.errors)); process.exit(1); }
const same = toCsv(PLAN_COLUMNS, v.rows) === readFileSync(process.argv[2], 'utf8');
console.log('rows', v.rows.length, 'csv unchanged by validation:', same);
const q = (s: unknown) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const at = new Date().toISOString();
const sql = [
  `-- Week 46 plan (9 to 15 Nov 2026), written by Claude in the Dashboard & Alerts chat on 8 Nov 2026 from Marc's levels of 8 Nov.`,
  `-- Same content as the dashboard's weekly_plan.csv. Replaces the copied Week 45 plan.`,
  `DELETE FROM weekly_plan;`,
  ...v.rows.map((r, i) => `INSERT INTO weekly_plan (pos, id, week, week_start, week_end, written, section, asset, market, title, "trigger", stop, target, risk_class, level, note) VALUES (${i}, ${[r.id, r.week, r.week_start, r.week_end, r.written, r.section, r.asset, r.market, r.title, r.trigger, r.stop, r.target, r.risk_class, r.level, r.note].map(q).join(', ')});`),
  `INSERT INTO weekly_plan_history (week, data, saved_at, saved_by) VALUES (${q(v.rows[0].week + ' (' + v.rows[0].week_start + ')')}, ${q(JSON.stringify(v.rows))}, ${q(at)}, 'Claude (weekly plan, chat)');`,
];
writeFileSync(process.argv[3], sql.join('\n') + '\n');
