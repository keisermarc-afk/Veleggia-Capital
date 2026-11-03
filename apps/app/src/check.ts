// The scheduled rule check: fetch FMP data, run the alert engine on Marc's levels, store the
// alerts and the new state, and push the alerts to his phone.
import { runEngine, type AlertState, type Alert } from '../../../packages/alerts/src';
import type { LevelRow, PlanRow } from '../../../packages/data/src';
import { fetchMarketData, FmpError } from './fmp';
import { getVapid, sendToAll, type Note } from './push';
import type { Env } from './env';

const zurich = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

export async function kvGet<T>(db: D1Database, k: string): Promise<T | null> {
  const r = await db.prepare('SELECT v FROM app_kv WHERE k = ?').bind(k).first<{ v: string }>();
  return r ? JSON.parse(r.v) as T : null;
}
export async function kvSet(db: D1Database, k: string, v: unknown) {
  await db.prepare('INSERT INTO app_kv (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, updated_at = ?3').bind(k, JSON.stringify(v), new Date().toISOString()).run();
}

export function noteFor(a: Alert): Note {
  const icon = a.level === 'warn' ? '▼' : a.level === 'good' ? '▲' : '•';
  const name = a.asset === 'SPX' ? (a.type === 'Range' ? 'ES' : 'S&P 500') : a.asset === 'NDX' ? 'NQ' : a.asset;
  return { title: `${icon} ${name} · ${a.type}`, body: a.message, tag: a.key, url: '/?tab=alerts' };
}

export async function runCheck(env: Env, now: Date, opts: { send: boolean; origin: string }): Promise<{ ok: boolean; alerts: Alert[]; error?: string; first?: boolean }> {
  const t0 = Date.now();
  const db = env.DB;
  try {
    const { results: levels } = await db.prepare('SELECT * FROM range_levels').all<LevelRow>();
    const { results: plan } = await db.prepare('SELECT * FROM weekly_plan ORDER BY pos').all<PlanRow>();
    const hourlyFor = levels.filter(l => (l.asset === 'BTC' || l.asset === 'ETH') && Number(l.long_trigger_4h) > 0).map(l => l.asset);
    const market = await fetchMarketData(env.FMP_API_KEY || '', now, hourlyFor, env.DEV_FMP_BASE_URL || undefined);
    const prev = await kvGet<AlertState>(db, 'alert_state');
    const { alerts, state, rules } = runEngine(prev, { ...market, range_levels: levels, weekly_plan: plan } as never, now);
    const at = zurich(now);
    if (alerts.length) {
      await db.batch(alerts.map(a => db.prepare('INSERT OR IGNORE INTO alerts (at, key, asset, type, level, message) VALUES (?, ?, ?, ?, ?, ?)').bind(at, a.key, a.asset, a.type, a.level, a.message)));
    }
    await kvSet(db, 'alert_state', state);
    await kvSet(db, 'rules_snapshot', { at: now.toISOString(), rules });
    let pushInfo = '';
    if (opts.send && alerts.length) {
      const vapid = await getVapid(db, opts.origin);
      // Up to 4 separate notifications; more than that are summed up in one.
      const notes = alerts.length <= 4 ? alerts.map(noteFor)
        : [{ title: `${alerts.length} new alerts`, body: alerts.map(a => `${a.asset} ${a.type}`).join(' · '), tag: 'batch-' + at, url: '/?tab=alerts' }];
      const r = await sendToAll(db, vapid, notes);
      pushInfo = `push sent ${r.sent}, failed ${r.failed}`;
    }
    await db.prepare('INSERT INTO runs (at, ok, n_alerts, error, ms) VALUES (?, 1, ?, ?, ?)').bind(now.toISOString(), alerts.length, pushInfo || (prev ? '' : 'first run: baseline stored, no alerts'), Date.now() - t0).run();
    return { ok: true, alerts, first: !prev };
  } catch (e) {
    const msg = e instanceof FmpError ? e.message : 'Rule check failed: ' + (e as Error).message;
    console.error(msg);
    await db.prepare('INSERT INTO runs (at, ok, n_alerts, error, ms) VALUES (?, 0, 0, ?, ?)').bind(now.toISOString(), msg.slice(0, 300), Date.now() - t0).run().catch(() => {});
    // Tell Marc once if the checks keep failing (3 in a row), so silence never means "no signals" by mistake.
    if (opts.send) {
      const { results } = await db.prepare('SELECT ok FROM runs ORDER BY id DESC LIMIT 3').all<{ ok: number }>();
      const warned = await kvGet<string>(db, 'failure_warned');
      if (results.length === 3 && results.every(r => !r.ok) && warned !== 'yes') {
        await kvSet(db, 'failure_warned', 'yes');
        const vapid = await getVapid(db, opts.origin);
        await sendToAll(db, vapid, [{ title: 'Veleggia checks are failing', body: msg + ' Alerts are paused until this is fixed.', tag: 'check-failing', url: '/?tab=alerts' }]);
      }
    }
    return { ok: false, alerts: [], error: msg };
  } finally {
    // A successful run clears the failure warning, so the next outage is reported again.
    const last = await db.prepare('SELECT ok FROM runs ORDER BY id DESC LIMIT 1').first<{ ok: number }>().catch(() => null);
    if (last?.ok) await kvSet(db, 'failure_warned', 'no').catch(() => {});
  }
}
