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
} from "../convex/lib/credentials";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const policy: RiskPolicy = {
  policyId: "P", version: 1, status: "PROVISIONAL",
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

const pc = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [] });
check("TEST-EXEC-007 precheck passes clean", pc.ok);
const pc2 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, providerState: "AVAILABLE", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: ["k1"] });
check("TEST-EXEC-008 idempotency duplicate -> precheck fails", !pc2.ok);
const pc3 = runPrechecks(intent, { systemEnabled: true, killSwitchEngaged: false, providerState: "DEGRADED", marketStatus: "OPEN", dataAgeMs: 1000, maxDataAgeMs: 7200000, now: Date.now(), existingIdempotencyKeys: [] });
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
