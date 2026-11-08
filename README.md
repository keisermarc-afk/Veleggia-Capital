# Veleggia Capital: rules app

The app version of Marc's macro dashboard. Phase 1:

1. Enter and edit range levels and the weekly plan directly in the app.
2. An installable phone app (PWA) with push alerts for range and rule signals.

The Claude macro dashboard keeps running unchanged until this app is verified against it.

## Architecture (proposed 3 Nov 2026)

```
Phone (installed PWA)  ──>  Cloudflare Worker (API + login)  ──>  D1 database
  edit levels + plan            secrets only here:                  levels, weekly plan,
  receive push alerts           FMP key, VAPID key, (later Bybit)   alert state, history
                                        ▲
                     Cron Triggers ─────┘  fetch FMP → packages/rules → compare state → Web Push
```

- **Hosting:** Cloudflare Workers Paid ($5 per month): Worker, D1 database and Cron Triggers in one plan.
- **Login:** Cloudflare Access (email code) in front of the app. Single user.
- **Secrets:** set with `wrangler secret put` or in the Cloudflare dashboard. Never in the repo, never in chat. `.dev.vars` and `.env*` are git-ignored.
- **Push on iPhone:** works only once the app is added to the home screen and opened from there (Apple's rule for web apps).

## Build order

1. **Rules engine and parity tests** (done): `packages/rules`.
2. **API and the editing screens** for range levels and the weekly plan (done, waiting for the Cloudflare setup below): `apps/app`, `packages/data`.
3. **Scheduled checks and push alerts** (built): `packages/alerts`, `apps/app/src/check.ts`.
4. Parallel run next to the dashboard (about 2 weeks). Cutover only with zero rule-state mismatches and every dashboard alert matched by an app alert.

## The app: `apps/app`

A Cloudflare Worker (Hono) with a D1 database and the screens in `apps/app/public` (plain HTML/JS, installable as a PWA).

- **Levels:** one card per market (BTC, ETH, ES, NQ) with range high, mid, low, watch levels, 4H long trigger, note, and the NQ ratio. Numbers can be typed as `87300`, `87,300` or `87'300`. "Set on" moves to today only when a level changes, not for a note edit.
- **Weekly plan:** headline, long setups (market, trigger, stop, target, risk class, trigger level), exits, shorts, rules, event risk. Each row folds to one line. "Start next week from this plan" copies it to the following Monday.
- **History:** every save of levels and plans is kept.
- **Files for the dashboard:** `/api/export/range_levels.csv` and `/api/export/weekly_plan.csv` are byte-for-byte the dashboard's file format, for the parallel run.
- **Login:** Cloudflare Access in front of the Worker. The Worker also verifies the Access token itself (`apps/app/src/auth.ts`) and refuses everything while Access is not configured. Writes must come from the app's own page.
- **Data rules** (`packages/data`): validation and CSV format shared by the server and the tests. The tests round-trip the dashboard's current files unchanged.

Local development:
```
cd apps/app
echo DEV_AUTH_BYPASS=local-dev-only > .dev.vars   # localhost only, never deployed
npx wrangler d1 migrations apply veleggia --local
npx wrangler dev
```

## Cloudflare setup (one time, done by Marc)

1. **D1 database:** Cloudflare dashboard > Storage & Databases > D1 > Create, name `veleggia`. The database ID goes into `apps/app/wrangler.jsonc` (not secret).
2. **GitHub secret** (repo Settings > Secrets and variables > Actions): `CLOUDFLARE_API_TOKEN`, from Account API tokens > Create token > template "Edit Cloudflare Workers", plus the permission Account > D1 > Edit, limited to this account. The account id sits in `apps/app/wrangler.jsonc` (not secret).
3. Every push to `main` then runs the tests and, only if they pass, applies the database migrations and deploys (`.github/workflows/ci.yml`).
4. **Login:** in Workers & Pages > veleggia-capital > Access, "Protect this Worker behind Access", All traffic, a policy allowing only Marc's email. Then put the team domain (`<team>.cloudflareaccess.com`) and the application's AUD tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc` (not secret).

## Alerts (step 3)

- **When:** every hour at :05 UTC (crypto daily close at 00:05, every 4H close, ES futures close at 21:05/22:05) and at 16:20 New York on weekdays for the cash index close. Cron in `apps/app/wrangler.jsonc`.
- **What:** `packages/alerts` follows the close-based rules of Claude's "Dashboard change alerts" task: regime confirmed, early signal, EMA50/EMA200 (crypto) and EMA50/EMA100/EMA200 (indices) close crosses, the two-close EMA50 exit, weekly trend, macro cycle, 200 hold rule, range signals, watch levels and the 4H long trigger. Every event alerts once (unique key). A continuing range break alerts once, not every day. A later FMP revision that flips a state alerts again, marked "revised data".
- **4H sweep and reclaim (BTC, ETH, added 6 Nov 2026):** a completed 4H candle (00/04/08/12/16/20 UTC) that trades below the range low or a watch level and closes back above it alerts as a long trigger; one that trades above the range high or a watch level and closes back below alerts as a failed push. A touch that stays on the right side does not alert. If the macro cycle is not "Uptrend intact", the alert says the long is Setup Only risk. Test: `packages/alerts/test/sweep4h.test.ts` (BTC's real sweep of 75,000 on 6 Nov, alerted at 17:05 Zurich).
- **Trigger timeframe (added 8 Nov 2026):** each crypto trigger level can be set to two 4H closes (default) or two 1H closes (`trigger_tf` = `1H`, chosen next to the trigger in the Levels tab). ETH's 2,255 trigger uses 1H.
- **Index trigger levels (ES, NQ, added 8 Nov 2026):** the FMP plan has no ES/NQ intraday data, so a 4H trigger level on SPX or NDX alerts on the daily close back above it (ES bars, NQ estimate) and the message asks Marc to confirm the 4H closes on his chart.
- **Not here yet:** intraday price crosses, ETF flows, funding, insider trades (they stay in the Claude task).
- **First run** stores the current state as a baseline and sends nothing.
- **Failures:** every run is logged (`runs` table, shown in the Alerts tab). Three failed runs in a row send one "checks are failing" push, so silence never means "no signal" by mistake.
- **Push:** standard Web Push (VAPID). The key pair is created once in the Worker and kept in D1. On iPhone push works only in the app opened from the Home Screen.
- **Tests:** `packages/alerts/test/replay.test.ts` replays 27 Oct to 3 Nov 2026 hour by hour and checks the app raises the same alerts as Claude's task did (exits, 200 hold, NAS100 below its EMA200, ES rejected at mid, ETH 4H trigger on the same candles), never repeats an alert, and alerts the ETH 4H trigger at 08:05 UTC (Claude's task: 08:34).
- **Secret:** `FMP_API_KEY`, set by Marc as a Worker secret in the Cloudflare dashboard.

## Rules engine: `packages/rules`

Pure functions, no network, with the clock passed in (`now`), so the same code runs in the Worker, in tests and later in the browser.

| Function | Dashboard calc | Rule |
|---|---|---|
| `cryptoTrend` | `crypto_trend` | Crypto EMA12/21 state, 3-close confirmed regime, EMA50 two-close exit |
| `equityHealth` | `equity_health` | Index EMA200 health, trend wave, EMA50 test / exit |
| `equityWeekly` | `equity_weekly` | Weekly EMA12/21 rule for SPX and NAS100 |
| `macroCycle` | `macro_cycle` | Macro cycle (Uptrend intact / Exhaustion warning / Uptrend weak), 200 hold rule |
| `rangeWatch` | `range_watch` | Range signals on ES bars and the NQ estimate |
| `setupWatch` | `setup_watch` | Weekly plan long setups vs the last close |

The formulas are copied from the dashboard expression by expression. Do not simplify them: results are compared exactly.

## Parity guarantee

`reference/dashboard-calcs.js` holds the dashboard's own calc code, extracted from the dashboard page by `tools/extract-reference.mjs`. The test `packages/rules/test/parity.test.ts`:

- runs the dashboard code in a sandbox with a frozen clock next to `packages/rules`, on the same FMP data (`fixtures/<date>/`);
- does this at about 400 moments: every half hour over 7 days, plus the minutes either side of every cut-off the rules use (UTC midnight, New York 16:15, New York 17:00, across the daylight-saving change);
- requires byte-identical results for every calc.

A deliberate one-line rule change (EMA21 cross threshold 4 → 3) makes the test fail, so it does catch differences.

When a rule changes on the dashboard: save the page, re-run `node tools/extract-reference.mjs <index.html> <version>`, port the change, and the test must pass again. Add a new fixture folder when market conditions show a state the old fixtures do not cover.

```
npm install
npm test          # parity tests
npm run typecheck
```

## Data inputs

The same FMP endpoints the dashboard uses (see `packages/rules/src/index.ts`). The 900-day history window matters, because every EMA is seeded from the first closes in the window.

Known data limits (from the dashboard notes):
- No Nasdaq 100 data on the FMP plan: NAS100 = QQQ × 41.10 for the rules, and NQ is estimated from QQQ × ratio × the ES premium for range levels. Recalibrate the ratio every couple of months.
- S&P range levels are ES1! levels, checked on ESUSD bars.

## Not investment advice

This software applies Marc's own rules to market data. It does not give trade instructions.

## Database workflow (manual)

`.github/workflows/db.yml`, started by hand (or by Claude through the GitHub API):
- `read` prints the live range levels, the latest level saves, the weekly plan, the last runs and alerts.
- `apply` runs one SQL file from `ops/`, reviewed in git. Used to load a weekly plan written in chat: `npx vite-node tools/plan-sql.ts <weekly_plan.csv> ops/plan_<year>-W<nn>.sql` validates the plan with the app's own rules and writes the SQL.
