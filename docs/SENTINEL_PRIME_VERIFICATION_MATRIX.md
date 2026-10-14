# SENTINEL PRIME — VERIFICATION MATRIX

Date: 2026-10-14. Every "PASS" below corresponds to an executed command or
test whose output was recorded on this host; anything not executed is marked
NOT TESTED or BLOCKED. Result vocabulary: PASS / FAIL / BLOCKED / NOT TESTED.

Test totals (final run): engine 116/0 · db 113/0 · databricks 16/0 · ui 14/0
(178 expect calls) — **259 tests, 0 failures**.

## A. Command-level verification

| # | Requirement | Command | Result | Evidence / limitation |
| --- | --- | --- | --- | --- |
| A1 | Dependencies install from lockfile | `bun install --frozen-lockfile` | PASS | exit 0 (baseline run, pre-edit) |
| A2 | Convex codegen valid after schema changes | `bun convex dev --once` | PASS | exit 0, "Convex functions ready" |
| A3 | TypeScript typecheck | `bun tsc -b --noEmit` (`bun run typecheck`) | PASS | exit 0, no errors |
| A4 | Lint | `bun run lint` | PASS | exit 0; 0 errors, 17 pre-existing warnings (not introduced by this pass) |
| A5 | Production build | `bun run build` | PASS | exit 0, built in ~8.4 s |
| A6 | Engine battery | `bun test ./src/tests/engine-verification.ts` | PASS | 116 passed, 0 failed |
| A7 | DB battery (real Convex handlers, in-memory) | `bun test ./src/tests/db-verification.ts` | PASS | 113 passed, 0 failed |
| A8 | Databricks battery | `bun test ./src/tests/databricks-verification.ts` | PASS | 16 passed, 0 failed |
| A9 | UI regression battery | `bun test ./src/tests/ui-reset.test.mjs` | PASS | 14 pass, 0 fail |
| A9b | Aggregate test script (all four batteries) | `bun run test` | PASS | exit 0 (engine && db && databricks && ui) |
| A10 | Browser runtime / visual verification | — | BLOCKED | No browser automation available on this host; UI verified via SSR render tests + source inspection only |
| A11 | Latency / performance measurement | — | NOT TESTED | No product latency measured; **no performance claims made** |

## B. P0 — policy-reference contract

| # | Requirement | Implementation | Test | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| B1 | Producer emits canonical version-pinned policy identity | `lib/risk.ts` `evaluateRisk` | `TEST-POLREF-001` | PASS | `"<policyId>@v<N>"` |
| B2 | Display label separate from identity | `lib/risk.ts` | `TEST-POLREF-002` | PASS | label carries `(<STATUS>)` |
| B3 | Producer→consumer contract (authorization built from produced ref validates) | `workflows.ts` → `lib/execution.ts` | `TEST-POLREF-003` | PASS | strict validator unchanged |
| B4 | Legacy display label still rejected by identifier validator | `lib/execution.ts` `token()` | `TEST-POLREF-004` | PASS | validator not weakened |
| B5 | Blocked-path decisions carry identity + label | `lib/risk.ts` | `TEST-POLREF-005/006` | PASS | malformed identity fails closed |
| B6 | Mismatched policy version cannot ratify (exact version binding) | `workflows.ts` `approveRiskPolicy` | `DB-POLREF-001` | PASS | real handler, in-memory DB |
| B7 | Ratification is admin-gated, limits unchanged | `workflows.ts` | `DB-POLREF-002` | PASS | admin role provisioned out-of-band in fixture |
| B8 | Eligible proposal under APPROVED policy yields authorization | `workflows.ts` `submitTradeProposal` | `DB-POLREF-003` | PASS | outcome APPROVE |
| B9 | Scope binds canonical `RISK-POLICY-CORE@v1` | `executionAuthorizations` row | `DB-POLREF-004` | PASS | asserted on persisted row |
| B10 | Approved proposal → PAPER order lifecycle (real producer/consumer path) | `workflows.ts` `placeOrder` | `DB-POLREF-005` | PASS | FILLED under simulated FILL; AUTHORIZED in history |
| B11 | Atomic single-use consumption bound to order | `workflows.ts` | `DB-POLREF-006` | PASS | `consumedByOrderId` matches |
| B12 | Consumed authorization cannot be reused | `lib/execution.ts` + `workflows.ts` | `DB-POLREF-007` | PASS | REJECTED (`authorization_state:BLOCK`), REJECTED audit row only |
| B13 | Foreign owner cannot consume (not-found ≡ not-owned) | `lib/authz.ts` `canUseAuthorization` | `DB-POLREF-008` | PASS | no ID oracle |
| B14 | Malformed (label-shaped) reference fails closed, consumes nothing | `lib/execution.ts` | `DB-POLREF-010` | PASS | authorization stays APPROVED |
| B15 | Expiry / revocation / mode / veto / scope checks preserved | `lib/execution.ts`, `lib/risk.ts` | `TEST-EXEC-*`, `TEST-RISK-*`, `DB-RESET-SAFETY-*` | PASS | unchanged by repair |

## C. Security / authorization

| # | Requirement | Implementation | Test | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| C1 | Every public workflows mutation authenticates server-side | `workflows.ts` `requireUser/requireActor` | `TEST-WIRE-001`, `DB-RESET-AUTH-*` | PASS | 22 public functions audited |
| C2 | placeOrder enforces authorization ownership; no client simulate flag | `workflows.ts` | `TEST-WIRE-002` | PASS | |
| C3 | Console queries owner-scope (own + shared system only) | `console.ts` + `lib/authz.ts` | `DB-RESET-AUTH-*`, owner-scoping asserts | PASS | scoping enforced server-side |
| C4 | Admin-only ops reject missing/incorrect roles; denials audited | `setKillSwitch/grantRole/approveRiskPolicy/seed/…` | `DB-RESET-SAFETY-KS-006`, source-verified | PASS | denial audit events observed |
| C5 | Anonymous sessions cannot change global kill switch | `workflows.ts` `setKillSwitch` | source-verified (`isAnonymous` gate) | PASS | |
| C6 | Anonymous PAPER trading scope | — | — | NOT TESTED | product decision unadjudicated (SP-P1-005) |
| C7 | Idempotent order submission; duplicates create nothing | `workflows.ts` + `by_idempotencyKey` index | `DB-RESET-DUP-001/002`, `DB-POLREF-007` | PASS | |
| C8 | Revoked/expired/consumed/mismatched authorizations unusable | `lib/execution.ts` | `TEST-EXEC-*`, `DB-POLREF-007/010` | PASS | fail closed |
| C9 | Kill switch not bypassable; release requires admin + healthy reconciliation | `workflows.ts` | `DB-RESET-SAFETY-KS-*` | PASS | fail-safe direction preserved |
| C10 | Error responses leak no secrets/IDs | all handlers | `DB-RESET-CONN-*`, source-verified | PASS | generic notes |
| C11 | Role provisioning operational process | — | — | BLOCKED | SPEC-GAP-008: out-of-band admin; no in-app flow (SP-P1-004) |

## D. Risk engine / accounting / database

| # | Requirement | Implementation | Test | Result |
| --- | --- | --- | --- | --- |
| D1 | Garbage on ANY risk input never APPROVEs (type/finiteness/range/allowlist) | `lib/risk.ts` | `TEST-FUZZ-001..004f` | PASS |
| D2 | Provisional policy cannot authorize | `lib/risk.ts` + ratification gate | `DB-POLREF-002/003` | PASS |
| D3 | Negative/zero/null limits interpreted safely (never inverted) | `lib/risk.ts` | `TEST-FUZZ-004c` | PASS |
| D4 | Fill accounting: no double counting; partial fills/over-closes/ambiguous intrabar conservative | `lib/positions.ts`, `workflows.ts` | `DB-RESET-EXEC-001..005`, `*_PARTIAL_*`, `TEST-EXEC-010` | PASS |
| D5 | Unresolved UNKNOWN orders block new exposure (global, by design) | `workflows.ts` (indexed `by_state`) | `DB-RESET-SAFETY-004`, `DB-RESET-RECON-*` | PASS |
| D6 | Bounded scans fail closed on saturation (`accountStateComplete`) | `workflows.ts` `loadRiskContext` | `DB-RESET-SAFETY-004`, engine context tests | PASS |
| D7 | Audit sequence generation concurrency-safe | `lib/store.ts` (OCC-serialized transactions) | reasoned + appends exercised in DB suite | PASS (by Convex OCC semantics; not stress-tested) |
| D8 | Reconciliation resolves only from recorded evidence; timeout never infers failure | `workflows.ts` `reconcile` | `DB-RESET-RECON-*` | PASS |
| D9 | Cross-owner UNKNOWN resolution mechanism | — | — | BLOCKED (Decision B / SP-P1-003) |

## E. Audit chain

| # | Requirement | Implementation | Test | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| E1 | Cryptographic hash + unambiguous canonical serialization | `lib/audit.ts` `sha256Hex`/`canonicalV1` | `TEST-AUDIT-201/203` | PASS | FIPS vectors; ambiguity removed |
| E2 | Versioned record format; legacy records still verify | `lib/audit.ts`, `lib/store.ts`, `schema.ts` | `TEST-AUDIT-202/204` | PASS | `SHA256-V1` writes; FNV verify-only |
| E3 | Sequence continuity; deletion/reordering/duplication detected | `lib/audit.ts` | `TEST-AUDIT-019*/206/209/210` | PASS | |
| E4 | Modification detected; malformed/unknown-format fails closed | `lib/audit.ts` | `TEST-AUDIT-014/205/208` | PASS | |
| E5 | Partial inspection never claimed as full verification | `verifyAuditChain` scope/notes | `TEST-AUDIT-017*/018*` | PASS | FULL_CHAIN/WINDOW/EMPTY distinct |
| E6 | Filtered views distinguish visible vs actually verified | `console.ts` (`verifiedCount` independent of filtering) | `TEST-AUDIT-020` | PASS | |
| E7 | Checkpoints verified in range; forged heads fail | `lib/audit.ts`, `lib/store.ts` `appendCheckpoint` | `TEST-AUDIT-210b/c/d` | PASS | self-attested in-log only |
| E8 | Independently protected anchoring | — | — | BLOCKED | SPEC-GAP-005; until deployed the chain is tamper-EVIDENT only and tail truncation is undetectable (`TEST-AUDIT-207`, documented) |
| E9 | Concurrent append behavior | Convex OCC | — | NOT TESTED under real concurrency; replay/dup detection tested (`TEST-AUDIT-209`) |

## F. Market data / strategy validity / credentials

| # | Requirement | Implementation | Test | Result |
| --- | --- | --- | --- | --- |
| F1 | Snapshot binding matches actual rows (market/timeframe/range/version) | `lib/pipeline.ts` | `TEST-VALID-013..016` | PASS |
| F2 | Leakage/look-ahead checks computed, not asserted | `lib/backtest.ts`, `lib/pipeline.ts` | `TEST-VALID-*` | PASS |
| F3 | Metrics unavailable (N/A) when evidence insufficient | `lib/backtest.ts`, `lib/evidence.ts` | `TEST-VALID-011`, engine evidence tests | PASS |
| F4 | Costs/spreads/slippage/ambiguous exits treated conservatively | `lib/backtest.ts` | `TEST-EXEC-010`, cost-model tests | PASS |
| F5 | Synthetic data labeled; no live-feed claims | `seed.ts`, UI labels (R-3) | source + UI suite | PASS |
| F6 | Raw credentials never persisted/returned/audited | `lib/credentials.ts`, `connections.ts` | `TEST-SEC-CRED-*`, `DB-RESET-CONN-*` | PASS |
| F7 | Provider states honest (SIMULATED/NOT_CONFIGURED/UNAVAILABLE) | `connections.ts`, `lib/databricks.ts` | `DB-RESET-CONN-*`, databricks 16/16 | PASS |
| F8 | Live forex news / real-time quotes / broker connectivity | — | — | NOT TESTED — **do not exist**; no adapter implemented or verified |
| F9 | Production KMS/vault credential custody | — | — | BLOCKED (SPEC-GAP-007) |

## G. Frontend (six protected routes)

| # | Requirement | Test / method | Result | Notes |
| --- | --- | --- | --- | --- |
| G1 | Protected routes + auth fallback intact | `ui-reset.test.mjs` | PASS | `/auth?returnTo=…` preserved |
| G2 | Design architecture renders on all six screens | `ui-reset.test.mjs` | PASS | 14/0, design markers pinned |
| G3 | Placeholder content labeled as simulated/demo | source review + honesty labels (R-3) | PASS (labels) | underlying data still prototype — see audit §7 |
| G4 | Analysis actions invoke the analysis pipeline | source trace | FAIL (documented) | "Run Market Analysis"/"Open Model Synthesis" only navigate; real pipeline reachable via engineering console panels |
| G5 | BUY/WAIT/SELL records no order | `ui-reset.test.mjs` | PASS | stance is local state; "No order was placed" |
| G6 | No live recommendation presented | source review | PASS after R-3 | fake "Verified catalyst" label removed |
| G7 | Real browser interaction (auth forms, taps, visual) | — | BLOCKED | no browser runtime (A10) |

## H. End-to-end product question

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the approved PAPER/DEMO workflow work end to end? | **YES** (simulated provider) | `DB-POLREF-001..006`: ratify → proposal → APPROVE → authorization (canonical ref) → PAPER order → FILLED → consumption binding |
| Does the UI use real or simulated data? | **Simulated/prototype** on the six screens (labeled); **real backend data** in the engineering console panels | audit §7 |
| Any real broker connectivity verified? | **NO** — none exists | `TEST-LIVE-001/002`, `DB-RESET-CONN-*` |
| Production ready? | **NO** | audit §9 blocking conditions 1–8 |
