# SENTINEL PRIME — REPAIR LOG

Date: 2026-10-14. Companion documents:
`docs/SENTINEL_PRIME_DEEP_AUDIT.md`, `docs/SENTINEL_PRIME_VERIFICATION_MATRIX.md`.

All changes were made on branch `main` (Git CLI is blocked on this host; file
state verified directly). No authentication config, secrets, deployment
settings, or risk-policy numerics were changed. No existing test was deleted,
weakened, or reordered; no test file's existing assertions were modified —
all test changes are pure additions.

---

## R-1 — SP-P0-001: policy-reference producer/consumer contract defect

**Defect.** `src/convex/lib/risk.ts` (`evaluateRisk` decision payload)
produced a human-readable policy reference `"<policyId>@v<version> (<status>)"`
(spaces + parentheses). `src/convex/workflows.ts` (`submitTradeProposal`)
persisted it into `executionAuthorizations.scope.riskPolicyRef`. The consumer
`src/convex/lib/execution.ts` (`validateAuthorizationScope`) validates that
field as a strict identifier token, which rejects spaces/parens. Result: any
authorization created through the real workflow failed scope validation closed
at `placeOrder` — the approved-proposal-to-order path could never complete.
Test fixtures had always used canonical refs (`"P@v1"`), masking the defect.

**Changed files.**
1. `src/convex/lib/risk.ts` — separated canonical identity from display label:
   the decision now carries `riskPolicyRef` = `"<policyId>@v<N>"` (canonical,
   version-pinned) and `riskPolicyLabel` = `"<policyId>@v<N> (<STATUS>)"`
   (display only). Malformed policy identity fails closed (no fabricated ref).
2. `src/convex/workflows.ts` — `submitTradeProposal` now writes the canonical
   identity into `scope.riskPolicyRef`; the human-readable label remains in
   audit/detail text. Expired/REVOKED/CONSUMED/ownership/single-use behavior
   untouched. `execution.ts`'s strict validator was NOT weakened.

**Tests added (all previously nonexistent).**
- `src/tests/engine-verification.ts` — `TEST-POLREF-001..006`:
  produced ref is canonical `policyId@vN`; display label separate and carries
  status; an authorization carrying the PRODUCED ref passes
  `validateAuthorizationScope` (producer→consumer contract); the legacy
  display label in the identifier field is still rejected (validator
  unchanged); blocked-path decisions return identity + label; malformed policy
  identity never fabricates a reference.
- `src/tests/db-verification.ts` — `DB-POLREF-001..010` (real-handler
  integration in an isolated in-memory DB): mismatched policy version cannot
  be ratified; admin ratification succeeds without changing limits; eligible
  proposal is APPROVED and yields an authorization whose scope binds
  `RISK-POLICY-CORE@v1`; `placeOrder` reaches a PAPER order through the real
  producer/consumer path (state FILLED under simulated FILL behavior,
  AUTHORIZED in lifecycle history); authorization atomically CONSUMED and
  bound to the surviving order; reuse rejected (single use); foreign owner
  rejected (not-found ≡ not-owned); a tampered display-label reference fails
  closed at `input_validity` and consumes nothing.

**Before / after.**
- Before: real-path authorization → `placeOrder` scope check BLOCK (identifier
  validator rejects the label) — end-to-end workflow broken.
- After: `DB-POLREF-005` proves approved proposal → PAPER order end to end;
  failure modes verified closed (`DB-POLREF-001/007/008/010`).

**Rollback consideration.** Reverting `risk.ts`/`workflows.ts` re-breaks the
workflow; there is no persisted-data migration (authorizations store a plain
string; old rows with label-shaped refs would fail scope validation closed —
safe, and none exist in production use).

---

## R-2 — SP-P1-001: audit-chain digest upgrade (FNV-1a → versioned SHA-256)

**Defect.** `src/convex/lib/audit.ts` chained records with a 64-bit FNV-1a
digest over an ambiguous `|`-joined serialization: non-cryptographic (64-bit
collisions practical) and field-split ambiguous (two different records can
serialize identically).

**Changed files.**
1. `src/convex/lib/audit.ts` — rewritten chain core:
   - `sha256Hex` (pure, synchronous, FIPS 180-4; verified against published
     vectors in `TEST-AUDIT-201`), used for version `SHA256-V1` producing
     `sha256:<64 lowercase hex>`.
   - Unambiguous canonical serialization: every field length-prefixed
     (`<len>:<value>`), format tag included in the hashed content.
   - `computeAuditHash` dispatches on `record.hashVersion`: `SHA256-V1` →
     SHA-256; absent/`FNV1A-64` → legacy FNV-1a (verification-only, kept so
     pre-upgrade records still verify); any unknown version throws / fails
     verification closed — never a weaker fallback.
   - `verifyAuditChain` unchanged in signature and semantics (FULL_CHAIN /
     WINDOW / EMPTY scopes, "NOT verified"/"NOT evidence" wording preserved),
     plus: malformed-record rejection (non-integer sequence), per-record hash
     format dispatch, and checkpoint validation — a `CHAIN_CHECKPOINT` record's
     declared head must equal the actual hash of the referenced record when in
     range; `checkpointsVerified` reports only in-range, actually-checked
     declarations.
   - Limitations documented in-file: tamper-EVIDENT not tamper-PROOF; tail
     truncation undetectable without externally stored heads; a privileged DB
     operator can rewrite records and recompute.
2. `src/convex/lib/store.ts` — `appendAudit` writes `hashVersion:
   CURRENT_HASH_VERSION` on every new record; added `appendCheckpoint` helper
   emitting `CHAIN_CHECKPOINT` with `CHECKPOINT head=<hash> seq=<n>` detail.
3. `src/convex/schema.ts` — `auditEvents.hashVersion: v.optional(v.string())`
   (additive; legacy rows simply lack the field).
4. `src/convex/console.ts` — record→`AuditRecord` mapping now carries
   `hashVersion` (both `overview` and `audit` queries), so verification
   dispatches the correct format.

**Tests added.** `src/tests/engine-verification.ts` — `TEST-AUDIT-201..210d`:
FIPS vectors; new-vs-legacy format shapes; field-split ambiguity eliminated
(legacy collides, v1 does not); legacy records still verify and mixed
legacy→v1 chains are intact; modification, mid-chain deletion, reordering,
duplicated-sequence replay all detected; unknown hash format fails closed;
tail-truncation limitation asserted as documented (not a pass claim);
checkpoints verify/count/fail on forged heads and are not counted out of range.

**Before / after.** Before: 64-bit FNV chain, ambiguous canonicalization.
After: SHA-256 chain (engine suite 97 → 116 passing; legacy compatibility
proven). Open: external anchoring of heads (SPEC-GAP-005) — chain remains
tamper-evident only, stated in every verification result.

**Rollback consideration.** Old code cannot verify `SHA256-V1` records;
rollback requires keeping the new verifier or migrating rows. The schema field
is optional, so a code rollback alone leaves a healthy (if weaker) system.

---

## R-3 — SP-P1-002: frontend placeholder honesty labels (partial fix)

**Defect.** Six product screens rendered hardcoded prototype data with
misleading labels: "Verified catalyst" on a fabricated news card, "Running
multi-agent synthesis…" on a 700 ms navigate-only timer, unlabeled hardcoded
quote/mid-price ("INSTITUTIONAL MID-PRICE"), unlabeled demo history records.

**Changed files (copy only; no layout, logic, or design change).**
1. `src/components/sentinel/screens/DashboardScreen.tsx` — quote footer →
   "Sample quote • Simulated tick feed (not a live price)"; news footer →
   "Sample workspace data • Not a live news feed" (was "Verified catalyst");
   timer status → "Opening the analysis workspace…" (was "Running multi-agent
   synthesis…").
2. `src/components/sentinel/screens/TradingScreen.tsx` — mid-price label →
   "INSTITUTIONAL MID-PRICE (SIMULATED DEMO DATA)" (design marker preserved,
   simulated qualifier added); stats line prefixed "Sample workspace data".
3. `src/components/sentinel/screens/SignalsScreen.tsx` — footer → "Seeded demo
   workspace synthesis • Informational analysis only • Automated execution
   disabled".
4. `src/components/sentinel/screens/HistoryScreen.tsx` — subtitle appends
   "(demo workspace records)".

**Tests.** No new tests; the existing UI suite (`ui-reset.test.mjs`, 14 tests,
178 expect calls) was run unchanged and passes 14/0 — the honesty labels are
supersets of the design markers the suite pins. (One intermediate label
revision dropped a pinned marker and failed 1 test; it was corrected to keep
all pinned markers — the test file itself was never edited.)

**Remaining risk.** Screens still show prototype data (classified in the audit
report §7); wiring them to real backend data is product work, out of this
repair's scope.

---

## Full changed-file inventory

| File | Repair | Nature |
| --- | --- | --- |
| `src/convex/lib/risk.ts` | R-1 | canonical policy identity + label |
| `src/convex/workflows.ts` | R-1 | bind canonical ref into authorization scope |
| `src/convex/lib/audit.ts` | R-2 | versioned SHA-256 chain, checkpoints, legacy verify |
| `src/convex/lib/store.ts` | R-2 | hashVersion on append + `appendCheckpoint` |
| `src/convex/schema.ts` | R-2 | optional `auditEvents.hashVersion` |
| `src/convex/console.ts` | R-2 | mapping carries `hashVersion` |
| `src/tests/engine-verification.ts` | R-1, R-2 | +19 tests (TEST-POLREF-*, TEST-AUDIT-2xx) |
| `src/tests/db-verification.ts` | R-1 | +10 tests (DB-POLREF-*), comment update |
| `src/components/sentinel/screens/DashboardScreen.tsx` | R-3 | honesty labels |
| `src/components/sentinel/screens/TradingScreen.tsx` | R-3 | honesty labels |
| `src/components/sentinel/screens/SignalsScreen.tsx` | R-3 | honesty labels |
| `src/components/sentinel/screens/HistoryScreen.tsx` | R-3 | honesty labels |

## Aggregate before / after (executed, recorded)

| Suite | Before | After |
| --- | --- | --- |
| engine-verification | 97 passed / 0 failed | **116 passed / 0 failed** |
| db-verification | 103 passed / 0 failed | **113 passed / 0 failed** |
| databricks-verification | 16 passed / 0 failed | 16 passed / 0 failed |
| ui-reset | 14 pass / 0 fail | 14 pass / 0 fail |
| `bun tsc -b --noEmit` | exit 0 | exit 0 |
| `bun run lint` | exit 0 (0 err / 17 warn) | exit 0 (0 err / 17 warn) |
| `bun run build` | exit 0 | exit 0 |
| `bun convex dev --once` | exit 0 | exit 0 |

## Remaining risks

- Tamper-evident-only audit chain until external anchoring exists
  (SPEC-GAP-005); tail truncation undetectable in the interim.
- Prototype UI data (R-3 partial): users of the six screens still see
  simulated quotes/verdicts — now labeled, but not live.
- Role provisioning out-of-band (SPEC-GAP-008); no last-admin lockout guard.
- Cross-owner UNKNOWN reconciliation unspecified (Decision B) — shared-account
  exposure stays blocked while any UNKNOWN order is unresolved.
- Credential custody requires production KMS/vault (SPEC-GAP-007).
