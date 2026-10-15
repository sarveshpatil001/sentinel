# SENTINEL PRIME — TARGETED RISK & EXECUTION FIX REPORT (findings A–D)

Date: 2026-10-15. Scope: the four confirmed defects (A order-state gate, B
reconciliation false-healthy, C consecutive-loss protection, D equity/drawdown
valuation). Live execution remains disabled; nothing in this pass touches
credentials, auth, or the PAPER/DEMO-only guards.

---

## A. Findings fixed

### A — Incomplete order-state gate: **FIXED**
Traced the full lifecycle (`lib/execution.ts` OrderState): CREATED →
VALIDATING → AUTHORIZED → READY → SUBMITTING → SUBMITTED → {ACKNOWLEDGED |
PARTIALLY_FILLED | FILLED | REJECTED | CANCELLED | EXPIRED | UNKNOWN}. One
policy now lives in `lib/execution.ts`
(`UNRESOLVED_SUBMISSION_STATES` / `isUnresolvedSubmissionState`), consumed by
the risk context, the submission precheck and reconciliation:
- **Unresolved submissions (restrict new exposure, require reconciliation):
  SUBMITTING, SUBMITTED, UNKNOWN.** SUBMITTING = submission in flight, no
  provider response; SUBMITTED = awaiting provider result; UNKNOWN =
  ambiguous (a submission may have reached the provider).
- Resolved/known states never block: ACKNOWLEDGED (normal working order),
  PARTIALLY_FILLED (known partial execution), FILLED/REJECTED/CANCELLED/
  EXPIRED (terminal).
- Enforcement is server-side in `placeOrder` (precheck) and
  `submitTradeProposal`/`loadRiskContext` (risk veto) — no frontend reliance.
- Scope = the caller's visibility (own + shared SYSTEM rows, `canViewRecord`),
  with per-owner-per-state **indexed** reads (`orders.by_owner_state`) and
  per-scope saturation detection. One customer's records no longer affect
  another customer's decisions (this supersedes the G2 report's earlier
  global-gate note, per finding A's explicit isolation requirement; within
  each scope the gate stays fail-closed). Shared SYSTEM rows block every scope.
- Saturated scan ⇒ `accountStateComplete: false` ⇒ engine UNKNOWN ⇒ no action
  ("an incomplete or saturated scan is never a complete, safe account state").
- Duplicate-exposure protection: an earlier submission that may have reached
  the provider (SUBMITTING/SUBMITTED/UNKNOWN) blocks all new submission in the
  scope; the gate opens when reconciliation resolves the orders (no
  forever-block — DB-GATE-004). **Reductions/cancels are NOT explicitly
  permitted by any existing policy during an unresolved window, so the window
  stays closed for them too (safest supported policy; no cancel path exists in
  this build). Kill-switch ENGAGE (a safety action) remains unblocked.**

### B — Reconciliation false-healthy: **FIXED**
`reconcile` now classifies **every** scanned order through
`classifyOrderReconciliation` (exhaustive; nothing falls through):
- ACCEPTED provider evidence → ACKNOWLEDGED; REJECTED → REJECTED (the
  documented resolution condition, matching the existing provider contract
  `normalizeProviderResponse`).
- No/absent evidence ⇒ **UNRESOLVED** and explicitly reported with category
  PENDING_SUBMISSION (SUBMITTING/SUBMITTED) or AMBIGUOUS (UNKNOWN). A timeout,
  missing response or absent provider record is never proof of anything.
- Contradictory evidence (fills on a rejected order, fill qty > order qty,
  invalid price/quantity) ⇒ UNRESOLVED/CONTRADICTORY_EVIDENCE — a terminal
  result is never manufactured.
- Unrecognized state values fail closed (UNRECOGNIZED_STATE).
- `healthy = scanComplete && unresolved.length === 0`; the result now returns
  `scanComplete` and structured `unresolved` entries; audit detail names
  "INCOMPLETE SCAN" and lists `[state/category]` per unresolved order. Output
  agrees with the execution gate (same state policy, same scope) and repeats
  are idempotent (reconcile writes only state/history; resolved orders leave
  the scanned set).

### C — Consecutive-loss protection ineffective: **FIXED**
- Source of truth: new `realizedTradeOutcomes` table — one row per
  **realization event** (a fill application that closes a positive portion of
  a position, i.e. the exact moment realized PnL enters the ledger in the
  repository's per-closed-portion accounting model). Written in the same
  Convex transaction as the position/ledger accounting (atomic).
- Stable event id `OUT-<orderId>-<cumulativeFilledQty>` + `by_outcomeId`
  uniqueness ⇒ retried mutations / repeated fills / repeated reconciliation
  can never count the same realized result twice (DB-STREAK-005/006).
- Per-owner monotonic `seq` (`by_owner_seq`) detects missing history; a gap
  fails the streak closed, never a silent zero (DB-STREAK-009).
- Policy (documented in `lib/positions.ts`): LOSS extends the streak, WIN
  resets it, **BREAKEVEN neither extends nor resets** (the safer fail-closed
  reading of an ambiguous rule; no breakeven epsilon is invented — a
  breakeven is realized delta exactly 0). The streak is therefore "losing
  realized outcomes since the most recent winning outcome". Partial exits
  across orders are distinct outcomes; duplicate applications are idempotent.
  Reopened positions create new events (records are immutable); the model has
  no correction/reversal/deposit/withdrawal events (documented).
- `loadRiskContext` now feeds the engine the persisted owner-scoped streak
  (was hardcoded `0`); history is read newest-first, bounded at SCAN_CAP with
  saturation ⇒ `accountStateComplete: false` (fail closed) while the reported
  streak stays a lower bound ≥ the counted losses. The seeded
  `maxConsecutiveLosses: 4` demonstrably BLOCKS at 4 (DB-STREAK-008).

### D — Equity/drawdown ignored unrealized PnL: **FIXED**
- Documented accounting semantics: equity is **mark-to-market** =
  `PAPER_EQUITY_BASE + Σ realized + Σ unrealized` over the customer's risk
  scope (own + shared SYSTEM). Unrealized uses the position-direction
  convention (LONG (mark−entry)·qty, SHORT (entry−mark)·qty). Both realized
  and unrealized are **gross of fees**, matching the existing model (fees are
  recorded per order; `positions.realizedPnl` is gross — DB-EQUITY-008
  documents/asserts this instead of silently netting).
- Mark = the market's latest closed **1h candle close** (the same canonical
  series the execution path prices fills from), valid only when finite,
  positive and fresh within the **existing** 2h execution staleness bound (no
  new invented threshold). Missing/stale/invalid prices ⇒
  `valuationComplete: false` ⇒ engine `equity_valuation` UNKNOWN ⇒ no new
  exposure. Absent prices are never treated as 0 unrealized or as safety.
- Daily realized PnL remains **realized-only** (DB-EQUITY-010).
- Peak equity: a reliable valuation may raise it; an unreliable valuation
  never lowers (or raises) it — it is left untouched (DB-EQUITY-009).
- Bounded: ≤ 256 distinct open markets valued per read (fan-out cap ⇒
  incomplete ⇒ fail closed); one indexed read per market.

## B. Changed files

| File | Purpose |
|---|---|
| `src/convex/lib/execution.ts` | One order-state policy (`UNRESOLVED_SUBMISSION_STATES`, `isUnresolvedSubmissionState`); exhaustive `classifyOrderReconciliation`; `PrecheckContext.unresolvedOrders` (renamed, broadened semantics + gate message) |
| `src/convex/lib/positions.ts` | `closedQuantity`, `unrealizedPnl` (MTM, fail-closed on unvalueable input), `classifyRealizedOutcome`, `computeLossStreak` (documented streak policy + gap/truncation detection) |
| `src/convex/lib/risk.ts` | `RiskContext.unresolvedOrders` (renamed), `valuationComplete`, new `equity_valuation` check, generalized `account_state_completeness`, streak-accurate `consecutive_losses` details |
| `src/convex/schema.ts` | `orders.by_owner_state` index; new `realizedTradeOutcomes` table (`by_owner_seq`, `by_outcomeId`, `by_orderId`) — additive, migration-compatible |
| `src/convex/workflows.ts` | `scanUnresolvedOrders`, `readLossStreak`, `valueScopePositions`, `recordRealizedOutcome`; `loadRiskContext` (scoped 3-state gate, persisted streak, MTM equity, peak rules); `placeOrder` (gate + outcome recording + valuation-aware peak); `reconcile` (exhaustive classification, `scanComplete`, structured unresolved, honest audit detail); `setKillSwitch` release gate covers all three unresolved states |
| `src/tests/db-verification.ts` | 39 new checks (DB-GATE-*, DB-RECON-011..018, DB-STREAK-*, DB-EQUITY-*); fixture updates: `OrderRow` extended, fresh MKT-G2-2 mark candle, `seedAuthorization` marketId option |
| `src/tests/engine-verification.ts` | 19 new checks (TEST-ORDSTATE/RECON/STREAK/MTM/OUTCOME); rename sites; fuzz now covers `valuationComplete` |
| `docs/SENTINEL_PRIME_RISK_EXECUTION_FIX_REPORT.md` | This report |

## C. Regression coverage (behavior → defect prevented)

**Finding A** — `DB-GATE-001/001b` SUBMITTING cannot bypass the gate (risk +
submission); `DB-GATE-002/002b` SUBMITTED cannot; `DB-GATE-003` UNKNOWN keeps
its protection; `DB-GATE-004/004b` a resolved former-UNKNOWN/terminal order no
longer blocks (no forever-block); `DB-GATE-005/005b` cross-customer records
never leak into another customer's decision (shared SYSTEM rows still in every
scope); `DB-GATE-006` saturated scan is never a safe state.

**Finding B** — `DB-RECON-011` unresolved SUBMITTING visible in output, no
false healthy; `DB-RECON-012` SUBMITTED classified, visible until resolution
condition; `DB-RECON-013` UNKNOWN stays unresolved; `DB-RECON-014` accepted/
rejected evidence resolves per contract; `DB-RECON-015` missing/contradictory
evidence never manufactures a terminal result; `DB-RECON-016` saturated scan →
incomplete/degraded (audit says "INCOMPLETE SCAN"); `DB-RECON-017` repeats are
idempotent (no duplicate fills/accounting, one transition); `DB-RECON-018`
output agrees with the execution gate. Plus pure `TEST-RECON-101..106`.

**Finding C** — `DB-STREAK-001` loss increments; `002` consecutive losses;
`003` win resets; `004` breakeven per documented policy; `005` partial
fills/exits + duplicate event id never double-count; `006` retried mutation =
one accounting event; `007` customer isolation; `008` threshold 4 blocks;
`009` missing/gapped history fails closed (not zero); `010` saturated history
= lower-bound streak + fail closed. Plus `TEST-STREAK-201..207`,
`TEST-OUTCOME-401/402`.

**Finding D** — `DB-EQUITY-001` no-open-positions equity; `002` positive
unrealized; `003` negative unrealized; `004` drawdown near/beyond limit on the
MTM basis; `005` missing price; `006` stale price; `007` invalid price; `008`
fees recorded, equity documented-gross; `009` peak never lowered by missing
valuation; `010` daily realized distinct from unrealized; `011` incomplete
position scan fails closed. Plus `TEST-MTM-301..303`.

## D. Verification results

| Check | Command actually run | Result | Evidence |
|---|---|---|---|
| Focused regression tests | `bun src/tests/db-verification.ts` (DB-GATE/RECON/STREAK/EQUITY batteries) | **Pass** (exit 0) | 197 passed, 0 failed (158 pre-existing + 39 new) |
| Database tests | `bun src/tests/db-verification.ts` | **Pass** (exit 0) | full file incl. all prior DB-* batteries |
| Engine tests | `bun src/tests/engine-verification.ts` | **Pass** (exit 0) | 135 passed, 0 failed (116 pre-existing + 19 new) |
| Typecheck | `bunx tsc -b --noEmit` | **Pass** (exit 0) | clean (after `bunx convex dev --once`, exit 0 — codegen + push incl. new indexes) |
| Lint | `bun run lint` | **Pass** (exit 0) | 0 errors, 17 warnings — exact pre-existing baseline, none added |
| Build | `bun run build` | **Pass** (exit 0) | `tsc -b && vite build`, built in 7.92s |
| Broader suite | `bun run test` | **Pass** (exit 0) | engine 135/0 · db 197/0 · marketdata 50/0 · databricks 16/0 · ui 14/0 = **412 checks, 0 failures** |

Failures encountered while implementing (fixed at the root, none suppressed):
1. First run after the behavior change: `DB-G2-004` failed — the G2 fixture
   holds an open position on a market with **no price data**, which under
   finding D's rules is honestly an incomplete valuation that freezes the
   peak. Fixture adapted (fresh MKT-G2-2 mark at the fixture entry price, so
   unrealized is exactly 0): every G2 assertion is unchanged and strict.
2. `TEST-RECON-106` — my classifier resolved an *unrecognized state* on
   ACCEPTED evidence; fixed by allowlisting reconcilable states first (fail
   closed), as documented.
3. `DB-STREAK-003/004` — test-fixture authorizations were scoped to MKT-T so
   the second-market order was correctly rejected; `seedAuthorization` now
   accepts `marketId` (fixture capability only).
4. `DB-EQUITY-009` — my expected constant was mis-added (100000+1200+20 =
   101220, not 101020); behavior was correct, expectation corrected.

No assertion was weakened, no test deleted or skipped, no error swallowed.

## E. Remaining risks

| Risk | Severity | Impact |
|---|---|---|
| No real provider lookup exists in this build: reconciliation resolves only on recorded provider evidence (`providerTruth`); rows without evidence remain unresolved indefinitely (pre-existing gap SP-P1-003) | **High** (for production) | A pending/ambiguous order can keep the affected scope blocked until evidence exists; this is the fail-closed design, but a real provider-ledger adapter is required before any production use |
| Outcome ledger begins at this change: realizations predating it (out-of-band/legacy rows, e.g. seeded demo positions) have no outcome rows | Medium | The seq-gap guard detects deletions/gaps but cannot detect realizations that never produced a row. Recovery procedure: replay fill history into `realizedTradeOutcomes`, or adjudicate with an audit-logged reset of `riskAccountState`. Seeded demo positions are shared SYSTEM rows and are excluded from owner streaks by design |
| Breakeven-streak policy is a judgment call (documented; breakeven preserves the streak) | Low | Alternative (breakeven resets) needs an ADR; current choice only ever blocks more, never less |
| Gate scoping per `canViewRecord` supersedes the G2 report's global-gate note | Low | Cross-customer coupling removed per finding A; each scope remains fail-closed; shared SYSTEM rows still block every scope. If product tenancy later defines a shared trading account, the seam (`scanUnresolvedOrders`) is where membership extends the scope |
| `consecutiveLosses` metric is event-level (per closed portion per fill), not per round-trip trade | Low | Matches the repository's accounting model; a round-trip definition would need a trade-lifecycle concept that does not exist |
| Mark freshness bound (2h) and 1h-close mark source are reused existing conventions, not ADR-ratified valuation policy | Low | Documented; a valuation ADR should ratify them (SPEC-GAP-002 class) |
| Fan-out cap 256 markets/read and SCAN_CAP 2000 | Low | Beyond the caps the system fails closed (blocked, never undercounted) |
| Last-admin demotion, unanchored audit chain, KMS custody, anonymous-session scope (pre-existing SP-P1-003/004/005, SPEC-GAP-005/007/008) | Medium | Unchanged by this pass; still production blockers |

## F. Final safety decision

**Suitable for continued local and PAPER/DEMO testing only.** These targeted
fixes make the four confirmed defects behave correctly and fail closed under
test, but they do **not** make Sentinel Prime production-ready or safe for
real-money execution: real-money execution remains disabled by design (no live
broker, no live mode, PAPER/DEMO-only credential ingestion, kill switch and
mode gates untouched), no real provider connectivity or live market data
exists or was verified, and the remaining risks above (especially the absence
of an authoritative provider ledger) are production blockers. Nothing in this
work establishes profitability or guarantees risk-free trading.

## Security & safety regression review (post-change)

- Real-money execution remains disabled (mode allowlist PAPER/DEMO only;
  CONTROLLED_LIVE blocked in engine and precheck; unchanged).
- Authorization/role checks, owner-binding, no-IDOR semantics untouched
  (all prior DB-POLREF/DB-AUTHZ/DB-PRIV/DB-RESET-AUTH batteries green).
- Cross-customer risk data isolated (DB-G2-* green with identical assertions;
  DB-GATE-005/005b, DB-STREAK-007).
- Ambiguous outcomes cannot duplicate submission (unresolved states block;
  single-use authorizations; idempotency keys; stable outcome ids).
- Incomplete/unknown context never authorizes exposure (`accountStateComplete`
  / `valuationComplete` → UNKNOWN → veto denies; DB-GATE-006, DB-EQUITY-005..7,
  011, DB-STREAK-009/010).
- Order-state transitions and accounting effects auditable (order `history`,
  `realizedTradeOutcomes` rows, RECONCILIATION_RUN audit detail).
- Bounded scans and per-scope saturation rules intact and extended.
- UI claims: no UI surface renders a "healthy" label from reconciliation;
  console/panels show raw backend state only (verified by search).
- No secrets, credentials, or env files touched; nothing sensitive in diffs,
  logs, or this report.

---

## Post-audit corrective patch (findings D1, D2, D3, D4, V4c) — SUPERSEDES
## specific claims above

Date: 2026-10-15. An independent post-audit confirmed five defects in this
report's earlier claims. The narrative above is preserved as a dated record;
the following corrections supersede it where they conflict:

1. **D2 — "fills counted once (dedup by order + fill id)" was not true.**
   The guard `fillDelta(filledQuantity, 0)` never subtracted an already-
   applied quantity. Now: **authoritative cumulative-fill accounting** —
   `orders.fillAppliedQuantity` is persisted and every provider fill is
   applied as the delta through one atomic path (`applyProviderFill`) that
   updates position, realized PnL, `realizedTradeOutcomes` (stable event id
   `OUT-<orderId>-<cumulativeFilled>`) and `riskAccountState` together. The
   same fill cannot be counted twice in any accounting record across retries,
   replays and repeated reconciliation (`DB-D2-001..003`, `DB-RECON-017`).
2. **D1 — reconciliation could resolve an order while dropping its fill
   accounting.** Now a RESOLVED classification carrying fill evidence applies
   that fill in the SAME transaction as the state transition; if the fill
   cannot be accounted (ownerless row, unusable price, applied-quantity
   inconsistency) the order stays UNRESOLVED/CONTRADICTORY_EVIDENCE and keeps
   blocking — it is never merely marked ACKNOWLEDGED (`DB-D1-001/002`,
   `TEST-RECON-107/108`).
3. **D4 — the per-customer gate scoping described under Finding A (and in the
   "Gate scoping per canViewRecord" risk row) is SUPERSEDED by ratified
   Decision A.** On the shared execution account an unresolved submission
   from EITHER customer blocks risk-increasing exposure for BOTH; the gate is
   account-global (`orders.by_mode_state`), while customer-private DATA stays
   isolated (foreign rows counted for account health, never disclosed or
   patched — Decision B). Unrelated accounts remain isolated; the global
   kill-switch release gate agrees with the account gate
   (`DB-GATE-005/005-ks/005c`). `DB-GATE-005`'s old assertion (foreign
   unresolved rows did not block another customer) encoded the defect and was
   rewritten to the ratified policy; its data-isolation intent is preserved
   and asserted in the new tests.
4. **DB-RECON-017's "no duplicate fills/accounting" assertion was vacuous**
   (the fixture order carried no fills). Rewritten to drive a real partial
   fill through `reconcile` and prove exactly-once accounting across repeated
   runs.
5. **V4c — candles marked `INCOMPLETE` were eligible price sources.** Now
   every mark-to-market and fill-pricing path selects only ELIGIBLE candles
   (never `INCOMPLETE`, finite/positive close, fresh within the existing 2h
   bound); with no eligible candle the valuation is reported incomplete and
   risk-increasing action is blocked (`DB-V4C-001/002`).
6. **D3 — the seeded/shared fixture P&L policy is now explicit (Decision C in
   `docs/execution-architecture-decisions.md`):** shared SYSTEM fixture P&L is
   shared ACCOUNT economics (enters equity, drawdown and the daily PnL
   fallback consistently) and NEVER enters any customer's behavioral streak;
   no ledger rows are fabricated for fixture baselines (`DB-D3-001..003`).

### Corrective-patch verification (commands actually run, exit codes actual)

| Check | Command | Result |
|---|---|---|
| Full test battery | `bun run test` | **exit 0** — engine 137/0 · db 209/0 · marketdata 50/0 · databricks 16/0 · ui 14/0 = **426 checks, 0 failures** (prior baseline 412 = 135+197+50+16+14; +14 new regression checks) |
| Typecheck | `bunx convex dev --once` (exit 0) then `bunx tsc -b --noEmit` | **exit 0** |
| Lint | `bun run lint` | **exit 0** — 0 errors, 17 warnings (exact pre-existing baseline) |
| Build | `bun run build` | **exit 0** — built in 8.25s |

No assertion was weakened or removed except the two mandated corrections
above (D4's `DB-GATE-005` policy assertion and the vacuous `DB-RECON-017`
fill assertion), each replaced by strictly stronger coverage. Live trading
remains disabled (mode allowlist PAPER/DEMO; `CONTROLLED_LIVE` blocked in
engine and prechecks; live credential ingestion rejected —
`DB-RESET-CONN-*`).
