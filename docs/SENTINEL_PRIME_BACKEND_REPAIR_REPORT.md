# SENTINEL PRIME — BACKEND REPAIR REPORT

Date: 2026-10-14. Scope: audit + repair of the Sentinel Prime backend per the
Backend Repair Master Prompt. Every claim below is backed by commands actually
run in this repository; real outputs are summarized in §7. Nothing in this
report is aspirational — anything unverified is labeled as such.

---

## 1. Confirmed defects found (prioritized)

| # | Severity | Defect (evidence) | Impact | Fix |
|---|----------|-------------------|--------|-----|
| D1 | HIGH | **No real market-data providers.** Every adapter was `SIMULATED`/`NOT_CONFIGURED` (prior audit SP-P1-002 open); screens showed hardcoded quotes (`1.08425`) and synthetic seed candles only. | No decision could be supported by real market data; any "live" claim would have been false. | Real adapters in `src/convex/lib/marketData.ts` (Kraken + Coinbase crypto OHLC, ECB/Frankfurter FX rates), strict response validation, honest `LIVE/CACHED/STALE/SIMULATED/UNAVAILABLE` labels, provider-health tracking. |
| D2 | HIGH | **No news subsystem.** No news table, no provider interface, no ingestion; the UI's "Verified catalyst" was a hardcoded string. | No analysis could reference real, sourced, timestamped news. | `src/convex/lib/news.ts` provider interface + Yahoo Finance RSS adapter (verified), impact/evidence classification, dedup, freshness, honest selection; `newsItems` persistence (`src/convex/news.ts`). |
| D3 | HIGH | **No analysis pipeline.** "Run Market Analysis" only navigated (prior audit: "no screen's control invokes the analysis pipeline"); no code path gathered data→news→quality→strategy→risk→verdict. | The product's core workflow did not exist server-side. | `src/convex/analysis.ts`: authenticated 10-step pipeline, deterministic strategy evaluation (`lib/strategyEval.ts`), outcomes through the **existing** `evaluateRisk`/`loadRiskContext` engine, honest BUY/SELL/WAIT/NO TRADE verdicts. |
| D4 | HIGH | **No persisted analysis history.** No schema or queries for analysis runs; HistoryScreen showed demo rows. | Analyses vanished; no owner-scoped traceability or auditability. | `analysisRuns` table + `analysis.history` (validated pagination, owner-scoped at the index) + `analysis.get` (owner-only, not-found ≡ not-owned). |
| D5 | MEDIUM | **Global candle scan.** `console.data` used `candles.take(2000)` and grouped by market in memory, mixing timeframes and ignoring bounds. | Unbounded reads, wrong/incoherent series for charts. | `console.data` now per-market `by_market_tf_time` bounded reads; new `marketData.candles` query: instrument + timeframe specific, validated OHLC, chronological, bounded range/limit, explicit freshness, honest empty state. |
| D6 | MEDIUM | **User preferences not persisted.** Settings toggles were session-local; workstation defaults were static text. | Preferences lost on reload; nothing validated market/timeframe/horizon. | `userPreferences` table + `preferences.get/save` with strict server-side validation (market existence, timeframe/horizon allowlists, server-derived symbol) and safe fallback for missing/invalid rows; SettingsScreen wired to load on startup and save. |
| D7 | MEDIUM | **No provider health / failure / rate-limit tracking.** Failures left no trace; nothing could distinguish LIVE from CACHED/STALE. | Data honesty unprovable at the system level. | `providerHealth` table + `healthAfterSuccess/Failure` state machine (DEGRADED→UNAVAILABLE, rate-limit deadlines) + `marketData.health` query. |
| D8 | LOW | **No forming-bar semantics.** Still-open provider candles had no marker and could pollute indicator series. | Indicators could be computed on partial bars without disclosure. | `persistCandles` marks bars still forming at retrieval `INCOMPLETE`; chart queries exclude them and report `partialBars`; analysis series excludes them. |
| D9 | LOW | **FX candle honesty gap** (pre-existing design hole): seeded FX "candles" implied an OHLC feed that no keyless provider publishes. | FX candles could only be fabricated. | FX candle path returns honest `NOT_CONFIGURED/UNAVAILABLE`; the verified ECB feed is persisted as **close-only rate observations** (`rateObservations`) — no synthetic OHLC is ever derived. |

## 2. Files changed and why

**New (backend):**
- `src/convex/lib/marketData.ts` — provider adapters (Kraken, Coinbase, ECB/Frankfurter), strict response/series validation, timeframe+symbol mapping with honest gaps (e.g. Coinbase has no 4h bucket → `UNSUPPORTED_REQUEST`), `deriveDataLabel`, provider-health state machine. Pure; network only via injected fetch (same pattern as `lib/databricks.ts`).
- `src/convex/lib/news.ts` — `NewsProviderAdapter` contract, Yahoo Finance RSS adapter, impact classification **with matched-phrase evidence** (no evidence ⇒ `UNKNOWN`), relevance tagging, content-hash dedup, freshness classes, `selectHighImpactNews` (returns `null` + reason instead of inventing a headline).
- `src/convex/lib/strategyEval.ts` — deterministic evaluation of registered structured candidates (`ema_cross` + declared RSI no-trade filter) with `NOT_EVALUATED` honesty when data is thin; no fabricated indicators/entries.
- `src/convex/analysis.ts` — pipeline core + `run` mutation, `runInternal` (action entry), `history` (paginated), `get`; `AnalysisRunRecord` typed trace record.
- `src/convex/marketData.ts` — `candles` chart query (bounded, labeled), `health`, `instruments`, internal `persistCandles`/`persistRates`/`recordHealth`.
- `src/convex/news.ts` — `persist` (dedup at write time), `latest`, `topImpact` (read-time freshness recheck).
- `src/convex/providers.ts` (`"use node"`) — authenticated `refreshMarketData`, `refreshNews`, and one-call `runAnalysisWithFreshData` orchestration. The only network-touching code.
- `src/convex/preferences.ts` — validated `get`/`save`.

**Modified:**
- `src/convex/schema.ts` — five new tables + `dataLabelValidator`/`newsImpactValidator`/`analysisVerdictValidator` (additive; no existing table altered).
- `src/convex/console.ts` — `data` query de-globalized (per-market indexed bounded reads).
- `src/components/sentinel/screens/SettingsScreen.tsx` — loads persisted prefs on startup with safe defaults, editable pair/timeframe/horizon + notification flags, real `preferences.save`; all pinned design markers preserved.
- `src/components/console/DataPanel.tsx` — call-site updated for `console.data` args.
- `src/tests/db-verification.ts` — +29 DB-level regression checks (module map extended).
- `src/tests/ui-reset.test.mjs` — api mock extended with the new endpoints; **no assertion changed**.
- `package.json` — test script includes the new suite.

**New (tests):** `src/tests/marketdata-verification.ts` — 50 offline checks over real recorded provider responses.

## 3. Database/schema changes

Additive only (existing tables untouched):
- `analysisRuns` — owner, request params, data label + quality checks, snapshot binding, news reference + timestamps, per-strategy results + evidence, risk checks + policy ref, verdict + evidence, status/errors, start/completion time. Indexes: `by_analysisId`, `by_owner_started`.
- `newsItems` — provider, source URL, headline/summary, published+retrieved timestamps, market/instrument/currency/asset tags, impact + evidence, relevance, content hash, freshness. Indexes: `by_contentHash`, `by_market_retrieved`.
- `providerHealth` — provider, kind, status, failure class, consecutive failures, last success/failure, rate-limit deadline, latency, note. Index: `by_provider`.
- `rateObservations` — ECB close-only FX fixes with provider + source URL + retrieval time + label note. Index: `by_market_date`.
- `userPreferences` — market/instrument (server-derived symbol), timeframe, horizon, notification flags. Index: `by_userId`.

## 4. Provider integrations actually implemented and verified

Connectivity **actually verified live from this project's environment on 2026-10-14** (real responses captured and asserted as fixtures in `src/tests/marketdata-verification.ts`):

| Provider | Endpoint | Status | Used for |
|---|---|---|---|
| Kraken | `api.kraken.com/0/public/OHLC` | VERIFIED (real BTC/USD bars parsed) | Crypto OHLC candles (primary) |
| Coinbase Exchange | `api.exchange.coinbase.com/products/*/candles` | VERIFIED (real BTC-USD candles parsed) | Crypto OHLC candles (fallback) |
| ECB via Frankfurter | `api.frankfurter.dev/v1/*` | VERIFIED (real EUR/USD fixes parsed) | FX close-only reference rates |
| Yahoo Finance RSS | `feeds.finance.yahoo.com/rss/2.0/headline` | VERIFIED (real items parsed) | Market news |

All four are keyless public endpoints — no credentials are read, sent, stored
or logged. Runtime fetches from the deployed Convex functions are re-verified
per request; any failure yields an honest `UNAVAILABLE` + failure class
(`NETWORK_ERROR`, `HTTP_ERROR`, `RATE_LIMITED` with deadline, `AUTH_FAILED`,
`MALFORMED_RESPONSE`, `INVALID_DATA`, `UNSUPPORTED_REQUEST`, `NOT_CONFIGURED`).
**No provider is claimed connected beyond the verification above.** FX
intraday OHLC candles are NOT available and are NOT faked (see D9).

## 5. Analysis workflow implemented

`providers.runAnalysisWithFreshData` (one authenticated call) or the
composable `analysis.run` mutation executes:
1. request + permission validation (server identity only; allowlisted timeframe/horizon; token-checked ids),
2. market data retrieval for the exact instrument + timeframe (provider bars and synthetic bars are **never merged**; the origin decides the label),
3. news retrieval (most relevant high-impact item, or an explicit `UNAVAILABLE` reason),
4. deterministic data-quality + freshness validation (`lib/dataQuality.ts`),
5. timestamped `dataSnapshots` row bound to the actual bar range + `dataVersion`,
6. evaluation of **every registered strategy candidate** for the market (honestly: only **two** candidates exist repo-wide — `STRAT-EMA-MOMENTUM`, `STRAT-RSI-REVERSION`; there is no set of ten),
7. per-strategy results + indicator evidence recorded verbatim,
8. proposed outcomes (from real last close + the candidate's own sizing) through the **existing** `evaluateRisk` — never bypassed,
9. verdict: `BUY`/`SELL` require a real risk `APPROVE`; any `BLOCK`/`UNKNOWN` ⇒ `NO TRADE`; no entry trigger ⇒ `WAIT`; bad/missing data or unevaluable strategies ⇒ `NO TRADE` with `BLOCKED`/`INSUFFICIENT_DATA`,
10. persistence + `ANALYSIS_RUN` audit event; no order/authorization/position is ever created.

## 6. Security fixes

- All new public functions gate on `getAuthUserId`; analysis records are owner-scoped **at the index level**; `get` returns not-found for foreign ids (no ID oracle).
- Every argument validated server-side: identifier tokens, allowlists (timeframe/horizon), pagination limits 1..100, chart limits ≤500 bars, bounded date ranges, bounded table reads.
- Secret handling: the new adapters take **no credentials at all**; failure details are sanitized (no URLs/query strings echoed) — asserted with canary secrets (`TEST-MD-NET-001/003`); `DB-SEC-001` scans every new table for canary material. When keyed providers are added, keys belong in the Convex environment/secret store (`process.env` in `"use node"` actions) — never the database; the existing KMS requirement (SPEC-GAP-007) remains documented.
- Audit: `ANALYSIS_RUN` and `MARKET_DATA_PERSISTED` events appended to the existing hash-chained log with correlation ids.
- Execution safety: the analysis path creates **no financial state**; the deterministic risk engine and its veto are unchanged and mandatory (`DB-ANALYSIS-005` asserts zero orders/authorizations/positions after runs).
- Request errors never echo caller input and never leak stack traces.

## 7. Tests run — real results (2026-10-14)

| Command | Result |
|---|---|
| `bun run test` | **exit 0** — engine **116 passed / 0 failed**; db **142 / 0** (incl. 29 new DB-ANALYSIS/CHART/HEALTH/NEWS/PREF/SEC checks); marketdata (new) **50 / 0**; databricks **16 / 0**; ui-reset **14 pass / 0 fail** (178 expects). Total **338 checks, 0 failures**. |
| `bunx tsc -b --noEmit` | **exit 0** |
| `bun run lint` | **exit 0** — 0 errors, 17 warnings (exact pre-existing baseline) |
| `bun run build` | **exit 0** — production build succeeded |
| `bunx convex dev --once` | **exit 0** — schema + functions pushed ("Convex functions ready") |

Coverage added per prompt §9: missing credentials/provider failures
(TEST-MD-NET-*, TEST-MD-FX-001), live-vs-simulated label correctness
(TEST-MD-LABEL-*), stale/malformed/missing/conflicting data (TEST-MD-VAL-*,
TEST-MD-ECB-002), news freshness + unavailable news (TEST-NEWS-004/007/009,
DB-NEWS-004), analysis success and failure paths (DB-ANALYSIS-003/011/012),
strategy evaluation + deterministic risk blocks (TEST-STRAT-*, DB-ANALYSIS-003
policy BLOCK), ownership + unauthorized access (DB-ANALYSIS-007), history
persistence + pagination (DB-ANALYSIS-008/009), instrument/timeframe chart
queries (DB-CHART-001..004), credential secrecy + audit logging (TEST-MD-NET-001,
DB-SEC-001, DB-ANALYSIS-006), execution disabled (DB-ANALYSIS-005).

## 8. Remaining blockers and configuration required

1. **FX intraday OHLC candles** — no keyless true-OHLC FX provider exists;
   the path reports honest `UNAVAILABLE` and serves ECB close-only rates
   instead. Enabling requires configuring a keyed OHLC FX provider (adapter
   slot documented in `lib/marketData.ts`).
2. **Risk policy is `PROVISIONAL`** — by design every verdict is `NO TRADE`
   until an admin ratifies the policy via the existing `approveRiskPolicy`
   (SPEC-GAP-002). Numerical limits were not touched.
3. **Only two strategy candidates exist** (the prompt references ten). The
   pipeline evaluates all candidates registered per market; registering more
   is product work, not a repair.
4. **Single news provider** (Yahoo Finance RSS). A second provider would
   improve coverage; the `NewsProviderAdapter` contract is ready for it.
5. **Notification delivery** is not implemented — preferences are persisted;
   nothing is sent anywhere (stated in-product).
6. **Deployment-runtime end-to-end fetch** was not exercised from this host
   (no authenticated session available here); the deployed actions re-verify
   each request and fail honest. Connectivity verification in §4 was performed
   from the project's build environment.
7. Pre-existing open items from the deep audit remain open: audit-chain
   external anchoring (SPEC-GAP-005), credential KMS custody (SPEC-GAP-007),
   role provisioning (SPEC-GAP-008), cross-owner reconciliation (Decision B).

## 9. Was live market data verified?

**Yes.** Real live data was retrieved and parsed during this repair (2026-10-14):
Kraken BTC/USD 1h candles (≈77,700–78,500 range, real volume/count fields),
Coinbase BTC-USD candles, ECB EUR/USD reference rates (e.g. 1.1188 via
Frankfurter), and Yahoo Finance RSS headlines. The exact response shapes are
recorded as fixtures in `src/tests/marketdata-verification.ts` and asserted by
the parsers. No live price is hardcoded anywhere; seeded synthetic bars remain
labeled `SIMULATED` and are never presented as live.

## 10. Live-money execution disabled?

**Confirmed — still fully disabled.** The analysis pipeline writes no orders,
no execution authorizations and no positions (`DB-ANALYSIS-005` asserts this);
system mode remains `PAPER`; `CONTROLLED_LIVE` is blocked inside the
deterministic risk engine; the kill-switch/authorization machinery is
unchanged; and no broker execution path was added. No live-money action exists
in this build.
