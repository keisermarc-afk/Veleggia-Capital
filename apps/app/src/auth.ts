// Login: Cloudflare Access sits in front of the app and signs every request with a JWT
// (header Cf-Access-Jwt-Assertion). The Worker checks that signature itself, so a request
// that somehow bypassed Access is still refused. Deny by default when not configured.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const requireAccess: MiddlewareHandler<{ Bindings: Env; Variables: { email: string } }> = async (c, next) => {
  const env = c.env;
  const url = new URL(c.req.url);
  // Local development only: `wrangler dev` on localhost with DEV_AUTH_BYPASS set in .dev.vars (never in production).
  if (env.DEV_AUTH_BYPASS === 'local-dev-only' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    c.set('email', 'dev@localhost');
    return next();
  }
  const team = (env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = (env.ACCESS_AUD || '').trim();
  if (!team || !aud) return c.json({ error: 'Login is not set up yet (Cloudflare Access team domain and audience missing).' }, 503);
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.json({ error: 'Not signed in.' }, 401);
  let jwks = jwksCache.get(team);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)); jwksCache.set(team, jwks); }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud });
    const email = String(payload.email || '');
    const allowed = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email.toLowerCase())) return c.json({ error: 'This account is not allowed.' }, 403);
    c.set('email', email);
    return next();
  } catch {
    return c.json({ error: 'Sign-in could not be verified.' }, 401);
  }
};

/** Writes must come from the app's own page (blocks cross-site form posts). */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin');
    if (!origin || new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'Cross-site request refused.' }, 403);
    if (!(c.req.header('Content-Type') || '').includes('application/json')) return c.json({ error: 'Send JSON.' }, 415);
  }
  return next();
};
