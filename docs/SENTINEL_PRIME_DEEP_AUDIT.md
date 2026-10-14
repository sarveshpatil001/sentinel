# SENTINEL PRIME — DEEP REPOSITORY AUDIT

Date: 2026-10-14
Auditor role: independent code/security/QA audit pass (evidence-based; every
finding below was confirmed against the current source or is explicitly marked
as unverified).

---

## 1. Repository and commit identity

| Item | Value | How established |
| --- | --- | --- |
| Repository | `https://github.com/sarveshpatil001/sentinel.git` | `.git/config` remote `github` |
| Branch | `main` | `.git/HEAD` → `refs/heads/main` |
| Local `refs/heads/main` | `f076b062cc739e9ac3ea5f9ff7cbd921cf442273` | read from `.git/refs/heads/main` |
| Initial commit in reflog | `1f16210c3487fc798a4b70a1e3df4bf34abb142b` ("Initial commit from vly.ai", Sarvesh Patil) | `.git/logs/HEAD` |
| Working-tree status | **NOT VERIFIED via git CLI** | The host blocks Git commands ("Git and GitHub commands are blocked; Vly manages version control"). File-level state was established by direct filesystem reads; unrelated pre-existing edits (e.g. `Landing.tsx`, docs) were left untouched. |
| Execution environment | Bun 1.4.2, Convex CLI (dev codegen via `bun convex dev --once`), TypeScript ~5.9, Vite 7 | `package.json`, command output |

## 2. Audit scope and methodology

Scope: entire repository tree (79 tracked project files; node_modules excluded),
with deep reads of `src/convex/**` (workflows, console, connections, users,
seed, databricks, schema, `lib/*`), `src/tests/**`, `src/pages/**`,
`src/components/sentinel/**`, `src/components/console/**`, auth/config files,
and `docs/**`.

Methodology:

1. Baseline recorded **before any edit** (all suites + typecheck + lint + build).
2. Every finding traced through actual data flow (producer → persistence →
   consumer), not inferred from comments.
3. Repairs made only with a failing-first regression or integration test, in
   the smallest change that preserves every safety invariant.
4. Post-repair verification re-run across the full matrix (recorded below).
5. Prior reports (`docs/ui-reset-audit.md`, `docs/ui-reset-report.md`,
   `docs/execution-architecture-decisions.md`, README claims) were treated as
   untrusted input and re-verified against source. Where they held, they are
   cited; where they could not be verified, that is stated.

### Verification matrix (executed 2026-10-14, final state)

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | (baseline run, pre-edit) |
| `bun convex dev --once` | 0 | codegen clean |
| `bun tsc -b --noEmit` / `bun run typecheck` | 0 | no errors |
| `bun test ./src/tests/engine-verification.ts` | 0 | **116 passed, 0 failed** |
| `bun test ./src/tests/db-verification.ts` | 0 | **113 passed, 0 failed** |
| `bun test ./src/tests/databricks-verification.ts` | 0 | **16 passed, 0 failed** |
| `bun test ./src/tests/ui-reset.test.mjs` | 0 | **14 pass, 0 fail** (178 expect calls) |
| `bun run lint` | 0 | 0 errors, 17 warnings (pre-existing) |
| `bun run build` | 0 | built in ~8.4 s |

Baseline (pre-edit) for comparison: engine 97/0, DB 103/0, Databricks 16/0,
UI 14/0, typecheck 0, lint 0 errors/17 warnings, build 0.

**No browser-based verification was possible** (no browser automation runtime
on this host; the platform dev server cannot be driven from here). UI claims
below are source-level plus SSR-render tests only.

## 3. Architecture and end-to-end data-flow map

```
Browser (mobile-first SPA, Vite/React 19, Tailwind v4)
  ├─ public surfaces: Landing / Auth (Convex Auth: email OTP + anonymous) / NotFound
  └─ protected workspace (RequireAuth → /auth?returnTo=…) 6 screens
       └─ engineering console panels (per-screen) → Convex queries/mutations
                                                     │
Convex backend (server-authoritative)                │
  console.ts   read-only projections, owner-scoped   │
  users.ts     currentUser                           │
  connections.ts credential registration (fingerprint-only)
  seed.ts      admin-gated, idempotent system initialization
  databricks.ts action; NOT_CONFIGURED in this deployment
  workflows.ts the trading core:
      submitTradeProposal → loadRiskContext (bounded scans, fail-closed)
        → evaluateRisk (deterministic, fail-closed)
        → (APPROVE ∧ ratification) → executionAuthorizations (scope-bound)
      placeOrder → validateAuthorizationScope → runPrechecks
        → simulated provider (PAPER/DEMO only) → orders/positions/fills
        → appendAudit (hash-chained)
      reconcile  → UNKNOWN → ACKNOWLEDGED/REJECTED from recorded evidence only
      setKillSwitch / grantRole / approveRiskPolicy / setSimulatedProviderBehavior
        (admin or fail-safe-direction gated, denials audited)
  lib/: risk, execution, positions, audit, store, authz, credentials,
        dataQuality, quant, backtest, pipeline, evidence, fitness, databricks
```

Data flow of a trade: proposal (strategyVersionId, marketId, side, quantity,
referencePrice, idempotencyKey) → risk context (system state, ratified policy
limits, positions with saturation detection, validation/evidence/fitness
eligibility, candles) → deterministic decision + checks → single-use
`executionAuthorizations` row carrying `scope.riskPolicyRef` (canonical
`policyId@vN`) → `placeOrder` validates scope + prechecks (mode allowlist
PAPER/DEMO, kill switch, provider state, data age, duplicate key, unresolved
UNKNOWN gate) → simulated provider behavior → order state machine
(CREATED→VALIDATING→AUTHORIZED→SUBMITTING→ACKNOWLEDGED/FILLED/…) → positions
accounting at fill time → audit events hash-chained per mutation.

## 4. Findings

### CRITICAL / HIGH — fixed in this pass

**SP-P0-001 — Policy-reference producer/consumer contract defect (FIXED)**
- Evidence: producer `src/convex/lib/risk.ts` built the policy reference as a
  human-readable label `${policyId}@v${version} (${status})` (spaces +
  parentheses); `src/convex/workflows.ts` persisted it into
  `executionAuthorizations.scope.riskPolicyRef`; consumer
  `src/convex/lib/execution.ts` `validateAuthorizationScope` requires a strict
  identifier token (`token()` rejects spaces/parens).
- Root cause: one field carrying two different semantics — display label and
  canonical identifier. Test fixtures used canonical refs (`"P@v1"`), so the
  real producer path was never exercised against the consumer.
- Impact: every authorization created through the real proposal path would fail
  scope validation closed at `placeOrder` — the approved-proposal-to-order
  workflow could never complete. Fail-safe direction (no wrong orders), but
  total loss of the execution workflow's function. Likelihood: certain (any
  use of the real path).
- Remediation: canonical identity (`policyId@vN`) separated from display label
  (`policyId@vN (STATUS)`); the strict validator was **not** weakened;
  `scope.riskPolicyRef` now carries the canonical identity only. Version
  binding preserved (ratification and `loadRiskContext` bind exact
  `policyId` + `version`); expiry, revocation, ownership, scope, mode, veto
  and single-use checks untouched.
- Regression tests: `TEST-POLREF-001..006` (engine),
  `DB-POLREF-001..010` (real-handler integration, see §6).

**SP-P1-001 — Non-cryptographic audit chain (FIXED; anchoring remains open)**
- Evidence: `src/convex/lib/audit.ts` hashed records with 64-bit FNV-1a over a
  `|`-joined serialization. 64-bit non-crypto digests are collision-prone and
  the join is ambiguous (different field splits serialize identically —
  demonstrated by `TEST-AUDIT-203`).
- Remediation: versioned format `SHA256-V1` (`sha256:<64 hex>`) over a
  length-prefixed canonical serialization (unambiguous), written by every new
  append (`lib/store.ts`); legacy FNV-1a records remain verifiable in their own
  format; unknown formats fail closed. Sequence continuity, reordering,
  duplication, and gap checks preserved. In-log `CHAIN_CHECKPOINT` records with
  declared head hashes are verified when in range.
- Remaining limitation (documented, tested as such): without externally
  protected head hashes (SPEC-GAP-005), the chain is tamper-**EVIDENT** only;
  a privileged database operator can rewrite records and recompute the chain,
  and tail truncation is undetectable (`TEST-AUDIT-207`). Never claimed
  otherwise anywhere in product output.

**SP-P1-002 — UI placeholder content presented with misleading labels
(PARTIALLY FIXED — labels honest; data remains prototype)**
- Evidence: `DashboardScreen` hardcoded quote `1.08425` labeled "Verified
  catalyst" news and "Running multi-agent synthesis…" on a 700 ms
  navigate-only timer; `TradingScreen` hardcoded `1.08425` labeled
  "INSTITUTIONAL MID-PRICE"; `SignalsScreen` hardcoded WAIT/58% verdict and
  levels; `HistoryScreen` three hardcoded demo records.
- Remediation: honesty labels only (no redesign): "Sample workspace data • Not
  a live news feed", "Sample quote • Simulated tick feed (not a live price)",
  "Opening the analysis workspace…", "INSTITUTIONAL MID-PRICE (SIMULATED DEMO
  DATA)", "Seeded demo workspace synthesis • Informational analysis only •
  Automated execution disabled", History subtitle "(demo workspace records)".
  The pinned design markers and all 14 UI tests remain untouched and green.
- OPEN: the six screens still render prototype/simulated data instead of live
  backend market state (the engineering console panels beneath each screen do
  show real backend data). See §7 classification.

### MEDIUM — open

**SP-P1-003 — Cross-owner UNKNOWN-order reconciliation gap (OPEN, documented)**
- `docs/execution-architecture-decisions.md` Decision B: no trusted
  cross-owner reconciliation service, no authoritative provider ledger, no
  evidence contract, no approved trigger. In effect the global fail-closed gate
  (Decision A) blocks all shared-account exposure while any UNKNOWN order is
  unresolved. Left open deliberately — inventing a mechanism would violate the
  approved design. Blocking for any production use of shared-account execution.

**SP-P1-004 — Role provisioning gaps (OPEN, documented: SPEC-GAP-008)**
- Initial admin is provisioned out-of-band only (verified in `seed.ts` and
  `grantRole`: exact-match role gate, denials audited). No self-service path.
  Additional observation: `grantRole` does not protect against an admin
  demoting the last admin (operational lockout risk). Not fixed — an audit-
  logged product decision is needed.

**SP-P1-005 — Anonymous-session trading scope (NOT TESTED)**
- Anonymous guest sessions are blocked from changing the global kill switch
  (`setKillSwitch` checks `isAnonymous`). Whether anonymous sessions should be
  allowed to submit PAPER proposals/orders is a product decision that this
  audit did not fully adjudicate. Flagged for review; PAPER/DEMO-only
  restrictions still hold either way.

### LOW — open

**SP-P2-001 — Console overview counts are windowed (display-only).**
`console.overview` computes `orderCounts` from the newest 100 order rows; the
execution/risk gates never use these numbers (they use indexed state reads and
saturation-detected scans — see §5). Documented, display-only.

**SP-P2-002 — 17 ESLint warnings (0 errors), pre-existing**, unchanged by this
pass (4 auto-fixable).

**SP-P2-003 — Tail-truncation of an unanchored chain is undetectable.**
Inherent to hash chains without external anchoring; demonstrated by
`TEST-AUDIT-207` and labeled in every verification result (`scope`,
`note`, `verifiedCount`, `checkpointsVerified`).

## 5. Security, data, execution, accounting, reliability

- **Authentication**: all 22 public Convex functions across `workflows.ts`,
  `console.ts`, `connections.ts`, `users.ts`, `seed.ts`, `databricks.ts` gate
  on `getAuthUserId`; `TEST-WIRE-001` asserts it for every workflows mutation.
- **Authorization/ownership**: `lib/authz.ts` fail-closed helpers
  (`canViewRecord` = own + shared system; `canUseAuthorization` = owner-only,
  legacy/missing owner = DENIED; `requireRole` exact match, missing ≠ admin).
  Console queries owner-scope server-side (DB-RESET-AUTH-* + owner-scoping
  tests). Not-found ≡ not-owned (no ID oracle).
- **Authorization lifecycle**: single-use atomic consumption bound to the
  surviving order (`DB-POLREF-006`), reuse rejected (`DB-POLREF-007`), foreign
  owner rejected (`DB-POLREF-008`), tampered/malformed scope fails closed
  without consumption (`DB-POLREF-010`), expiration/revocation covered by
  engine + DB suites. Convex OCC serializes the consume/order transaction.
- **Idempotency/concurrency**: dedicated `by_idempotencyKey` index, duplicate
  detection before any mutation (`DB-RESET-DUP-001..002`,
  `DB-POLREF-007`); audit sequence generation is safe under OCC serialization
  of mutations (appends read latest + insert within one transaction).
- **Risk veto & kill switch**: fail-closed pure engine (TEST-FUZZ-001..004f
  — garbage on ANY input never APPROVEs; unknown mode/state strings BLOCK;
  negative limits BLOCK); kill switch engagement allowed for verified users,
  release requires admin + zero unresolved UNKNOWN orders + healthy
  reconciliation (`DB-RESET-SAFETY-KS-*`). No alternate mutation bypasses it.
- **Policy governance**: provisional policies never authorize;
  `approveRiskPolicy` is admin-gated, binds exact policy version
  (`DB-POLREF-001` refuses version mismatch), and records — not fabricates —
  ratification. Numerical limits were not altered to make any test pass.
- **Accounting**: equity/drawdown/daily PnL computed account-globally per
  Decision A; fills counted once (dedup by order + fill id); partial fills,
  over-closes, ambiguous intrabar exits (conservative SL), rejected and
  duplicate submissions verified (DB-RESET-EXEC-*, *_PARTIAL_*, DB-RESET-SAFETY-*).
- **Bounded scans**: the 2,000-record cap in `workflows.ts` is saturation-
  detected: `accountStateComplete = positions.length < SCAN_CAP &&
  unknownRows.length < SCAN_CAP` — saturation → `accountStateComplete:false`
  → engine fails CLOSED (UNKNOWN → no new exposure). UNKNOWN-order and
  duplicate-key gates are indexed reads (complete at any size). No capped
  query silently undercounts into an approval.
- **Credentials**: raw key material never persisted, never returned, never
  audited (only FNV-1a-64 fingerprint + masked last-4);
  `TEST-SEC-CRED-*` + `DB-RESET-CONN-*` verify raw keys/secrets never enter
  rows, audit details, or responses. Live credential ingestion is refused.
  Production requirement: KMS/vault custody (SPEC-GAP-007) — not implemented.
- **Provider honesty**: every adapter is SIMULATED or NOT_CONFIGURED;
  simulated verification explicitly does not claim real connectivity
  (DB-RESET-CONN-*); Databricks action reports NOT_CONFIGURED (16 tests).
- **Market data / leakage**: synthetic seed data labeled as such;
  snapshot binding verified against actual rows (TEST-VALID-013..016 —
  mismatched/missing snapshots BLOCK); leakage checks compute their result;
  insufficient evidence → metrics reported unavailable (N/A, never zero).
- **Error responses**: generic rejection notes ("Order intent rejected — no
  external mutation performed"), no secrets, no internal stack traces.

## 6. Fixed findings — regression references

| Finding | Fix | Regression/integration tests |
| --- | --- | --- |
| SP-P0-001 policy-reference contract | `risk.ts` canonical identity + label; `workflows.ts` binds canonical ref into scope; validator unchanged | `TEST-POLREF-001..006`; `DB-POLREF-001..010` (real proposal→order lifecycle) |
| SP-P1-001 audit chain | versioned SHA-256 + length-prefixed canonical form + checkpoints; legacy verify path kept | `TEST-AUDIT-201..210d` (vectors, ambiguity, mixed chain, tamper, gap, dup, reorder, malformed, checkpoint) |
| SP-P1-002 misleading labels | honesty copy only | UI suite unchanged, 14/0 (design markers preserved) |

Full change inventory: `docs/SENTINEL_PRIME_REPAIR_LOG.md`.

## 7. Frontend control classification (all six protected routes)

Legend: 1 = fully implemented & verified · 2 = implemented, not
integration-tested · 3 = simulated/prototype · 4 = disabled/intentionally
unavailable · 5 = broken. (Nothing classified 5.)

**/dashboard — DashboardScreen**
- Quote card (1.08425 / +0.18%): **3** hardcoded, now labeled "Sample quote •
  Simulated tick feed (not a live price)".
- News catalyst card: **3** hardcoded; label fixed from "Verified catalyst" to
  "Sample workspace data • Not a live news feed".
- Signal card (WAIT / 58%): **3** hardcoded demo synthesis.
- Decorative SVG sparkline: **3** decorative (aria-hidden).
- "Run Market Analysis": **3** 700 ms timer that only navigates to /analysis;
  status text now "Opening the analysis workspace…" (was "Running multi-agent
  synthesis…"). It does NOT call the analysis pipeline.
- Engineering console `OverviewPanel`: **1** real backend projection.

**/trading — TradingScreen**
- Mid-price/stat cards: **3** hardcoded, labeled "INSTITUTIONAL MID-PRICE
  (SIMULATED DEMO DATA)" + "Sample workspace data".
- Pair/timeframe chips: **4** locked to seeded demo workspace (explicit notice).
- "Open Model Synthesis →": navigation only. "Orderbook": **4** ("not included
  in this prototype build" notice).
- Engineering console `RiskPanel` + `ExecutionPanel`: **1** real
  proposal→authorization→order→reconcile→kill-switch→provider-behavior flows
  (covered by the DB suite).

**/charts — ChartsScreen**
- Candle chart: **3** static SVG, honestly badged "Illustrative" (aria-label
  also says illustrative).
- Timeframe buttons: **3** change only the heading text (data unchanged).
- Chart settings ⚙: **4** prototype notice.
- Engineering console `DataPanel`: **1** real candles/snapshots/quality.

**/analysis — SignalsScreen (Market Signals)**
- Verdict card (WAIT), confidence 58%, entry/stop/target StatCards, "Consensus
  Evidence" rows: **3** hardcoded seeded demo synthesis (footer now says so).
- Pair/timeframe chips: **4** locked (notice).
- BUY/WAIT/SELL stance cluster: **3** local UI state only, honestly labeled
  ("informational only • No order was placed") — records nothing server-side.
- Engineering console `StrategiesPanel` + `AgentsPanel`: **1** real.

**/history — HistoryScreen**
- Three archive records: **3** hardcoded demo records (subtitle now says
  "demo workspace records").
- Search/filter chips/Reset: **2** real client-side behavior over demo data.
- "Export CSV Log": **2** real client-side CSV generation (status text says
  "demo record(s)").
- Engineering console `ValidationPanel` + `AuditPanel`: **1** real (includes
  live audit-chain verification output).

**/settings — SettingsScreen**
- Workstation defaults rows: **3** static display.
- Notification toggles + "Save Preferences": **3** session-local state only
  (status text says "demo workspace"; nothing persisted).
- Safety card ("Locked to Demo", "Automated order execution is strictly
  disabled"): **1**-grade honest statement matching backend reality.
- Sign Out: **1** real Convex Auth sign-out.
- Engineering console init button + `ConnectionsPanel` + `DatabricksPanel` +
  `RiskPanel`: **1** real (init admin-gated and idempotent).

Claimed vs actual analysis actions: **no screen's "Run Market Analysis" /
"Open Model Synthesis" / "Inspect Full AI Synthesis" control invokes the
analysis pipeline** — they navigate. The real pipeline is reachable only
through the engineering console (`runValidation`, `submitTradeProposal`, etc.).
This is now labeled where a timer previously claimed synthesis.

## 8. Previously known findings — status

| Known finding (source) | Status |
| --- | --- |
| Policy-reference contract defect (prior audit, Oct 13 2026) | **FIXED** (SP-P0-001) |
| FNV-1a chain, external anchoring gap (SPEC-GAP-005) | Hash upgraded (SP-P1-001); **anchoring still OPEN** |
| External policy-approval authority (SPEC-GAP-002) | OPEN — ratification records only, never auto-approves |
| Credential KMS/vault custody (SPEC-GAP-007) | OPEN — production requirement documented |
| Role provisioning process (SPEC-GAP-008) | OPEN — out-of-band admin only |
| Cross-owner reconciliation (Decision B) | OPEN — fail-closed gate holds (SP-P1-003) |
| Shared-account tenancy (Decision A) | Preserved as decided; per-user ledgers remain future work |

## 9. Production-readiness verdict

**NOT READY FOR PRODUCTION.** Blocking conditions:

1. All market/news/quote/verdict content on the six product screens is
   prototype/simulated data (SP-P1-002 open part); no live market-data or news
   adapter exists or was verified.
2. No real broker connectivity exists or was verified; all providers are
   SIMULATED/NOT_CONFIGURED. Real-money execution remains disabled by design.
3. Audit chain is tamper-evident only until externally anchored checkpoints
   are deployed (SPEC-GAP-005 / SP-P2-003).
4. Credential custody requires a production KMS/vault (SPEC-GAP-007).
5. Cross-owner UNKNOWN reconciliation mechanism is unspecified (SP-P1-003);
   on the shared PAPER account any unresolved UNKNOWN order blocks all new
   exposure by design.
6. Role provisioning/admin bootstrap procedure needs an approved operational
   process (SPEC-GAP-008 / SP-P1-004), incl. last-admin protection.
7. Anonymous-session trading scope unadjudicated (SP-P1-005).
8. No browser-level/runtime performance verification was possible on this
   host; no latency claims are made.

What IS production-grade today: the deterministic risk engine's fail-closed
behavior, authorization lifecycle (ownership, single-use, scope, expiry),
idempotency, PAPER/DEMO-only enforcement, kill-switch semantics, bounded-scan
fail-closed accounting, credential non-persistence, and the audit chain's
internal integrity checks — all covered by 259 passing tests across four
suites (see the verification matrix).
