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

export function evaluateRisk(
  proposal: TradeProposal,
  ctx: RiskContext,
  policy: RiskPolicy,
): RiskDecisionResult {
  const checks: RiskCheck[] = [];
  const push = (check: string, status: RiskCheckStatus, detail: string) =>
    checks.push({ check, status, detail });

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
  } else {
    push("mode", "PASS", `Mode ${proposal.mode} permits simulated/authorized execution.`);
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
