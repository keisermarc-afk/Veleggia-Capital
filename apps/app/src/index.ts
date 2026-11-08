import { Hono } from 'hono';
import {
  validateLevel, validatePlan, sortLevels, toCsv, LEVEL_COLUMNS, PLAN_COLUMNS, ASSETS,
  type LevelRow, type PlanRow,
} from '../../../packages/data/src';
import { requireAccess, sameOrigin } from './auth';
import { runCheck, kvGet, noteFor } from './check';
import { getVapid, sendToAll } from './push';
import type { Env } from './env';

type App = { Bindings: Env; Variables: { email: string } };
const app = new Hono<App>();

/** Today's date in Zurich, which is how Marc dates his levels and plans. */
const zurichToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowIso = () => new Date().toISOString();

app.use('/api/*', requireAccess, sameOrigin);
app.use('/api/*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });

app.get('/api/me', c => c.json({ email: c.get('email') }));

// ---------- Range levels ----------
async function loadLevels(db: D1Database): Promise<(LevelRow & { updated_at: string; updated_by: string })[]> {
  const { results } = await db.prepare('SELECT * FROM range_levels').all<LevelRow & { updated_at: string; updated_by: string }>();
  return sortLevels(results) as (LevelRow & { updated_at: string; updated_by: string })[];
}

app.get('/api/levels', async c => c.json({ rows: await loadLevels(c.env.DB) }));

app.put('/api/levels/:asset', async c => {
  const asset = c.req.param('asset').toUpperCase();
  if (!ASSETS.includes(asset as never)) return c.json({ error: 'Unknown asset.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'Send the levels as JSON.' }, 400);
  const prev = await c.env.DB.prepare('SELECT * FROM range_levels WHERE asset = ?').bind(asset).first<LevelRow>();
  const v = validateLevel({ ...body, asset }, zurichToday(), prev);
  if (!v.ok) return c.json({ error: 'Some fields need fixing.', errors: v.errors }, 422);
  const r = v.row, at = nowIso(), by = c.get('email');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO range_levels (asset, range_high, mid, range_low, set_on, note, proxy_ratio, watch_levels, long_trigger_4h, updated_at, updated_by, trigger_tf)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(asset) DO UPDATE SET range_high = ?2, mid = ?3, range_low = ?4, set_on = ?5, note = ?6, proxy_ratio = ?7, watch_levels = ?8, long_trigger_4h = ?9, updated_at = ?10, updated_by = ?11, trigger_tf = ?12`)
      .bind(r.asset, r.range_high, r.mid, r.range_low, r.set_on, r.note, r.proxy_ratio, r.watch_levels, r.long_trigger_4h, at, by, r.trigger_tf),
    c.env.DB.prepare('INSERT INTO range_levels_history (asset, data, saved_at, saved_by) VALUES (?, ?, ?, ?)').bind(r.asset, JSON.stringify(r), at, by),
  ]);
  return c.json({ row: { ...r, updated_at: at, updated_by: by } });
});

app.get('/api/levels/history', async c => {
  const asset = (c.req.query('asset') || '').toUpperCase();
  const q = asset
    ? c.env.DB.prepare('SELECT id, asset, data, saved_at, saved_by FROM range_levels_history WHERE asset = ? ORDER BY id DESC LIMIT 50').bind(asset)
    : c.env.DB.prepare('SELECT id, asset, data, saved_at, saved_by FROM range_levels_history ORDER BY id DESC LIMIT 50');
  const { results } = await q.all<{ id: number; asset: string; data: string; saved_at: string; saved_by: string }>();
  return c.json({ rows: results.map(h => ({ ...h, data: JSON.parse(h.data) })) });
});

// ---------- Weekly plan ----------
async function loadPlan(db: D1Database): Promise<PlanRow[]> {
  const { results } = await db.prepare('SELECT * FROM weekly_plan ORDER BY pos').all<PlanRow & { pos: number }>();
  return results.map(({ pos: _pos, ...r }) => r as PlanRow);
}

app.get('/api/plan', async c => {
  const rows = await loadPlan(c.env.DB);
  const meta = await c.env.DB.prepare("SELECT saved_at, saved_by FROM weekly_plan_history ORDER BY id DESC LIMIT 1").first<{ saved_at: string; saved_by: string }>();
  return c.json({ rows, saved_at: meta?.saved_at ?? null, saved_by: meta?.saved_by ?? null });
});

app.put('/api/plan', async c => {
  const body = await c.req.json<{ week_start: string; written?: string; rows: Record<string, unknown>[] }>().catch(() => null);
  if (!body) return c.json({ error: 'Send the plan as JSON.' }, 400);
  const v = validatePlan(body, zurichToday());
  if (!v.ok) return c.json({ error: 'Some fields need fixing.', errors: v.errors }, 422);
  const at = nowIso(), by = c.get('email');
  const ins = c.env.DB.prepare(`INSERT INTO weekly_plan (pos, id, week, week_start, week_end, written, section, asset, market, title, "trigger", stop, target, risk_class, level, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // One batch = one transaction: the plan is replaced completely or not at all.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM weekly_plan'),
    ...v.rows.map((r, i) => ins.bind(i, r.id, r.week, r.week_start, r.week_end, r.written, r.section, r.asset, r.market, r.title, r.trigger, r.stop, r.target, r.risk_class, r.level, r.note)),
    c.env.DB.prepare('INSERT INTO weekly_plan_history (week, data, saved_at, saved_by) VALUES (?, ?, ?, ?)').bind(v.rows[0].week + ' (' + v.rows[0].week_start + ')', JSON.stringify(v.rows), at, by),
  ]);
  return c.json({ rows: v.rows, saved_at: at, saved_by: by });
});

app.get('/api/plan/history', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, week, saved_at, saved_by, data FROM weekly_plan_history ORDER BY id DESC LIMIT 30').all<{ id: number; week: string; saved_at: string; saved_by: string; data: string }>();
  return c.json({ rows: results.map(h => ({ ...h, rows: JSON.parse(h.data).length, data: undefined })) });
});

// ---------- Exports in the dashboard's file format ----------
const csvResponse = (body: string, name: string) => new Response(body, {
  headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
});
app.get('/api/export/range_levels.csv', async c => csvResponse(toCsv(LEVEL_COLUMNS, await loadLevels(c.env.DB)), 'range_levels.csv'));
app.get('/api/export/weekly_plan.csv', async c => csvResponse(toCsv(PLAN_COLUMNS, await loadPlan(c.env.DB)), 'weekly_plan.csv'));

// ---------- Alerts and push ----------
app.get('/api/alerts', async c => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 60));
  const { results } = await c.env.DB.prepare('SELECT id, at, key, asset, type, level, message FROM alerts ORDER BY id DESC LIMIT ?').bind(limit).all();
  return c.json({ rows: results });
});

app.get('/api/status', async c => {
  const { results: runs } = await c.env.DB.prepare('SELECT at, ok, n_alerts, error, ms FROM runs ORDER BY id DESC LIMIT 12').all();
  const subs = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
  const snap = await kvGet<{ at: string; rules: Record<string, unknown> }>(c.env.DB, 'rules_snapshot');
  return c.json({ runs, subscriptions: subs?.n ?? 0, fmp_key_set: !!c.env.FMP_API_KEY, snapshot: snap });
});

app.get('/api/push/key', async c => c.json({ publicKey: (await getVapid(c.env.DB, new URL(c.req.url).origin)).publicKey }));

app.post('/api/push/subscribe', async c => {
  const body = await c.req.json<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return c.json({ error: 'Not a valid push subscription.' }, 400);
  await c.env.DB.prepare(`INSERT INTO push_subscriptions (endpoint, data, created_at, user_agent) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(endpoint) DO UPDATE SET data = ?2`).bind(sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }), new Date().toISOString(), (c.req.header('User-Agent') || '').slice(0, 200)).run();
  return c.json({ ok: true });
});

app.post('/api/push/unsubscribe', async c => {
  const body = await c.req.json<{ endpoint?: string }>().catch(() => null);
  if (body?.endpoint) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(body.endpoint).run();
  return c.json({ ok: true });
});

app.post('/api/push/test', async c => {
  const vapid = await getVapid(c.env.DB, new URL(c.req.url).origin);
  const r = await sendToAll(c.env.DB, vapid, [noteFor({ key: 'test-' + Date.now(), asset: 'Veleggia', type: 'Test', level: 'info', message: 'Push alerts work. Range and rule signals will arrive like this.' })]);
  return c.json(r);
});

/** Run the rule check now (same as the schedule). Pushes only when ?send=1. */
app.post('/api/check', async c => {
  const r = await runCheck(c.env, new Date(), { send: c.req.query('send') === '1', origin: new URL(c.req.url).origin });
  return c.json(r, r.ok ? 200 : 502);
});

app.get('/api/export/alerts.csv', async c => {
  const { results } = await c.env.DB.prepare('SELECT at, asset, type, level, message, key FROM alerts ORDER BY id DESC LIMIT 500').all<Record<string, string>>();
  return csvResponse(toCsv(['at', 'asset', 'type', 'level', 'message', 'key'], results), 'app_alerts.csv');
});

app.notFound(c => c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw));
app.onError((err, c) => { console.error(err); return c.json({ error: 'Something went wrong on the server.' }, 500); });

export default {
  fetch: app.fetch,
  // The schedule (wrangler.jsonc "triggers"): run the rule check and push new alerts.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCheck(env, new Date(event.scheduledTime), { send: true, origin: 'https://veleggia-capital.keiser-marc.workers.dev' }).then(() => undefined));
  },
};
