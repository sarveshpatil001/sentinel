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
  providerState: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  marketStatus: string;
  dataAgeMs: number | null;
  maxDataAgeMs: number | null;
  now: number;
  existingIdempotencyKeys: string[];
}

export interface PrecheckResult {
  ok: boolean;
  checks: { check: string; status: RiskCheckStatus; detail: string }[];
}

export function validateAuthorizationScope(
  auth: AuthorizationRecord,
  intent: OrderIntent,
  now: number,
): PrecheckResult {
  const checks: PrecheckResult["checks"] = [];
  const add = (check: string, status: RiskCheckStatus, detail: string) =>
    checks.push({ check, status, detail });

  if (auth.state === "REVOKED") {
    add("authorization_state", "BLOCK", "Authorization REVOKED — cannot be used.");
  } else if (auth.state === "CONSUMED") {
    add("authorization_state", "BLOCK", "Authorization already CONSUMED — one authorization, one order.");
  } else if (auth.state === "EXPIRED" || auth.scope.expiresAt <= now) {
    add("authorization_state", "BLOCK", "Authorization EXPIRED — stale authorization must be re-evaluated.");
  } else {
    add("authorization_state", "PASS", "Authorization APPROVED and unexpired.");
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

  if (!ctx.systemEnabled) add("system_enabled", "BLOCK", "Execution subsystem disabled.");
  else add("system_enabled", "PASS", "Execution subsystem enabled.");

  if (ctx.killSwitchEngaged) add("kill_switch", "BLOCK", "Kill switch ENGAGED.");
  else add("kill_switch", "PASS", "Kill switch released.");

  if (ctx.providerState !== "AVAILABLE")
    add("provider_status", "UNKNOWN", `Provider ${ctx.providerState} — submission safety unknown; do not submit.`);
  else add("provider_status", "PASS", "Provider AVAILABLE.");

  if (ctx.marketStatus !== "OPEN") add("market_status", "BLOCK", `Market ${ctx.marketStatus}.`);
  else add("market_status", "PASS", "Market OPEN.");

  if (ctx.dataAgeMs === null || (ctx.maxDataAgeMs !== null && ctx.dataAgeMs > ctx.maxDataAgeMs))
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
