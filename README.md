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

1. **Rules engine and parity tests** (this commit): `packages/rules`.
2. API and the editing screens for range levels and the weekly plan.
3. Scheduled checks and push alerts.
4. Parallel run next to the dashboard (about 2 weeks). Cutover only with zero rule-state mismatches and every dashboard alert matched by an app alert.

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
