// Send a test push to every saved subscription, from GitHub Actions (.github/workflows/push-test.yml).
// Input: two JSON files from `wrangler d1 execute --json` (VAPID row, subscriptions).
// Output: one line per subscription with only coarse facts (device, push service, created date, HTTP status).
// The repo's Actions logs can be public, so keys and endpoints are never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPushPayload } from '@block65/webcrypto-web-push';

const rows = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return (Array.isArray(j) ? j[0] : j).results || []; };
const [vapidFile, subsFile, goneFile] = process.argv.slice(2);
const vrow = rows(vapidFile)[0];
if (!vrow) { console.log('No push key in the database yet: the app has never been asked for one. Turn alerts on in the app first.'); process.exit(0); }
const { publicKey, privateKey } = JSON.parse(vrow.v);
const vapid = { publicKey, privateKey, subject: 'https://afk-capital.keiser-marc.workers.dev' };
const subs = rows(subsFile);
console.log(`Subscriptions in the app: ${subs.length}`);
if (!subs.length) console.log('No phone or browser is registered for alerts. In the installed app: Alerts tab, turn alerts on, allow notifications.');

const device = ua => /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'other';
const note = { title: 'AFK Capital', body: 'Test push sent by Claude. Push alerts work.', tag: 'test', url: '/?tab=alerts' };
const gone = [];
let ok = 0;
for (const [i, s] of subs.entries()) {
  const sub = JSON.parse(s.data);
  let status = 'error';
  try {
    const payload = await buildPushPayload({ data: JSON.stringify(note), options: { ttl: 3600, urgency: 'high', topic: 'test' } }, sub, vapid);
    const res = await fetch(sub.endpoint, payload);
    status = String(res.status);
    if (res.ok) ok++;
    if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
  } catch (e) { status = 'error: ' + String(e.message).slice(0, 80); }
  console.log(`#${i + 1}  ${device(s.user_agent || '')}  via ${new URL(sub.endpoint).host}  registered ${String(s.created_at).slice(0, 16)}  ->  ${status}`);
}
console.log(`Delivered to the push service: ${ok} of ${subs.length}. Gone (will be removed): ${gone.length}.`);
writeFileSync(goneFile, gone.map(e => `DELETE FROM push_subscriptions WHERE endpoint = '${e.replace(/'/g, "''")}';`).join('\n'));
