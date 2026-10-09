/**
 * SENTINEL PRIME — ENGINE VERIFICATION BATTERY (Section 18)
 *
 * Runs adversarial, failure-first checks over the pure deterministic engines:
 * TEST-RISK-*, TEST-EXEC-*, TEST-DATA-*, TEST-VALID-*, TEST-AUDIT-*.
 * Execute with: bun src/tests/engine-verification.ts
 * Exit code 0 only when every check passes. Checks are never deleted to make
 * the build green (Rule 38/39).
 */
import { evaluateRisk, vetoAllows, RiskContext, RiskPolicy, TradeProposal } from "../convex/lib/risk";
import { normalizeProviderResponse, validateAuthorizationScope, runPrechecks, AuthorizationRecord, OrderIntent } from "../convex/lib/execution";
import { validateCandles } from "../convex/lib/dataQuality";
import { simulate, StrategyDefinition, ValidationConfig } from "../convex/lib/backtest";
import { computeAuditHash, verifyAuditChain, AuditRecord } from "../convex/lib/audit";
import {
  fingerprintSecret,
  maskKey,
  redactedSummary,
  validateCredentialInput,
  PROVIDERS,
} from "../convex/lib/credentials";
import { canUseAuthorization, canViewRecord, requireRole, executionAllowedInMode } from "../convex/lib/authz";
import { applyFill, fillDelta } from "../convex/lib/positions";
import {
  runValidationPipeline,
  verifySnapshotBinding,
  featureCausalityCheck,
  SnapshotBinding,
} from "../convex/lib/pipeline";
import { readFileSync } from "node:fs";
import { THEME_STORAGE_KEY, resolveTheme } from "../lib/theme";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// NOTE (contract change): the shared fixture is an APPROVED policy. Policy
// STATUS is now enforced by the risk engine (TEST-RISK-009/010 cover the
// PROVISIONAL/SUPERSEDED rejection), so the old PROVISIONAL fixture would
// have masked the very checks these tests intend to exercise.
const policy: RiskPolicy = {
  policyId: "P", version: 1, status: "APPROVED",
  limits: {
    maxNotionalPerTrade: 25000, maxOpenPositions: 3, maxDailyLoss: 2000,
    maxDrawdown: 0.15, maxConsecutiveLosses: 4, maxSpreadBps: 15, maxDataAgeMs: 7200000,
  },
};
const baseCtx: RiskContext = {
  mode: "PAPER", killSwitchEngaged: false, strategyEligible: true,
  strategyVersionId: "SV-1", evidenceLevel: "MODERATE", fitnessVerdict: "MIXED",
  marketId: "MKT-1", marketStatus: "OPEN", providerState: "AVAILABLE",
  dataAgeMs: 60000, dataQualityState: "VALID", spreadBps: 2, openPositions: 1,
  realizedPnlToday: 100, equity: 100100, peakEquity: 100100, consecutiveLosses: 0,
  existingOrderIdempotencyKeys: [], proposalIdempotencyKey: "k1",
  unresolvedUnknownOrders: 0,
};
const proposal: TradeProposal = { proposalId: "P1", side: "BUY", quantity: 0.1, referencePrice: 62000, orderType: "MARKET", mode: "PAPER" };

// TEST-RISK happy path
const d1 = evaluateRisk(proposal, baseCtx, policy);
check("TEST-RISK-001 veto approves clean proposal", d1.outcome === "APPROVE" && vetoAllows(d1.outcome));

// TEST-RISK unknown critical state -> no trade
const d2 = evaluateRisk(proposal, { ...baseCtx, dataQualityState: "MISSING" }, policy);
check("TEST-RISK-002 MISSING data -> UNKNOWN -> veto denies", d2.outcome === "UNKNOWN" && !vetoAllows(d2.outcome));

// kill switch blocks
const d3 = evaluateRisk(proposal, { ...baseCtx, killSwitchEngaged: true }, policy);
check("TEST-RISK-003 kill switch -> BLOCK", d3.outcome === "BLOCK" && !vetoAllows(d3.outcome));

// stale data blocks
const d4 = evaluateRisk(proposal, { ...baseCtx, dataAgeMs: 10 * 3600_000 }, policy);
check("TEST-RISK-004 stale data -> BLOCK", d4.outcome === "BLOCK");

// ineligible strategy blocks
const d5 = evaluateRisk(proposal, { ...baseCtx, strategyEligible: false }, policy);
check("TEST-RISK-005 ineligible strategy -> BLOCK", d5.outcome === "BLOCK");

// over-limit notional blocks
const d6 = evaluateRisk({ ...proposal, quantity: 1 }, baseCtx, policy);
check("TEST-RISK-006 notional limit enforced", d6.outcome === "BLOCK");

// duplicate idempotency key blocks
const d7 = evaluateRisk(proposal, { ...baseCtx, existingOrderIdempotencyKeys: ["k1"] }, policy);
check("TEST-RISK-007 duplicate order key -> BLOCK", d7.outcome === "BLOCK");

// undeclared limits -> UNKNOWN -> no trade (fail closed)
const d8 = evaluateRisk(proposal, baseCtx, { ...policy, limits: { ...policy.limits, maxDailyLoss: null } });
check("TEST-RISK-008 unknown limit -> UNKNOWN -> no trade", d8.outcome === "UNKNOWN" && !vetoAllows(d8.outcome));

// TEST-EXEC unknown order semantics
const t1 = normalizeProviderResponse({ kind: "timeout" });
check("TEST-EXEC-001 provider timeout -> UNKNOWN, truth NONE, reconcile-first", t1.state === "UNKNOWN" && t1.providerTruth === "NONE" && t1.note.includes("RECONCILE"));

// authorization scope mismatch
const auth: AuthorizationRecord = {
  authorizationId: "A1", state: "APPROVED",
  scope: { account: "PAPER:paper-account", strategyVersionId: "SV-1", marketId: "MKT-1", side: "BUY", quantity: 0.1, orderType: "MARKET", timeInForce: "GTC", riskPolicyRef: "P@v1", mode: "PAPER", expiresAt: Date.now() + 60000 },
  issuedAt: Date.now(),
};
const intent: OrderIntent = { orderId: "O1", idempotencyKey: "k1", authorizationId: "A1", strategyVersionId: "SV-1", marketId: "MKT-1", symbol: "BTC/USD", side: "BUY", quantity: 0.1, orderType: "MARKET", timeInForce: "GTC", mode: "PAPER" };
check("TEST-EXEC-002 matching scope passes", validateAuthorizationScope(auth, intent, Date.now()).ok);
check("TEST-EXEC-003 wrong side rejected", !validateAuthorizationScope(auth, { ...intent, side: "SELL" }, Date.now()).ok);
check("TEST-EXEC-004 wrong quantity rejected", !validateAuthorizationScope(auth, { ...intent, quantity: 9 }, Date.now()).ok);
check("TEST-EXEC-005 expired authorization rejected", !validateAuthorizationScope({ ...auth, scope: { ...auth.scope, expiresAt: Date.now() - 1 } }, intent, Date.now()).ok);
check("TEST-EXEC-006 consumed authorization rejected", !validateAuthorizationScope({ ...auth, state: "CONSUMED" }, intent, Date.now()).ok);

const pc = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, mode: "PAPER", providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [], unresolvedUnknownOrders: 0 });
check("TEST-EXEC-007 precheck passes clean", pc.ok);
const pc2 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, mode: "PAPER", providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: ["k1"], unresolvedUnknownOrders: 0 });
check("TEST-EXEC-008 idempotency duplicate -> precheck fails", !pc2.ok);
const pc3 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, mode: "PAPER", providerState: "DEGRADED", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [], unresolvedUnknownOrders: 0 });
check("TEST-EXEC-009 degraded provider -> precheck fails (unknown -> blocked)", !pc3.ok);

// TEST-DATA semantics
const mk = (t: number, o: number, h: number, l: number, c: number) => ({ eventTime: t, open: o, high: h, low: l, close: c, volume: 1, availabilityTime: t + 3600000, source: "s", symbol: "BTC/USD", marketId: "M", timeframe: "1h" });
const good = [mk(0, 10, 11, 9, 10.5), mk(3600000, 10.5, 11.5, 10, 11), mk(7200000, 11, 12, 10.5, 11.5)];
const qctx = { marketId: "M", symbol: "BTC/USD", timeframe: "1h", timeframeMs: 3600000, now: 7200000 + 3600000, staleAfterMs: 7200000, providerState: "AVAILABLE" as const };
check("TEST-DATA-001 clean data -> VALID", validateCandles(good, qctx).state === "VALID");
const negative = [mk(0, -10, 11, 9, 10.5), ...good.slice(1)];
check("TEST-DATA-002 negative price -> INVALID (never coerced to zero)", validateCandles(negative, qctx).state === "INVALID");
const nanC = [mk(0, 10, 11, 9, NaN), ...good.slice(1)];
check("TEST-DATA-003 NaN -> INVALID", validateCandles(nanC, qctx).state === "INVALID");
const empty = validateCandles([], qctx);
check("TEST-DATA-004 empty feed -> MISSING (not zero, not success)", empty.state === "MISSING");
const emptyFailed = validateCandles([], { ...qctx, providerState: "UNAVAILABLE" });
check("TEST-DATA-005 provider down + empty -> FAILED (FAILED != EMPTY)", emptyFailed.state === "FAILED");
const gap = [good[0], mk(7200000, 11, 12, 10.5, 11.5)];
check("TEST-DATA-006 gap -> INCOMPLETE, missing candles not fabricated", validateCandles(gap, qctx).state === "INCOMPLETE");
const badOhlc = [mk(0, 10, 9, 11, 10.5), ...good.slice(1)];
check("TEST-DATA-007 OHLC violation -> INVALID", validateCandles(badOhlc, qctx).state === "INVALID");
const dup = [...good, mk(3600000, 10.5, 11.5, 10, 11.2)];
check("TEST-DATA-008 conflicting duplicate -> INVALID, not selected", validateCandles(dup, qctx).state === "INVALID");
const future = [mk(0, 10, 11, 9, 10.5), ...good.slice(1).map((c) => ({ ...c, availabilityTime: 10 * 3600000 }))];
check("TEST-DATA-009 future availability -> INVALID (knowability rule)", validateCandles(future, qctx).state === "INVALID");
const stale = validateCandles(good, { ...qctx, now: 24 * 3600000, staleAfterMs: 7200000 });
check("TEST-DATA-010 stale feed -> STALE", stale.state === "STALE");

// TEST-EXEC intrabar ambiguity -> conservative outcome
const def: StrategyDefinition = {
  marketId: "M", symbol: "BTC/USD", timeframe: "1h",
  entry: { indicator: "ema_cross", fast: 2, slow: 3 },
  exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
  filters: { rsiMin: null, rsiMax: null },
  sizing: { kind: "fixed_fraction", fraction: 1 },
};
const config: ValidationConfig = { oosSplitFraction: 0.5, startingEquity: 100000, periodsPerYear: 24 * 365 };
const mkC = (t: number, o: number, h: number, l: number, c: number) => ({ ...mk(t, o, h, l, c), volume: 100 });
// Rising series to force a crossover entry, then one candle that spans both SL and TP.
const bars = [
  mkC(0, 100, 101, 99, 100),
  mkC(3600000, 99, 100, 98, 99),
  mkC(7200000, 98, 99, 97, 98),
  mkC(10800000, 98, 99, 97.5, 98),
  mkC(14400000, 99, 100, 98.5, 99),
  mkC(18000000, 101, 102, 100, 101),
  // signal fires on bar 5's close -> entry at this bar's open (103)
  mkC(21600000, 103, 105, 102, 104),
  // ambiguous candle: SL (100.94) and TP (105.06) both inside [80, 130]
  mkC(25200000, 104, 130, 80, 105),
  mkC(28800000, 105, 106, 104, 105),
  mkC(32400000, 105, 106, 104, 105),
];
const sim = simulate(bars, def, config, { kind: "percentage", version: "c", feeRate: 0, slippageBps: 0 });
const ambiguous = sim.trades.find((t) => t.ambiguousIntrabar);
check("TEST-EXEC-010 ambiguous candle (SL+TP in range) -> conservative SL outcome", ambiguous !== undefined && ambiguous.exitReason === "STOP_LOSS", JSON.stringify(sim.trades));
check("TEST-VALID-011 metrics are N/A (not zero) with no trades", simulate([], def, config, { kind: "percentage", version: "c", feeRate: 0, slippageBps: 0 }).metrics.netReturn === null);

// reproducibility
const a1 = simulate(bars, def, config, { kind: "percentage", version: "c", feeRate: 0.001, slippageBps: 5 });
const a2 = simulate(bars, def, config, { kind: "percentage", version: "c", feeRate: 0.001, slippageBps: 5 });
check("TEST-VALID-012 reproducible: identical inputs -> identical results", JSON.stringify(a1.metrics) === JSON.stringify(a2.metrics));

// TEST-AUDIT tamper detection
const rec: AuditRecord = { sequence: 1, at: 1, actor: "a", actorType: "USER", action: "X", resourceType: "r", resourceId: "1", outcome: "SUCCESS", correlationId: "c", detail: "d", prevHash: "GENESIS", hash: "" };
rec.hash = computeAuditHash(rec);
check("TEST-AUDIT-013 intact chain verifies", verifyAuditChain([rec]).valid);
const tampered = { ...rec, detail: "forged" };
check("TEST-AUDIT-014 tampered record detected", !verifyAuditChain([tampered]).valid);

// Window verification: the console shows the newest N events of a longer
// chain, so it verifies a WINDOW against an anchor taken from the log ITSELF —
// the anchor is SELF-ATTESTED (NOT independently trusted unless checked
// against a separately protected checkpoint); that limitation is declared,
// and internal linkage and hashes are still fully checked.
const rec2: AuditRecord = { ...rec, sequence: 2, at: 2, detail: "second", prevHash: rec.hash, hash: "" };
rec2.hash = computeAuditHash(rec2);
const rec3: AuditRecord = { ...rec2, sequence: 3, at: 3, detail: "third", prevHash: rec2.hash, hash: "" };
rec3.hash = computeAuditHash(rec3);
check(
  "TEST-AUDIT-015 a mid-chain window verifies against its trusted anchor",
  verifyAuditChain([rec2, rec3], rec2.prevHash).valid,
);
check(
  "TEST-AUDIT-015b a mid-chain window without an anchor must NOT pass (GENESIS linkage would be fabricated)",
  !verifyAuditChain([rec2, rec3]).valid,
);
const windowTampered = { ...rec3, detail: "forged in window" };
check(
  "TEST-AUDIT-016 tampering inside a window is still detected",
  !verifyAuditChain([rec2, windowTampered], rec2.prevHash).valid,
);

// Checkpoint honesty: a window verdict is never presented as whole-history
// proof, and a mid-chain head claiming a GENESIS link cannot smuggle the
// FULL_CHAIN label (the anchor is self-attested, never trusted for scope).
check(
  "TEST-AUDIT-017 a verified window is labeled WINDOW (history before the anchor is NOT verified)",
  verifyAuditChain([rec2, rec3], rec2.prevHash).scope === "WINDOW" &&
    verifyAuditChain([rec2, rec3], rec2.prevHash).note.includes("NOT verified"),
);
check(
  "TEST-AUDIT-017b only a range starting at record 1 anchored at GENESIS is labeled FULL_CHAIN",
  verifyAuditChain([rec, rec2, rec3]).scope === "FULL_CHAIN",
);
const spoofedHead: AuditRecord = { ...rec2, sequence: 2, prevHash: "GENESIS", hash: "" };
spoofedHead.hash = computeAuditHash(spoofedHead);
const spoofedNext: AuditRecord = { ...rec3, sequence: 3, prevHash: spoofedHead.hash, hash: "" };
spoofedNext.hash = computeAuditHash(spoofedNext);
check(
  "TEST-AUDIT-018 a consistent mid-chain head claiming a GENESIS link is still labeled WINDOW",
  verifyAuditChain([spoofedHead, spoofedNext], spoofedHead.prevHash).valid &&
    verifyAuditChain([spoofedHead, spoofedNext], spoofedHead.prevHash).scope === "WINDOW",
);
check(
  "TEST-AUDIT-018b an empty range reports EMPTY — nothing verified, never evidence of integrity",
  verifyAuditChain([]).scope === "EMPTY" && verifyAuditChain([]).note.includes("NOT evidence"),
);

// P1 sequence continuity: within any verified range the sequence numbers must
// be consecutive — missing, duplicated or reordered records FAIL
// verification even when every hash and link is self-consistent.
const gapRec: AuditRecord = { ...rec2, sequence: 4, at: 4, detail: "after a gap", prevHash: rec2.hash, hash: "" };
gapRec.hash = computeAuditHash(gapRec);
const gapVerdict = verifyAuditChain([rec2, gapRec], rec2.prevHash);
check(
  "TEST-AUDIT-019 a missing sequence number inside the range fails",
  !gapVerdict.valid && (gapVerdict.reason ?? "").includes("sequence"),
);
const dupRec: AuditRecord = { ...rec3, sequence: 3, at: 4, detail: "replayed", prevHash: rec3.hash, hash: "" };
dupRec.hash = computeAuditHash(dupRec);
const dupVerdict = verifyAuditChain([rec2, rec3, dupRec], rec2.prevHash);
check(
  "TEST-AUDIT-019b a duplicated sequence number fails (replay)",
  !dupVerdict.valid && (dupVerdict.reason ?? "").includes("sequence"),
);
const reorderVerdict = verifyAuditChain([rec3, rec2], rec3.prevHash);
check(
  "TEST-AUDIT-019c reordered records fail (out-of-order sequences)",
  !reorderVerdict.valid && (reorderVerdict.reason ?? "").includes("sequence"),
);
const brokenLink: AuditRecord = { ...rec3, prevHash: "deadbeefdeadbeef", hash: "" };
brokenLink.hash = computeAuditHash(brokenLink);
const brokenVerdict = verifyAuditChain([rec2, brokenLink], rec2.prevHash);
check(
  "TEST-AUDIT-019d a broken prevHash link fails even with self-consistent hashes",
  !brokenVerdict.valid && brokenVerdict.reason === "prevHash linkage broken",
);
// verifiedCount = records ACTUALLY verified (linkage + hash), never the
// visible/filtered count: 0 on empty, n on intact, pre-break on tampered.
check(
  "TEST-AUDIT-020 verifiedCount reports records actually verified",
  verifyAuditChain([]).verifiedCount === 0 &&
    verifyAuditChain([rec, rec2, rec3]).verifiedCount === 3 &&
    verifyAuditChain([rec2, windowTampered], rec2.prevHash).verifiedCount === 1,
);

// TEST-SEC-CRED-* credential handling contract (Section 16 secret rules)
const rawKey = "sk-live-ABCDEFGH1234567890";
const fp1 = await fingerprintSecret(rawKey);
const fp2 = await fingerprintSecret(rawKey);
check("TEST-SEC-CRED-001 fingerprint is deterministic and never equals the raw key", fp1.fingerprint === fp2.fingerprint && fp1.fingerprint !== rawKey && fp1.fingerprint.length >= 16);
const fpOther = await fingerprintSecret("sk-live-ZZZZZZZZ0000000000");
check("TEST-SEC-CRED-002 distinct keys produce distinct fingerprints", fpOther.fingerprint !== fp1.fingerprint);
const masked = maskKey(rawKey);
check("TEST-SEC-CRED-003 mask reveals only the last 4 characters", masked.endsWith("7890") && !masked.includes("ABCDEFGH") && masked.includes("•"));
const badLive = validateCredentialInput({ provider: "BINANCE", label: "ok label", environment: "CONTROLLED_LIVE", accountRef: "a1", apiKey: rawKey, permissions: ["READ_ACCOUNT"] });
check("TEST-SEC-CRED-004a CONTROLLED_LIVE credential ingestion is refused", !badLive.ok && badLive.errors.some((e) => e.includes("Live credential ingestion is disabled")));
const badKey = validateCredentialInput({ provider: "BINANCE", label: "ok label", environment: "PAPER", accountRef: "a1", apiKey: "short", permissions: ["READ_ACCOUNT"] });
check("TEST-SEC-CRED-004b short key rejected", !badKey.ok);
const badProvider = validateCredentialInput({ provider: "NOT_A_PROVIDER", label: "ok label", environment: "PAPER", accountRef: "a1", apiKey: rawKey, permissions: ["READ_ACCOUNT"] });
check("TEST-SEC-CRED-004c unknown provider rejected", !badProvider.ok);
const badPerms = validateCredentialInput({ provider: "BINANCE", label: "ok label", environment: "PAPER", accountRef: "a1", apiKey: rawKey, permissions: ["DROP_TABLES"] });
check("TEST-SEC-CRED-004d unknown permissions rejected", !badPerms.ok);
const goodInput = validateCredentialInput({ provider: "BINANCE", label: "Main demo", environment: "PAPER", accountRef: "a1", apiKey: rawKey, permissions: ["READ_ACCOUNT", "SUBMIT_ORDERS"] });
check("TEST-SEC-CRED-006 valid PAPER input accepted", goodInput.ok);
const summary = redactedSummary({ connectionId: "CONN-1", provider: "BINANCE", label: "Main demo", keyMasked: masked, keyFingerprint: fp1.fingerprint, status: "PENDING_VERIFICATION" });
check("TEST-SEC-CRED-005 redacted summary contains no raw key material", !summary.includes(rawKey) && !summary.includes("ABCDEFGH") && summary.includes("••••"));

// ---------------------------------------------------------------------------
// AUDIT-REPAIR REGRESSION SUITE (authorization, risk lifecycle, execution,
// reconciliation, leakage, live-mode restrictions)
// ---------------------------------------------------------------------------

// TEST-RISK policy lifecycle + input validity
const d9 = evaluateRisk(proposal, baseCtx, { ...policy, status: "PROVISIONAL" });
check(
  "TEST-RISK-009 PROVISIONAL policy cannot authorize execution",
  d9.outcome === "BLOCK" && !vetoAllows(d9.outcome) && d9.checks.some((c) => c.check === "policy_status" && c.status === "BLOCK"),
);
const d10 = evaluateRisk(proposal, baseCtx, { ...policy, status: "SUPERSEDED" });
check("TEST-RISK-010 SUPERSEDED policy cannot authorize execution", d10.outcome === "BLOCK" && !vetoAllows(d10.outcome));
const d11 = evaluateRisk({ ...proposal, quantity: NaN }, baseCtx, policy);
check(
  "TEST-RISK-011 NaN quantity -> BLOCK (invalid input never approves)",
  d11.outcome === "BLOCK" && !vetoAllows(d11.outcome) && d11.checks.some((c) => c.check === "input_validity" && c.status === "BLOCK"),
);
check(
  "TEST-RISK-011b negative quantity -> BLOCK",
  evaluateRisk({ ...proposal, quantity: -1 }, baseCtx, policy).outcome === "BLOCK",
);
check(
  "TEST-RISK-011c zero reference price -> BLOCK",
  evaluateRisk({ ...proposal, referencePrice: 0 }, baseCtx, policy).outcome === "BLOCK",
);
const d12 = evaluateRisk(proposal, baseCtx, { ...policy, limits: { ...policy.limits, maxDrawdown: NaN } });
check(
  "TEST-RISK-012 malformed policy limit (NaN) -> BLOCK, never APPROVE",
  d12.outcome === "BLOCK" && d12.checks.some((c) => c.check === "policy_validity" && c.status === "BLOCK"),
);
const d13 = evaluateRisk({ ...proposal, mode: "CONTROLLED_LIVE" }, baseCtx, policy);
check(
  "TEST-RISK-013 CONTROLLED_LIVE mode -> BLOCK (live execution not authorized in this build)",
  d13.outcome === "BLOCK" && !vetoAllows(d13.outcome),
);
const d14 = evaluateRisk(proposal, { ...baseCtx, unresolvedUnknownOrders: 2 }, policy);
check(
  "TEST-RISK-014 unresolved UNKNOWN orders -> BLOCK (new exposure blocked)",
  d14.outcome === "BLOCK" && d14.checks.some((c) => c.check === "reconciliation_state" && c.status === "BLOCK"),
);
// P0 fail-closed completeness: bounded-scan saturation at the data layer must
// surface as UNKNOWN (no trade) — never a silent exposure undercount.
const d15 = evaluateRisk(proposal, { ...baseCtx, accountStateComplete: false }, policy);
check(
  "TEST-RISK-015 account state incomplete (scan saturation) -> UNKNOWN, veto denies",
  d15.outcome === "UNKNOWN" &&
    !vetoAllows(d15.outcome) &&
    d15.checks.some((c) => c.check === "account_state_completeness" && c.status === "UNKNOWN"),
);
const d15b = evaluateRisk(proposal, { ...baseCtx, accountStateComplete: true }, policy);
check(
  "TEST-RISK-015b explicit completeness -> PASS, clean proposal still approved",
  d15b.outcome === "APPROVE" &&
    d15b.checks.some((c) => c.check === "account_state_completeness" && c.status === "PASS"),
);

// TEST-EXEC mode gate + reconciliation gate + partial fills
const pc4 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, mode: "CONTROLLED_LIVE", providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [], unresolvedUnknownOrders: 0 });
check(
  "TEST-EXEC-011 CONTROLLED_LIVE mode -> submission precheck fails",
  !pc4.ok && pc4.checks.some((c) => c.check === "mode" && c.status === "BLOCK"),
);
const pc5 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, mode: "PAPER", providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [], unresolvedUnknownOrders: 1 });
check(
  "TEST-EXEC-012 unresolved UNKNOWN order -> precheck fails (exposure blocked)",
  !pc5.ok && pc5.checks.some((c) => c.check === "reconciliation_state" && c.status === "BLOCK"),
);
const t2 = normalizeProviderResponse({ kind: "partial_fill", providerOrderId: "P1", filled: 0.5, remaining: 0.5, price: 100 });
check(
  "TEST-EXEC-013 partial fill -> PARTIALLY_FILLED, truth ACCEPTED, remainder open",
  t2.state === "PARTIALLY_FILLED" && t2.providerTruth === "ACCEPTED" && t2.note.includes("remainder open"),
);

// TEST-AUTHZ authorization boundary (capability tokens, roles, visibility)
check(
  "TEST-AUTHZ-001 execution authorization is owner-bound (missing owner fails closed)",
  canUseAuthorization("u1", "u1") && !canUseAuthorization("u2", "u1") && !canUseAuthorization(undefined, "u1") && !canUseAuthorization(null, "u1"),
);
check(
  "TEST-AUTHZ-002 privileged ops require exact admin role (missing role is never admin)",
  requireRole("admin", "admin") && !requireRole("user", "admin") && !requireRole(undefined, "admin") && !requireRole(null, "admin"),
);
check(
  "TEST-AUTHZ-003 record visibility: own + system records only, never other users'",
  canViewRecord("u1", "u1") && canViewRecord(undefined, "u1") && !canViewRecord("u2", "u1"),
);

// TEST-POS canonical position accounting + duplicate-fill protection
const p1 = applyFill(null, { side: "BUY", quantity: 1, price: 100 });
const p2 = applyFill(p1, { side: "BUY", quantity: 1, price: 110 });
check(
  "TEST-POS-001 adds use the weighted average entry price",
  p2.side === "LONG" && p2.quantity === 2 && Math.abs(p2.avgEntryPrice - 105) < 1e-9,
);
const p3 = applyFill(p2, { side: "SELL", quantity: 0.5, price: 120 });
check(
  "TEST-POS-002 partial close realizes (exit - entry) * qty",
  p3.quantity === 1.5 && Math.abs(p3.realizedPnl - 7.5) < 1e-9,
);
const p4 = applyFill(p3, { side: "SELL", quantity: 1.5, price: 90 });
check(
  "TEST-POS-003 close to FLAT realizes the remainder exactly once",
  p4.side === "FLAT" && p4.quantity === 0 && Math.abs(p4.realizedPnl - -15) < 1e-9,
);
const p5 = applyFill({ side: "LONG", quantity: 1, avgEntryPrice: 100, realizedPnl: 0 }, { side: "SELL", quantity: 1.5, price: 110 });
check(
  "TEST-POS-004 over-close flips through FLAT to the opposite side",
  p5.side === "SHORT" && p5.quantity === 0.5 && Math.abs(p5.realizedPnl - 10) < 1e-9,
);
check(
  "TEST-POS-005 repeated provider fill event yields zero delta (no double accounting)",
  fillDelta(0.5, 0.5) === 0 && fillDelta(0.5, 0.25) === 0.25 && fillDelta(NaN, 0) === 0,
);

// TEST-LEAK look-ahead protection is COMPUTED, not asserted
const barsPerturbed = bars.map((b, i) =>
  i === bars.length - 1 ? { ...b, open: 999, high: 9999, low: 1, close: 4242 } : b,
);
const simPert = simulate(barsPerturbed, def, config, { kind: "percentage", version: "c", feeRate: 0, slippageBps: 0 });
const earlier = (s: { trades: { exitIndex: number }[] }) =>
  s.trades.filter((t) => t.exitIndex < bars.length - 1);
check(
  "TEST-LEAK-001 perturbing FUTURE bars cannot change earlier trade decisions",
  JSON.stringify(earlier(sim)) === JSON.stringify(earlier(simPert)),
);
// Causality needs a series beyond the feature warm-up window; a series too
// short to assess must report UNKNOWN — never an unsupported PASS.
const causalityBars: {
  eventTime: number; open: number; high: number; low: number; close: number; volume: number; availabilityTime: number;
}[] = [];
let px = 100;
for (let i = 0; i < 60; i++) {
  const o = px;
  const c = px * (1 + Math.sin(i / 3) * 0.01 + (i % 7) * 0.001);
  causalityBars.push({
    eventTime: i * 3600000,
    open: o,
    high: Math.max(o, c) * 1.005,
    low: Math.min(o, c) * 0.995,
    close: c,
    volume: 100,
    availabilityTime: i * 3600000 + 3600000,
  });
  px = c;
}
check(
  "TEST-LEAK-002 feature causality (prefix recomputation) verifies on the engine",
  featureCausalityCheck(causalityBars, def).status === "PASS",
  `got ${featureCausalityCheck(causalityBars, def).status}`,
);
check(
  "TEST-LEAK-002b series too short to assess reports UNKNOWN, never an unsupported PASS",
  featureCausalityCheck(bars, def).status === "UNKNOWN",
);
const lateCandles = good.map((c, i) =>
  i === 1 ? { ...c, availabilityTime: c.eventTime + 2 * 3600000 } : c,
);
const testSnapshot: SnapshotBinding = {
  snapshotId: "SNAP-T",
  marketIds: ["M"],
  timeframe: "1h",
  rangeStart: -1,
  rangeEnd: 10 * 3600000,
  dataVersion: "test-v1",
};
const cleanQuality = {
  state: "VALID" as const,
  checks: [],
  counts: { candles: 3, duplicates: 0, gaps: 0, ohlcViolations: 0, invalidValues: 0 },
};
const leakRun = runValidationPipeline({
  validationId: "V-LEAK",
  strategyVersionId: "SV-LEAK",
  dataSnapshotId: "SNAP-T",
  definition: def,
  config,
  cost: { kind: "percentage", version: "c", feeRate: 0, slippageBps: 0 },
  snapshot: testSnapshot,
  candles: lateCandles,
  quality: cleanQuality,
  marketMeta: { marketId: "M", symbol: "BTC/USD", timeframe: "1h", assetClass: "CRYPTO", spreadBps: 2, liquidityNote: "test" },
});
check(
  "TEST-LEAK-003 late-available bar fails the availability rule (leakage detected, not asserted PASS)",
  leakRun.leakageState === "POSSIBLE_LEAKAGE" &&
    leakRun.integrity.some((c) => c.check === "availability_time_rule" && c.status === "FAIL"),
);

// TEST-VALID snapshot binding
const badBinding = verifySnapshotBinding({ ...testSnapshot, rangeStart: 2 * 3600000 }, def, good);
check(
  "TEST-VALID-013 mismatched snapshot is REJECTED (rows outside the declared range)",
  badBinding.some((c) => c.check === "snapshot_range" && c.status === "FAIL"),
);
const blockedRun = runValidationPipeline({
  validationId: "V-BLOCKED",
  strategyVersionId: "SV-BLOCKED",
  dataSnapshotId: "SNAP-T",
  definition: def,
  config,
  cost: { kind: "percentage", version: "c", feeRate: 0, slippageBps: 0 },
  snapshot: { ...testSnapshot, rangeStart: 2 * 3600000 },
  candles: good,
  quality: cleanQuality,
  marketMeta: { marketId: "M", symbol: "BTC/USD", timeframe: "1h", assetClass: "CRYPTO", spreadBps: 2, liquidityNote: "test" },
});
check(
  "TEST-VALID-014 snapshot binding failure BLOCKS the run (no metrics, no evidence)",
  blockedRun.state === "BLOCKED" && blockedRun.metrics === null && blockedRun.evidence === null,
);
const okBinding = verifySnapshotBinding(testSnapshot, def, good);
check(
  "TEST-VALID-015 matching snapshot binding verifies all binding checks",
  okBinding.length > 0 && okBinding.every((c) => c.status === "PASS"),
);
check(
  "TEST-VALID-016 missing snapshot is rejected (binding fails closed)",
  verifySnapshotBinding(null, def, good).some((c) => c.check === "snapshot_exists" && c.status === "FAIL"),
);

// TEST-LIVE live-mode restrictions
check(
  "TEST-LIVE-001 no real provider adapter exists (all SIMULATED or NOT_CONFIGURED)",
  PROVIDERS.every((p) => p.adapter === "SIMULATED" || p.adapter === "NOT_CONFIGURED"),
);
check(
  "TEST-LIVE-002 submission is PAPER/DEMO only; CONTROLLED_LIVE and DISABLED are denied",
  executionAllowedInMode("PAPER") && executionAllowedInMode("DEMO") && !executionAllowedInMode("CONTROLLED_LIVE") && !executionAllowedInMode("DISABLED"),
);

// TEST-WIRE server-side enforcement wiring (the frontend is never the boundary)
const wfSrc = readFileSync(new URL("../convex/workflows.ts", import.meta.url), "utf8");
const authGateCalls = (wfSrc.match(/requireActor\(ctx\)|requireUser\(ctx\)/g) ?? []).length;
const mutationBlocks = (wfSrc.match(/mutation\(\{/g) ?? []).length;
check(
  "TEST-WIRE-001 every workflows mutation authenticates the caller server-side",
  authGateCalls >= mutationBlocks,
  `gates=${authGateCalls} mutations=${mutationBlocks}`,
);
check(
  "TEST-WIRE-002 placeOrder enforces authorization ownership and consumes atomically; no client simulate flag",
  wfSrc.includes("canUseAuthorization(auth.ownerUserId, userId)") &&
    wfSrc.includes('state: "CONSUMED"') &&
    !wfSrc.includes("args.simulate"),
);

// TEST-THEME-* dark theme mode wiring (current UI changes)
check("TEST-THEME-001 dark is the default for missing/unknown stored values", resolveTheme(null) === "dark" && resolveTheme(undefined) === "dark" && resolveTheme("blue") === "dark");
check("TEST-THEME-002 explicit 'light' is honored (dark is default, not forced)", resolveTheme("light") === "light");
check("TEST-THEME-003 shared storage key is used by toggle and bootstrap", THEME_STORAGE_KEY === "sp-theme");
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
check("TEST-THEME-004 index.html applies dark by default before mount (no theme flash)", indexHtml.includes('localStorage.getItem("sp-theme")') && indexHtml.includes('classList.toggle("dark"') && indexHtml.includes('|| "dark"'));
const manifest = readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8");
check("TEST-THEME-005 PWA manifest chrome matches the dark palette", manifest.includes('"background_color": "#171717"') && manifest.includes('"theme_color": "#171717"'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
