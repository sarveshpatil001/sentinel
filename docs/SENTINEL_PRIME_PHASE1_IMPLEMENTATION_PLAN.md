# SENTINEL PRIME — PHASE 1 IMPLEMENTATION PLAN
## Secure multi-customer, multi-provider, multi-market SaaS preparation

Date: 2026-10-15. Phase: PLANNING ONLY — **no source code was modified** for this
deliverable (this document is the only file created).

Core product principle preserved throughout:
**One product. Many customers. Multiple supported markets. Multiple supported
providers. One trustworthy analysis experience.**

Evidence discipline used below:

- **[VERIFIED]** — observed directly in the current repository, or produced by a
  command actually executed on this host (output cited).
- **[ASSUMPTION]** — engineering judgment not yet backed by repository evidence.
- **[UNVERIFIED]** — plausible but not inspected/tested in this pass; listed in §8.

---

## 1. Current architecture and verified findings

### 1.1 Stack and shape [VERIFIED]

- Frontend: Vite + React 19 + TypeScript, Tailwind 4 + shadcn/ui, React Router
  7 (`src/main.tsx`, `src/App.tsx`, `src/pages/*`, `src/components/sentinel/*`).
- Backend: single Convex deployment (`src/convex/*`), Convex Auth
  (`@convex-dev/auth` 0.0.90) with three providers: email OTP
  (`auth/emailOtp.ts`, gateway-sent codes), Anonymous, and a Freebuff
  federated `customJwt` (`auth.config.ts`).
- Package manager Bun; tests are plain scripts + `bun test` (see §9).
- Database schema: `src/convex/schema.ts` (617 lines), **declared with
  `schemaValidation: false`** — validators exist but are not enforced at the
  storage layer.

### 1.2 Public API surface [VERIFIED] (complete enumeration via ripgrep)

| File | Exports | Gate |
|---|---|---|
| `analysis.ts` | `run` (m), `runInternal` (internalM), `history` (q, paginated), `get` (q) | `getAuthUserId`; owner-scoped |
| `console.ts` | `overview, data, strategies, validation, risk, execution, agents, audit` (q) | `getAuthUserId`; `canViewRecord` filtering |
| `workflows.ts` | `submitTradeProposal, placeOrder, reconcile, runValidation, recordLearningEvent, proposeCandidateVersion, setKillSwitch, grantRole, approveRiskPolicy, setSimulatedProviderBehavior` (m) | `getAuthUserId`/`requireActor`; role gates on privileged ops |
| `providers.ts` ("use node") | `refreshMarketData, refreshNews, runAnalysisWithFreshData` (actions) | `getAuthUserId`; only network-touching paths |
| `marketData.ts` | `candles, health, instruments` (q); `persistCandles, persistRates, recordHealth` (internalM) | queries unauthenticated-but-shared (see §2 G8 note); internal persist via actions |
| `news.ts` | `latest, topImpact` (q); `persist` (internalM) | shared market data |
| `connections.ts` | `catalog, list, register, verify, rotate, revoke` | `getAuthUserId`; strict `userId` match |
| `preferences.ts` | `get, save` | `getAuthUserId`; `by_userId` index |
| `seed.ts` | `seed` (m) | admin role, idempotent init |
| `users.ts` | `currentUser` (q) | auth-gated |
| `databricks.ts` | `checkWorkspace` (action, "use node") | auth-gated, read-only |

Deterministic library layer (`src/convex/lib/`): `risk.ts` (fail-closed risk
engine + veto), `execution.ts` (scope validation, prechecks, provider-response
normalization), `pipeline.ts` (validation pipeline), `backtest.ts`,
`quant.ts`, `strategyEval.ts`, `dataQuality.ts`, `audit.ts` (SHA256-V1
hash-chained log + verification), `authz.ts`, `credentials.ts`, `marketData.ts`,
`news.ts`, `evidence.ts`, `fitness.ts`, `positions.ts`, `store.ts`,
`databricks.ts`.

### 1.3 Tenancy model as it exists today [VERIFIED]

There is **no tenant/organization entity**. The unit of isolation is the
individual user:

- Owned rows carry `ownerUserId` (optional on legacy/system rows). Convention:
  `undefined`/empty = **shared SYSTEM record visible to every authenticated
  user** (`lib/authz.ts: isSystemRecord`, `canViewRecord` = own + system).
- Capability tokens (`executionAuthorizations`) are owner-bound and fail closed
  on missing ownership (`canUseAuthorization`).
- Role checks are exact-match on a single global `users.role`
  (`admin|user|member`); missing role is never admin.
- Owner scoping is enforced server-side in every read path inspected
  (`console.ts` filters, `analysis.history` indexed `by_owner_started`,
  `analysis.get` strict owner match, `connections.list` `by_userId`).
- Not-found ≡ not-owned everywhere inspected (no ID oracle).

### 1.4 Global (shared) state [VERIFIED]

- `systemState` is a single row: mode, kill switch, `simulatedProviderBehavior`,
  `peakEquity`, `pnlDay`, `realizedPnlDay`, controlled-live gates.
- Risk accounting is account-global: `loadRiskContext` computes
  `equity = 100000 + Σ realizedPnl` over **all positions rows regardless of
  owner**, `openPositions` over all owners, and `placeOrder` recomputes
  `totalRealized` the same way at fill time (`workflows.ts`).
- UNKNOWN-order exposure gate and the duplicate-idempotency-key check are
  **global** (documented as Decision A / fail-closed design).
- Reference data (`markets`, `candles`, `rateObservations`, `newsItems`,
  `providerHealth`, `dataSnapshots`, `dataQualityReports`, `riskPolicies`,
  `agents`) is shared — appropriate for non-customer market data.

### 1.5 Multi-market state [VERIFIED]

- `assetClassValidator` = `CRYPTO | FOREX` only. **Stocks, commodities and
  indices are NOT supported and not claimable today.**
- Real, keyless providers wired and honestly labeled (`providers.ts` header +
  `lib/marketData.ts` / `lib/news.ts`): Kraken public OHLC (crypto), Coinbase
  Exchange candles (crypto), ECB reference rates via Frankfurter (close-only FX
  — deliberately never expanded into synthetic OHLC), Yahoo Finance RSS (news).
  Connectivity was verified 2026-10-14 per the module header [VERIFIED as
  documented in code; live re-fetch from this host not repeated in this pass —
  see §8].
- Instrument mapping is code-level (`instrumentConfig(symbol)` →
  `krakenPair` / `coinbaseProduct` / `ecbBase`); `marketData.instruments`
  reports `hasCandleProvider` / `hasRateFeedOnly` and `supportedTimeframes`
  (currently all `TIMEFRAMES` for every instrument).
- FX intraday OHLC is explicitly `UNAVAILABLE` (honest empty state).

### 1.6 Multi-provider state [VERIFIED]

- Broker/platform credential registry (`connections.ts` + `lib/credentials.ts`)
  with an explicit provider catalog (`PROVIDERS`): 2 SIMULATED adapters
  (paper-execution engine), 9 NOT_CONFIGURED. Verification semantics are
  honest: SIMULATED → `VERIFIED_SIMULATED`, NOT_CONFIGURED → stays
  `PENDING_VERIFICATION`, never faked ACTIVE.
- Secret handling: raw key material is input-only; only SHA-256 (or declared
  FNV1A-64 fallback) fingerprint + masked last-4 are persisted; raw keys never
  returned, never audited. CONTROLLED_LIVE credential ingestion refused.
- `providerHealth` records real request outcomes, failure classes, rate-limit
  windows, latency; data labels (LIVE/CACHED/STALE/SIMULATED/UNAVAILABLE) are
  derived from row origin + age (`deriveDataLabel`).
- **There is no declared capability contract**: capabilities (timeframes,
  historical depth, streaming, account data) are implicit in code paths, not a
  machine-readable declaration per provider. No streaming support exists
  anywhere (poll-only). No account-data adapter exists.

### 1.7 Normalized data contracts present today [VERIFIED]

- **Candles** (`candles` table): OHLCV + `source`, `providerTimestamp`,
  `receivedTime`, `availabilityTime`, `qualityStatus` (INCOMPLETE for
  still-forming bars at persist time). Dual timestamps + source identity ✓.
- **News** (`newsItems`): `sourceName`, `sourceUrl`, `publishedAt`,
  `retrievedAt`, `impact` + `impactEvidence[]`, `relevanceScore`,
  `contentHash` (dedup), `freshness` ✓.
- **Rates** (`rateObservations`): close-only with `sourceUrl`, `labelNote` ✓.
- **Data labels**: LIVE/CACHED/STALE/SIMULATED/UNAVAILABLE with reason ✓.
- **Provider errors**: failure-class state machine in `lib/marketData.ts`
  (`healthAfterFailure`, rate-limit windows) ✓.
- **Execution**: `normalizeProviderResponse` (ack/fill/partial/reject/timeout →
  order state + providerTruth) ✓.
- **Missing/implicit**: no Quote or Spread contract (`spreadBps` is a hardcoded
  constant — FOREX 8, else 2 — fed into the risk engine's spread check in
  `loadRiskContext` and `runValidation`); no formal Instrument registry; no
  provider Capability contract; ingest-time numeric validation of bars is
  partial (bounds + market existence in `persistCandles`, full OHLCV validation
  happens at read/analysis time in `validateCandles`).

### 1.8 Safe operations [VERIFIED]

- Read-only console surface; nothing in the UI path authorizes finance.
- Real-money execution **disabled by default and by construction**:
  `executionAllowedInMode` = PAPER/DEMO only; CONTROLLED_LIVE credentials
  refused; kill switch engaged-by-default on init; the analysis pipeline
  creates **no** orders/authorizations/positions (asserted by `DB-ANALYSIS-005`
  in the DB suite); no broker execution adapter exists.
- Audit: append-only SHA256-V1 hash chain (`lib/audit.ts`, `lib/store.ts`),
  windowed verification with honest `WINDOW` vs `FULL_CHAIN` scope reporting;
  privileged mutations record denials.
- Credentials: as §1.6. Databricks access is read-only current-user check,
  token never leaves the action.
- Bounded queries with explicit saturation detection (SCAN_CAP 2000 →
  `accountStateComplete:false` → fail CLOSED) in `workflows.ts`.
- Rate limiting: **absent** except per-user connection count cap (20) and
  request-size bounds. No per-user/per-tenant quota on provider actions.

### 1.9 Test baseline captured this pass [VERIFIED — commands in §9]

| Suite | Result |
|---|---|
| `engine-verification.ts` | 116 passed, 0 failed |
| `db-verification.ts` | 142 passed, 0 failed |
| `marketdata-verification.ts` | 50 passed, 0 failed |
| `databricks-verification.ts` | 16 passed, 0 failed |
| `ui-reset.test.mjs` (`bun test`) | 14 pass, 0 fail (178 expect() calls) |
| **Total** | **338 checks, 0 failures** |
| `bun tsc -b --noEmit` | exit 0 |

---

## 2. Critical security and tenant-isolation gaps (prioritized)

Each gap cites the exact code observed. "Cross-customer" means one
authenticated customer affecting or reading another customer's data/state.

### G1 — HIGH [VERIFIED] Cross-customer strategy-definition disclosure + genealogy forgery

`recordLearningEvent` accepts an arbitrary `orderId` string with **no
existence or ownership check** (`workflows.ts` ~line 931: inserts
`sourceOrderId: args.orderId` directly). `proposeCandidateVersion`
(`workflows.ts` ~line 975) then:

1. checks only that the *learning event* is visible to the caller
   (`canViewRecord(learning.ownerUserId, userId)`),
2. resolves `orders` **by `orderId` with no owner filter**
   (`.filter(q => q.eq(q.field("orderId"), learning.sourceOrderId))`),
3. resolves the parent `strategyVersions` row **with no `canViewRecord` check**,
4. copies the parent's full `definition` (entry/exit/filters/sizing parameters)
   into a new caller-owned version.

Order ids are predictable (`ORD-<idempotencyKey>`). Therefore customer B can
create a learning event naming customer A's order id and obtain a readable copy
of A's **private strategy definition**, while also polluting A's version
genealogy (child attributed to A's parent). This violates the codebase's own
"never another user's records" rule and is a genuine IDOR-class read primitive.

### G2 — HIGH [VERIFIED] Cross-customer risk/accounting coupling (shared ledger)

`loadRiskContext` and `placeOrder` compute equity, realized PnL, daily PnL,
peak equity and open-position counts from **all owners' positions**
(`positions.take(SCAN_CAP)` → `reduce` with no owner filter; `systemState`
holds one `peakEquity`/`pnlDay`/`realizedPnlDay`). Consequences for SaaS:

- Customer A's losses change Customer B's risk verdicts (max-daily-loss,
  drawdown, equity-based sizing).
- One customer's fills rewrite the shared daily-PnL counters used by all.

This is the documented "Decision A shared paper account"; it is safe for a
single-user demo but **not acceptable multi-customer behavior**. It must be
re-adjudicated as a product decision and converted to per-tenant ledgers (§3).

### G3 — HIGH [VERIFIED] Global kill switch & mode are cross-customer controls

- Any **verified non-anonymous** user may ENGAGE the global kill switch
  (`setKillSwitch` gates release on admin but engagement on mere
  non-anonymous). One customer can halt the entire customer base
  (griefing/DoS). Fail-safe direction limits the damage, but scope is wrong for
  SaaS.
- `systemState.mode`, `simulatedProviderBehavior` are single global values: one
  tenant's demo configuration changes every tenant's behavior.

### G4 — MEDIUM [VERIFIED] Global UNKNOWN-order gate (availability coupling)

Any user's UNKNOWN order blocks new exposure for **all** users
(`placeOrder` precheck + `setKillSwitch` release gate read `orders.by_state`
globally). Fail-closed is correct; cross-tenant scope is not. (Documented as
SP-P1-003/Decision B in `docs/SENTINEL_PRIME_DEEP_AUDIT.md`.)

### G5 — MEDIUM [VERIFIED] Global idempotency-key namespace enables cross-user denial

`placeOrder` treats `idempotencyKey` as globally unique. A collision with a
foreign key returns a generic REJECTED with no data leak (good), but a user who
can guess/observe another user's key can pre-register it and cause the victim's
order intent to be refused forever. Namespace must be per-tenant (and ideally
per-user).

### G6 — MEDIUM [VERIFIED] No admin-scoped audit forensics; no scoped export

`console.audit`/`overview` return only `actorType === "SERVICE"` or
`actor === user:<self>` events. There is **no admin query** to investigate
cross-tenant incidents, and no server-side export path at all (HistoryScreen's
CSV is client-side over demo rows). For SaaS, incident response needs an
admin-gated, audited, tenant-scoped audit query and export.

### G7 — MEDIUM [VERIFIED] Role model is global; admin bootstrap & last-admin risks

Single global `users.role`; no tenant membership/roles. `grantRole` has no
last-admin demotion protection (documented SP-P1-004), initial admin is
out-of-band only (SPEC-GAP-008). Multi-customer SaaS needs `tenants` +
`memberships` with scoped roles and a defined admin lifecycle.

### G8 — LOW/MEDIUM [VERIFIED] Windowed owner filtering (availability, not confidentiality)

`console.*` queries filter by `canViewRecord` **after** `take(50..250)`. No
cross-user data can leak (filter is server-side) but a user's own records can
be pushed out of the window by other users' volume — wrong results in a shared
deployment. Fix: index-scoped queries (`by_ownerUserId` already exists on most
owned tables) instead of scan-then-filter. Related: `console.data` issues one
candle query per market (≤50 sequential reads per call) — scale concern.
Also `marketData.candles/health/instruments` and `news.latest/topImpact` are
unauthenticated reads of shared reference data — acceptable for public market
data, but must be a deliberate decision per data class (they expose nothing
customer-specific today [VERIFIED by inspection of return shapes]).

### G9 — LOW [VERIFIED] `spreadBps` fabricated constant in a safety decision

`loadRiskContext`/`runValidation` feed `spreadBps: FOREX 8 : 2` into the risk
engine's spread gate. An invented constant silently governs approvals; with
multi-market support this must be provider-sourced (with `spreadSource` +
timestamp) or an explicit, ratifiable per-instrument config.

### G10 — LOW [VERIFIED] Storage-level validation disabled

`schemaValidation: false` in `schema.ts`: a buggy mutation can write any
shape. For a multi-tenant integrity boundary this must move to enforced
validation (after legacy-row normalization).

### G11 — MEDIUM [VERIFIED] No rate limits / quotas on provider-touching actions

`providers.ts` actions perform outbound HTTP on any authenticated request
(bounded per request, unbounded per user/tenant). One customer can exhaust
provider quotas, inflate egress cost, or get shared egress IPs banned —
a direct cross-customer availability risk once many tenants share one
deployment. `providerHealth.rateLimitUntil` records provider backoff but is
not consulted as an admission gate.

### G12 — LOW [VERIFIED] Ingest-time data validation is partial

`persistCandles` validates bar count bounds + market existence but not numeric
OHLCV sanity; `validateCandles` runs at read/analysis time. The analysis engine
never consumes *unvalidated* data (quality is computed before use), but invalid
rows can enter storage. Contract §4 closes this at the boundary.

**Explicitly checked and NOT found** (so they are not listed as gaps): no path
from analysis → orders (pipeline writes only `analysisRuns`/`dataSnapshots`);
no client-supplied identity/role is ever trusted (all identities from
`getAuthUserId`); no raw secret persistence/return paths; no IDOR oracle in
not-found handling; authorization single-use + owner binding holds
(`DB-POLREF-006..010` in the passing suite).

---

## 3. Proposed architecture (fits the existing codebase)

Principle: **incremental, additive, no framework migration** (rule 2/6). The
deterministic core (`lib/risk.ts`, `lib/execution.ts`, `lib/pipeline.ts`,
`lib/backtest.ts`, `lib/quant.ts`, `lib/audit.ts`) is pure and stays untouched
in behavior; tenancy is introduced at the persistence and boundary layers.

### 3.1 Tenancy layer (new)

```
tenants        { tenantId, name, status, createdAt, settings… }
memberships    { tenantId, userId, tenantRole: OWNER|ADMIN|MEMBER, status }
tenantState    { tenantId, mode, killSwitchEngaged, killSwitchReason,
                 simulatedProviderBehavior, peakEquity, pnlDay, realizedPnlDay,
                 controlledLiveGates[], updatedAt }   // per-tenant replica of systemState
```

- `lib/authz.ts` gains pure, fail-closed helpers:
  `requireMembership(memberships, userId, tenantId)`,
  `canViewTenantRecord(ownerUserId, tenantId, viewer)`,
  `requireTenantRole(membership, role)`. Existing helpers remain (rules keep
  their semantics; SYSTEM/shared records stay visible to all members).
- Every owned table gains `tenantId` (required on new rows; backfilled on
  legacy rows via a migration mutation that maps `ownerUserId` → tenant).
- Reads switch from scan-then-filter to **index-scoped** queries
  (`by_tenant_owner`, `by_tenant_started`, …) — fixes G8 while adding tenancy.
- Risk accounting becomes per-tenant: `loadRiskContext` reads
  `positions.by_tenant` / `orders.by_tenant_state` with the existing
  saturation-detection pattern (SCAN_CAP semantics preserved, scope narrowed).
  This resolves G2/G4 per tenant while keeping fail-closed behavior.
- Kill switch, mode, and simulation config become per-tenant (`tenantState`),
  with an optional deployment-level emergency brake (admin-only, engages all
  tenants) to preserve the fail-safe direction — resolves G3.
- Idempotency keys become unique per tenant (composite lookup
  `by_tenant_idempotencyKey`) — resolves G5.

### 3.2 Shared reference plane (unchanged ownership)

`markets`, `candles`, `rateObservations`, `newsItems`, `providerHealth`,
`dataSnapshots`, `dataQualityReports`, `agents` stay shared — they are market
truth, not customer data. Rate limiting (§3.4) protects the shared fetch
budget.

### 3.3 Provider plane (new contract, existing adapters wrapped)

```
lib/providers/types.ts
  ProviderAdapter {
    spec: ProviderSpec            // provider id, kind, adapterState
    capabilities: ProviderCapabilities
    fetchCandles(req): ProviderResult<Candle[]>
    fetchRates?(req): ProviderResult<RateObservation[]>
    fetchQuotes?(req): ProviderResult<Quote[]>
    fetchNews?(req): ProviderResult<NewsItem[]>
    fetchAccount?(req): ProviderResult<never> | { ok:false, status:"UNAVAILABLE", reason }
  }
  ProviderCapabilities {
    markets: AssetClass[]         // declared, not assumed
    instruments: InstrumentRef[]  // or instrument predicate
    timeframes: string[]
    historical: { maxBars, earliest, backfillSupported }
    streaming: false              // explicit — nothing streams today
    accountData: false            // explicit
    spread: "PROVIDED" | "ESTIMATED" | "NONE"
  }
```

- Every capability is **declared and enforced**: a request outside the declared
  set returns `{ ok:false, status:"UNAVAILABLE", reason:"capability_not_declared" }`
  — never a guess (rule 7). The existing `fetchCryptoMarketData`,
  `fetchEcbRates`, `fetchForexCandles` (NOT_CONFIGURED), `fetchYahooNews` are
  wrapped, not rewritten.
- Execution-side `PROVIDERS` catalog (lib/credentials.ts) gains the same
  capability object so broker connections report exactly what they support
  (today: execution `NONE`, account data `NONE`).

### 3.4 Safe-operations plane

- **Rate limits/quotas**: per-tenant token bucket stored in `tenantState` (or
  `tenantQuotas`) enforced at the top of `providers.*` actions and the
  network-costing mutations; `providerHealth.rateLimitUntil` consulted as an
  admission gate before egress (fixes G11).
- **Exports**: admin-gated and owner-scoped export mutation(s) producing
  tenant-scoped records, each export audited (fixes G6).
- **Audit forensics**: `console.auditAdmin` (admin-only, tenant-scoped, audited
  on read) returning full actor views; global chain verification unchanged.
- **Secrets**: unchanged fingerprint/mask design until KMS custody
  (SPEC-GAP-007) lands; tenantId added to `brokerConnections`.
- **Execution safety**: unchanged — PAPER/DEMO-only, kill switch per tenant,
  pipeline still writes zero financial state, CONTROLLED_LIVE still refused.

### 3.5 Multi-market plane (bounded honesty)

- `assetClassValidator` extended with `STOCK | COMMODITY | INDEX` **only when**
  a provider declares those capabilities (§4); until then markets of those
  classes cannot be created (schema + registry enforcement), so the product
  never claims unsupported markets (rule 7).
- Market-specific rules live in one registry
  (`lib/markets/rules.ts`: session calendars, tick/lot size, price precision,
  spread source, trading hours → `marketStatus`), separated from shared
  pipeline code. The risk engine consumes only normalized fields.

---

## 4. Required contracts, interfaces, and database changes

### 4.1 New/changed tables (additive)

| Change | Purpose |
|---|---|
| `tenants`, `memberships`, `tenantState` (new) | §3.1 |
| `tenantId: v.string()` on `strategies, strategyVersions, validationRuns, evidenceRecords, botFitnessRecords, riskDecisions, executionAuthorizations, orders, positions, learningEvents, monitoringEvents, analysisRuns, brokerConnections, userPreferences` | tenant scoping |
| Indexes: `by_tenant_owner`, `by_tenant_started` (analysisRuns), `by_tenant_idempotencyKey` (orders), `by_tenant_state` (orders), `by_tenant_market` (positions) | index-level isolation (G8) + per-tenant gates |
| `quotes` (new, optional in Phase 1): `{ marketId, bid, ask, mid, spreadBps, provider, providerTimestamp, receivedTime, label }` | real spread/quote contract (G9) |
| `providerCapabilities` (optional) or static registry module | machine-readable capabilities (§3.3) |
| Enable `schemaValidation: true` after backfill (G10) | storage integrity |

### 4.2 Contract shapes (validated at every boundary)

- **Instrument** (registry): `{ marketId, symbol, assetClass, venue, providerRefs,
  pricePrecision, lotSize, tickSize, sessionCalendar, supportedTimeframes,
  spreadSource }`.
- **Candle** (existing row, plus): ingest-time numeric validation
  (`open>0, high>=max(o,c), low<=min(o,c), high>=low, volume>=0, eventTime
  aligned to timeframe`) — closes G12 at `persistCandles`.
- **Quote/Spread**: §4.1 `quotes`; risk engine's `spreadBps` input becomes
  provider-sourced with explicit `spreadSource` and age, failing closed when
  unknown (replaces the hardcoded 8/2 — G9).
- **Timestamps**: keep the existing triple (`providerTimestamp`,
  `receivedTime`, `availabilityTime`) on every market object.
- **Source identity**: keep `source`/`provider` + `label` (LIVE/CACHED/STALE/
  SIMULATED/UNAVAILABLE) + `labelReason` on every response.
- **ProviderError**: formalize the existing failure-class enum
  (`RATE_LIMITED, AUTH, NOT_FOUND, MALFORMED_RESPONSE, NETWORK, TIMEOUT,
  UNSUPPORTED, UNKNOWN`) as a typed `ProviderResult<T>` union;
  `status:"UNAVAILABLE"` is always explicit.
- **Rule**: the analysis engine consumes only rows that passed contract
  validation; unvalidated provider payloads never reach `lib/pipeline.ts` /
  `lib/strategyEval.ts` (already true de facto — now enforced at ingest).

### 4.3 Interface changes

- `lib/authz.ts`: tenant helpers (§3.1), same fail-closed philosophy.
- `workflows.ts` mutations accept/derive `tenantId` server-side (never from
  client claims); `recordLearningEvent` **validates `orderId` ownership**
  and `proposeCandidateVersion` re-checks parent visibility (G1 fix — this is
  the one change we recommend making before Phase 1 proper, see §6 step 0).
- `providers.ts` actions wrap adapters through `ProviderAdapter` and enforce
  per-tenant quotas.
- New admin queries/mutations: `console.auditAdmin`, `export.*`, tenant
  management (create/add member/set role with last-admin protection).

---

## 5. Required tests (including cross-customer access-denial)

All tests must run against **two authenticated identities** (convex-test
supports identity switching — used already by `db-verification.ts`). Naming
continues the existing `DB-*`/`TEST-*` conventions.

**Cross-customer access denial (new `DB-TENANT-*` suite)**
1. User B cannot read A's analysis run (`analysis.get` → null), history page
   (empty), strategies/versions/evidence/fitness, orders, authorizations,
   positions, learning events, monitoring events, preferences, connections.
2. B cannot consume A's execution authorization (already covered
   `DB-POLREF-008` — keep as regression).
3. **G1 regression**: B cannot derive a candidate version from A's order id;
   `recordLearningEvent` with a foreign/unknown `orderId` is rejected; a
   shared SYSTEM learning event still works; parent genealogy can never cross
   tenants.
4. Idempotency-key isolation: A's key does not dedupe/deny B's order (post
   G5 fix), and duplicate detection still works within a tenant.
5. Per-tenant kill switch/mode: A's kill switch does not block B; deployment
   emergency brake blocks all (and is admin-only + audited).
6. Per-tenant risk accounting: A's realized PnL/positions never enter B's
   equity/daily-loss/drawdown inputs (and vice versa); UNKNOWN-order gate
   blocks only the owning tenant.
7. Role/membership: non-member denied on every tenant-scoped function;
   tenant role checks exact-match; last-admin demotion refused; global admin
   cannot silently read tenant-private payloads without an audited admin path.
8. Exports: owner-scoped export contains only own/tenant rows; every export
   writes an audit event; foreign IDs in export requests are rejected.
9. Windowed-read fix regression: a user's own records remain visible even when
   other users exceed the old scan window (G8).
10. Audit forensics: non-admin cannot call `console.auditAdmin`; admin reads
    are themselves audited.

**Contracts (`TEST-CONTRACT-*`)**
- Ingest validation rejects malformed OHLCV/negative volume/misaligned bars;
  `ProviderResult` failure classes map 1:1 to health transitions; capability
  violations return explicit UNAVAILABLE; quote/spread objects require
  provider + timestamps; unknown asset class or market rule → fail closed.

**Provider/multi-market (`DB-PROVIDER-*`)**
- Adapter registry declares capabilities; requests outside them never reach
  the network (mock `FetchLike` — pattern exists in marketdata suite);
  rate-limit admission gate honors `providerHealth.rateLimitUntil`;
  per-tenant quota enforcement; new asset classes rejected until declared.

**Safe operations**
- Real-money execution remains impossible: no mode/config/tenant setting
  yields an external order (extend `DB-ANALYSIS-005` style assertions);
  anonymous sessions still cannot touch kill switch or privileged config;
  credential canary tests unchanged.

**Regression**: the existing 338 checks must stay green (they encode fail-closed
engine behavior, authorization lifecycle, credential secrecy, honest labels).

---

## 6. Ordered implementation plan (dependencies + acceptance criteria)

**Step 0 — Immediate security fix (no schema change). P0.**
Fix G1: validate `orderId` existence + ownership in `recordLearningEvent`;
re-check parent `canViewRecord` in `proposeCandidateVersion`; reject cross-tenant
genealogy. *Depends on*: nothing. *Acceptance*: `DB-TENANT-003` passes; new
rows cannot reference foreign orders; existing tests green; ordering before
everything else because it is exploitable today by any two registered users.

**Step 1 — Tenancy foundation. P0.**
Tables `tenants`/`memberships`/`tenantState`; `tenantId` columns + indexes;
migration mutation backfilling legacy rows (owner → tenant, SYSTEM rows stay
shared); `lib/authz.ts` tenant helpers; convert all owner-scoped reads to
index-scoped queries. *Depends on*: 0. *Acceptance*: `DB-TENANT-001/002/007/009`
pass; no behavior change for single-tenant data (338 checks green); `tsc` clean.

**Step 2 — Per-tenant state + risk accounting. P0.**
Move kill switch/mode/simulation config/peak equity/daily PnL to `tenantState`;
scope `loadRiskContext`/`placeOrder`/`reconcile`/`setKillSwitch` per tenant;
per-tenant idempotency namespace; deployment-level emergency brake (admin,
audited). *Depends on*: 1. *Acceptance*: `DB-TENANT-004/005/006` pass; risk
engine input shapes unchanged (pure core untouched); fail-closed semantics
preserved (saturation detection retained per tenant). **Product decision
required before coding**: formally supersede "Decision A/B" shared-account
rules (`docs/execution-architecture-decisions.md`) — an audit-logged ADR.

**Step 3 — Data contracts + integrity. P1.**
Ingest-time candle validation; `quotes`/spread contract feeding the risk
engine (remove hardcoded 8/2); typed `ProviderResult`; instrument registry;
enable `schemaValidation` after backfill. *Depends on*: 1 (for tenantId
backfill ordering). *Acceptance*: `TEST-CONTRACT-*` pass; risk spread check
consumes provider-sourced or explicitly configured spread and fails closed on
unknown; no test weakened.

**Step 4 — Provider adapter interface + capabilities. P1.**
`ProviderAdapter`/`ProviderCapabilities` (§3.3); wrap existing four adapters;
explicit UNAVAILABLE for undeclared capabilities; extend broker-connection
catalog with capability objects. *Depends on*: 3. *Acceptance*:
`DB-PROVIDER-*` pass (capability violation = no network call); every adapter
response carries label + source + timestamps; streaming/account-data remain
explicitly `false` until real support exists.

**Step 5 — Safe operations at scale. P1.**
Per-tenant quotas + rate-limit admission gate (G11); admin audit forensics +
scoped exports (G6); admin lifecycle hardening (last-admin protection, role
change attestations). *Depends on*: 1–2. *Acceptance*: quota tests pass;
export/forensics tests pass; denials audited.

**Step 6 — Multi-market extension points. P2.**
Add `STOCK|COMMODITY|INDEX` enums + market rules registry + session/precision
rules **only alongside** at least one provider that declares the capability;
otherwise the enum stays CRYPTO|FOREX and the product claims nothing new.
*Depends on*: 3–4. *Acceptance*: new market classes round-trip through
analysis with honest labels; unsupported combinations return explicit
UNAVAILABLE; no invented prices/fees/spreads.

Ordering rationale (per the prompt): security and data integrity (0–3) before
provider integrations (4) before market expansion/UI (6).

---

## 7. Risks, estimated complexity, evidence needed

| Item | Complexity [ASSUMPTION] | Risks | Evidence needed before/after |
|---|---|---|---|
| Step 0 G1 fix | S (hours) | none material; tiny behavior change for learning flow | Two-identity denial test; regression suite |
| Step 1 tenancy + backfill | M–L (days) | legacy rows with `ownerUserId: undefined` classification; migration idempotence; Convex index rollout | Migration dry-run on seeded data; `DB-TENANT-*`; query-plan sanity (index-only reads) |
| Step 2 per-tenant accounting | M | **Reverses documented Decisions A/B** — needs ADR; per-tenant aggregate scans must keep saturation fail-closed; OCC contention on `tenantState` hot row | ADR record; fuzz + boundary tests from engine suite re-run; equity math equivalence tests for single-tenant case |
| Step 3 contracts/validation | M | enabling `schemaValidation` can reject legacy rows; spread sourcing may be genuinely unavailable (must fail closed, not fake) | Contract tests; a labeled `spreadSource:"NONE"` path that blocks rather than approves |
| Step 4 adapter interface | M | capability over-declaration would recreate today's honesty problem; provider ToS/rate limits | Capability manifest per provider citing the provider's own docs; mock-fetch tests |
| Step 5 quotas/exports/forensics | S–M | admin surface growth (new attack surface); export = data egress | Export audit events; quota boundary tests; admin denial tests |
| Step 6 multi-market | L | regulatory/market-rule errors; session-calendar correctness; temptation to claim unsupported markets | Provider capability proof per market class; per-market rule tables reviewed; honest-unavailable behavior tests |

Systemic risks: (a) per-tenant `tenantState` writes serialize on one row per
tenant — fine at current scale, revisit with per-tenant partitions if needed
[ASSUMPTION]; (b) shared egress IP reputation across tenants — quotas mitigate,
dedicated egress may be required later [ASSUMPTION]; (c) hash-chained audit
across tenants remains one chain — fine, but external anchoring (SPEC-GAP-005)
should follow Phase 1.

---

## 8. Unverified findings / assumptions (explicit)

- [UNVERIFIED] Live re-fetch of Kraken/Coinbase/Frankfurter/Yahoo endpoints was
  **not** re-executed this pass; connectivity status is taken from the
  verified-2026-10-14 annotations in `providers.ts`/`lib/marketData.ts` and the
  passing marketdata suite (which mocks `FetchLike`).
- [UNVERIFIED] `lib/marketData.ts` fetch internals (retry/failover details) and
  `lib/pipeline.ts`/`lib/execution.ts`/`lib/risk.ts` internals were not
  line-audited in this pass; their behavior is attested by the 279 engine+db
  checks and prior audits (`docs/SENTINEL_PRIME_DEEP_AUDIT.md`,
  `docs/SENTINEL_PRIME_BACKEND_REPAIR_REPORT.md`).
- [UNVERIFIED] `preferences.save` field validation specifics (ownership and
  indexing verified; validator details not read line-by-line).
- [UNVERIFIED] Deployed-Convex runtime behavior (auth flows, actions) not
  exercised from this host; no browser-level testing performed.
- [ASSUMPTION] Complexity estimates (S/M/L) are engineering judgment, not
  measured.
- [ASSUMPTION] Per-tenant tenancy (rather than per-user) is the right SaaS
  unit; per-user single-tenant remains the degenerate case with one membership.

---

## 9. Files inspected and commands executed (this pass)

**Files inspected (read):** `src/convex/schema.ts`, `console.ts`, `workflows.ts`
(full), `analysis.ts`, `providers.ts`, `marketData.ts`, `connections.ts`,
`users.ts`, `auth.ts`, `auth.config.ts`, `auth/emailOtp.ts`, `seed.ts` (init
gating), `preferences.ts`/`news.ts` (scoping via targeted search),
`lib/authz.ts`, `lib/store.ts`, `lib/credentials.ts`, `databricks.ts`; grep
enumeration of all public Convex exports; prior docs
(`docs/SENTINEL_PRIME_DEEP_AUDIT.md`) for carried-forward findings;
`package.json`; `.git/logs/HEAD` (single-commit history — findings are
current-state, not historical).

**Commands executed (all exit 0):**
- `bun run test` → engine 116/0, db 142/0, marketdata 50/0, databricks 16/0,
  ui-reset 14/0 — **338 checks, 0 failures** (raw output captured to
  `/tmp/phase1-test.txt`).
- `bun tsc -b --noEmit` → exit 0 (`/tmp/phase1-tsc.txt`).
- `rg` API-surface and ownership-pattern enumerations (output cited above).

**Not executed:** lint, production build (out of scope for planning phase);
live provider fetches; deployed-runtime calls.

**Stop point:** per instructions, this phase ends with the plan. No source code
was modified (only this document was created).
