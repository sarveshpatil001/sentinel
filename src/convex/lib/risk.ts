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
  /**
   * CURRENT LOSS STREAK: number of losing realized trade outcomes since the
   * most recent winning outcome (breakeven outcomes neither extend nor reset
   * it — see lib/positions.ts computeLossStreak). Persisted per owner from
   * completed realized trade outcomes — never a hardcoded constant.
   */
  consecutiveLosses: number;
  existingOrderIdempotencyKeys: string[];
  proposalIdempotencyKey: string;
  /**
   * Orders in an UNRESOLVED SUBMISSION state (SUBMITTING/SUBMITTED/UNKNOWN —
   * see lib/execution.ts UNRESOLVED_SUBMISSION_STATES) awaiting
   * reconciliation. > 0 blocks new exposure.
   */
  unresolvedOrders: number;
  /**
   * False when the account state could NOT be read completely (bounded-scan
   * saturation at the data layer, or a loss streak that could not be derived
   * reliably from the persisted outcome history). Incompleteness must never
   * silently undercount exposure: false forces an UNKNOWN verdict (no trade).
   * Omitted = complete (pure-function callers/tests that provide full inputs).
   */
  accountStateComplete?: boolean;
  /**
   * False when the MARK-TO-MARKET valuation of open positions could not be
   * established (missing, stale or invalid prices, or an unbounded market
   * fan-out). Absent prices are NEVER treated as zero unrealized PnL or as
   * proof of safety: false forces an UNKNOWN verdict (no new exposure).
   * Omitted = complete (pure-function callers/tests that provide full inputs).
   */
  valuationComplete?: boolean;
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
  /**
   * CANONICAL policy identity: `<policyId>@v<version>` — identifier-token
   * conformant (TOKEN_RE) and version-pinned. This is the machine reference
   * bound into `executionAuthorizations.scope.riskPolicyRef` and validated by
   * `validateAuthorizationScope` (execution.ts). A malformed policy identity
   * is never interpolated into a plausible-looking reference.
   */
  policyRef: string;
  /**
   * Human-readable display label (identity + lifecycle status), for audit and
   * UI text ONLY. Never stored in an identifier field.
   */
  policyLabel: string;
}

/**
 * Canonical, version-pinned policy identity (the one policy-reference
 * contract shared by producer, database record and consumer). Returns the
 * INVALID sentinel for anything that is not a valid identity+version pair so
 * a garbage policy can never masquerade as a real reference.
 */
export function policyIdentity(policyId: unknown, version: unknown): string {
  return token(policyId) && finite(version) && (version as number) > 0
    ? `${policyId}@v${version}`
    : "INVALID-POLICY@v0";
}

const UNKNOWN_BLOCKS = true; // fail-closed invariant

const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

/**
 * Strict identifier/symbol token: no whitespace, control, quote or underscore
 * characters (identifiers in this system never contain `_` — verified).
 * Every real identifier conforms — garbage strings do not.
 */
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;
const token = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);

/** Controlled vocabularies — ALLOWLISTS. Unknown values fail closed. */
const MODES: readonly string[] = [
  "RESEARCH",
  "BACKTEST",
  "OUT_OF_SAMPLE",
  "PAPER",
  "DEMO",
  "CONTROLLED_LIVE",
  "DISABLED",
];
const SIDES: readonly string[] = ["BUY", "SELL"];
const ORDER_TYPES: readonly string[] = ["MARKET", "LIMIT"];
const DATA_QUALITY_STATES: readonly string[] = [
  "VALID",
  "INCOMPLETE",
  "STALE",
  "MISSING",
  "INVALID",
  "FAILED",
];
const PROVIDER_STATES: readonly string[] = ["AVAILABLE", "DEGRADED", "UNAVAILABLE"];
const EVIDENCE_LEVELS: readonly string[] = ["STRONG", "MODERATE", "WEAK", "INSUFFICIENT"];
const FITNESS_VERDICTS: readonly string[] = [
  "SUITABLE",
  "MIXED",
  "UNSUITABLE",
  "INSUFFICIENT_DATA",
];

/**
 * Required-input validation. Invalid, non-finite or UNKNOWN-valued inputs
 * must NEVER produce an approval (Section 10): a malformed proposal, context
 * or policy is a deterministic BLOCK, and numeric limit evaluation is skipped
 * rather than fed NaN. Every numeric input is validated with Number.isFinite;
 * every string/enum input is validated against a token shape or an allowlist
 * (unknown values fail closed — never a permissive default).
 */
function validateInputs(
  proposal: TradeProposal,
  ctx: RiskContext,
  policy: RiskPolicy,
): { problems: string[]; malformedPolicy: boolean } {
  const problems: string[] = [];

  // Identifiers and controlled vocabularies (allowlists; unknown -> BLOCK).
  if (!token(proposal.proposalId))
    problems.push("proposal.proposalId must be a non-empty identifier token");
  if (!SIDES.includes(proposal.side))
    problems.push(`proposal.side ${String(proposal.side)} is not a known side`);
  if (!ORDER_TYPES.includes(proposal.orderType))
    problems.push(`proposal.orderType ${String(proposal.orderType)} is not a known order type`);
  if (!MODES.includes(proposal.mode))
    problems.push(`proposal.mode ${String(proposal.mode)} is not a known mode`);
  if (!MODES.includes(ctx.mode)) problems.push(`ctx.mode ${String(ctx.mode)} is not a known mode`);
  if (typeof ctx.killSwitchEngaged !== "boolean")
    problems.push("ctx.killSwitchEngaged must be a boolean");
  if (typeof ctx.strategyEligible !== "boolean")
    problems.push("ctx.strategyEligible must be a boolean");
  if (!token(ctx.strategyVersionId))
    problems.push("ctx.strategyVersionId must be a non-empty identifier token");
  if (!token(ctx.marketId)) problems.push("ctx.marketId must be a non-empty identifier token");
  if (!token(ctx.proposalIdempotencyKey))
    problems.push("ctx.proposalIdempotencyKey must be a non-empty identifier token");
  if (!EVIDENCE_LEVELS.includes(ctx.evidenceLevel))
    problems.push(`ctx.evidenceLevel ${String(ctx.evidenceLevel)} is not a known level`);
  if (!FITNESS_VERDICTS.includes(ctx.fitnessVerdict))
    problems.push(`ctx.fitnessVerdict ${String(ctx.fitnessVerdict)} is not a known verdict`);
  if (!DATA_QUALITY_STATES.includes(ctx.dataQualityState))
    problems.push(`ctx.dataQualityState ${String(ctx.dataQualityState)} is not a known data-quality state`);
  if (!PROVIDER_STATES.includes(ctx.providerState))
    problems.push(`ctx.providerState ${String(ctx.providerState)} is not a known provider state`);
  if (
    !Array.isArray(ctx.existingOrderIdempotencyKeys) ||
    !ctx.existingOrderIdempotencyKeys.every((k) => typeof k === "string")
  )
    problems.push("ctx.existingOrderIdempotencyKeys must be an array of strings");
  if (ctx.accountStateComplete !== undefined && typeof ctx.accountStateComplete !== "boolean")
    problems.push("ctx.accountStateComplete must be a boolean when present");
  if (ctx.valuationComplete !== undefined && typeof ctx.valuationComplete !== "boolean")
    problems.push("ctx.valuationComplete must be a boolean when present");

  // Numerics — every numeric input passes Number.isFinite (never coerced).
  if (!finite(proposal.quantity) || proposal.quantity <= 0)
    problems.push("proposal.quantity must be a finite number > 0");
  if (!finite(proposal.referencePrice) || proposal.referencePrice <= 0)
    problems.push("proposal.referencePrice must be a finite number > 0");
  if (ctx.dataAgeMs !== null && (!finite(ctx.dataAgeMs) || ctx.dataAgeMs < 0))
    problems.push("ctx.dataAgeMs must be null or a finite number >= 0");
  if (ctx.spreadBps !== null && (!finite(ctx.spreadBps) || ctx.spreadBps < 0))
    problems.push("ctx.spreadBps must be null or a finite number >= 0");
  if (!finite(ctx.equity) || ctx.equity < 0) problems.push("ctx.equity invalid");
  if (!finite(ctx.peakEquity) || ctx.peakEquity <= 0)
    problems.push("ctx.peakEquity invalid");
  if (!finite(ctx.realizedPnlToday)) problems.push("ctx.realizedPnlToday invalid");
  if (!finite(ctx.openPositions) || ctx.openPositions < 0)
    problems.push("ctx.openPositions invalid");
  if (!finite(ctx.consecutiveLosses) || ctx.consecutiveLosses < 0)
    problems.push("ctx.consecutiveLosses invalid");
  if (!finite(ctx.unresolvedOrders) || ctx.unresolvedOrders < 0)
    problems.push("ctx.unresolvedOrders invalid");

  // Policy shape — malformed policy is reported as policy_validity.
  let malformedPolicy = false;
  if (!token(policy.policyId)) {
    malformedPolicy = true;
    problems.push("policy.policyId must be a non-empty identifier token");
  }
  if (!finite(policy.version) || policy.version <= 0) {
    malformedPolicy = true;
    problems.push("policy.version must be a finite number > 0");
  }
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
    if (v !== null && (!finite(v) || v < 0)) {
      malformedPolicy = true;
      problems.push(`policy.limits.${key} is neither null nor a finite number >= 0`);
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
  // One policy-reference contract for producer, record and consumer:
  // `policyRef` is the canonical token identity; `policyLabel` is display-only.
  const policyRef = policyIdentity(policy.policyId, policy.version);
  const policyLabel = `${policyRef} (${policy.status})`;

  const { problems, malformedPolicy } = validateInputs(proposal, ctx, policy);
  if (problems.length > 0) {
    push(
      malformedPolicy ? "policy_validity" : "input_validity",
      "BLOCK",
      `Invalid risk inputs — evaluation refused (fail closed): ${problems.join("; ")}.`,
    );
    return { outcome: "BLOCK", checks, policyRef, policyLabel };
  }
  push("input_validity", "PASS", "All required risk inputs are finite and valid.");

  // --- Policy eligibility (approved lifecycle only) ----------------------
  // Unapproved or provisional policies must NOT authorize execution (Section 10).
  if (policy.status !== "APPROVED") {
    push(
      "policy_status",
      "BLOCK",
      `Risk policy ${policyRef} is ${policy.status} — only an APPROVED policy version may authorize execution.`,
    );
    return { outcome: "BLOCK", checks, policyRef, policyLabel };
  }
  push("policy_status", "PASS", `Risk policy ${policy.policyId}@v${policy.version} is APPROVED.`);

  // --- System gates -------------------------------------------------------
  if (ctx.killSwitchEngaged === true) {
    push("kill_switch", "BLOCK", "Kill switch is ENGAGED — no new execution permitted.");
  } else if (ctx.killSwitchEngaged === false) {
    push("kill_switch", "PASS", "Kill switch released.");
  } else {
    // Unreachable after input validation; kept fail-closed by construction.
    push("kill_switch", "BLOCK", "Kill switch state is not a known state — fail closed, no execution.");
  }

  // Mode is an ALLOWLIST: PAPER/DEMO (matching the system mode) pass, every
  // known non-executable mode is named explicitly, and any UNKNOWN mode is
  // BLOCKED — there is no permissive default.
  if (proposal.mode === "DISABLED") {
    push("mode", "BLOCK", "System mode DISABLED — no new execution.");
  } else if (proposal.mode === "RESEARCH" || proposal.mode === "BACKTEST" || proposal.mode === "OUT_OF_SAMPLE") {
    push("mode", "BLOCK", `Mode ${proposal.mode} has no external execution path.`);
  } else if (proposal.mode === "CONTROLLED_LIVE") {
    // Live activation is a separate, explicitly authorized operation. It is
    // NOT reachable in this build — never a side effect of any other action.
    push("mode", "BLOCK", "CONTROLLED_LIVE execution is NOT authorized in this build (live activation prohibited — requires a separate, approved live-readiness process). ");
  } else if (proposal.mode !== ctx.mode) {
    push("mode", "BLOCK", `Proposal mode ${proposal.mode} does not match system mode ${ctx.mode} — fail closed.`);
  } else if (proposal.mode === "PAPER" || proposal.mode === "DEMO") {
    push("mode", "PASS", `Mode ${proposal.mode} permits simulated/authorized execution.`);
  } else {
    push("mode", "BLOCK", `Mode ${proposal.mode} is not a known mode — fail closed, no execution.`);
  }

  // --- Reconciliation state ----------------------------------------------
  // An unresolved submission (SUBMITTING/SUBMITTED/UNKNOWN) means the order's
  // external state is not established and an earlier submission may already
  // have reached the provider; new exposure is blocked until reconciliation
  // resolves it (one shared policy with the execution precheck —
  // lib/execution.ts UNRESOLVED_SUBMISSION_STATES).
  if (ctx.unresolvedOrders > 0) {
    push(
      "reconciliation_state",
      "BLOCK",
      `${ctx.unresolvedOrders} order(s) in an unresolved submission state (SUBMITTING/SUBMITTED/UNKNOWN) await reconciliation — new exposure is blocked until external state is known.`,
    );
  } else {
    push("reconciliation_state", "PASS", "No unresolved submission order state.");
  }

  // --- Account-state completeness ---------------------------------------
  // Fail-closed: if the data layer could not establish that risk inputs are
  // complete (bounded scan saturated, or the loss streak could not be derived
  // reliably from the persisted outcome history), exposure may be
  // undercounted. Unknown must never become approved.
  if (ctx.accountStateComplete === false) {
    push(
      "account_state_completeness",
      "UNKNOWN",
      "Account state could not be read completely (bounded-scan saturation or an unestablishable loss-streak history) — exposure may be undercounted; no new exposure until completeness is re-established.",
    );
  } else {
    push("account_state_completeness", "PASS", "Account risk inputs read completely.");
  }

  // --- Mark-to-market valuation completeness ----------------------------
  // Fail-closed: absent or stale prices are NEVER treated as zero unrealized
  // PnL or as proof that the account is safe. When a reliable valuation
  // cannot be established, equity/drawdown may misstate exposure and the
  // context is incomplete -> UNKNOWN, no new exposure.
  if (ctx.valuationComplete === false) {
    push(
      "equity_valuation",
      "UNKNOWN",
      "Mark-to-market valuation could not be established for every open position (missing, stale or invalid prices) — equity and drawdown may misstate exposure; no new exposure until a reliable valuation exists.",
    );
  } else {
    push("equity_valuation", "PASS", "Mark-to-market equity valuation established from valid, fresh prices.");
  }

  // --- Strategy eligibility ----------------------------------------------
  if (ctx.strategyEligible === true) {
    push("strategy_eligibility", "PASS", `Strategy version ${ctx.strategyVersionId} is validation-eligible.`);
  } else {
    push("strategy_eligibility", "BLOCK", `Strategy version ${ctx.strategyVersionId} is NOT eligible (validation/evidence gate unmet).`);
  }

  // --- Data quality / freshness (critical -> UNKNOWN, not zero) -----------
  // Data quality is an ALLOWLIST over the six known states; an UNKNOWN state
  // is never treated as VALID (no permissive default).
  if (ctx.dataQualityState === "VALID") {
    push("data_quality", "PASS", "Market data quality VALID.");
  } else if (ctx.dataQualityState === "FAILED" || ctx.dataQualityState === "INVALID") {
    push("data_quality", "BLOCK", `Critical market data quality is ${ctx.dataQualityState} — trade blocked.`);
  } else if (ctx.dataQualityState === "MISSING") {
    push("data_quality", "UNKNOWN", "Critical market data is MISSING — unknown risk state, no trade.");
  } else if (ctx.dataQualityState === "STALE" || ctx.dataQualityState === "INCOMPLETE") {
    push("data_quality", "UNKNOWN", `Market data is ${ctx.dataQualityState} — risk state not fully knowable, no trade.`);
  } else {
    push("data_quality", "UNKNOWN", `Market data quality state ${String(ctx.dataQualityState)} is not a known state — risk state not knowable, no trade.`);
  }

  if (ctx.dataAgeMs === null || !finite(ctx.dataAgeMs)) {
    push("data_freshness", "UNKNOWN", "Data age unknown — freshness cannot be verified.");
  } else if (policy.limits.maxDataAgeMs !== null && ctx.dataAgeMs > policy.limits.maxDataAgeMs) {
    push("data_freshness", "BLOCK", `Data age ${Math.round(ctx.dataAgeMs / 60000)}min exceeds policy limit.`);
  } else {
    push("data_freshness", "PASS", `Data age ${Math.round(ctx.dataAgeMs / 60000)}min within policy limit.`);
  }

  // --- Provider / market status -----------------------------------------
  // Provider state is an ALLOWLIST: only AVAILABLE passes; anything else is
  // UNKNOWN (never a permissive default).
  if (ctx.providerState === "AVAILABLE") {
    push("provider_status", "PASS", "Provider AVAILABLE.");
  } else if (ctx.providerState === "UNAVAILABLE") {
    push("provider_status", "UNKNOWN", "Provider UNAVAILABLE — external state not knowable; unsafe actions blocked.");
  } else if (ctx.providerState === "DEGRADED") {
    push("provider_status", "UNKNOWN", "Provider DEGRADED — execution safety not confirmed; no trade.");
  } else {
    push("provider_status", "UNKNOWN", `Provider state ${String(ctx.providerState)} is not a known state — external state not knowable; no trade.`);
  }

  if (ctx.marketStatus !== "OPEN") {
    push("market_status", "BLOCK", `Market status is ${ctx.marketStatus}.`);
  } else {
    push("market_status", "PASS", "Market OPEN.");
  }

  // --- Spread / liquidity -------------------------------------------------
  if (ctx.spreadBps === null || !finite(ctx.spreadBps)) {
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

  // Drawdown from MARK-TO-MARKET equity against the server-maintained peak.
  // The peak is never lowered by a stale/absent valuation (the data layer
  // leaves it untouched when the valuation is unreliable).
  const drawdown =
    ctx.peakEquity > 0 ? (ctx.peakEquity - ctx.equity) / ctx.peakEquity : null;
  if (drawdown === null) {
    push("drawdown", "UNKNOWN", "Drawdown not computable (equity state unknown).");
  } else if (policy.limits.maxDrawdown !== null && drawdown >= policy.limits.maxDrawdown) {
    push("drawdown", "BLOCK", `Drawdown ${(drawdown * 100).toFixed(1)}% at or beyond limit ${(policy.limits.maxDrawdown * 100).toFixed(1)}%.`);
  } else {
    push("drawdown", "PASS", `Drawdown ${(drawdown * 100).toFixed(1)}% within limit.`);
  }

  // Loss streak from PERSISTED completed realized trade outcomes (owner
  // scoped; lib/positions.ts computeLossStreak policy). A hard-coded or
  // silently-substituted zero can never disable this protection.
  if (
    policy.limits.maxConsecutiveLosses !== null &&
    ctx.consecutiveLosses >= policy.limits.maxConsecutiveLosses
  ) {
    push(
      "consecutive_losses",
      "BLOCK",
      `Loss streak ${ctx.consecutiveLosses} (losing realized outcomes since the last winning outcome) at limit ${policy.limits.maxConsecutiveLosses}.`,
    );
  } else if (policy.limits.maxConsecutiveLosses === null) {
    push("consecutive_losses", "UNKNOWN", "No consecutive-loss limit declared in policy.");
  } else {
    push(
      "consecutive_losses",
      "PASS",
      `Loss streak ${ctx.consecutiveLosses} (losing realized outcomes since the last winning outcome) within limit ${policy.limits.maxConsecutiveLosses}.`,
    );
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
    policyRef,
    policyLabel,
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
