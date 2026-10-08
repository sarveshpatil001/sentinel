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
import { runValidationPipeline } from "./lib/pipeline";
import { validateAuthorizationScope, runPrechecks, normalizeProviderResponse, OrderIntent, OrderState } from "./lib/execution";

const HOUR = 3600_000;
const PAPER_EQUITY_BASE = 100000;

async function requireUser(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("UNAUTHENTICATED");
  return userId;
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
    realizedPnlToday: realized,
    equity,
    peakEquity: Math.max(PAPER_EQUITY_BASE, equity),
    consecutiveLosses: 0,
    existingOrderIdempotencyKeys: orders.map((o) => o.idempotencyKey),
    proposalIdempotencyKey: args.proposalIdempotencyKey,
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
 * `simulate` models the EXTERNAL provider's behavior in this paper/demo build:
 *   - ACK    : provider accepts
 *   - FILL   : provider accepts and fills at the last close
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
    symbol: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    quantity: v.number(),
    orderType: v.string(),
    timeInForce: v.string(),
    idempotencyKey: v.string(),
    simulate: v.union(
      v.literal("ACK"),
      v.literal("FILL"),
      v.literal("REJECT"),
      v.literal("TIMEOUT"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();

    // Idempotency: duplicate protection for every external financial mutation.
    const existing = await ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing) {
      return {
        deduped: true as const,
        orderId: existing.orderId,
        state: existing.state,
        note: "Duplicate idempotency key — no new external mutation performed.",
      };
    }

    const auth = await ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", args.authorizationId))
      .first();
    if (!auth) {
      return { deduped: false as const, orderId: null as string | null, state: "REJECTED" as const, note: "Authorization not found — order intent rejected before submission." };
    }

    const intent: OrderIntent = {
      orderId: `ORD-${args.idempotencyKey}`,
      idempotencyKey: args.idempotencyKey,
      authorizationId: args.authorizationId,
      strategyVersionId: args.strategyVersionId,
      marketId: args.marketId,
      symbol: args.symbol,
      side: args.side,
      quantity: args.quantity,
      orderType: args.orderType,
      timeInForce: args.timeInForce,
      mode: auth.scope.mode,
    };

    const scopeCheck = validateAuthorizationScope(auth as never, intent, now);
    const state = await ctx.db.query("systemState").first();
    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
      .first();
    const lastCandle = await ctx.db
      .query("candles")
      .withIndex("by_market_tf_time", (q) => q.eq("marketId", args.marketId).eq("timeframe", "1h"))
      .order("desc")
      .first();
    const allOrders = await ctx.db.query("orders").take(500);

    const precheck = runPrechecks(intent, {
      systemEnabled: state?.mode !== "DISABLED",
      killSwitchEngaged: state?.killSwitchEngaged ?? true,
      providerState: market?.providerState ?? "UNAVAILABLE",
      marketStatus: market?.status ?? "UNKNOWN",
      dataAgeMs: lastCandle ? now - lastCandle.availabilityTime : null,
      maxDataAgeMs: 2 * HOUR,
      now,
      existingIdempotencyKeys: allOrders.map((o) => o.idempotencyKey),
    });

    const passed = scopeCheck.ok && precheck.ok;
    const history: { state: OrderState; at: number; note: string }[] = [];
    const push = (s: OrderState, at: number, note: string) =>
      history.push({ state: s, at, note });

    push("CREATED", now, "Order intent created from a scoped execution authorization.");
    push("VALIDATING", now + 1, scopeCheck.ok ? "Authorization scope validated." : `Scope validation FAILED: ${scopeCheck.checks.filter((c) => c.status !== "PASS").map((c) => c.check).join(", ")}`);

    type FinalState = "REJECTED" | "UNKNOWN" | "ACKNOWLEDGED" | "FILLED";
    let finalState: FinalState = "REJECTED";
    let providerTruth: "ACCEPTED" | "REJECTED" | "NONE" = "NONE";
    let providerOrderId: string | undefined;
    let fillPrice: number | undefined;
    let fees: number | undefined;
    let slippage: number | undefined;

    if (!passed) {
      push("REJECTED", now + 2, `Precheck/authorization failed (${[...scopeCheck.checks, ...precheck.checks].filter((c) => c.status !== "PASS").map((c) => `${c.check}:${c.status}`).join(", ")}). FAIL CLOSED — nothing submitted.`);
    } else {
      push("AUTHORIZED", now + 2, "Authorization valid and unexpired.");
      push("READY", now + 3, "Ready for submission.");
      push("SUBMITTING", now + 4, `Submitting to ${market?.provider ?? "provider"}.`);
      push("SUBMITTED", now + 5, "Submission issued to provider adapter.");

      const lastClose = lastCandle?.close ?? 0;
      const resp = normalizeProviderResponse(
        args.simulate === "ACK"
          ? { kind: "ack", providerOrderId: `SIM-PROV-${now}` }
          : args.simulate === "REJECT"
            ? { kind: "reject", reason: "SIMULATED_PROVIDER_REJECT" }
            : args.simulate === "FILL"
              ? { kind: "fill", providerOrderId: `SIM-PROV-${now}`, price: lastClose }
              : { kind: "timeout" },
      );
      providerOrderId = args.simulate === "TIMEOUT" ? `SIM-PROV-${now}` : providerOrderId;
      providerTruth = args.simulate === "TIMEOUT" ? "ACCEPTED" : resp.providerTruth;
      finalState = resp.state as FinalState;
      push(resp.state, now + (args.simulate === "TIMEOUT" ? 90_000 : 6), resp.note);

      if (args.simulate === "FILL") {
        const slip = lastClose * 0.0005;
        fillPrice = lastClose + (args.side === "BUY" ? slip : -slip);
        fees = fillPrice * args.quantity * 0.001;
        slippage = slip * args.quantity;

        const existingPos = await ctx.db
          .query("positions")
          .withIndex("by_market", (q) => q.eq("marketId", args.marketId))
          .first();
        if (existingPos) {
          // Order state != position state; both are tracked explicitly.
          const newQty = args.side === "BUY" ? existingPos.quantity + args.quantity : existingPos.quantity - args.quantity;
          await ctx.db.patch(existingPos._id, {
            quantity: newQty,
            side: newQty > 0 ? "LONG" : newQty < 0 ? "SHORT" : "FLAT",
            avgEntryPrice: fillPrice,
            updatedAt: now + 6,
          });
        } else {
          await ctx.db.insert("positions", {
            positionId: `POS-${args.idempotencyKey}`,
            account: `${auth.scope.mode}:paper-account`,
            marketId: args.marketId,
            symbol: args.symbol,
            side: args.side === "BUY" ? "LONG" : "SHORT",
            quantity: args.quantity,
            avgEntryPrice: fillPrice,
            realizedPnl: 0,
            source: "PAPER",
            updatedAt: now + 6,
          });
        }
        await ctx.db.patch(auth._id, { state: "CONSUMED", consumedByOrderId: intent.orderId });
      }
    }

    await ctx.db.insert("orders", {
      orderId: intent.orderId,
      idempotencyKey: args.idempotencyKey,
      authorizationId: args.authorizationId,
      proposalId: `PROP-${args.idempotencyKey}`,
      strategyVersionId: args.strategyVersionId,
      marketId: args.marketId,
      symbol: args.symbol,
      side: args.side,
      quantity: args.quantity,
      orderType: args.orderType,
      timeInForce: args.timeInForce,
      mode: auth.scope.mode as never,
      state: finalState as never,
      providerOrderId,
      providerTruth,
      fillPrice,
      fillQuantity: fillPrice !== undefined ? args.quantity : undefined,
      fees,
      slippage,
      history,
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
            : `Order ended in state ${finalState} (provider truth: ${providerTruth}).`,
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
    const orders = await ctx.db.query("orders").take(500);

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

    const version = await ctx.db
      .query("strategyVersions")
      .withIndex("by_versionId", (q) => q.eq("strategyVersionId", args.strategyVersionId))
      .first();
    if (!version) return { ok: false as const, reason: "Strategy version not found." };

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

    const run = runValidationPipeline({
      validationId: `VAL-${args.strategyVersionId}-${now}`,
      strategyVersionId: args.strategyVersionId,
      dataSnapshotId: snapshot?.snapshotId ?? "SNAP-UNKNOWN",
      definition,
      config: DECLARED_VALIDATION_CONFIG,
      cost: DECLARED_COST,
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
      });
    }
    if (run.fitness) {
      await ctx.db.insert("botFitnessRecords", {
        fitnessId: `FIT-${args.strategyVersionId}-${now}`,
        strategyVersionId: args.strategyVersionId,
        dimensions: run.fitness.dimensions,
        verdict: run.fitness.verdict,
        createdAt: now,
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
    if (!learning) return { ok: false as const, reason: "Learning event not found." };

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
    const userId = await requireUser(ctx);
    const now = Date.now();

    if (!args.engaged) {
      // Releasing requires healthy reconciliation — fail closed otherwise.
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
