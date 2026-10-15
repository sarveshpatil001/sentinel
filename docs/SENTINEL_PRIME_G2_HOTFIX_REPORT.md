# SENTINEL PRIME — G2 HOTFIX REPORT (STEP 1: TENANT RISK ISOLATION)

Date: 2026-10-15. Scope: **G2 per-customer risk-input isolation only.** G3
(kill-switch scoping) and all other findings untouched, as instructed.

---

## 1. Confirmed root cause

Traced `loadRiskContext`, `placeOrder`, `evaluateRisk` (`lib/risk.ts`, pure,
unchanged), the position queries and all callers (`submitTradeProposal`,
`analysis.executeAnalysis`, three direct test call sites):

1. **Positions aggregated over ALL owners.** `loadRiskContext` ran
   `positions.take(SCAN_CAP)` with **no owner filter** and summed
   `realizedPnl` into `equity = 100000 + Σ realized`, counted `openPositions`
   across every customer, and derived drawdown from that mixed equity.
2. **Daily PnL and peak equity lived in the SHARED `systemState` row.**
   `realizedPnlDay`/`pnlDay`/`peakEquity` were single global counters: every
   fill's delta was accumulated into one row (`placeOrder`), so **customer B's
   loss was added to customer A's daily-loss input** — and `loadRiskContext`
   read those global counters into every customer's verdict
   (`maxDailyLoss`, `maxDrawdown` checks in `lib/risk.ts`).
3. **`placeOrder`'s fill-time equity recompute** likewise summed all owners.

Required ownership boundary (documented decision):

- **Risk scope = the customer's own records + shared SYSTEM demo rows** —
  exactly `canViewRecord` semantics (`lib/authz.ts`): the shared SYSTEM
  workspace is explicitly authorized for every customer, and this
  "explicitly authorized shared/portfolio-level aggregation" must be
  preserved (it is also what the existing `DB-BOUNDS-002a/b` checks verify).
  **Another customer's rows never enter the scope** (own-only exclusion of
  foreign owners).
- **Account-level aggregation preserved**: all of one customer's positions
  across markets aggregate in one account scope.
- Owner identity is **always server-derived** from the trusted auth identity
  (`getAuthUserId`) at the mutation boundary — never a client-supplied field.

---

## 2. Exact changes

### `src/convex/schema.ts`
- New `riskAccountState` table — **per-customer** accounting ledger
  (`ownerUserId`, `peakEquity`, `pnlDay`, `realizedPnlDay`) with
  `by_ownerUserId` index. Customer accounting is now separate from the shared
  platform controls (`systemState`: kill switch, mode, simulation config).

### `src/convex/workflows.ts`
- New `readRiskScopePositions(ctx, accountOwnerUserId)`: two **indexed**
  reads over the `by_owner_market` prefix — the owner's rows and shared SYSTEM
  rows (`.eq("ownerUserId", undefined)`, which the Convex docs confirm matches
  documents missing the field; see https://docs.convex.dev/database/types,
  "Working with undefined"). **Per-scope saturation detection** at `SCAN_CAP`:
  another customer's row volume can no longer affect this scope's
  completeness (previously one shared scan coupled all customers).
- `loadRiskContext` gains `args.accountOwnerUserId` (documented as
  server-derived only; both callers pass the authenticated identity):
  - `equity`, `openPositions`, cumulative `realized` computed over the scope
    only;
  - daily PnL / peak equity read from the caller's `riskAccountState` row,
    preserving the legacy fail-safe fallbacks (no day tracking → the
    customer's own cumulative realized PnL, never zero; peak falls back to
    the contribution base, never `equity` itself);
  - `accountStateComplete` = per-scope completeness AND the unchanged global
    UNKNOWN-order gate.
- `placeOrder` (fill path):
  - equity recomputed over the caller's scope only;
  - upserts the caller's `riskAccountState` (daily PnL + peak equity);
  - continues to maintain the legacy `systemState` counters as
    **platform-aggregate telemetry** (dual-write) so existing verified
    behavior (`DB-EXEC-001d`) stays green — those fields are **not read by
    any risk calculation** anymore, and removal is deferred to the plan
    Step 2 migration.

### `src/convex/analysis.ts`
- The pipeline's hypothetical proposals now evaluate against the **analysis
  owner's** scope (`accountOwnerUserId: ownerUserId`, server-derived).

### `src/tests/db-verification.ts`
- The three direct `loadRiskContext` call sites pass the new required
  `accountOwnerUserId` (fixture identity). No assertion changed.
- New `DB-G2-001..006` battery.

Deterministic risk checks (`lib/risk.ts`), audit logging, authorization
lifecycle, PAPER/DEMO-only enforcement and the kill switch are **untouched**.
No live-trading path exists or was added.

---

## 3. Regression tests (DB-G2-*)

| Check | Proves (requirement) |
|---|---|
| DB-G2-001 | **A's risk context excludes B's positions/losses**: equity = 100 000 + own (150) + shared SYSTEM (1 000); B's −5 000 absent; daily PnL = A's own ledger (−100) |
| DB-G2-002 | **B's context excludes A's**: equity = 100 000 − 5 000 + 1 000; A's +150 absent; daily PnL = B's ledger (−3 000) |
| DB-G2-003 | **One customer's loss does not alter another's verdict**: identical proposal + policy → A's `daily_loss` PASS, B's `daily_loss` BLOCK on B's own loss |
| DB-G2-004 | **Same-customer aggregation**: real FILL-path order closes A's position (realized 99.95) and aggregates across A's markets + shared rows (equity 101 149.95, 2 open); A's own ledger updated (−100.05 daily, peak 101 149.95) |
| DB-G2-005 | **Unauthorized account/position references rejected**: B's fill touches only B's rows — A's position row and ledger byte-identical before/after |
| DB-G2-006 | **Controls stay separate**: after B's loss, A's daily-loss verdict is unchanged (−100.05 → PASS) while the shared kill switch remains the platform-level control |

All pre-existing risk and execution-safety checks remain green unchanged
(`DB-BOUNDS-001..004` bounded-scan fail-closed behavior, `DB-EXEC-001..`
fill accounting, `DB-POLREF-*` authorization lifecycle, `DB-G1-*`,
`TEST-FUZZ-*` engine fail-closed fuzzing) — see §4.

---

## 4. Verification — commands executed, actual exit codes

| Command | Exit | Result |
|---|---|---|
| `bunx convex dev --once` (codegen + push, incl. `riskAccountState`) | **0** | functions ready |
| `bunx tsc -b --noEmit` | **0** | clean (run after codegen and again after tests) |
| `bun src/tests/db-verification.ts` (focused) | **0** | **158 passed, 0 failed** (152 pre-existing + 6 new) |
| `bun run test` (complete suite) | **0** | engine 116/0 · db 158/0 · marketdata 50/0 · databricks 16/0 · ui 14/0 = **354 checks, 0 failures** |
| `bun run lint` | **0** | 0 errors, 17 warnings — exact pre-existing baseline, none added |
| `bun run build` (production) | **0** | built in 8.17s |

No check failed during this step; nothing was skipped, deleted, weakened, or
suppressed. Existing test changes were limited to passing the new required
`accountOwnerUserId` argument at three call sites (assertions untouched).

---

## 5. Files changed

1. `src/convex/schema.ts` — `riskAccountState` table.
2. `src/convex/workflows.ts` — scoped risk reads, per-customer ledger
   (consumed + written), scoped fill-time equity, documented scope rule.
3. `src/convex/analysis.ts` — owner-scoped risk context for hypotheticals.
4. `src/tests/db-verification.ts` — 3 call-site args + `DB-G2-001..006`.
5. `docs/SENTINEL_PRIME_G2_HOTFIX_REPORT.md` — this report.
6. `docs/SENTINEL_PRIME_PHASE1_IMPLEMENTATION_PLAN.md` — status note.

---

## 6. Remaining limitations / notes

- **Global gates unchanged (plan gaps G4/G5, deliberately out of scope):** the
  UNKNOWN-order exposure gate and the duplicate idempotency-key namespace
  remain platform-global and fail-closed. Scoping them per customer would make
  verdicts *more permissive* (weakening a documented safeguard) and needs the
  tenancy adjudication of plan Step 2. Cross-customer effect today is
  fail-closed only (blocks, never authorizes).
- **Legacy `systemState` accounting fields** (`peakEquity`, `pnlDay`,
  `realizedPnlDay`) are still written as platform-aggregate telemetry so the
  existing `DB-EXEC-001d` behavior stays green; they are no longer consumed by
  any risk calculation. Removal is deferred to the plan Step 2 migration.
- **Scope semantics:** own + shared SYSTEM rows (`canViewRecord`). A
  strict-own-only variant (excluding shared demo rows) is a product decision
  reserved for plan Step 2 when `tenants`/`memberships` exist; the
  `readRiskScopePositions` helper is the single seam where a tenant/portfolio
  membership set would extend the scope.
- No tenant/membership model yet (plan Step 1): scoping is per user account.
  `riskAccountState.ownerUserId` is a plain user id (not a Convex `Id`), by
  design, so the later tenant migration stays additive.
- `consecutiveLosses` remains hardcoded `0` in the context (pre-existing,
  unchanged — plan-level gap, not a G2 input).
- Per-scope saturation (`SCAN_CAP = 2000` rows per owner) fails closed within
  the scope; a customer with ≥2 000 position rows blocks only themselves.
