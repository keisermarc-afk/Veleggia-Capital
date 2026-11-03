export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Cloudflare Access team domain, for example "veleggia.cloudflareaccess.com" (not secret). */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application (not secret). */
  ACCESS_AUD?: string;
  /** Optional comma-separated list of emails allowed in, as a second check after Access. */
  ALLOWED_EMAILS?: string;
  /** Only in .dev.vars for `wrangler dev` on localhost: "local-dev-only". */
  DEV_AUTH_BYPASS?: string;
}
