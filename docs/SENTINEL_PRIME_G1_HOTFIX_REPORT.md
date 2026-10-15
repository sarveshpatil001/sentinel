# SENTINEL PRIME — G1 SECURITY HOTFIX REPORT (STEP 0)

Date: 2026-10-15. Scope: **G1 cross-customer strategy-disclosure only.** G2 and
all other Phase 1 findings are untouched, as instructed.

---

## 1. Vulnerability (as verified before the fix)

`recordLearningEvent` accepted any client-supplied `orderId` with **no
existence or ownership check** and stored it as `learningEvents.sourceOrderId`.
`proposeCandidateVersion` then:

1. checked only the *learning event's* visibility (`canViewRecord`),
2. resolved `orders` **by `orderId` with no owner filter** (a filtered full
   scan, `.filter(q => q.eq(q.field("orderId"), ...))`),
3. resolved the parent `strategyVersions` row **with no visibility check**,
4. copied the parent's full `definition` (entry/exit/filters/sizing) into a
   new caller-owned version.

Order ids are predictable (`ORD-<idempotencyKey>`), so any two registered
users could exploit this: Customer A referenced Customer B's order id and
obtained a readable copy of B's private strategy parameters, while also
polluting B's version genealogy (child attributed to B's parent).

**Ownership model used by the fix** (derived from the existing architecture,
`lib/authz.ts`): a record is visible to its owner and to shared SYSTEM records
(`canViewRecord`); record ids are REFERENCES, never proof of ownership —
rights are always recomputed server-side from stored `ownerUserId` fields;
not-found ≡ not-owned (no ID oracle).

---

## 2. Fix (files changed)

### `src/convex/schema.ts`
- Added index `orders.by_orderId` — the ownership lookup must be exact and
  complete at any table size; a filtered scan can silently under-check.

### `src/convex/workflows.ts`
- **`recordLearningEvent`**: when `orderId` is provided, the order is resolved
  via `by_orderId` and must satisfy `canViewRecord(order.ownerUserId, caller)`.
  Missing/foreign/unresolvable → **rejected before anything is stored**,
  response `{ ok:false, learningEventId:null, reason:"Order not found." }`
  (identical for missing and foreign — no ID oracle), audited as
  `LEARNING_EVENT_DENIED`. Success return is now
  `{ ok:true, learningEventId }` (additive; the id value semantics are
  unchanged for callers).
- **`proposeCandidateVersion`**: the source order **and** the parent strategy
  version must both satisfy `canViewRecord` before any definition field is
  read. Missing, foreign-owned, or inconsistent associations (including an own
  order pointing at a foreign `strategyVersionId`, and legacy learning rows
  that already reference a foreign order) fail with the pre-existing generic
  refusal ("No parent strategy version identifiable — candidate creation
  refused (no guessing)."), audited as `CANDIDATE_CREATION_DENIED`.
  Order resolution switched from a filtered scan to the `by_orderId` index.
- **Collision-proof destination-record identity** (adjacent defect the
  regression tests exposed): `learningEventId` was `LEARN-<millisecond>`, so
  two events created in the same ms — even by different users — collided and
  the `by_learningEventId` lookup resolved to the *wrong user's* record
  (cross-user resolution + lost genealogy links). The id now binds the
  server-derived owner and probes for clashes
  (`LEARN-<ms>-<sha256 prefix>`, the `analysis.ts` executeAnalysis precedent).
  Legacy `LEARN-<ms>` rows remain resolvable (exact-match lookup).

Authentication, risk controls, the audit chain, execution safeguards and
PAPER/DEMO-only enforcement are untouched. No live-trading path exists or was
added.

### `src/tests/db-verification.ts`
- Existing `DB-RESET-CANDIDATE` fixture hardened (it now asserts its own-order
  learning event actually succeeds before exercising the candidate lifecycle;
  required by the discriminated return type — behavior covered is unchanged).
- New `DB-G1-001..010` regression battery (real handlers, real identities).

---

## 3. Regression tests added (DB-G1-*)

| Check | Proves |
|---|---|
| DB-G1-001 | **Legitimate same-customer flow preserved**: own order → own learning event → candidate from a visible parent; candidate owned by the caller |
| DB-G1-002 | **Customer A cannot use Customer B's order id**: rejected at `recordLearningEvent` before storage; response carries no private parameters |
| DB-G1-003 | Missing ≡ foreign (byte-identical responses, no ID oracle); nothing stored for either |
| DB-G1-004 | Defense in depth: a legacy/pre-fix learning row pivoting to a foreign order is refused at the derivation boundary; no candidate, no parameter copied |
| DB-G1-005 | **Customer A cannot reference Customer B's strategy version** — own order pointing at a foreign `strategyVersionId` cannot copy its parameters |
| DB-G1-006 | Foreign and missing learning events rejected with indistinguishable responses; destination-record ids are collision-proof across same-ms creators |
| DB-G1-007 | The owner (B) can still derive from their **own private** parent — the fix narrows cross-customer access only |
| DB-G1-008 | Authentication not weakened: signed-out callers get `UNAUTHENTICATED` on both mutations |
| DB-G1-009 | Audit not weakened: both denial paths recorded; denial records leak no private parameters |
| DB-G1-010 | No audit record anywhere contains private strategy definition parameter values |

Marker discipline: B's fixture definition uses distinctive markers
(`MKT-B-PRIV`, `PRIV/X`, `STRAT-B-PRIV`, fast `131`/slow `277`) and every
denial path asserts their absence from the response.

**One check was adjusted during the run (explained per policy):** the first
DB-G1-009 asserted no `"131"`/`"PRIV"` substring anywhere in the whole audit
table. That scope was wrong, not the product: timestamp digits can coincidentally
contain `131`, and B's *own* successful derivation legitimately names B's own
record ids (`SV-B-PRIV`) in its audit entry. The check was re-scoped to the
**denial records' text fields** (the actual requirement — denials must not leak)
and DB-G1-010 was added to scan **all** audit records for B's private definition
parameter values. No assertion on product behavior was weakened.

---

## 4. Verification — commands executed, actual exit codes

| Command | Exit | Result |
|---|---|---|
| `bunx convex dev --once` (codegen + push) | **0** | functions ready |
| `bunx tsc -b --noEmit` | **0** | clean |
| `bun src/tests/db-verification.ts` (focused) | **0** | **152 passed, 0 failed** (142 pre-existing + 10 new) |
| `bun run test` (complete suite) | **0** | engine 116/0 · db 152/0 · marketdata 50/0 · databricks 16/0 · ui 14/0 = **348 checks, 0 failures** |
| `bun run lint` | **0** | 0 errors, 17 warnings — exact pre-existing baseline (SP-P2-002), none added |
| `bun run build` (production) | **0** | built in 8.10s |

During the work one focused run failed (DB-G1-006/007) and that failure was the
evidence for the `learningEventId` collision defect — fixed at the cause
(record identity), after which every suite passed. Nothing was skipped and no
test was deleted or weakened.

---

## 5. Files changed

1. `src/convex/schema.ts` — `orders.by_orderId` index.
2. `src/convex/workflows.ts` — ownership checks, denial audits, collision-proof
   `learningEventId`, `sha256Hex` import, discriminated `recordLearningEvent`
   return.
3. `src/tests/db-verification.ts` — fixture guard + `DB-G1-001..010`.
4. `docs/SENTINEL_PRIME_G1_HOTFIX_REPORT.md` — this report.
5. `docs/SENTINEL_PRIME_PHASE1_IMPLEMENTATION_PLAN.md` — Step 0 status update.

No other files touched; no behavior changed outside the learning-event →
candidate-derivation path.

---

## 6. Remaining uncertainty / notes

- `recordLearningEvent`'s return shape changed from `{ learningEventId }` to a
  discriminated union (`{ ok:true, learningEventId }` |
  `{ ok:false, learningEventId:null, reason }`). Verified by ripgrep that the
  only caller is the test battery (no UI caller); `StrategiesPanel.tsx` calls
  only `proposeCandidateVersion`, whose shape is unchanged.
- Legacy `LEARN-<ms>` learning rows keep their ids and stay resolvable; the
  ownership checks apply to them the moment they are used (DB-G1-004 covers the
  pre-existing foreign-reference case).
- Re-derivation of multiple candidates from one learning event (which
  overwrites `candidateStrategyVersionId`) remains allowed — pre-existing
  behavior, not a confidentiality issue, left unchanged in this hotfix.
- `failureClass` remains a free string at the API boundary (stored via cast;
  `schemaValidation: false`) — pre-existing, tracked as plan gap G10, out of
  scope here.
- Per the phase boundary: **G2 (shared-ledger accounting) and all other
  findings remain open and untouched**, as instructed.
