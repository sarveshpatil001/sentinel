/**
 * SENTINEL PRIME — EXECUTION ENGINE (Section 11)
 *
 * Execution carries out ALREADY AUTHORIZED actions. It never decides strategy
 * and never bypasses risk. Key invariants enforced here:
 *   - ORDER INTENT != EXTERNAL ORDER
 *   - authorization scope is validated before submission and on staleness
 *   - idempotency: every external financial mutation is duplicate-protected
 *   - UNKNOWN is first class: an ambiguous submission is NOT assumed failed and
 *     is NEVER blindly retried — it is reconciled first (Rules 10/13/14)
 *   - order state is not position state
 */

import { RiskCheckStatus } from "./risk";

export type OrderState =
  | "CREATED"
  | "VALIDATING"
  | "AUTHORIZED"
  | "READY"
  | "SUBMITTING"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "UNKNOWN";

/**
 * ORDER-STATE POLICY — the ONE definition of which orders require
 * reconciliation and restrict new exposure (shared by the execution precheck,
 * the risk context and the reconciliation engine).
 *
 * Lifecycle: CREATED -> VALIDATING -> AUTHORIZED -> READY -> SUBMITTING ->
 * SUBMITTED -> { ACKNOWLEDGED | PARTIALLY_FILLED | FILLED | REJECTED |
 * CANCELLED | EXPIRED | UNKNOWN }.
 *
 * Classification:
 *  - UNRESOLVED SUBMISSION (external state not established — requires
 *    reconciliation and blocks new exposure): SUBMITTING (submission in
 *    flight, no provider response recorded), SUBMITTED (awaiting the
 *    provider's result), UNKNOWN (ambiguous: a submission MAY have reached
 *    the provider).
 *  - RESOLVED / KNOWN states (never block merely by a former state):
 *    ACKNOWLEDGED (accepted and working — a normal pending order),
 *    PARTIALLY_FILLED (partial execution, remainder open — known state),
 *    FILLED / REJECTED / CANCELLED / EXPIRED (terminal).
 *  - Internal pre-submission history states (never persisted as order.state in
 *    this architecture): CREATED, VALIDATING, AUTHORIZED, READY.
 */
export const UNRESOLVED_SUBMISSION_STATES = ["SUBMITTING", "SUBMITTED", "UNKNOWN"] as const;

export function isUnresolvedSubmissionState(state: string): boolean {
  return (UNRESOLVED_SUBMISSION_STATES as readonly string[]).includes(state);
}

/**
 * RECONCILIATION CLASSIFICATION — exhaustive over the states the
 * reconciliation engine scans (SUBMITTING / SUBMITTED / UNKNOWN). Every
 * scanned order gets EXACTLY ONE outcome; nothing falls through silently.
 *
 * Evidence contract (the repository's provider contract,
 * normalizeProviderResponse): provider evidence is ACCEPTED, REJECTED or
 * NONE. The rules:
 *  - ACCEPTED (authoritative: the provider ledger has the order) -> RESOLVED
 *    to ACKNOWLEDGED; REJECTED -> RESOLVED to REJECTED. This is the documented
 *    resolution condition for a pending/ambiguous submission.
 *  - NONE / absent evidence -> NEVER a terminal result. A timeout, a missing
 *    response or an absent provider record is not proof of rejection or of
 *    non-submission: the order stays in its current state and is reported
 *    UNRESOLVED (PENDING_SUBMISSION for SUBMITTING/SUBMITTED — a normal known
 *    pending order; AMBIGUOUS for UNKNOWN — a possible submission).
 *  - Contradictory evidence (fills on a rejected order, a fill quantity beyond
 *    the order quantity, invalid price/quantity fields) -> UNRESOLVED
 *    (CONTRADICTORY_EVIDENCE): contradictory evidence never manufactures a
 *    terminal result.
 *  - Any unrecognized state value -> UNRESOLVED (UNRECOGNIZED_STATE), fail
 *    closed.
 */
export type ReconciliationCategory =
  | "PENDING_SUBMISSION"
  | "AMBIGUOUS"
  | "CONTRADICTORY_EVIDENCE"
  | "UNRECOGNIZED_STATE";

export type ReconciliationOutcome =
  | { kind: "RESOLVED"; to: OrderState; note: string }
  | { kind: "UNRESOLVED"; category: ReconciliationCategory; note: string };

export function classifyOrderReconciliation(order: {
  state: string;
  providerTruth?: "ACCEPTED" | "REJECTED" | "NONE" | null;
  quantity: number;
  fillQuantity?: number | null;
  fillPrice?: number | null;
}): ReconciliationOutcome {
  const { state, providerTruth, quantity, fillQuantity, fillPrice } = order;

  // Only the three reconcilable states are ever resolved; an unrecognized
  // state value fails CLOSED even if evidence looks authoritative.
  if (!isUnresolvedSubmissionState(state)) {
    return {
      kind: "UNRESOLVED",
      category: "UNRECOGNIZED_STATE",
      note: `RECONCILIATION: order state ${String(state)} is not a known reconcilable state — fail closed, remains unresolved.`,
    };
  }

  // Contradictory evidence is checked next and never resolves anything.
  const hasFill = fillQuantity !== undefined && fillQuantity !== null;
  const contradictory =
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    (hasFill && (!Number.isFinite(fillQuantity) || (fillQuantity as number) < 0 || (fillQuantity as number) > quantity)) ||
    (fillPrice !== undefined && fillPrice !== null && (!Number.isFinite(fillPrice) || (fillPrice as number) <= 0)) ||
    (providerTruth === "REJECTED" && hasFill && (fillQuantity as number) > 0);
  if (contradictory) {
    return {
      kind: "UNRESOLVED",
      category: "CONTRADICTORY_EVIDENCE",
      note: "Order evidence is self-contradictory (invalid fields or fills incompatible with the provider truth). No terminal result is manufactured — manual/authoritative adjudication required.",
    };
  }

  if (providerTruth === "ACCEPTED") {
    return {
      kind: "RESOLVED",
      to: "ACKNOWLEDGED",
      note: "RECONCILIATION: provider ledger shows ACCEPTED. Local state recovered — no duplicate submission was made.",
    };
  }
  if (providerTruth === "REJECTED") {
    return {
      kind: "RESOLVED",
      to: "REJECTED",
      note: "RECONCILIATION: provider ledger shows REJECTED.",
    };
  }

  // No authoritative evidence (NONE / absent / unknown value): NEVER resolved.
  if (state === "SUBMITTING" || state === "SUBMITTED") {
    return {
      kind: "UNRESOLVED",
      category: "PENDING_SUBMISSION",
      note: `RECONCILIATION: ${state} with no provider response recorded — normal pending submission, external state not yet known. Not assumed failed; not retried; remains unresolved until provider evidence arrives.`,
    };
  }
  return {
    kind: "UNRESOLVED",
    category: "AMBIGUOUS",
    note: "RECONCILIATION: UNKNOWN (possible submission) with no provider evidence — ambiguous outcome. Never assumed failed, never assumed never-submitted; remains unresolved.",
  };
}

export interface AuthorizationScope {
  account: string;
  strategyVersionId: string;
  marketId: string;
  side: string;
  quantity: number;
  orderType: string;
  timeInForce: string;
  riskPolicyRef: string;
  mode: string;
  expiresAt: number;
}

export interface AuthorizationRecord {
  authorizationId: string;
  state: "APPROVED" | "EXPIRED" | "REVOKED" | "CONSUMED";
  scope: AuthorizationScope;
  issuedAt: number;
}

export interface OrderIntent {
  orderId: string;
  idempotencyKey: string;
  authorizationId: string;
  strategyVersionId: string;
  marketId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  timeInForce: string;
  mode: string;
}

export interface PrecheckContext {
  systemEnabled: boolean;
  killSwitchEngaged: boolean;
  /** Effective execution mode. Only PAPER/DEMO may submit. */
  mode: string;
  providerState: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  marketStatus: string;
  dataAgeMs: number | null;
  maxDataAgeMs: number | null;
  now: number;
  existingIdempotencyKeys: string[];
  /**
   * Orders in an UNRESOLVED SUBMISSION state (SUBMITTING / SUBMITTED /
   * UNKNOWN — see UNRESOLVED_SUBMISSION_STATES) awaiting reconciliation.
   * > 0 blocks new exposure until external state is known.
   */
  unresolvedOrders: number;
}

export interface PrecheckResult {
  ok: boolean;
  checks: { check: string; status: RiskCheckStatus; detail: string }[];
}

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
const TIME_IN_FORCE: readonly string[] = ["GTC", "IOC", "FOK", "DAY"];
const PROVIDER_STATES: readonly string[] = ["AVAILABLE", "DEGRADED", "UNAVAILABLE"];

/**
 * Structural validation of an order intent: identifier tokens, enum
 * allowlists and Number.isFinite on every numeric input. Empty, unknown or
 * otherwise garbage values fail closed (never an implicit pass).
 */
function validateIntentShape(intent: OrderIntent): string[] {
  const problems: string[] = [];
  if (!token(intent.orderId)) problems.push("intent.orderId must be a non-empty identifier token");
  if (!token(intent.idempotencyKey))
    problems.push("intent.idempotencyKey must be a non-empty identifier token");
  if (!token(intent.authorizationId))
    problems.push("intent.authorizationId must be a non-empty identifier token");
  if (!token(intent.strategyVersionId))
    problems.push("intent.strategyVersionId must be a non-empty identifier token");
  if (!token(intent.marketId)) problems.push("intent.marketId must be a non-empty identifier token");
  if (!token(intent.symbol)) problems.push("intent.symbol must be a non-empty identifier token");
  if (!SIDES.includes(intent.side))
    problems.push(`intent.side ${String(intent.side)} is not a known side`);
  if (!finite(intent.quantity) || intent.quantity <= 0)
    problems.push("intent.quantity must be a finite number > 0");
  if (!ORDER_TYPES.includes(intent.orderType))
    problems.push(`intent.orderType ${String(intent.orderType)} is not a known order type`);
  if (!TIME_IN_FORCE.includes(intent.timeInForce))
    problems.push(`intent.timeInForce ${String(intent.timeInForce)} is not a known time in force`);
  if (!MODES.includes(intent.mode))
    problems.push(`intent.mode ${String(intent.mode)} is not a known mode`);
  return problems;
}

export function validateAuthorizationScope(
  auth: AuthorizationRecord,
  intent: OrderIntent,
  now: number,
): PrecheckResult {
  const checks: PrecheckResult["checks"] = [];
  const add = (check: string, status: RiskCheckStatus, detail: string) =>
    checks.push({ check, status, detail });

  // --- Structural validity (allowlists + Number.isFinite; garbage fails
  // closed before any state machine can bless it). --------------------------
  const problems = [
    ...validateIntentShape(intent),
    ...(token(auth.authorizationId)
      ? []
      : ["auth.authorizationId must be a non-empty identifier token"]),
    ...(intent.authorizationId === auth.authorizationId
      ? []
      : ["intent.authorizationId does not name the validated authorization record"]),
    ...(token(auth.scope.account) ? [] : ["auth.scope.account must be a non-empty identifier token"]),
    ...(token(auth.scope.strategyVersionId)
      ? []
      : ["auth.scope.strategyVersionId must be a non-empty identifier token"]),
    ...(token(auth.scope.marketId)
      ? []
      : ["auth.scope.marketId must be a non-empty identifier token"]),
    ...(SIDES.includes(auth.scope.side)
      ? []
      : [`auth.scope.side ${String(auth.scope.side)} is not a known side`]),
    ...(finite(auth.scope.quantity) && auth.scope.quantity > 0
      ? []
      : ["auth.scope.quantity must be a finite number > 0"]),
    ...(ORDER_TYPES.includes(auth.scope.orderType)
      ? []
      : [`auth.scope.orderType ${String(auth.scope.orderType)} is not a known order type`]),
    ...(TIME_IN_FORCE.includes(auth.scope.timeInForce)
      ? []
      : [`auth.scope.timeInForce ${String(auth.scope.timeInForce)} is not a known time in force`]),
    ...(token(auth.scope.riskPolicyRef)
      ? []
      : ["auth.scope.riskPolicyRef must be a non-empty identifier token"]),
    ...(MODES.includes(auth.scope.mode)
      ? []
      : [`auth.scope.mode ${String(auth.scope.mode)} is not a known mode`]),
    ...(finite(auth.scope.expiresAt) && auth.scope.expiresAt >= 0
      ? []
      : ["auth.scope.expiresAt must be a finite number >= 0"]),
    ...(finite(auth.issuedAt) && auth.issuedAt >= 0
      ? []
      : ["auth.issuedAt must be a finite number >= 0"]),
    ...(finite(now) && now >= 0 ? [] : ["now must be a finite number >= 0"]),
  ];
  if (problems.length > 0) {
    add(
      "input_validity",
      "BLOCK",
      `Invalid authorization/intent input — validation refused (fail closed): ${problems.join("; ")}.`,
    );
    return { ok: false, checks };
  }
  add("input_validity", "PASS", "Authorization and order intent inputs are structurally valid.");

  // --- Authorization state: APPROVED is the allowlist; every other value
  // (including UNKNOWN states) fails closed. --------------------------------
  if (auth.state === "REVOKED") {
    add("authorization_state", "BLOCK", "Authorization REVOKED — cannot be used.");
  } else if (auth.state === "CONSUMED") {
    add("authorization_state", "BLOCK", "Authorization already CONSUMED — one authorization, one order.");
  } else if (auth.state === "EXPIRED" || auth.scope.expiresAt <= now) {
    add("authorization_state", "BLOCK", "Authorization EXPIRED — stale authorization must be re-evaluated.");
  } else if (auth.state === "APPROVED") {
    add("authorization_state", "PASS", "Authorization APPROVED and unexpired.");
  } else {
    add(
      "authorization_state",
      "BLOCK",
      `Authorization state ${String(auth.state)} is not a known state — fail closed.`,
    );
  }

  const scope = auth.scope;
  const mismatches: string[] = [];
  if (scope.account !== intent.mode + ":paper-account") mismatches.push("account");
  if (scope.strategyVersionId !== intent.strategyVersionId) mismatches.push("strategyVersionId");
  if (scope.marketId !== intent.marketId) mismatches.push("marketId");
  if (scope.side !== intent.side) mismatches.push("side");
  if (scope.quantity !== intent.quantity) mismatches.push("quantity");
  if (scope.orderType !== intent.orderType) mismatches.push("orderType");
  if (scope.timeInForce !== intent.timeInForce) mismatches.push("timeInForce");
  if (scope.mode !== intent.mode) mismatches.push("mode");

  if (mismatches.length > 0) {
    add("authorization_scope", "BLOCK", `Scope mismatch: ${mismatches.join(", ")}.`);
  } else {
    add("authorization_scope", "PASS", "Order intent matches authorization scope exactly.");
  }

  return { ok: !checks.some((c) => c.status !== "PASS"), checks };
}

export function runPrechecks(intent: OrderIntent, ctx: PrecheckContext): PrecheckResult {
  const checks: PrecheckResult["checks"] = [];
  const add = (check: string, status: RiskCheckStatus, detail: string) =>
    checks.push({ check, status, detail });

  // --- Structural validity (allowlists + Number.isFinite; garbage fails
  // closed before any comparison can coerce it into a pass). ----------------
  const problems = [
    ...validateIntentShape(intent),
    ...(typeof ctx.systemEnabled === "boolean" ? [] : ["ctx.systemEnabled must be a boolean"]),
    ...(typeof ctx.killSwitchEngaged === "boolean" ? [] : ["ctx.killSwitchEngaged must be a boolean"]),
    ...(MODES.includes(ctx.mode) ? [] : [`ctx.mode ${String(ctx.mode)} is not a known mode`]),
    ...(PROVIDER_STATES.includes(ctx.providerState)
      ? []
      : [`ctx.providerState ${String(ctx.providerState)} is not a known provider state`]),
    ...(ctx.dataAgeMs === null || (finite(ctx.dataAgeMs) && ctx.dataAgeMs >= 0)
      ? []
      : ["ctx.dataAgeMs must be null or a finite number >= 0"]),
    ...(ctx.maxDataAgeMs === null || (finite(ctx.maxDataAgeMs) && ctx.maxDataAgeMs >= 0)
      ? []
      : ["ctx.maxDataAgeMs must be null or a finite number >= 0"]),
    ...(finite(ctx.now) && ctx.now >= 0 ? [] : ["ctx.now must be a finite number >= 0"]),
    ...(Array.isArray(ctx.existingIdempotencyKeys) &&
    ctx.existingIdempotencyKeys.every((k) => typeof k === "string")
      ? []
      : ["ctx.existingIdempotencyKeys must be an array of strings"]),
    ...(finite(ctx.unresolvedOrders) && ctx.unresolvedOrders >= 0
      ? []
      : ["ctx.unresolvedOrders must be a finite number >= 0"]),
  ];
  if (problems.length > 0) {
    add(
      "input_validity",
      "BLOCK",
      `Invalid precheck input — validation refused (fail closed): ${problems.join("; ")}.`,
    );
    return { ok: false, checks };
  }
  add("input_validity", "PASS", "Precheck inputs are structurally valid.");

  if (ctx.systemEnabled !== true) add("system_enabled", "BLOCK", "Execution subsystem disabled.");
  else add("system_enabled", "PASS", "Execution subsystem enabled.");

  // Submission is permitted in PAPER/DEMO ONLY. CONTROLLED_LIVE is never
  // reachable here: live activation is a separate, explicitly approved
  // operation and is not implemented in this build.
  if (ctx.mode !== "PAPER" && ctx.mode !== "DEMO")
    add(
      "mode",
      "BLOCK",
      `Mode ${ctx.mode} permits no order submission (PAPER/DEMO only; live execution is not authorized in this build).`,
    );
  else add("mode", "PASS", `Mode ${ctx.mode} permits simulated submission.`);

  if (ctx.killSwitchEngaged === true) add("kill_switch", "BLOCK", "Kill switch ENGAGED.");
  else add("kill_switch", "PASS", "Kill switch released.");

  if (ctx.unresolvedOrders > 0)
    add(
      "reconciliation_state",
      "BLOCK",
      `${ctx.unresolvedOrders} order(s) in an unresolved submission state (SUBMITTING/SUBMITTED/UNKNOWN) await reconciliation — new exposure blocked until external state is known.`,
    );
  else add("reconciliation_state", "PASS", "No unresolved submission order state.");

  // Provider state is an ALLOWLIST: only AVAILABLE passes; anything else is
  // UNKNOWN (never a permissive default).
  if (ctx.providerState === "AVAILABLE") add("provider_status", "PASS", "Provider AVAILABLE.");
  else if (ctx.providerState === "DEGRADED" || ctx.providerState === "UNAVAILABLE")
    add("provider_status", "UNKNOWN", `Provider ${ctx.providerState} — submission safety unknown; do not submit.`);
  else
    add(
      "provider_status",
      "UNKNOWN",
      `Provider state ${String(ctx.providerState)} is not a known state — submission safety unknown; do not submit.`,
    );

  if (ctx.marketStatus !== "OPEN") add("market_status", "BLOCK", `Market ${ctx.marketStatus}.`);
  else add("market_status", "PASS", "Market OPEN.");

  // Freshness requires a FINITE, non-negative age. Unknown/NaN/negative age
  // is never coerced into "fresh" by a failed numeric comparison.
  if (
    ctx.dataAgeMs === null ||
    !finite(ctx.dataAgeMs) ||
    ctx.dataAgeMs < 0 ||
    (ctx.maxDataAgeMs !== null && ctx.dataAgeMs > ctx.maxDataAgeMs)
  )
    add("data_freshness", "BLOCK", "Market data stale or unknown at precheck.");
  else add("data_freshness", "PASS", "Market data fresh at precheck.");

  if (ctx.existingIdempotencyKeys.includes(intent.idempotencyKey))
    add("idempotency", "BLOCK", "Duplicate idempotency key — order already exists (duplicate protection).");
  else add("idempotency", "PASS", "Idempotency key unused.");

  return { ok: !checks.some((c) => c.status !== "PASS"), checks };
}

/**
 * Provider response normalization. A timeout after a possible submission is
 * UNKNOWN — not failure, not success. The caller must reconcile before any
 * retry (Rules 10/13/14).
 */
export function normalizeProviderResponse(
  raw:
    | { kind: "ack"; providerOrderId: string }
    | { kind: "reject"; reason: string }
    | { kind: "timeout" }
    | { kind: "partial_fill"; providerOrderId: string; filled: number; remaining: number; price: number }
    | { kind: "fill"; providerOrderId: string; price: number },
): {
  state: OrderState;
  note: string;
  providerTruth: "ACCEPTED" | "REJECTED" | "NONE";
} {
  switch (raw.kind) {
    case "ack":
      return { state: "ACKNOWLEDGED", note: `Provider acknowledged order ${raw.providerOrderId}.`, providerTruth: "ACCEPTED" };
    case "reject":
      return { state: "REJECTED", note: `Provider rejected: ${raw.reason}`, providerTruth: "REJECTED" };
    case "fill":
      return { state: "FILLED", note: `Filled at ${raw.price}.`, providerTruth: "ACCEPTED" };
    case "partial_fill":
      return {
        state: "PARTIALLY_FILLED",
        note: `Partial fill ${raw.filled}/${raw.filled + raw.remaining} at ${raw.price} — remainder open.`,
        providerTruth: "ACCEPTED",
      };
    case "timeout":
      return {
        state: "UNKNOWN",
        note:
          "Provider timeout after possible submission. ORDER = UNKNOWN. Do NOT assume failure. Do NOT blindly retry. RECONCILE FIRST.",
        providerTruth: "NONE",
      };
  }
}

/** Canonical error normalization for provider-specific failures. */
export function canonicalizeProviderError(providerCode: string): string {
  const map: Record<string, string> = {
    RATE_LIMITED: "PROVIDER_RATE_LIMITED",
    INSUFFICIENT_FUNDS: "REJECTED_INSUFFICIENT_FUNDS",
    INVALID_QTY: "REJECTED_INVALID_QUANTITY",
    MARKET_CLOSED: "REJECTED_MARKET_CLOSED",
    NETWORK: "PROVIDER_NETWORK_ERROR",
  };
  return map[providerCode] ?? "PROVIDER_UNKNOWN_ERROR";
}
