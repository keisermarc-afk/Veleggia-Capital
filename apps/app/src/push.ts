// Web Push (RFC 8291 / 8292) to Marc's installed app. The VAPID key pair is created once inside
// the Worker and kept in the D1 database (server side only; never in the repo or the browser).
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface Vapid { publicKey: string; privateKey: string; subject: string }

export async function getVapid(db: D1Database, subject: string): Promise<Vapid> {
  const row = await db.prepare("SELECT v FROM app_kv WHERE k = 'vapid'").first<{ v: string }>();
  if (row) return { ...JSON.parse(row.v), subject };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer;
  const keys = { publicKey: b64u(raw), privateKey: jwk.d! };
  // INSERT OR IGNORE: if two requests race, the first key pair wins and both read it back.
  await db.prepare("INSERT OR IGNORE INTO app_kv (k, v, updated_at) VALUES ('vapid', ?, ?)").bind(JSON.stringify(keys), new Date().toISOString()).run();
  const stored = await db.prepare("SELECT v FROM app_kv WHERE k = 'vapid'").first<{ v: string }>();
  return { ...JSON.parse(stored!.v), subject };
}

export interface Note { title: string; body: string; tag?: string; url?: string }

/** Send to every saved subscription; drops subscriptions the push service says are gone. */
export async function sendToAll(db: D1Database, vapid: Vapid, notes: Note[]): Promise<{ sent: number; failed: number; removed: number }> {
  const { results } = await db.prepare('SELECT endpoint, data FROM push_subscriptions').all<{ endpoint: string; data: string }>();
  let sent = 0, failed = 0, removed = 0;
  for (const s of results) {
    const sub = JSON.parse(s.data) as PushSubscription;
    for (const note of notes) {
      try {
        const payload = await buildPushPayload({ data: JSON.stringify(note), options: { ttl: 24 * 3600, urgency: 'high', topic: note.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '_') } }, sub, vapid);
        const res = await fetch(sub.endpoint, payload);
        if (res.status === 404 || res.status === 410) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
          removed++; break;
        }
        if (res.ok) sent++; else { failed++; console.error('push failed', res.status); }
      } catch (e) { failed++; console.error('push error', (e as Error).message); }
    }
  }
  return { sent, failed, removed };
}
