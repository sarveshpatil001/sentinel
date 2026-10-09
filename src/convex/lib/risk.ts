/**
 * SENTINEL PRIME — DETERMINISTIC RISK ENGINE + RISK VETO (Section 10)
 *
 * The Risk Agent may RECOMMEND. This module DECIDES.
 * The deterministic risk veto is the final authority and fails closed:
 *   - any UNKNOWN critical state  -> outcome UNKNOWN -> NOT AUTHORIZED (no trade)
 *   - any BLOCK                   -> outcome BLOCK
 * Unknown must never become approved (Section 02).
 *
 * Numerical limits are NOT invented here: they are carried by a versioned risk
 * policy record. This engine only evaluates a proposal against that policy.
 */

export type RiskCheckStatus = "PASS" | "BLOCK" | "UNKNOWN";

export interface RiskCheck {
  check: string;
  status: RiskCheckStatus;
  detail: string;
}

export interface RiskPolicyLimits {
  maxNotionalPerTrade: number | null;
  maxOpenPositions: number | null;
  maxDailyLoss: number | null;
  maxDrawdown: number | null;
  maxConsecutiveLosses: number | null;
  maxSpreadBps: number | null;
  maxDataAgeMs: number | null;
}

export interface RiskPolicy {
  policyId: string;
  version: number;
  limits: RiskPolicyLimits;
  status: "PROVISIONAL" | "APPROVED" | "SUPERSEDED";
}

export interface RiskContext {
  mode: string;
  killSwitchEngaged: boolean;
  strategyEligible: boolean;
  strategyVersionId: string;
  evidenceLevel: string;
  fitnessVerdict: string;
  marketId: string;
  marketStatus: string;
  providerState: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  dataAgeMs: number | null;
  dataQualityState: string;
  spreadBps: number | null;
  openPositions: number;
  realizedPnlToday: number;
  equity: number;
  peakEquity: number;
  consecutiveLosses: number;
  existingOrderIdempotencyKeys: string[];
  proposalIdempotencyKey: string;
  /** Orders in UNKNOWN state awaiting reconciliation. > 0 blocks new exposure. */
  unresolvedUnknownOrders: number;
  /**
   * False when the account state could NOT be read completely (bounded-scan
   * saturation at the data layer). Incompleteness must never silently
   * undercount exposure: false forces an UNKNOWN verdict (no trade).
   * Omitted = complete (pure-function callers/tests that provide full inputs).
   */
  accountStateComplete?: boolean;
}

export interface TradeProposal {
  proposalId: string;
  side: "BUY" | "SELL";
  quantity: number;
  referencePrice: number;
  orderType: string;
  mode: string;
}

export interface RiskDecisionResult {
  outcome: "APPROVE" | "BLOCK" | "UNKNOWN";
  checks: RiskCheck[];
  policyRef: string;
}

const UNKNOWN_BLOCKS = true; // fail-closed invariant

const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

/**
 * Required-input validation. Invalid or non-finite values must NEVER produce
 * an approval (Section 10): a malformed proposal or policy is a deterministic
 * BLOCK, and numeric limit evaluation is skipped rather than fed NaN.
 */
function validateInputs(
  proposal: TradeProposal,
  ctx: RiskContext,
  policy: RiskPolicy,
): { problems: string[]; malformedPolicy: boolean } {
  const problems: string[] = [];
  if (!finite(proposal.quantity) || proposal.quantity <= 0)
    problems.push("proposal.quantity must be a finite number > 0");
  if (!finite(proposal.referencePrice) || proposal.referencePrice <= 0)
    problems.push("proposal.referencePrice must be a finite number > 0");
  if (!finite(ctx.equity) || ctx.equity < 0) problems.push("ctx.equity invalid");
  if (!finite(ctx.peakEquity) || ctx.peakEquity <= 0)
    problems.push("ctx.peakEquity invalid");
  if (!finite(ctx.realizedPnlToday)) problems.push("ctx.realizedPnlToday invalid");
  if (!finite(ctx.openPositions) || ctx.openPositions < 0)
    problems.push("ctx.openPositions invalid");
  if (!finite(ctx.consecutiveLosses) || ctx.consecutiveLosses < 0)
    problems.push("ctx.consecutiveLosses invalid");
  if (!finite(ctx.unresolvedUnknownOrders) || ctx.unresolvedUnknownOrders < 0)
    problems.push("ctx.unresolvedUnknownOrders invalid");

  let malformedPolicy = false;
  const limits: (keyof RiskPolicyLimits)[] = [
    "maxNotionalPerTrade",
    "maxOpenPositions",
    "maxDailyLoss",
    "maxDrawdown",
    "maxConsecutiveLosses",
    "maxSpreadBps",
    "maxDataAgeMs",
  ];
  for (const key of limits) {
    const v = policy.limits[key];
    if (v !== null && !finite(v)) {
      malformedPolicy = true;
      problems.push(`policy.limits.${key} is neither null nor a finite number`);
    }
  }
  return { problems, malformedPolicy };
}

export function evaluateRisk(
  proposal: TradeProposal,
  ctx: RiskContext,
  policy: RiskPolicy,
): RiskDecisionResult {
  const checks: RiskCheck[] = [];
  const push = (check: string, status: RiskCheckStatus, detail: string) =>
    checks.push({ check, status, detail });

  // --- Required inputs + policy shape (fail closed on garbage) -----------
  const { problems, malformedPolicy } = validateInputs(proposal, ctx, policy);
  if (problems.length > 0) {
    push(
      malformedPolicy ? "policy_validity" : "input_validity",
      "BLOCK",
      `Invalid risk inputs — evaluation refused (fail closed): ${problems.join("; ")}.`,
    );
    return { outcome: "BLOCK", checks, policyRef: `${policy.policyId}@v${policy.version} (${policy.status})` };
  }
  push("input_validity", "PASS", "All required risk inputs are finite and valid.");

  // --- Policy eligibility (approved lifecycle only) ----------------------
  // Unapproved or provisional policies must NOT authorize execution (Section 10).
  if (policy.status !== "APPROVED") {
    push(
      "policy_status",
      "BLOCK",
      `Risk policy ${policy.policyId}@v${policy.version} is ${policy.status} — only an APPROVED policy version may authorize execution.`,
    );
    return { outcome: "BLOCK", checks, policyRef: `${policy.policyId}@v${policy.version} (${policy.status})` };
  }
  push("policy_status", "PASS", `Risk policy ${policy.policyId}@v${policy.version} is APPROVED.`);

  // --- System gates -------------------------------------------------------
  if (ctx.killSwitchEngaged) {
    push("kill_switch", "BLOCK", "Kill switch is ENGAGED — no new execution permitted.");
  } else {
    push("kill_switch", "PASS", "Kill switch released.");
  }

  if (proposal.mode === "DISABLED") {
    push("mode", "BLOCK", "System mode DISABLED — no new execution.");
  } else if (proposal.mode === "RESEARCH" || proposal.mode === "BACKTEST" || proposal.mode === "OUT_OF_SAMPLE") {
    push("mode", "BLOCK", `Mode ${proposal.mode} has no external execution path.`);
  } else if (proposal.mode === "CONTROLLED_LIVE") {
    // Live activation is a separate, explicitly authorized operation. It is
    // NOT reachable in this build — never a side effect of any other action.
    push("mode", "BLOCK", "CONTROLLED_LIVE execution is NOT authorized in this build (live activation prohibited — requires a separate, approved live-readiness process). ");
  } else {
    push("mode", "PASS", `Mode ${proposal.mode} permits simulated/authorized execution.`);
  }

  // --- Reconciliation state ----------------------------------------------
  // Unresolved UNKNOWN order state makes risk evaluation unreliable; new
  // exposure is blocked until reconciliation resolves it.
  if (ctx.unresolvedUnknownOrders > 0) {
    push(
      "reconciliation_state",
      "BLOCK",
      `${ctx.unresolvedUnknownOrders} order(s) in UNKNOWN state await reconciliation — new exposure is blocked until external state is known.`,
    );
  } else {
    push("reconciliation_state", "PASS", "No unresolved UNKNOWN order state.");
  }

  // --- Account-state completeness ---------------------------------------
  // Fail-closed: if the data layer could not establish that risk inputs are
  // complete (bounded scan saturated), exposure may be undercounted. Unknown
  // must never become approved.
  if (ctx.accountStateComplete === false) {
    push(
      "account_state_completeness",
      "UNKNOWN",
      "Account state could not be read completely (scan saturation) — exposure may be undercounted; no new exposure until completeness is re-established.",
    );
  } else {
    push("account_state_completeness", "PASS", "Account risk inputs read completely.");
  }

  // --- Strategy eligibility ----------------------------------------------
  if (ctx.strategyEligible) {
    push("strategy_eligibility", "PASS", `Strategy version ${ctx.strategyVersionId} is validation-eligible.`);
  } else {
    push("strategy_eligibility", "BLOCK", `Strategy version ${ctx.strategyVersionId} is NOT eligible (validation/evidence gate unmet).`);
  }

  // --- Data quality / freshness (critical -> UNKNOWN, not zero) -----------
  if (ctx.dataQualityState === "FAILED" || ctx.dataQualityState === "INVALID") {
    push("data_quality", "BLOCK", `Critical market data quality is ${ctx.dataQualityState} — trade blocked.`);
  } else if (ctx.dataQualityState === "MISSING") {
    push("data_quality", "UNKNOWN", "Critical market data is MISSING — unknown risk state, no trade.");
  } else if (ctx.dataQualityState === "STALE" || ctx.dataQualityState === "INCOMPLETE") {
    push("data_quality", "UNKNOWN", `Market data is ${ctx.dataQualityState} — risk state not fully knowable, no trade.`);
  } else {
    push("data_quality", "PASS", "Market data quality VALID.");
  }

  if (ctx.dataAgeMs === null) {
    push("data_freshness", "UNKNOWN", "Data age unknown — freshness cannot be verified.");
  } else if (policy.limits.maxDataAgeMs !== null && ctx.dataAgeMs > policy.limits.maxDataAgeMs) {
    push("data_freshness", "BLOCK", `Data age ${Math.round(ctx.dataAgeMs / 60000)}min exceeds policy limit.`);
  } else {
    push("data_freshness", "PASS", `Data age ${Math.round(ctx.dataAgeMs / 60000)}min within policy limit.`);
  }

  // --- Provider / market status -----------------------------------------
  if (ctx.providerState === "UNAVAILABLE") {
    push("provider_status", "UNKNOWN", "Provider UNAVAILABLE — external state not knowable; unsafe actions blocked.");
  } else if (ctx.providerState === "DEGRADED") {
    push("provider_status", "UNKNOWN", "Provider DEGRADED — execution safety not confirmed; no trade.");
  } else {
    push("provider_status", "PASS", "Provider AVAILABLE.");
  }

  if (ctx.marketStatus !== "OPEN") {
    push("market_status", "BLOCK", `Market status is ${ctx.marketStatus}.`);
  } else {
    push("market_status", "PASS", "Market OPEN.");
  }

  // --- Spread / liquidity -------------------------------------------------
  if (ctx.spreadBps === null) {
    push("spread", "UNKNOWN", "Spread unknown — liquidity risk not assessable.");
  } else if (policy.limits.maxSpreadBps !== null && ctx.spreadBps > policy.limits.maxSpreadBps) {
    push("spread", "BLOCK", `Spread ${ctx.spreadBps}bps exceeds policy limit ${policy.limits.maxSpreadBps}bps.`);
  } else {
    push("spread", "PASS", `Spread ${ctx.spreadBps}bps within policy limit.`);
  }

  // --- Portfolio / account limits ----------------------------------------
  const notional = proposal.quantity * proposal.referencePrice;
  if (policy.limits.maxNotionalPerTrade === null) {
    push("notional_limit", "UNKNOWN", "No notional limit declared in policy — risk state not evaluable.");
  } else if (notional > policy.limits.maxNotionalPerTrade) {
    push("notional_limit", "BLOCK", `Notional ${notional.toFixed(2)} exceeds limit ${policy.limits.maxNotionalPerTrade}.`);
  } else {
    push("notional_limit", "PASS", `Notional ${notional.toFixed(2)} within limit.`);
  }

  if (policy.limits.maxOpenPositions === null) {
    push("position_limit", "UNKNOWN", "No open-position limit declared in policy.");
  } else if (ctx.openPositions >= policy.limits.maxOpenPositions) {
    push("position_limit", "BLOCK", `Open positions ${ctx.openPositions} at limit ${policy.limits.maxOpenPositions}.`);
  } else {
    push("position_limit", "PASS", `Open positions ${ctx.openPositions} within limit.`);
  }

  const dailyLoss = -ctx.realizedPnlToday;
  if (policy.limits.maxDailyLoss === null) {
    push("daily_loss", "UNKNOWN", "No daily-loss limit declared in policy.");
  } else if (dailyLoss >= policy.limits.maxDailyLoss) {
    push("daily_loss", "BLOCK", `Daily loss ${dailyLoss.toFixed(2)} at or beyond limit ${policy.limits.maxDailyLoss}.`);
  } else {
    push("daily_loss", "PASS", `Daily loss ${dailyLoss.toFixed(2)} within limit.`);
  }

  const drawdown =
    ctx.peakEquity > 0 ? (ctx.peakEquity - ctx.equity) / ctx.peakEquity : null;
  if (drawdown === null) {
    push("drawdown", "UNKNOWN", "Drawdown not computable (equity state unknown).");
  } else if (policy.limits.maxDrawdown !== null && drawdown >= policy.limits.maxDrawdown) {
    push("drawdown", "BLOCK", `Drawdown ${(drawdown * 100).toFixed(1)}% at or beyond limit ${(policy.limits.maxDrawdown * 100).toFixed(1)}%.`);
  } else {
    push("drawdown", "PASS", `Drawdown ${(drawdown * 100).toFixed(1)}% within limit.`);
  }

  if (
    policy.limits.maxConsecutiveLosses !== null &&
    ctx.consecutiveLosses >= policy.limits.maxConsecutiveLosses
  ) {
    push("consecutive_losses", "BLOCK", `${ctx.consecutiveLosses} consecutive losses at limit.`);
  } else if (policy.limits.maxConsecutiveLosses === null) {
    push("consecutive_losses", "UNKNOWN", "No consecutive-loss limit declared in policy.");
  } else {
    push("consecutive_losses", "PASS", `${ctx.consecutiveLosses} consecutive losses within limit.`);
  }

  // --- Duplicate order protection ---------------------------------------
  if (ctx.existingOrderIdempotencyKeys.includes(ctx.proposalIdempotencyKey)) {
    push("duplicate_order", "BLOCK", "Idempotency key already used — duplicate order rejected.");
  } else {
    push("duplicate_order", "PASS", "Idempotency key unused.");
  }

  // --- Veto (final authority, fail-closed) --------------------------------
  const hasBlock = checks.some((c) => c.status === "BLOCK");
  const hasUnknown = checks.some((c) => c.status === "UNKNOWN");
  const outcome: "APPROVE" | "BLOCK" | "UNKNOWN" = hasBlock
    ? "BLOCK"
    : hasUnknown && UNKNOWN_BLOCKS
      ? "UNKNOWN"
      : "APPROVE";

  return {
    outcome,
    checks,
    policyRef: `${policy.policyId}@v${policy.version} (${policy.status})`,
  };
}

/**
 * The deterministic risk VETO. Anything that is not an explicit APPROVE is
 * NOT AUTHORIZED. There is no admin override and no force-trade path
 * (Section 10: ADMIN must not have skip-risk/force-trade/bypass-veto).
 */
export function vetoAllows(outcome: "APPROVE" | "BLOCK" | "UNKNOWN"): boolean {
  return outcome === "APPROVE";
}
