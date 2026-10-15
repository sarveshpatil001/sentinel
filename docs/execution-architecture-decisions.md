# Sentinel Prime — Execution Architecture Decisions

Status: **DECIDED constraints + OPEN proposals.** This file records three
product decisions (A, B, C) and the audit-verification semantics they depend
on. Live trading is not implemented, not enabled, and not auto-resumable.
Nothing in this file approves a risk limit, ratifies a policy, or provisions
an administrator.

---

## Decision A — Shared PAPER account exposure (DECIDED — preserved)

The current build runs PAPER/DEMO on a single **shared** account
(`PAPER:paper-account`). For this model:

1. **The exposure gate is ACCOUNT-GLOBAL and fail-closed.** While ANY order
   **on the shared execution account** — from ANY owner — is in an unresolved
   submission state (`SUBMITTING` / `SUBMITTED` / `UNKNOWN`, one shared
   order-state policy), new exposure is blocked for EVERY customer of that
   account: at risk-decision time (`reconciliation_state` in the deterministic
   risk engine) and again at submission time (execution prechecks). The gate
   is deliberately **not** scoped to the initiating user: on a shared account
   the external state is shared, so unknown state anywhere on the account
   means the account's true exposure is unknown. The scan is indexed per
   account (`orders.by_mode_state`) and is saturation-detected — it never
   degrades other accounts' scan completeness, and an unresolved order on an
   UNRELATED execution account (e.g. `DEMO:paper-account`) never blocks this
   account (tested: `DB-GATE-005`, `DB-GATE-005c`).
   **RATIFIED (post-audit corrective patch, finding D4):** this rule — an
   unresolved submission from either customer blocks risk-increasing exposure
   for BOTH on the shared account — is the confirmed policy; the previous
   per-customer gate behavior was a defect, not a design. Customer-private
   DATA remains strictly isolated: foreign rows are only ever COUNTED for
   account health, never disclosed, patched or classified by another customer
   (Decision B). The global kill-switch release gate agrees with this rule:
   release is refused while ANY unresolved submission remains on ANY account
   (the switch is one shared platform control), and succeeds once the account
   is clear (tested: `DB-GATE-005-ks`).
2. **Risk accounting is account-global and consistent** with that model:
   equity, realized PnL, peak equity and daily PnL are computed over the whole
   shared account at fill time and at proposal time. Per-user accounting would
   silently desynchronize the two.
3. Rationale: an `UNKNOWN` order may already be live at the provider. Adding
   exposure while the account's real position is unknowable is exactly what
   the fail-closed rule forbids.

### Future multi-user execution — SEPARATE ARCHITECTURAL REQUIREMENT

When real multi-user execution is designed, it requires **isolated account
ledgers**, not just record ownership:

- one execution **account per user (or per workspace)**, with orders,
  positions, authorizations and risk accounting scoped to that account;
- **per-account exposure gates**: an `UNKNOWN` order blocks only its own
  account's new exposure (other accounts are unaffected);
- **per-account reconciliation** and per-account equity/drawdown accounting;
- a migration plan for existing shared-account records.

This redesign is **NOT implemented in this build** (per Decision A) and
requires a dedicated ADR covering tenancy, migration and risk semantics.
Until then the shared-account fail-closed behavior above stays in force.

---

## Decision B — Reconciliation authority (current authority documented;
## cross-owner mechanism is an OPEN GAP)

### Currently implemented narrow authority (tested)

| Requirement | Where enforced |
| --- | --- |
| Ordinary users cannot reconcile or mutate another user's orders | `workflows.reconcile` transitions only the caller's own + shared SYSTEM rows; not-found ≡ not-owned. Foreign rows on the shared account are only COUNTED into the account-honest health summary (`unresolvedForeign`) so a run never reports healthy while they block the account — their ids are never disclosed (tested: `DB-GATE-005-ks`) |
| A resolution carrying fill evidence accounts the fill atomically | `reconcile` applies fills through the one cumulative-fill accounting path (persisted `orders.fillAppliedQuantity`, stable `OUT-<orderId>-<cumulative>` event ids) in the SAME transaction as the transition; if the fill cannot be accounted the order stays unresolved (CONTRADICTORY_EVIDENCE) and is never merely marked `ACKNOWLEDGED` (findings D1/D2) |
| Resolution only from recorded evidence | An `UNKNOWN` order resolves ONLY on its recorded provider truth (`ACCEPTED` → `ACKNOWLEDGED`, `REJECTED` → `REJECTED`) |
| Never infer failure from a timeout | A timeout leaves provider truth `NONE`; the order STAYS `UNKNOWN` and is listed as unresolved — never assumed failed, never blindly retried |
| Unresolvable state keeps blocking | Unresolved `UNKNOWN` orders remain `UNKNOWN` and the global gate (Decision A) keeps blocking new shared-account exposure |
| Authorization | Every mutation is auth-gated server-side; unauthenticated callers are rejected |
| Idempotency | Re-running reconciliation is a no-op for already-resolved orders (transitions apply to `UNKNOWN` rows only) |
| State-transition validation | Only `UNKNOWN → ACKNOWLEDGED` / `UNKNOWN → REJECTED`; terminal states are never rewritten |
| Audit logging | Every run is recorded (`RECONCILIATION_RUN`) with resolved/unresolved detail and outcome HEALTHY/MISMATCH |

### Exact gap — do not invent a mechanism here

1. **No trusted server-side reconciliation service** exists that is authorized
   to resolve `UNKNOWN` orders **across owners** (the narrow user-scoped path
   above cannot clear another user's order that blocks the shared account).
2. **No authoritative provider ledger**: every provider adapter is
   `SIMULATED` or `NOT_CONFIGURED`; there is no external truth source to query
   beyond the truth recorded at submission time.
3. **No specified evidence contract**: nothing defines what artifact from a
   provider counts as authoritative state, its freshness window, or format.
4. **No approved trigger or service authorization policy** (cron, webhook
   action, or service role) for such a service.

### Smallest proposed design — FOR APPROVAL (not implemented)

1. `internal.reconcile.resolveUnknown` — an **internalMutation** (never
   client-callable; Convex internal functions are unreachable from the client
   API) that may resolve `UNKNOWN` orders **across owners**, but only when an
   evidence artifact accompanies each transition.
2. **Evidence contract (to be ratified)**: `{ orderId, providerOrderId,
   providerTruth, observedAt, source, signature? }` recorded with the
   transition; `observedAt` must post-date the order's submission.
3. **Transition table**: `UNKNOWN` + ACCEPTED-evidence → `ACKNOWLEDGED`;
   `UNKNOWN` + REJECTED-evidence → `REJECTED`; **no evidence → stays
   `UNKNOWN` and keeps blocking** shared-account exposure.
4. **Idempotency**: resolution keyed by `(orderId, evidence.observedAt)`;
   replays are no-ops.
5. **Trigger**: an approved schedule (Convex cron) or a provider webhook
   action — both explicitly require approval; until then nothing may call the
   service.
6. **Audit**: every service resolution recorded with actor
   `service:reconciliation`, the evidence reference, and the exact transition.

Until this design is approved AND an authoritative evidence source exists,
cross-owner `UNKNOWN` orders remain their owner's to reconcile, and the global
fail-closed gate (Decision A) keeps shared-account exposure blocked.

---

## Decision C — Shared SYSTEM fixture accounting (DECIDED — documented rule)

Ownerless (`ownerUserId` undefined/empty) records are **shared SYSTEM**
records: the seeded demo workspace and other fixtures live on the shared
execution account (Decision A). The rule for their accounting inputs:

1. **Shared fixture P&L is shared ACCOUNT economics.** Because every customer
   shares the execution account, ownerless positions and their realized PnL
   enter every risk input that measures the ACCOUNT — equity, drawdown, peak
   equity and the daily PnL fallback — exactly as a customer's own records do.
   This is not silent contamination: it is the documented consequence of the
   shared-account model (Decision A), applied CONSISTENTLY across all
   account-level inputs (`readRiskScopePositions` = own + shared).
2. **Behavioral streaks are owner-scoped and stay owner-scoped.** The
   consecutive-loss streak is a per-customer behavioral instrument: it walks
   only that customer's own realized-outcome rows (`realizedTradeOutcomes`
   `by_owner_seq`). Shared SYSTEM fixture outcomes NEVER extend or reset any
   customer's streak (tested: `DB-D3-001..003`).
3. **No ledger rows are fabricated.** The seeded fixture's baked-in realized
   result (`POS-SEED-BTC` +420.5) predates the realized-outcome ledger and is
   carried in the position row; no outcome event is invented for it, and no
   unaccounted fill is ever pretended to have been applied.
4. Rationale for the asymmetry (explicit, as required): account economics
   answer "what is this account worth" — the account is shared, so the answer
   is shared. Streaks answer "how has THIS customer been trading" — fixture
   results are not anyone's trading behavior, so they must not enter them.
   Per-customer daily ledgers for a shared account remain future work (see
   Decision A's multi-user requirement).

---

## Audit-chain verification semantics (recorded)

- **Source of the window anchor**: the verified window's FIRST record's own
  `prevHash`, read from the same `auditEvents` log being verified. It is
  **self-attested, NOT independently trusted**.
- Enforced consequences (`src/convex/lib/audit.ts`):
  - `FULL_CHAIN` is reported only when the verified range starts at record
    sequence 1 anchored at `GENESIS`;
  - any other range is reported `WINDOW`: internal linkage and record hashes
    verified, history BEFORE the anchor **NOT verified** — and never presented
    as proof of historical integrity (a mid-chain head claiming a `GENESIS`
    link is still `WINDOW`);
  - an empty range is `EMPTY`: nothing was verified.
- The chain is **tamper-EVIDENT (FNV-1a over canonical content), NOT
  tamper-proof**: an attacker who rewrites records can recompute hashes.
  Whole-history proof requires external anchoring (SHA-256 + external log) —
  recorded as SPEC-GAP-005. Window-linkage verification and whole-history
  integrity are distinct claims and are labeled distinctly in the console.
