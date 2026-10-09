/**
 * SENTINEL PRIME — WORKFLOW MUTATIONS (Sections 10, 11, 13)
 *
 * The ONLY paths that create financial state. Every path follows the master
 * authority chain: DATA -> VALIDATION -> EVIDENCE -> FITNESS -> RISK ->
 * DETERMINISTIC RISK VETO -> EXECUTION AUTHORIZATION -> EXECUTION ->
 * RECONCILIATION -> AUDIT.
 *
 * Prohibited paths that DO NOT EXIST here and must never be added (Section 32):
 * AI -> EXCHANGE, FRONTEND -> EXCHANGE, STRATEGY -> EXCHANGE,
 * LEARNING -> EXCHANGE, LEARNING -> LIVE STRATEGY MUTATION, ADMIN BYPASS.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { MutationCtx, appendAudit } from "./lib/store";
import { evaluateRisk, RiskContext, RiskPolicy, TradeProposal, vetoAllows } from "./lib/risk";
import { CostModel, StrategyDefinition } from "./lib/backtest";
import { runValidationPipeline, SnapshotBinding } from "./lib/pipeline";
import { validateAuthorizationScope, runPrechecks, normalizeProviderResponse, OrderIntent, OrderState } from "./lib/execution";
import { canUseAuthorization, canViewRecord, requireRole } from "./lib/authz";
import { applyFill, fillDelta, PositionState } from "./lib/positions";

const HOUR = 3600_000;
const PAPER_EQUITY_BASE = 100000;

async function requireUser(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("UNAUTHENTICATED");
  return userId;
}

/** Authenticated actor WITH server-side role. Role claims from clients are ignored. */
async function requireActor(
  ctx: MutationCtx,
): Promise<{ userId: string; role: string | undefined; isAnonymous: boolean }> {
  const userId = await requireUser(ctx);
  const user = await ctx.db.get(userId);
  return { userId, role: user?.role, isAnonymous: user?.isAnonymous === true };
}

export interface RiskContextBundle {
  ctx: RiskContext;
  policy: RiskPolicy;
}

export async function loadRiskContext(
  ctx: MutationCtx,
  args: {
    strategyVersionId: string;
    marketId: string;
    proposalIdempotencyKey: string;
  },
): Promise<RiskContextBundle> {
  const state = await ctx.db.query("systemState").first();
  const policyRow = await ctx.db.query("riskPolicies").first();
  const market = await ctx.db
    .query("markets")
    .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
    .first();

  const validation = await ctx.db
    .query("validationRuns")
    .withIndex("by_strategyVersion", (q) => q.eq("strategyVersionId", args.strategyVersionId))
    .order("desc")
    .first();
  const evidence = await ctx.db
    .query("evidenceRecords")
    .withIndex("by_strategyVersion", (q) => q.eq("strategyVersionId", args.strategyVersionId))
    .order("desc")
    .first();
  const fitness = await ctx.db
    .query("botFitnessRecords")
    .withIndex("by_strategyVersion", (q) => q.eq("strategyVersionId", args.strategyVersionId))
    .order("desc")
    .first();

  const quality = await ctx.db
    .query("dataQualityReports")
    .withIndex("by_market", (q) => q.eq("marketId", args.marketId))
    .first();
  const lastCandle = (await ctx.db
    .query("candles")
    .withIndex("by_market_tf_time", (q) => q.eq("marketId", args.marketId).eq("timeframe", "1h"))
    .order("desc")
    .first()) ?? null;

  const positions = await ctx.db.query("positions").take(100);
  const orders = await ctx.db.query("orders").take(500);

  const realized = positions.reduce((a, p) => a + p.realizedPnl, 0);
  const equity = PAPER_EQUITY_BASE + realized;
  const openPositions = positions.filter((p) => p.quantity > 0).length;

  // Daily-loss accounting: server-tracked UTC-day realized PnL. Legacy rows
  // without day tracking fall back to the CUMULATIVE realized PnL — never
  // zero (MISSING must not become a permissive default).
  const dayKey = new Date().toISOString().slice(0, 10);
  const realizedPnlToday =
    state?.pnlDay === undefined
      ? realized
      : state.pnlDay === dayKey
        ? (state.realizedPnlDay ?? 0)
        : 0;
  // Peak equity is server-maintained at fill time; the legacy fallback is the
  // contribution base (never `equity` itself, which would force drawdown to 0).
  const peakEquity = Math.max(state?.peakEquity ?? PAPER_EQUITY_BASE, equity);
  const unresolvedUnknownOrders = orders.filter((o) => o.state === "UNKNOWN").length;

  const eligible =
    validation?.state === "COMPLETED" &&
    (evidence?.level === "STRONG" || evidence?.level === "MODERATE") &&
    (fitness?.verdict ?? "INSUFFICIENT_DATA") !== "UNSUITABLE";

  const riskCtx: RiskContext = {
    mode: state?.mode ?? "PAPER",
    killSwitchEngaged: state?.killSwitchEngaged ?? true,
    strategyEligible: eligible,
    strategyVersionId: args.strategyVersionId,
    evidenceLevel: evidence?.level ?? "INSUFFICIENT",
    fitnessVerdict: fitness?.verdict ?? "INSUFFICIENT_DATA",
    marketId: args.marketId,
    marketStatus: market?.status ?? "UNKNOWN",
    providerState: market?.providerState ?? "UNAVAILABLE",
    dataAgeMs: lastCandle ? Date.now() - lastCandle.availabilityTime : null,
    dataQualityState: quality?.state ?? "MISSING",
    spreadBps: market?.assetClass === "FOREX" ? 8 : 2,
    openPositions,
    realizedPnlToday,
    equity,
    peakEquity,
    consecutiveLosses: 0,
    existingOrderIdempotencyKeys: orders.map((o) => o.idempotencyKey),
    proposalIdempotencyKey: args.proposalIdempotencyKey,
    unresolvedUnknownOrders,
  };

  return {
    ctx: riskCtx,
    policy: {
      policyId: policyRow?.policyId ?? "RISK-POLICY-CORE",
      version: policyRow?.version ?? 1,
      status: (policyRow?.status as RiskPolicy["status"]) ?? "PROVISIONAL",
      limits: (policyRow?.limits ?? {
        maxNotionalPerTrade: null,
        maxOpenPositions: null,
        maxDailyLoss: null,
        maxDrawdown: null,
        maxConsecutiveLosses: null,
        maxSpreadBps: null,
        maxDataAgeMs: null,
      }) as RiskPolicy["limits"],
    },
  };
}

/**
 * TRADE PROPOSAL -> DETERMINISTIC RISK ENGINE -> DETERMINISTIC RISK VETO ->
 * EXECUTION AUTHORIZATION / BLOCK.
 *
 * Only an explicit veto APPROVE produces an execution authorization. There is
 * no force-trade path: even an admin cannot convert BLOCK/UNKNOWN to APPROVE.
 */
export const submitTradeProposal = mutation({
  args: {
    strategyVersionId: v.string(),
    marketId: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    quantity: v.number(),
    referencePrice: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();

    // OWNERSHIP: a proposal acts on a strategy version. Private versions are
    // usable by their owner only — not-found and not-owned are
    // indistinguishable (no IDOR oracle), and no risk decision is recorded.
    const version = await ctx.db
      .query("strategyVersions")
      .withIndex("by_versionId", (q) => q.eq("strategyVersionId", args.strategyVersionId))
      .first();
    if (!version || !canViewRecord(version.ownerUserId, userId)) {
      return {
        riskDecisionId: null as string | null,
        outcome: "BLOCK" as const,
        authorizationId: null as string | null,
        checks: [
          {
            check: "strategy_version_access",
            status: "BLOCK" as const,
            detail: "Strategy version not found.",
          },
        ],
      };
    }

    const { ctx: riskCtx, policy } = await loadRiskContext(ctx, {
      strategyVersionId: args.strategyVersionId,
      marketId: args.marketId,
      proposalIdempotencyKey: args.idempotencyKey,
    });

    const proposal: TradeProposal = {
      proposalId: `PROP-${args.idempotencyKey}`,
      side: args.side,
      quantity: args.quantity,
      referencePrice: args.referencePrice,
      orderType: "MARKET",
      mode: riskCtx.mode,
    };

    const decision = evaluateRisk(proposal, riskCtx, policy);
    const riskDecisionId = `RISK-${args.idempotencyKey}`;
    await ctx.db.insert("riskDecisions", {
      riskDecisionId,
      proposalId: proposal.proposalId,
      strategyVersionId: args.strategyVersionId,
      mode: riskCtx.mode as never,
      policyId: policy.policyId,
      policyVersion: policy.version,
      checks: decision.checks,
      outcome: decision.outcome,
      actor: `user:${userId}`,
      ownerUserId: userId,
      createdAt: now,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "RISK_DECISION_RECORDED",
        resourceType: "riskDecision",
        resourceId: riskDecisionId,
        outcome: decision.outcome,
        correlationId: proposal.proposalId,
        detail: `Deterministic risk evaluation under ${decision.policyRef}: ${decision.outcome}. Veto is final authority.`,
      },
      now,
    );

    if (!vetoAllows(decision.outcome)) {
      await appendAudit(
        ctx,
        {
          actor: "system:risk-veto",
          actorType: "SERVICE",
          action: "EXECUTION_AUTHORIZATION_DENIED",
          resourceType: "riskDecision",
          resourceId: riskDecisionId,
          outcome: "DENIED",
          correlationId: proposal.proposalId,
          detail: `Veto returned ${decision.outcome}. No authorization issued. Unknown must never become approved.`,
        },
        now,
      );
      return { riskDecisionId, outcome: decision.outcome, authorizationId: null as string | null, checks: decision.checks };
    }

    const authorizationId = `AUTH-${args.idempotencyKey}`;
    await ctx.db.insert("executionAuthorizations", {
      authorizationId,
      riskDecisionId,
      proposalId: proposal.proposalId,
      scope: {
        account: `${riskCtx.mode}:paper-account`,
        strategyVersionId: args.strategyVersionId,
        marketId: args.marketId,
        side: args.side,
        quantity: args.quantity,
        orderType: "MARKET",
        timeInForce: "GTC",
        riskPolicyRef: decision.policyRef,
        mode: riskCtx.mode as never,
        expiresAt: now + 15 * 60_000,
      },
      state: "APPROVED",
      issuedAt: now,
      // Capability token bound to the caller. Another user can never consume it.
      ownerUserId: userId,
    });

    await appendAudit(
      ctx,
      {
        actor: "system:execution-authorizer",
        actorType: "SERVICE",
        action: "EXECUTION_AUTHORIZATION_ISSUED",
        resourceType: "executionAuthorization",
        resourceId: authorizationId,
        outcome: "APPROVED",
        correlationId: proposal.proposalId,
        detail: `Scoped authorization issued (expires ${new Date(now + 15 * 60_000).toISOString()}), mode ${riskCtx.mode}.`,
      },
      now,
    );

    return { riskDecisionId, outcome: decision.outcome, authorizationId, checks: decision.checks };
  },
});

export type { OrderIntent, TradeProposal };

/**
 * ORDER INTENT -> PRECHECK -> AUTHORIZATION VALIDATION -> PROVIDER -> ORDER STATE.
 *
 * The SIMULATED provider adapter's behavior is selected by the SERVER-SIDE
 * test/demo configuration `systemState.simulatedProviderBehavior` (admin-gated,
 * PAPER/DEMO only) — never by a per-request client flag:
 *   - ACK    : provider accepts
 *   - FILL   : provider accepts and fills at the last close
 *   - PARTIAL: provider partially fills (half), remainder stays open
 *   - REJECT : provider rejects
 *   - TIMEOUT: response lost after a possible submission -> order is UNKNOWN.
 *              The provider-side truth is ACCEPTED; the local state stays
 *              UNKNOWN until RECONCILIATION. Never assumed failed, never retried.
 */
export const placeOrder = mutation({
  args: {
    authorizationId: v.string(),
    strategyVersionId: v.string(),
    marketId: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    quantity: v.number(),
    orderType: v.string(),
    timeInForce: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireActor(ctx);
    const now = Date.now();

    // Idempotency: duplicate protection for every external financial mutation.
    // The key namespace is GLOBAL (one key -> at most one external mutation),
    // but the existing order's id and state are visible to its OWNER only — a
    // duplicate key must never disclose another user's order (no IDOR oracle).
    const existing = await ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing) {
      if (!canViewRecord(existing.ownerUserId, userId)) {
        // Foreign key collision: indistinguishable from any other rejected
        // intent. No order id, no state, no owner leaks — and no row is created.
        return {
          deduped: false as const,
          orderId: null as string | null,
          state: "REJECTED" as const,
          note: "Order intent rejected — no external mutation performed.",
        };
      }
      return {
        deduped: true as const,
        orderId: existing.orderId,
        state: existing.state,
        note: "Duplicate idempotency key — no new external mutation performed.",
      };
    }

    // OWNERSHIP: an execution authorization is a capability token bound to its
    // issuer. Not-found and not-owned are indistinguishable (no ID oracle).
    const auth = await ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", args.authorizationId))
      .first();
    if (!auth || !canUseAuthorization(auth.ownerUserId, userId)) {
      return { deduped: false as const, orderId: null as string | null, state: "REJECTED" as const, note: "Authorization not found — order intent rejected before submission." };
    }

    // Symbol is SERVER-DERIVED from the market record — never client-trusted.
    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
      .first();
    const symbol = market?.symbol ?? "UNKNOWN";

    const intent: OrderIntent = {
      orderId: `ORD-${args.idempotencyKey}`,
      idempotencyKey: args.idempotencyKey,
      authorizationId: args.authorizationId,
      strategyVersionId: args.strategyVersionId,
      marketId: args.marketId,
      symbol,
      side: args.side,
      quantity: args.quantity,
      orderType: args.orderType,
      timeInForce: args.timeInForce,
      mode: auth.scope.mode,
    };

    const scopeCheck = validateAuthorizationScope(auth as never, intent, now);
    const state = await ctx.db.query("systemState").first();
    const lastCandle = await ctx.db
      .query("candles")
      .withIndex("by_market_tf_time", (q) => q.eq("marketId", args.marketId).eq("timeframe", "1h"))
      .order("desc")
      .first();
    // GLOBAL (all owners) BY DESIGN: an unresolved UNKNOWN order means the
    // shared paper account's external state is unknown, so new exposure is
    // blocked regardless of owner (fail-closed). Scoping this gate per owner
    // is a product-tenancy decision left open as a spec gap — it is not
    // silently weakened here.
    const allOrders = await ctx.db.query("orders").take(500);

    const precheck = runPrechecks(intent, {
      systemEnabled: state?.mode !== "DISABLED",
      killSwitchEngaged: state?.killSwitchEngaged ?? true,
      mode: state?.mode ?? "DISABLED",
      providerState: market?.providerState ?? "UNAVAILABLE",
      marketStatus: market?.status ?? "UNKNOWN",
      dataAgeMs: lastCandle ? now - lastCandle.availabilityTime : null,
      maxDataAgeMs: 2 * HOUR,
      now,
      existingIdempotencyKeys: allOrders.map((o) => o.idempotencyKey),
      unresolvedUnknownOrders: allOrders.filter((o) => o.state === "UNKNOWN").length,
    });

    const passed = scopeCheck.ok && precheck.ok;
    const history: { state: OrderState; at: number; note: string }[] = [];
    const push = (s: OrderState, at: number, note: string) =>
      history.push({ state: s, at, note });

    push("CREATED", now, "Order intent created from a scoped execution authorization.");
    push("VALIDATING", now + 1, scopeCheck.ok ? "Authorization scope validated." : `Scope validation FAILED: ${scopeCheck.checks.filter((c) => c.status !== "PASS").map((c) => c.check).join(", ")}`);

    type FinalState = "REJECTED" | "UNKNOWN" | "ACKNOWLEDGED" | "FILLED" | "PARTIALLY_FILLED";
    let finalState: FinalState = "REJECTED";
    let providerTruth: "ACCEPTED" | "REJECTED" | "NONE" = "NONE";
    let providerOrderId: string | undefined;
    let fillPrice: number | undefined;
    let fees: number | undefined;
    let slippage: number | undefined;
    let filledQuantity = 0;

    if (!passed) {
      push("REJECTED", now + 2, `Precheck/authorization failed (${[...scopeCheck.checks, ...precheck.checks].filter((c) => c.status !== "PASS").map((c) => `${c.check}:${c.status}`).join(", ")}). FAIL CLOSED — nothing submitted.`);
    } else {
      push("AUTHORIZED", now + 2, "Authorization valid and unexpired.");
      push("READY", now + 3, "Ready for submission.");
      push("SUBMITTING", now + 4, `Submitting to ${market?.provider ?? "provider"}.`);
      push("SUBMITTED", now + 5, "Submission issued to provider adapter.");

      // ATOMIC CONSUMPTION: one authorization -> exactly one order intent.
      // Convex mutations execute in a serializable transaction, so concurrent
      // duplicate use of one authorization cannot both pass this write.
      await ctx.db.patch(auth._id, { state: "CONSUMED", consumedByOrderId: intent.orderId });

      // Provider behavior is a SERVER-SIDE test/demo configuration
      // (systemState.simulatedProviderBehavior) — never a per-request client flag.
      const behavior = state?.simulatedProviderBehavior ?? "ACK";
      const lastClose = lastCandle?.close ?? 0;
      const resp = normalizeProviderResponse(
        behavior === "ACK"
          ? { kind: "ack", providerOrderId: `SIM-PROV-${now}` }
          : behavior === "REJECT"
            ? { kind: "reject", reason: "SIMULATED_PROVIDER_REJECT" }
            : behavior === "FILL"
              ? { kind: "fill", providerOrderId: `SIM-PROV-${now}`, price: lastClose }
              : behavior === "PARTIAL"
                ? {
                    kind: "partial_fill",
                    providerOrderId: `SIM-PROV-${now}`,
                    filled: args.quantity / 2,
                    remaining: args.quantity - args.quantity / 2,
                    price: lastClose,
                  }
                : { kind: "timeout" },
      );
      providerOrderId = behavior === "TIMEOUT" ? `SIM-PROV-${now}` : providerOrderId;
      providerTruth = behavior === "TIMEOUT" ? "ACCEPTED" : resp.providerTruth;
      finalState = resp.state as FinalState;
      push(resp.state, now + (behavior === "TIMEOUT" ? 90_000 : 6), resp.note);

      if (resp.state === "FILLED" || resp.state === "PARTIALLY_FILLED") {
        filledQuantity = resp.state === "FILLED" ? args.quantity : args.quantity / 2;
        const slip = lastClose * 0.0005;
        fillPrice = lastClose + (args.side === "BUY" ? slip : -slip);
        fees = fillPrice * filledQuantity * 0.001;
        slippage = slip * filledQuantity;

        // Canonical position accounting. `fillDelta` guards against duplicate
        // fill application (a repeated provider fill event adds 0).
        const delta = fillDelta(filledQuantity, 0);
        // Position rows are USER-OWNED: a fill only ever updates the caller's
        // own position. Shared SYSTEM rows (e.g. seeded demo positions) are
        // never merged into — a new owner-bound row is created instead.
        const existingPos = await ctx.db
          .query("positions")
          .withIndex("by_owner_market", (q) =>
            q.eq("ownerUserId", userId).eq("marketId", args.marketId),
          )
          .first();
        const prev: PositionState | null = existingPos
          ? {
              side: existingPos.side,
              quantity: existingPos.quantity,
              avgEntryPrice: existingPos.avgEntryPrice,
              realizedPnl: existingPos.realizedPnl,
            }
          : null;
        const next = applyFill(prev, { side: args.side, quantity: delta, price: fillPrice });
        if (existingPos) {
          await ctx.db.patch(existingPos._id, {
            side: next.side,
            quantity: next.quantity,
            avgEntryPrice: next.avgEntryPrice,
            realizedPnl: next.realizedPnl,
            updatedAt: now + 6,
          });
        } else {
          await ctx.db.insert("positions", {
            positionId: `POS-${args.idempotencyKey}`,
            account: `${auth.scope.mode}:paper-account`,
            marketId: args.marketId,
            symbol,
            side: next.side,
            quantity: next.quantity,
            avgEntryPrice: next.avgEntryPrice,
            realizedPnl: next.realizedPnl,
            source: "PAPER",
            updatedAt: now + 6,
            ownerUserId: userId,
          });
        }

        // Account-level risk accounting maintained server-side at fill time:
        // daily realized PnL (UTC day) and all-time peak equity.
        const realizedDelta = next.realizedPnl - (prev?.realizedPnl ?? 0);
        const allPositions = await ctx.db.query("positions").take(100);
        const totalRealized = allPositions.reduce((a, p) => a + p.realizedPnl, 0);
        const equityNow = PAPER_EQUITY_BASE + totalRealized;
        const dayKey = new Date(now).toISOString().slice(0, 10);
        const realizedPnlDay =
          state?.pnlDay === dayKey ? (state.realizedPnlDay ?? 0) + realizedDelta : realizedDelta;
        if (state) {
          await ctx.db.patch(state._id, {
            peakEquity: Math.max(state.peakEquity ?? PAPER_EQUITY_BASE, equityNow),
            pnlDay: dayKey,
            realizedPnlDay,
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.insert("orders", {
      orderId: intent.orderId,
      idempotencyKey: args.idempotencyKey,
      authorizationId: args.authorizationId,
      // Referential integrity: the order links to the REAL proposal the
      // authorization was issued for (never a fabricated id).
      proposalId: auth.proposalId,
      strategyVersionId: args.strategyVersionId,
      marketId: args.marketId,
      symbol,
      side: args.side,
      quantity: args.quantity,
      orderType: args.orderType,
      timeInForce: args.timeInForce,
      mode: auth.scope.mode as never,
      state: finalState as never,
      providerOrderId,
      providerTruth,
      fillPrice,
      fillQuantity: filledQuantity > 0 ? filledQuantity : undefined,
      fees,
      slippage,
      history,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now + 100_000,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "ORDER_STATE_RECORDED",
        resourceType: "order",
        resourceId: intent.orderId,
        outcome: finalState,
        correlationId: `PROP-${args.idempotencyKey}`,
        detail:
          finalState === "UNKNOWN"
            ? "Provider timeout after possible submission -> ORDER UNKNOWN. NOT assumed failed. NOT retried. Reconciliation required."
            : `Order ended in state ${finalState} (provider truth: ${providerTruth}). Authorization ${args.authorizationId} consumed atomically with this order intent (one authorization, one order).`,
      },
      now,
    );

    return { deduped: false as const, orderId: intent.orderId, state: finalState, note: history[history.length - 1].note };
  },
});

/**
 * RECONCILIATION — authoritative for external state (Sections 11/32).
 * Resolves UNKNOWN orders against the provider ledger BEFORE any retry is even
 * possible. Unreconciled state blocks unsafe new exposure.
 */
export const reconcile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    // OWNERSHIP: reconciliation only touches records the caller may act on —
    // their OWN orders plus shared SYSTEM records. A foreign UNKNOWN order is
    // its owner's to reconcile; it stays fail-closed for everyone else.
    const orders = (await ctx.db.query("orders").take(500)).filter((o) =>
      canViewRecord(o.ownerUserId, userId),
    );

    const resolved: { orderId: string; from: string; to: string }[] = [];
    const unresolved: string[] = [];

    for (const o of orders) {
      const needsReconciliation =
        o.state === "UNKNOWN" || o.state === "SUBMITTING" || o.state === "SUBMITTED";
      if (!needsReconciliation) continue;

      if (o.state === "UNKNOWN" && o.providerTruth === "ACCEPTED") {
        await ctx.db.patch(o._id, {
          state: "ACKNOWLEDGED",
          history: [
            ...o.history,
            {
              state: "ACKNOWLEDGED" as never,
              at: now,
              note: "RECONCILIATION: provider ledger shows ACCEPTED. Local state recovered — no duplicate submission was made.",
            },
          ],
          updatedAt: now,
        });
        resolved.push({ orderId: o.orderId, from: "UNKNOWN", to: "ACKNOWLEDGED" });
      } else if (o.state === "UNKNOWN" && o.providerTruth === "REJECTED") {
        await ctx.db.patch(o._id, {
          state: "REJECTED",
          history: [
            ...o.history,
            {
              state: "REJECTED" as never,
              at: now,
              note: "RECONCILIATION: provider ledger shows REJECTED.",
            },
          ],
          updatedAt: now,
        });
        resolved.push({ orderId: o.orderId, from: "UNKNOWN", to: "REJECTED" });
      } else if (o.state === "UNKNOWN") {
        unresolved.push(o.orderId); // provider truth itself unknown — remains UNKNOWN, never guessed
      }
    }

    const healthy = unresolved.length === 0;
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "RECONCILIATION_RUN",
        resourceType: "reconciliation",
        resourceId: `RECON-${now}`,
        outcome: healthy ? "HEALTHY" : "MISMATCH",
        correlationId: `RECON-${now}`,
        detail: healthy
          ? `Orders/fills/positions reconciled against provider ledger. Resolved: ${resolved.map((r) => `${r.orderId} ${r.from}->${r.to}`).join(", ") || "none"}.`
          : `Unresolved orders remain: ${unresolved.join(", ")}. NEW EXPOSURE IS BLOCKED until reconciliation succeeds.`,
      },
      now,
    );

    return { healthy, resolved, unresolved };
  },
});

// DECLARED validation configuration. The constitution forbids INVENTING split
// percentages and cost parameters; these values are declared constants flagged
// as SPEC-GAP-002/004 for ADR ratification and are versioned in every run.
export const DECLARED_VALIDATION_CONFIG = {
  oosSplitFraction: 0.3,
  startingEquity: 100000,
  periodsPerYear: 24 * 365,
};
export const DECLARED_COST: CostModel = {
  kind: "percentage",
  version: "sp-cost-1.0.0",
  feeRate: 0.001,
  slippageBps: 5,
};

/**
 * Runs the deterministic validation pipeline for an immutable strategy
 * version against a data snapshot. Rule 15: the version's definition and
 * provenance are NEVER patched here — only lifecycle status transitions.
 */
export const runValidation = mutation({
  args: { strategyVersionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();

    // OWNERSHIP: a validation run consumes a strategy version. Private
    // versions belong to their owner — not-found and not-owned are
    // indistinguishable (no IDOR oracle).
    const version = await ctx.db
      .query("strategyVersions")
      .withIndex("by_versionId", (q) => q.eq("strategyVersionId", args.strategyVersionId))
      .first();
    if (!version || !canViewRecord(version.ownerUserId, userId)) {
      return { ok: false as const, reason: "Strategy version not found." };
    }

    const definition = version.definition as StrategyDefinition;
    const candles = (await ctx.db
      .query("candles")
      .withIndex("by_market_tf_time", (q) =>
        q.eq("marketId", definition.marketId).eq("timeframe", definition.timeframe),
      )
      .take(1000))
      .map((c) => ({
        eventTime: c.eventTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        availabilityTime: c.availabilityTime,
        // Identity carried so snapshot binding can verify it (never assumed).
        marketId: c.marketId,
        timeframe: c.timeframe,
      }));

    const qualityRow = await ctx.db
      .query("dataQualityReports")
      .withIndex("by_market", (q) => q.eq("marketId", definition.marketId))
      .first();
    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", definition.marketId))
      .first();
    const snapshot = await ctx.db.query("dataSnapshots").first();
    const snapshotBinding: SnapshotBinding | null = snapshot
      ? {
          snapshotId: snapshot.snapshotId,
          marketIds: snapshot.marketIds,
          timeframe: snapshot.timeframe,
          rangeStart: snapshot.rangeStart,
          rangeEnd: snapshot.rangeEnd,
          dataVersion: snapshot.dataVersion,
        }
      : null;

    const run = runValidationPipeline({
      validationId: `VAL-${args.strategyVersionId}-${now}`,
      strategyVersionId: args.strategyVersionId,
      dataSnapshotId: snapshot?.snapshotId ?? "SNAP-UNKNOWN",
      definition,
      config: DECLARED_VALIDATION_CONFIG,
      cost: DECLARED_COST,
      snapshot: snapshotBinding,
      candles,
      quality: qualityRow
        ? { state: qualityRow.state, checks: qualityRow.checks, counts: qualityRow.counts }
        : { state: "MISSING", checks: [], counts: { candles: 0, duplicates: 0, gaps: 0, ohlcViolations: 0, invalidValues: 0 } },
      marketMeta: {
        marketId: definition.marketId,
        symbol: definition.symbol,
        timeframe: definition.timeframe,
        assetClass: market?.assetClass ?? "CRYPTO",
        spreadBps: market?.assetClass === "FOREX" ? 8 : 2,
        liquidityNote: "Synthetic venue; no book-depth feed",
      },
    });

    const validationId = `VAL-${args.strategyVersionId}-${now}`;
    await ctx.db.insert("validationRuns", {
      validationId,
      strategyVersionId: args.strategyVersionId,
      dataSnapshotId: snapshot?.snapshotId ?? "SNAP-UNKNOWN",
      validationConfigVersion: "sp-vconfig-1.0.0",
      engineVersion: "sp-sim-1.0.0",
      featureVersion: "sp-features-1.0.0",
      costModelVersion: DECLARED_COST.version,
      executionModelVersion: "sp-exec-nextopen-conservative-1.0.0",
      state: run.state as never,
      integrity: run.integrity,
      leakageState: run.leakageState as never,
      metrics: run.metrics,
      stress: run.stress,
      oos: run.oos,
      createdAt: now,
      completedAt: now,
      ownerUserId: userId,
    });

    if (run.evidence) {
      await ctx.db.insert("evidenceRecords", {
        evidenceId: `EV-${args.strategyVersionId}-${now}`,
        validationId,
        strategyVersionId: args.strategyVersionId,
        level: run.evidence.level as never,
        rubricVersion: run.evidence.rubricVersion,
        factors: run.evidence.factors,
        rationale: run.evidence.rationale,
        createdAt: now,
        ownerUserId: userId,
      });
    }
    if (run.fitness) {
      await ctx.db.insert("botFitnessRecords", {
        fitnessId: `FIT-${args.strategyVersionId}-${now}`,
        strategyVersionId: args.strategyVersionId,
        dimensions: run.fitness.dimensions,
        verdict: run.fitness.verdict,
        createdAt: now,
        ownerUserId: userId,
      });
    }

    // Lifecycle status ONLY. definition/provenance remain immutable (Rule 15).
    const eligible =
      run.state === "COMPLETED" &&
      (run.evidence?.level === "STRONG" || run.evidence?.level === "MODERATE") &&
      run.fitness?.verdict !== "UNSUITABLE";
    await ctx.db.patch(version._id, {
      status: eligible ? "DEPLOYMENT_ELIGIBLE" : "VALIDATION" as never,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "VALIDATION_COMPLETED",
        resourceType: "validationRun",
        resourceId: validationId,
        outcome: run.state,
        correlationId: validationId,
        detail: `Deterministic validation of ${args.strategyVersionId}: ${run.state}, evidence ${run.evidence?.level ?? "INSUFFICIENT"}, fitness ${run.fitness?.verdict ?? "INSUFFICIENT_DATA"}. Definition unchanged (immutable version).`,
      },
      now,
    );

    return {
      ok: true as const,
      validationId,
      state: run.state,
      evidenceLevel: run.evidence?.level ?? "INSUFFICIENT",
      fitnessVerdict: run.fitness?.verdict ?? "INSUFFICIENT_DATA",
      notes: run.notes,
    };
  },
});

/**
 * LEARNING (Section 13): record analysis + hypothesis. The ONLY strategy output
 * learning may produce is a NEW candidate version via proposeCandidateVersion.
 * There is no code path from learning to a live/validated version (Rule 8).
 */
export const recordLearningEvent = mutation({
  args: {
    orderId: v.optional(v.string()),
    failureClass: v.string(),
    analysis: v.string(),
    hypothesis: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const learningEventId = `LEARN-${now}`;
    await ctx.db.insert("learningEvents", {
      learningEventId,
      sourceOrderId: args.orderId,
      failureClass: args.failureClass as never,
      analysis: args.analysis,
      hypothesis: args.hypothesis,
      liveMutationAttempted: false,
      ownerUserId: userId,
      createdAt: now,
    });
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "LEARNING_EVENT_RECORDED",
        resourceType: "learningEvent",
        resourceId: learningEventId,
        outcome: "SUCCESS",
        correlationId: learningEventId,
        detail: `Failure class ${args.failureClass}. Live strategy NOT modified — learning has no live-mutation capability.`,
      },
      now,
    );
    return { learningEventId };
  },
});

/**
 * Creates a NEW IMMUTABLE candidate version with genealogy (parent/child).
 * The parent version is never touched. The candidate starts at PROPOSAL and
 * must pass validation again — learning output is not evidence.
 */
export const proposeCandidateVersion = mutation({
  args: {
    learningEventId: v.string(),
    params: v.object({
      fast: v.optional(v.number()),
      slow: v.optional(v.number()),
      stopLossPct: v.optional(v.number()),
      takeProfitPct: v.optional(v.number()),
      timeExitBars: v.optional(v.number()),
      rsiMin: v.optional(v.number()),
      rsiMax: v.optional(v.number()),
      fraction: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const learning = await ctx.db
      .query("learningEvents")
      .withIndex("by_learningEventId", (q) => q.eq("learningEventId", args.learningEventId))
      .first();
    // Ownership: a user may only derive candidates from their own learning
    // events (or shared SYSTEM records). Never another user's records.
    if (!learning || !canViewRecord(learning.ownerUserId, userId)) {
      return { ok: false as const, reason: "Learning event not found." };
    }

    const sourceOrder = learning.sourceOrderId
      ? await ctx.db
          .query("orders")
          .filter((q) => q.eq(q.field("orderId"), learning.sourceOrderId))
          .first()
      : null;
    const parent = sourceOrder
      ? await ctx.db
          .query("strategyVersions")
          .withIndex("by_versionId", (q) => q.eq("strategyVersionId", sourceOrder.strategyVersionId))
          .first()
      : null;
    if (!parent) {
      return { ok: false as const, reason: "No parent strategy version identifiable — candidate creation refused (no guessing)." };
    }

    const parentDef = parent.definition as StrategyDefinition;
    const nextVersionNumber = parent.version + 1;
    const strategyVersionId = `${parent.strategyId}-V${nextVersionNumber}-${now}`;

    // Structured parameter deltas only — no executable code is ever created.
    const definition: StrategyDefinition = {
      ...parentDef,
      entry: {
        indicator: "ema_cross",
        fast: args.params.fast ?? parentDef.entry.fast,
        slow: args.params.slow ?? parentDef.entry.slow,
      },
      exit: {
        stopLossPct: args.params.stopLossPct ?? parentDef.exit.stopLossPct,
        takeProfitPct: args.params.takeProfitPct ?? parentDef.exit.takeProfitPct,
        timeExitBars: args.params.timeExitBars ?? parentDef.exit.timeExitBars,
      },
      filters: {
        rsiMin: args.params.rsiMin ?? parentDef.filters.rsiMin,
        rsiMax: args.params.rsiMax ?? parentDef.filters.rsiMax,
      },
      sizing: {
        kind: "fixed_fraction",
        fraction: args.params.fraction ?? parentDef.sizing.fraction,
      },
    };

    await ctx.db.insert("strategyVersions", {
      strategyVersionId,
      strategyId: parent.strategyId,
      version: nextVersionNumber,
      parentVersionId: parent.strategyVersionId,
      status: "PROPOSAL" as never,
      immutable: true,
      definition,
      provenance: {
        authorType: "AI" as never,
        authorRef: "learning-agent",
        rationale: `Candidate derived from learning event ${args.learningEventId}: ${learning.hypothesis}`,
        modelProvider: "NOT_CONFIGURED",
        modelVersion: "NOT_CONFIGURED",
        promptConfigVersion: "NOT_CONFIGURED",
        createdAt: now,
      },
      // The candidate is created by the caller — a private record until a
      // lifecycle process explicitly shares it.
      ownerUserId: userId,
    });

    await ctx.db.patch(learning._id, { candidateStrategyVersionId: strategyVersionId });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "STRATEGY_VERSION_CREATED",
        resourceType: "strategyVersion",
        resourceId: strategyVersionId,
        outcome: "SUCCESS",
        correlationId: args.learningEventId,
        detail: `New candidate version ${nextVersionNumber} created from parent ${parent.strategyVersionId} (genealogy preserved). Parent unchanged. Candidate must be validated before any trust exists.`,
      },
      now,
    );

    return { ok: true as const, strategyVersionId, parentVersionId: parent.strategyVersionId };
  },
});

/**
 * KILL SWITCH (Section 10): authenticated, authorized, audited, observable.
 * Distinct from cancel/close/reduce: it halts NEW execution globally.
 * There is no admin bypass of the risk veto — engaging only ever restricts.
 */
export const setKillSwitch = mutation({
  args: { engaged: v.boolean(), reason: v.string() },
  handler: async (ctx, args) => {
    const { userId, role, isAnonymous } = await requireActor(ctx);
    const now = Date.now();

    // The kill switch is GLOBAL. Anonymous guest sessions are free to create,
    // so they must never be able to change it: engaging is a griefing/DoS
    // vector against everyone, releasing is a privilege.
    if (isAnonymous && !requireRole(role, "admin")) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "KILL_SWITCH_CHANGE_DENIED",
          resourceType: "systemState",
          resourceId: "global",
          outcome: "DENIED",
          correlationId: `KILL-${now}`,
          detail: "Refused: anonymous guest sessions cannot change the global kill switch.",
        },
        now,
      );
      return {
        ok: false as const,
        reason: "Sign in with a verified account to change the kill switch.",
      };
    }

    if (!args.engaged) {
      // PRIVILEGED: resuming global execution requires the admin role
      // (fail-safe direction: ENGAGING is always allowed for verified
      // accounts, releasing is not).
      if (!requireRole(role, "admin")) {
        await appendAudit(
          ctx,
          {
            actor: `user:${userId}`,
            actorType: "USER",
            action: "KILL_SWITCH_RELEASE_DENIED",
            resourceType: "systemState",
            resourceId: "global",
            outcome: "DENIED",
            correlationId: `KILL-${now}`,
            detail: `Release refused: admin role required to resume global execution (caller role: ${role ?? "none"}).`,
          },
          now,
        );
        return { ok: false as const, reason: "Admin role required to release the kill switch." };
      }
      // Releasing ALSO requires healthy reconciliation — fail closed otherwise.
      const unknownOrders = (await ctx.db.query("orders").take(500)).filter(
        (o) => o.state === "UNKNOWN",
      );
      if (unknownOrders.length > 0) {
        await appendAudit(
          ctx,
          {
            actor: `user:${userId}`,
            actorType: "USER",
            action: "KILL_SWITCH_RELEASE_DENIED",
            resourceType: "systemState",
            resourceId: "global",
            outcome: "DENIED",
            correlationId: `KILL-${now}`,
            detail: `Release refused: ${unknownOrders.length} order(s) in UNKNOWN state must be reconciled first.`,
          },
          now,
        );
        return { ok: false as const, reason: "UNKNOWN orders outstanding — reconcile before release." };
      }
    }

    const state = await ctx.db.query("systemState").first();
    if (!state) return { ok: false as const, reason: "System state missing — fail closed." };
    await ctx.db.patch(state._id, {
      killSwitchEngaged: args.engaged,
      killSwitchReason: args.reason,
      updatedAt: now,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: args.engaged ? "KILL_SWITCH_ENGAGED" : "KILL_SWITCH_RELEASED",
        resourceType: "systemState",
        resourceId: "global",
        outcome: args.engaged ? "ENGAGED" : "RELEASED",
        correlationId: `KILL-${now}`,
        detail: `Kill switch ${args.engaged ? "ENGAGED" : "RELEASED"}: ${args.reason}`,
      },
      now,
    );

    return { ok: true as const, engaged: args.engaged };
  },
});

// ---------------------------------------------------------------------------
// PRIVILEGED CONFIGURATION (Section 12: privileged changes are admin-only,
// audited, and fail closed). SPEC-GAP-008: role provisioning is unspecified —
// the initial admin must be provisioned out-of-band (e.g. Convex dashboard).
// ---------------------------------------------------------------------------

/** Permission changes are security-sensitive: admin-only + audited. */
export const grantRole = mutation({
  args: {
    targetUserId: v.string(),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, role } = await requireActor(ctx);
    const now = Date.now();
    if (!requireRole(role, "admin")) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "ROLE_CHANGE_DENIED",
          resourceType: "user",
          resourceId: args.targetUserId,
          outcome: "DENIED",
          correlationId: `ROLE-${now}`,
          detail: `Role change refused: admin role required (caller role: ${role ?? "none"}).`,
        },
        now,
      );
      return { ok: false as const, reason: "Admin role required to change roles." };
    }
    const target = await ctx.db.get(args.targetUserId as never);
    if (!target) return { ok: false as const, reason: "Target user not found." };
    await ctx.db.patch(target._id, { role: args.role } as never);
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "ROLE_CHANGED",
        resourceType: "user",
        resourceId: args.targetUserId,
        outcome: "SUCCESS",
        correlationId: `ROLE-${now}`,
        detail: `Role set to ${args.role}: ${args.reason}`,
      },
      now,
    );
    return { ok: true as const };
  },
});

/**
 * Records the RATIFICATION of an existing risk-policy version's declared
 * limits. Values are never modified here (numerics are fixed by the ADR that
 * ratifies them). SPEC-GAP-002: the external approval authority/process is not
 * specified in-app — this mutation only records that ratification occurred.
 */
export const approveRiskPolicy = mutation({
  args: { policyId: v.string(), version: v.number(), attestation: v.string() },
  handler: async (ctx, args) => {
    const { userId, role } = await requireActor(ctx);
    const now = Date.now();
    if (!requireRole(role, "admin")) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "RISK_POLICY_APPROVAL_DENIED",
          resourceType: "riskPolicy",
          resourceId: `${args.policyId}@v${args.version}`,
          outcome: "DENIED",
          correlationId: `POL-${now}`,
          detail: `Policy approval refused: admin role required (caller role: ${role ?? "none"}).`,
        },
        now,
      );
      return { ok: false as const, reason: "Admin role required to approve risk policies." };
    }
    const policy = await ctx.db
      .query("riskPolicies")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .first();
    if (!policy || policy.version !== args.version) {
      return { ok: false as const, reason: "Risk policy version not found." };
    }
    if (policy.status === "APPROVED") {
      return { ok: false as const, reason: "Policy version is already APPROVED." };
    }
    await ctx.db.patch(policy._id, {
      status: "APPROVED",
      provenanceNote: `${policy.provenanceNote} | RATIFIED ${new Date(now).toISOString()} by user:${userId}: ${args.attestation}`,
    });
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "RISK_POLICY_APPROVED",
        resourceType: "riskPolicy",
        resourceId: `${args.policyId}@v${args.version}`,
        outcome: "SUCCESS",
        correlationId: `POL-${now}`,
        detail: `Risk policy ${args.policyId}@v${args.version} ratified (limits unchanged). Attestation: ${args.attestation}`,
      },
      now,
    );
    return { ok: true as const };
  },
});

/**
 * Controlled TEST/DEMO configuration: the behavior of the SIMULATED provider
 * adapter. Admin-gated, mode-gated (PAPER/DEMO only — there is NO way to
 * select simulation behavior in a live-capable mode), audited.
 */
export const setSimulatedProviderBehavior = mutation({
  args: {
    behavior: v.union(
      v.literal("ACK"),
      v.literal("FILL"),
      v.literal("PARTIAL"),
      v.literal("REJECT"),
      v.literal("TIMEOUT"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, role } = await requireActor(ctx);
    const now = Date.now();
    const state = await ctx.db.query("systemState").first();
    const mode = state?.mode ?? "DISABLED";
    if (mode !== "PAPER" && mode !== "DEMO") {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "SIMULATION_CONFIG_DENIED",
          resourceType: "systemState",
          resourceId: "global",
          outcome: "DENIED",
          correlationId: `SIMCFG-${now}`,
          detail: `Simulation behavior change refused in mode ${mode} (PAPER/DEMO only).`,
        },
        now,
      );
      return { ok: false as const, reason: "Simulation behavior can only be configured in PAPER/DEMO modes." };
    }
    if (!requireRole(role, "admin")) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "SIMULATION_CONFIG_DENIED",
          resourceType: "systemState",
          resourceId: "global",
          outcome: "DENIED",
          correlationId: `SIMCFG-${now}`,
          detail: `Simulation behavior change refused: admin role required (caller role: ${role ?? "none"}).`,
        },
        now,
      );
      return { ok: false as const, reason: "Admin role required to change simulation configuration." };
    }
    if (!state) return { ok: false as const, reason: "System state missing — fail closed." };
    await ctx.db.patch(state._id, { simulatedProviderBehavior: args.behavior, updatedAt: now });
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "SIMULATION_CONFIG_CHANGED",
        resourceType: "systemState",
        resourceId: "global",
        outcome: "SUCCESS",
        correlationId: `SIMCFG-${now}`,
        detail: `Simulated provider behavior set to ${args.behavior} (mode ${mode}): ${args.reason}`,
      },
      now,
    );
    return { ok: true as const, behavior: args.behavior };
  },
});
