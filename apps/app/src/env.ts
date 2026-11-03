export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Cloudflare Access team domain, for example "veleggia.cloudflareaccess.com" (not secret). */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application (not secret). */
  ACCESS_AUD?: string;
  /** Optional comma-separated list of emails allowed in, as a second check after Access. */
  ALLOWED_EMAILS?: string;
  /** FMP API key: a Worker secret set by Marc in the Cloudflare dashboard. Never in the repo. */
  FMP_API_KEY?: string;
  /** Only in .dev.vars: a local mock of FMP serving the test fixtures. */
  DEV_FMP_BASE_URL?: string;
  /** Only in .dev.vars for `wrangler dev` on localhost: "local-dev-only". */
  DEV_AUTH_BYPASS?: string;
}
