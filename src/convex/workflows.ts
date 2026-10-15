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
import {
  validateAuthorizationScope,
  runPrechecks,
  normalizeProviderResponse,
  classifyOrderReconciliation,
  UNRESOLVED_SUBMISSION_STATES,
  OrderIntent,
  OrderState,
} from "./lib/execution";
import { canUseAuthorization, canViewRecord, requireRole } from "./lib/authz";
import { sha256Hex } from "./lib/audit";
import {
  applyFill,
  fillDelta,
  closedQuantity,
  classifyRealizedOutcome,
  computeLossStreak,
  unrealizedPnl,
  PositionState,
} from "./lib/positions";
import type { Doc } from "./_generated/dataModel";

const HOUR = 3600_000;
const PAPER_EQUITY_BASE = 100000;

// BOUNDED-SCAN SAFETY: safety-relevant reads must be COMPLETE at any database
// size and record age — never a bounded scan that silently undercounts
// exposure. Convex allows at most 16,384 documents per query and only one
// paginated query per function execution, so unbounded aggregation inside a
// single transaction is not possible. The enforced rule throughout this file:
//  - prefer INDEXED existence checks (complete at any table size), and
//  - where a scan is unavoidable, detect saturation explicitly: if a capped
//    scan returns the full cap, completeness CANNOT be established — the risk
//    context reports `accountStateComplete: false` and the engine fails
//    CLOSED (UNKNOWN -> no new exposure), never a silent undercount.
const SCAN_CAP = 2000;

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

/**
 * RISK-SCOPE POSITION READS (G2 tenant risk isolation).
 *
 * A customer's risk inputs are their OWN positions PLUS shared SYSTEM demo
 * rows — exactly `canViewRecord` semantics (the shared SYSTEM workspace is
 * explicitly authorized for every customer; see lib/authz.ts). NEVER another
 * customer's rows: another customer's positions or losses must not change
 * this customer's risk verdict.
 *
 * Both reads are INDEXED and saturation-detected PER SCOPE (`by_owner_market`
 * prefix; Convex indexes include documents missing the field, matched with
 * `.eq(..., undefined)`), so another customer's row volume can never affect
 * this scope's completeness. Saturation at SCAN_CAP fails CLOSED.
 */
export interface RiskScopePosition {
  marketId: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  avgEntryPrice: number;
  realizedPnl: number;
}

async function readRiskScopePositions(
  ctx: MutationCtx,
  accountOwnerUserId: string,
): Promise<{ rows: RiskScopePosition[]; complete: boolean }> {
  const own = await ctx.db
    .query("positions")
    .withIndex("by_owner_market", (q) => q.eq("ownerUserId", accountOwnerUserId))
    .take(SCAN_CAP);
  const shared = await ctx.db
    .query("positions")
    .withIndex("by_owner_market", (q) => q.eq("ownerUserId", undefined))
    .take(SCAN_CAP);
  return {
    rows: [...own, ...shared],
    complete: own.length < SCAN_CAP && shared.length < SCAN_CAP,
  };
}

/** Per-customer accounting ledger (daily PnL, peak equity). */
async function readRiskAccountState(ctx: MutationCtx, accountOwnerUserId: string) {
  return await ctx.db
    .query("riskAccountState")
    .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", accountOwnerUserId))
    .first();
}

/**
 * UNRESOLVED-SUBMISSION GATE READ (findings A/B/D4, one shared policy with
 * lib/execution.ts UNRESOLVED_SUBMISSION_STATES).
 *
 * DECISION A (docs/execution-architecture-decisions.md, re-ratified by the
 * post-fix audit): the exposure gate is ACCOUNT-GLOBAL and fail-closed. The
 * account is derived from `mode` per the authorization-scope contract
 * (`<mode>:paper-account`). While ANY order on the execution account is in an
 * unresolved submission state — SUBMITTING / SUBMITTED / UNKNOWN, ANY owner —
 * the account's true exposure is unknown and risk-increasing action on that
 * account is blocked. Unrelated accounts are never scanned: their row volume
 * can never degrade this account's completeness.
 *
 * BOUNDED-SCAN SAFETY: INDEXED per-mode-per-state reads via `by_mode_state`,
 * with saturation detected PER STATE. At/above the cap the exact count is
 * unknown -> `complete: false` -> the engine fails CLOSED (never a silent
 * undercount).
 */
async function scanUnresolvedAccountOrders(
  ctx: MutationCtx,
  accountMode: Doc<"orders">["mode"],
): Promise<{ rows: Doc<"orders">[]; count: number; complete: boolean }> {
  const rows: Doc<"orders">[] = [];
  let complete = true;
  for (const state of UNRESOLVED_SUBMISSION_STATES) {
    const found = await ctx.db
      .query("orders")
      .withIndex("by_mode_state", (q) => q.eq("mode", accountMode).eq("state", state))
      .take(SCAN_CAP);
    rows.push(...found);
    if (found.length >= SCAN_CAP) complete = false;
  }
  return { rows, count: rows.length, complete };
}

/**
 * ACTIONABLE unresolved-submission read (Decision B): own + shared SYSTEM
 * rows — the records this caller may reconcile (never another customer's
 * rows; not-found == not-owned, no cross-user leak). Indexed per-owner-
 * per-state reads with per-scope saturation detection.
 */
async function scanUnresolvedOwnedOrders(
  ctx: MutationCtx,
  accountOwnerUserId: string,
): Promise<{ rows: Doc<"orders">[]; complete: boolean }> {
  const rows: Doc<"orders">[] = [];
  let complete = true;
  for (const owner of [accountOwnerUserId, undefined]) {
    for (const state of UNRESOLVED_SUBMISSION_STATES) {
      const found = await ctx.db
        .query("orders")
        .withIndex("by_owner_state", (q) => q.eq("ownerUserId", owner).eq("state", state))
        .take(SCAN_CAP);
      rows.push(...found);
      if (found.length >= SCAN_CAP) complete = false;
    }
  }
  return { rows, complete };
}

/**
 * LOSS-STREAK READ (finding C): the owner's persisted realized trade outcomes,
 * newest first, walked by the documented policy (lib/positions.ts
 * computeLossStreak). Bounded at SCAN_CAP with explicit saturation detection —
 * an unestablishable streak is NEVER silently substituted as zero: the read
 * reports `complete: false` and the engine fails closed upstream.
 *
 * DECISION C (docs/execution-architecture-decisions.md): the loss streak is a
 * OWNER-SCOPED BEHAVIORAL limit — it counts the completed trades of ONE
 * decision-maker. Shared SYSTEM fixture outcomes (e.g. the seeded demo
 * workspace) belong to no decision-maker: they are RECORDED in the ledger for
 * completeness/audit but deliberately NEVER read here, so demo data can
 * neither mask a real losing run nor fabricate one. Per-owner sequence gap
 * detection requires exactly this single-owner ledger.
 */
async function readLossStreak(ctx: MutationCtx, accountOwnerUserId: string) {
  const rows = await ctx.db
    .query("realizedTradeOutcomes")
    .withIndex("by_owner_seq", (q) => q.eq("ownerUserId", accountOwnerUserId))
    .order("desc")
    .take(SCAN_CAP);
  return computeLossStreak(
    rows.map((r) => ({ seq: r.seq, outcome: r.outcome })),
    rows.length < SCAN_CAP,
  );
}

// MARK-TO-MARKET VALUATION (finding D). Mark price = the market's latest
// CLOSED 1h close (the repository's canonical price series — the same series
// the execution path prices fills from), valid only when finite, positive and
// FRESH within the existing execution staleness bound (2h — the same bound
// placeOrder's precheck enforces; no new threshold is invented).
const MARK_MAX_AGE_MS = 2 * HOUR;
// Engineering bound on mark-price fan-out: at most this many distinct open
// markets are valued inside one transaction; beyond it the valuation is
// reported INCOMPLETE (fail closed) rather than silently skipping markets.
const MARKET_FANOUT_CAP = 256;

// CANDLE ELIGIBILITY FOR RISK PRICES (V4c): every candle-selection path used
// for mark-to-market valuation and fill pricing goes through this helper. A
// bar flagged INCOMPLETE is never an eligible price source, and an eligible
// bar must still carry a finite, positive close. The newest-first walk is
// bounded (eligibility window); if no eligible bar exists the answer is null
// — never a filler price — and the callers fail CLOSED (valuation incomplete /
// data freshness blocked).
const CANDLE_ELIGIBILITY_WINDOW = 50;

async function latestEligibleCandle(ctx: MutationCtx, marketId: string) {
  const rows = await ctx.db
    .query("candles")
    .withIndex("by_market_tf_time", (q) =>
      q.eq("marketId", marketId).eq("timeframe", "1h"),
    )
    .order("desc")
    .take(CANDLE_ELIGIBILITY_WINDOW);
  for (const c of rows) {
    if (c.qualityStatus === "INCOMPLETE") continue;
    if (!Number.isFinite(c.close) || c.close <= 0) continue;
    return c;
  }
  return null;
}

/**
 * Mark-to-market unrealized PnL over a risk scope. Absent, stale or invalid
 * marks are NEVER treated as zero unrealized PnL: the valuation is reported
 * incomplete and the risk engine fails closed (no new exposure).
 */
async function valueScopePositions(
  ctx: MutationCtx,
  rows: RiskScopePosition[],
  now: number,
): Promise<{ unrealized: number; complete: boolean }> {
  const openRows = rows.filter((p) => p.quantity > 0);
  const markets = [...new Set(openRows.map((p) => p.marketId))];
  if (markets.length > MARKET_FANOUT_CAP) return { unrealized: 0, complete: false };
  let unrealized = 0;
  for (const marketId of markets) {
    // V4c: only ELIGIBLE candles may price a position — the newest INCOMPLETE
    // bar can never override an older eligible one (and if none is eligible
    // the mark is null -> the valuation is honestly incomplete).
    const mark = await latestEligibleCandle(ctx, marketId);
    const markPrice =
      mark &&
      Number.isFinite(mark.close) &&
      mark.close > 0 &&
      Number.isFinite(mark.availabilityTime) &&
      mark.availabilityTime >= 0 &&
      now - mark.availabilityTime <= MARK_MAX_AGE_MS
        ? mark.close
        : null;
    for (const p of openRows.filter((r) => r.marketId === marketId)) {
      const u = unrealizedPnl(p, markPrice);
      if (u === null) return { unrealized, complete: false };
      unrealized += u;
    }
  }
  return { unrealized, complete: true };
}

/**
 * REALIZED TRADE OUTCOME RECORD (finding C) — one row per REALIZATION EVENT
 * (a fill application that closed a positive portion of a position).
 *
 * Idempotent by STABLE event id (`outcomeId` = order id + the provider's
 * cumulative filled quantity): repeated fills, retried mutations and repeated
 * reconciliation can never count the same realized result twice. `seq` is a
 * per-owner monotonic sequence (gap detection at read time). Written in the
 * SAME Convex transaction as the position/ledger accounting of the same fill
 * (atomic with the accounting event).
 *
 * Exported for the regression battery (direct idempotency exercise).
 */
export async function recordRealizedOutcome(
  ctx: MutationCtx,
  args: {
    outcomeId: string;
    ownerUserId: string;
    orderId: string;
    marketId: string;
    realizedPnl: number;
    outcome: "WIN" | "LOSS" | "BREAKEVEN";
    closedQuantity: number;
    at: number;
  },
): Promise<{ recorded: boolean }> {
  const existing = await ctx.db
    .query("realizedTradeOutcomes")
    .withIndex("by_outcomeId", (q) => q.eq("outcomeId", args.outcomeId))
    .first();
  if (existing) return { recorded: false }; // duplicate event — never counted twice
  const newest = await ctx.db
    .query("realizedTradeOutcomes")
    .withIndex("by_owner_seq", (q) => q.eq("ownerUserId", args.ownerUserId))
    .order("desc")
    .first();
  await ctx.db.insert("realizedTradeOutcomes", {
    outcomeId: args.outcomeId,
    ownerUserId: args.ownerUserId,
    orderId: args.orderId,
    marketId: args.marketId,
    realizedPnl: args.realizedPnl,
    outcome: args.outcome,
    closedQuantity: args.closedQuantity,
    seq: (newest?.seq ?? 0) + 1,
    createdAt: args.at,
  });
  return { recorded: true };
}

/**
 * CUMULATIVE PROVIDER-FILL ACCOUNTING (findings D1/D2) — the ONE accounting
 * path every provider fill goes through (order placement AND reconciliation).
 *
 * Authoritative cumulative accounting: `orders.fillAppliedQuantity` persists
 * how much of the provider's cumulative `fillQuantity` has already been
 * accounted. Only the difference (`fillDelta`) may touch the ledger, so a
 * repeated, replayed or concurrently re-scanned fill event can NEVER
 * double-count in any accounting record (position, realized PnL,
 * realizedTradeOutcomes, riskAccountState). The realized-outcome event uses
 * the STABLE id `OUT-<orderId>-<cumulativeFilled>` and is written in the SAME
 * transaction as the position/ledger accounting it describes (atomic).
 *
 * Fail-closed: unaccountable input — ownerless (shared SYSTEM) orders (no
 * customer ledger to account into), non-finite/out-of-range quantities,
 * unusable prices, or persisted applied-quantity inconsistency — is REFUSED
 * and NOTHING is applied. The caller must then keep the order unresolved
 * (never resolve an order carrying unapplied fill data).
 */
async function applyProviderFill(
  ctx: MutationCtx,
  order: Doc<"orders">,
  fill: { cumulativeFilled: number; price: number },
  now: number,
): Promise<{ applied: boolean; delta: number; reason?: string }> {
  const refusal = (reason: string) => ({ applied: false as const, delta: 0, reason });
  if (!order.ownerUserId) {
    return refusal(
      "ownerless (shared SYSTEM) order fills cannot be attributed to a customer ledger — fail closed",
    );
  }
  const { cumulativeFilled, price } = fill;
  if (
    !Number.isFinite(cumulativeFilled) ||
    cumulativeFilled <= 0 ||
    cumulativeFilled > order.quantity
  ) {
    return refusal("unaccountable cumulative fill quantity — fail closed");
  }
  if (!Number.isFinite(price) || (price as number) <= 0) {
    return refusal("unaccountable fill price — fail closed");
  }
  const alreadyApplied = order.fillAppliedQuantity ?? 0;
  if (
    !Number.isFinite(alreadyApplied) ||
    alreadyApplied < 0 ||
    alreadyApplied > cumulativeFilled
  ) {
    return refusal("persisted applied-quantity inconsistency — fail closed");
  }
  // Only the NOT-YET-ACCOUNTED portion may touch the ledger (finding D2).
  const delta = fillDelta(cumulativeFilled, alreadyApplied);
  if (delta > 0) {
    // Canonical position accounting over the OWNER's rows only — a fill only
    // ever updates the caller-of-record's own position (shared SYSTEM rows are
    // never merged into).
    const existingPos = await ctx.db
      .query("positions")
      .withIndex("by_owner_market", (q) =>
        q.eq("ownerUserId", order.ownerUserId!).eq("marketId", order.marketId),
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
    const appliedFill = { side: order.side, quantity: delta, price: price as number };
    const next = applyFill(prev, appliedFill);
    if (existingPos) {
      await ctx.db.patch(existingPos._id, {
        side: next.side,
        quantity: next.quantity,
        avgEntryPrice: next.avgEntryPrice,
        realizedPnl: next.realizedPnl,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("positions", {
        positionId: `POS-${order.idempotencyKey}`,
        account: `${order.mode}:paper-account`,
        marketId: order.marketId,
        symbol: order.symbol,
        side: next.side,
        quantity: next.quantity,
        avgEntryPrice: next.avgEntryPrice,
        realizedPnl: next.realizedPnl,
        source: "PAPER",
        updatedAt: now,
        ownerUserId: order.ownerUserId,
      });
    }

    // REALIZED TRADE OUTCOME (finding C): one event per realization — the
    // application of a fill portion that CLOSED part of the position.
    const realizedDelta = next.realizedPnl - (prev?.realizedPnl ?? 0);
    const closedQty = closedQuantity(prev, appliedFill);
    const realizedOutcome = classifyRealizedOutcome(realizedDelta, closedQty);
    if (realizedOutcome !== null) {
      await recordRealizedOutcome(ctx, {
        outcomeId: `OUT-${order.orderId}-${cumulativeFilled}`,
        ownerUserId: order.ownerUserId,
        orderId: order.orderId,
        marketId: order.marketId,
        realizedPnl: realizedDelta,
        outcome: realizedOutcome,
        closedQuantity: closedQty,
        at: now,
      });
    }

    // Account-level risk accounting maintained server-side at fill time:
    // daily realized PnL (UTC day) and all-time peak equity. Equity is
    // recomputed over the owner's risk scope and is MARK-TO-MARKET (finding
    // D); an unreliable valuation never lowers (or raises) an established
    // peak. DECISION C: shared SYSTEM fixture P&L is account-level demo
    // economics (Decision A shared account) and is included here exactly as
    // before; it never enters behavioral streaks (see readLossStreak).
    const scopePositions = await readRiskScopePositions(ctx, order.ownerUserId);
    const totalRealized = scopePositions.rows.reduce((a, p) => a + p.realizedPnl, 0);
    const valuation = await valueScopePositions(ctx, scopePositions.rows, now);
    const equityNow = PAPER_EQUITY_BASE + totalRealized + valuation.unrealized;
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const accountState = await readRiskAccountState(ctx, order.ownerUserId);
    const realizedPnlDay =
      accountState?.pnlDay === dayKey
        ? (accountState.realizedPnlDay ?? 0) + realizedDelta
        : realizedDelta;
    const peakEquityNow = valuation.complete
      ? Math.max(accountState?.peakEquity ?? PAPER_EQUITY_BASE, equityNow)
      : (accountState?.peakEquity ?? PAPER_EQUITY_BASE);
    if (accountState) {
      await ctx.db.patch(accountState._id, {
        peakEquity: peakEquityNow,
        pnlDay: dayKey,
        realizedPnlDay,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("riskAccountState", {
        ownerUserId: order.ownerUserId,
        peakEquity: peakEquityNow,
        pnlDay: dayKey,
        realizedPnlDay,
        updatedAt: now,
      });
    }
    // LEGACY platform-aggregate telemetry (all customers summed): kept
    // maintained for the documented shared-account ledger, but NOT consumed by
    // any risk calculation. Removal is deferred to plan Step 2 migration.
    const state = await ctx.db.query("systemState").first();
    if (state) {
      await ctx.db.patch(state._id, {
        peakEquity: Math.max(state.peakEquity ?? PAPER_EQUITY_BASE, equityNow),
        pnlDay: dayKey,
        realizedPnlDay:
          state?.pnlDay === dayKey ? (state.realizedPnlDay ?? 0) + realizedDelta : realizedDelta,
        updatedAt: now,
      });
    }
  }
  // Persist the authoritative cumulative applied quantity (finding D2).
  await ctx.db.patch(order._id, { fillAppliedQuantity: cumulativeFilled });
  return { applied: true, delta };
}

export async function loadRiskContext(
  ctx: MutationCtx,
  args: {
    strategyVersionId: string;
    marketId: string;
    proposalIdempotencyKey: string;
    /**
     * G2: owner of the risk account whose inputs are being assembled.
     * ALWAYS server-derived from the trusted auth identity at the mutation
     * boundary (submitTradeProposal derives it via getAuthUserId; the
     * analysis pipeline passes the authenticated analysis owner). NEVER a
     * client-supplied value — a caller cannot widen or shift their scope.
     */
    accountOwnerUserId: string;
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
  // V4c: freshness is measured on the newest ELIGIBLE candle (INCOMPLETE
  // bars are never risk prices); no eligible candle -> age unknown -> the
  // engine fails closed.
  const lastCandle = await latestEligibleCandle(ctx, args.marketId);

  // BOUNDED-SCAN SAFETY (G2-scoped): positions are read from the caller's
  // risk scope only — own + shared SYSTEM rows, never another customer's —
  // with PER-SCOPE saturation detection (see readRiskScopePositions). The
  // unresolved-submission gate and duplicate-key reads below are INDEXED
  // checks — complete at any table size and any record age.
  //
  // DECISION A (re-ratified by the post-fix audit, finding D4): the exposure
  // gate is ACCOUNT-GLOBAL — the ONE order-state policy
  // (lib/execution.ts UNRESOLVED_SUBMISSION_STATES: SUBMITTING / SUBMITTED /
  // UNKNOWN) applies to EVERY order on the shared execution account
  // (`<mode>:paper-account`), any owner: an unresolved submission anywhere on
  // the account means the account's true exposure is unknown, so new
  // risk-increasing exposure is blocked for everyone on it. Unrelated
  // accounts are never scanned.
  const scopePositions = await readRiskScopePositions(ctx, args.accountOwnerUserId);
  const positions = scopePositions.rows;
  const unresolvedScan = await scanUnresolvedAccountOrders(
    ctx,
    (state?.mode ?? "PAPER") as Doc<"orders">["mode"],
  );
  const duplicateKeyOrder = await ctx.db
    .query("orders")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.proposalIdempotencyKey))
    .first();
  // Persisted, owner-scoped loss streak from completed realized trade
  // outcomes (finding C) — never a hardcoded constant.
  const streak = await readLossStreak(ctx, args.accountOwnerUserId);
  // Completeness CANNOT be established past the cap -> fail closed upstream.
  // Scope completeness is independent of other customers' row volume.
  const accountStateComplete =
    scopePositions.complete && unresolvedScan.complete && streak.complete;

  // G2: equity and exposure aggregate ONLY over this customer's risk scope
  // (own + shared SYSTEM rows). Another customer's positions or losses never
  // enter these figures. DECISION C: shared SYSTEM rows are the explicitly
  // shared demo/account workspace (Decision A shared account) — their P&L is
  // account-level economics and is included here by policy; it is the
  // BEHAVIORAL loss streak alone that stays owner-scoped (see readLossStreak).
  // Finding D: equity is MARK-TO-MARKET — realized PnL
  // PLUS unrealized PnL of open positions at fresh, valid marks. When a
  // reliable valuation cannot be established the context is marked incomplete
  // and the engine fails closed (absent prices are never treated as zero
  // unrealized PnL or as proof of safety).
  const realized = positions.reduce((a, p) => a + p.realizedPnl, 0);
  const valuation = await valueScopePositions(ctx, positions, Date.now());
  const equity = PAPER_EQUITY_BASE + realized + valuation.unrealized;
  const openPositions = positions.filter((p) => p.quantity > 0).length;

  // Daily-loss accounting: PER-CUSTOMER server-tracked UTC-day realized PnL
  // (riskAccountState). A customer without day tracking falls back to their
  // own CUMULATIVE realized PnL — never zero (MISSING must not become a
  // permissive default), and never another customer's ledger.
  const dayKey = new Date().toISOString().slice(0, 10);
  const accountState = await readRiskAccountState(ctx, args.accountOwnerUserId);
  const realizedPnlToday =
    accountState?.pnlDay === undefined
      ? realized
      : accountState.pnlDay === dayKey
        ? (accountState.realizedPnlDay ?? 0)
        : 0;
  // Peak equity is per-customer and server-maintained at fill time; the
  // fallback is the contribution base (never `equity` itself, which would
  // force drawdown to 0). A fresh valuation may RAISE the peak; an
  // UNRELIABLE valuation never lowers — and never raises — an established
  // peak (finding D): it is left untouched.
  const peakBase = accountState?.peakEquity ?? PAPER_EQUITY_BASE;
  const peakEquity = valuation.complete ? Math.max(peakBase, equity) : peakBase;
  // Indexed, per-account state reads: detection of unresolved submissions is
  // complete at any table size for THIS execution account (the count is exact
  // below the per-state caps; at/above a cap the exact total is unknown —
  // `accountStateComplete` is false and exposure is blocked regardless).
  const unresolvedOrders = unresolvedScan.count;

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
    consecutiveLosses: streak.streak,
    // Targeted indexed lookup: only the collision candidate (never a bounded
    // key list) — the engine checks membership for duplicate detection.
    existingOrderIdempotencyKeys: duplicateKeyOrder ? [args.proposalIdempotencyKey] : [],
    proposalIdempotencyKey: args.proposalIdempotencyKey,
    unresolvedOrders,
    accountStateComplete,
    valuationComplete: valuation.complete,
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
      // G2: risk inputs are scoped to the CALLER's account (server-derived
      // from the auth identity above — never a client-supplied owner id).
      accountOwnerUserId: userId,
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
        detail: `Deterministic risk evaluation under ${decision.policyLabel}: ${decision.outcome}. Veto is final authority.`,
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
        // Canonical, version-pinned policy identity (`<policyId>@v<n>`) — the
        // single contract expected by validateAuthorizationScope. The
        // human-readable label is NEVER stored in this identifier field.
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
    // V4c: fill pricing and freshness use the newest ELIGIBLE candle — an
    // INCOMPLETE bar can never price a fill or prove freshness; with no
    // eligible candle `dataAgeMs` is null and the precheck BLOCKS below.
    const lastCandle = await latestEligibleCandle(ctx, args.marketId);
    // ONE order-state policy with the risk context (lib/execution.ts
    // UNRESOLVED_SUBMISSION_STATES): SUBMITTING, SUBMITTED and UNKNOWN orders
    // are unresolved submissions — an earlier submission may already have
    // reached the provider, so new exposure is blocked until reconciliation
    // resolves them (fail-closed; no duplicate exposure).
    // DECISION A (finding D4, re-ratified): the gate is ACCOUNT-GLOBAL — it
    // covers EVERY order on this authorization's execution account
    // (`<mode>:paper-account`), any owner: an unresolved submission anywhere
    // on the account means the account's exposure is unknown. Unrelated
    // accounts are never scanned.
    // Resolved/terminal orders (ACKNOWLEDGED, PARTIALLY_FILLED, FILLED,
    // REJECTED, CANCELLED, EXPIRED) never block merely because of a former
    // state.
    // BOUNDED-SCAN SAFETY: per-mode-per-state INDEXED reads with per-state
    // saturation detection (see scanUnresolvedAccountOrders) — complete at
    // any database size/age for this account; the duplicate-key input reuses
    // the targeted lookup already performed above (never a bounded scan).
    const unresolvedScan = await scanUnresolvedAccountOrders(
      ctx,
      auth.scope.mode as Doc<"orders">["mode"],
    );

    const precheck = runPrechecks(intent, {
      systemEnabled: state?.mode !== "DISABLED",
      killSwitchEngaged: state?.killSwitchEngaged ?? true,
      mode: state?.mode ?? "DISABLED",
      providerState: market?.providerState ?? "UNAVAILABLE",
      marketStatus: market?.status ?? "UNKNOWN",
      dataAgeMs: lastCandle ? now - lastCandle.availabilityTime : null,
      maxDataAgeMs: 2 * HOUR,
      now,
      existingIdempotencyKeys: existing ? [args.idempotencyKey] : [],
      unresolvedOrders: unresolvedScan.count,
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

        // Position/PnL/outcome accounting is applied AFTER the order row is
        // persisted, through the SAME cumulative-fill accounting path
        // reconciliation uses (applyProviderFill — findings D1/D2): one
        // atomic, idempotent accounting path for every provider fill, keyed
        // on the order's persisted `fillAppliedQuantity`.
      }
    }

    const insertedOrderId = await ctx.db.insert("orders", {
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
      fillAppliedQuantity: filledQuantity > 0 ? 0 : undefined,
      fees,
      slippage,
      history,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now + 100_000,
    });

    if (filledQuantity > 0) {
      // CUMULATIVE FILL ACCOUNTING (findings D1/D2): the recorded provider
      // fill is accounted through the one shared atomic path — position,
      // realized PnL, realized-outcome event and riskAccountState are updated
      // together, and `fillAppliedQuantity` is persisted so the same fill can
      // never be counted twice in any accounting record.
      const orderRow = (await ctx.db.get(insertedOrderId))!;
      const application = await applyProviderFill(
        ctx,
        orderRow,
        { cumulativeFilled: filledQuantity, price: fillPrice ?? NaN },
        now,
      );
      if (!application.applied) {
        // Unreachable by construction (owner-bound order, provider-priced
        // fill). If accounting cannot be established the transaction FAILS
        // CLOSED atomically — no order, no consumed authorization and no
        // partial accounting survives; nothing pretends the fill happened.
        throw new Error(`FILL_ACCOUNTING_REFUSED: ${application.reason ?? "unaccountable fill"}`);
      }
    }

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
    // OWNERSHIP (Decision B): reconciliation only ACTS ON records the caller
    // may act on — their OWN orders plus shared SYSTEM records. A foreign
    // unresolved order is its owner's to reconcile; it is never patched and
    // never disclosed here (no cross-user leak) — only its COUNT enters the
    // account health below, exactly as the execution gate already reports it.
    //
    // HEALTH (Decision A): health is ACCOUNT-HONEST — the shared execution
    // account is healthy only when NO unresolved submission remains on it
    // (any owner) AND the caller's actionable rows are clear. Reconciliation
    // output therefore agrees with the actual execution gate (same state
    // policy, same account scope).
    // BOUNDED-SCAN SAFETY: INDEXED scans (by_owner_state for the actionable
    // set, by_mode_state for the account) over the SAME order-state policy
    // (UNRESOLVED_SUBMISSION_STATES = SUBMITTING/SUBMITTED/UNKNOWN), with
    // saturation detection — if any scan saturates, completeness cannot be
    // established: `healthy` is false, `scanComplete` is false and new
    // exposure stays blocked (fail-closed).
    //
    // EXHAUSTIVE CLASSIFICATION (finding B): EVERY scanned order gets exactly
    // one outcome via classifyOrderReconciliation (lib/execution.ts) —
    // resolved only on authoritative provider evidence (ACCEPTED/REJECTED),
    // otherwise explicitly UNRESOLVED (PENDING_SUBMISSION / AMBIGUOUS /
    // CONTRADICTORY_EVIDENCE / UNRECOGNIZED_STATE). A timeout, a missing
    // response or an absent provider record is never proof of rejection or of
    // non-submission, and no terminal result is ever manufactured.
    const systemStateRow = await ctx.db.query("systemState").first();
    const accountMode = (systemStateRow?.mode ?? "PAPER") as Doc<"orders">["mode"];
    const actionable = await scanUnresolvedOwnedOrders(ctx, userId);
    const accountScan = await scanUnresolvedAccountOrders(ctx, accountMode);
    // Foreign rows: COUNTED for account health, never classified, patched or
    // disclosed (Decision B — no cross-user leak).
    const unresolvedForeign = accountScan.rows.filter(
      (o) => !canViewRecord(o.ownerUserId, userId),
    ).length;

    const resolved: { orderId: string; from: string; to: string; fillAccounted: boolean }[] = [];
    const unresolved: {
      orderId: string;
      state: string;
      category: string;
      note: string;
    }[] = [];

    for (const o of actionable.rows) {
      const outcome = classifyOrderReconciliation({
        state: o.state,
        providerTruth: o.providerTruth ?? null,
        quantity: o.quantity,
        fillQuantity: o.fillQuantity ?? null,
        fillPrice: o.fillPrice ?? null,
      });
      if (outcome.kind === "RESOLVED") {
        // D1: a resolution carrying fill evidence MUST account those fills in
        // THIS transaction (same atomic accounting path as order placement —
        // findings D1/D2). Resolution with unapplied fill data is forbidden:
        // if the fill cannot be accounted, the order stays UNRESOLVED and
        // keeps blocking — it is never merely marked ACKNOWLEDGED.
        const fillQty = o.fillQuantity;
        const hasFillEvidence =
          fillQty !== undefined && fillQty !== null && fillQty > 0;
        let fillAccounted = true;
        if (hasFillEvidence) {
          const application = await applyProviderFill(
            ctx,
            o,
            { cumulativeFilled: fillQty, price: o.fillPrice ?? NaN },
            now,
          );
          fillAccounted = application.applied;
        }
        if (!fillAccounted) {
          unresolved.push({
            orderId: o.orderId,
            state: o.state,
            category: "CONTRADICTORY_EVIDENCE",
            note: "RECONCILIATION: fill evidence is recorded but could not be accounted (unaccountable fill data) — resolution REFUSED; the order stays unresolved and keeps blocking (findings D1/D2).",
          });
          continue;
        }
        await ctx.db.patch(o._id, {
          state: outcome.to,
          history: [
            ...o.history,
            {
              state: outcome.to as never,
              at: now,
              note: outcome.note,
            },
          ],
          updatedAt: now,
        });
        resolved.push({
          orderId: o.orderId,
          from: o.state,
          to: outcome.to,
          fillAccounted: hasFillEvidence,
        });
      } else {
        // Explicitly classified and REPORTED — never dropped, never silently
        // resolved. The order stays in its current state (visible in the next
        // reconciliation run and in the execution gate) until its documented
        // resolution condition — authoritative provider evidence — is met.
        unresolved.push({
          orderId: o.orderId,
          state: o.state,
          category: outcome.category,
          note: outcome.note,
        });
      }
    }

    // Completeness cannot be established over a saturated scan -> NOT healthy.
    // Health is ACCOUNT-HONEST (Decision A): healthy only when no unresolved
    // submission remains ANYWHERE on the shared execution account (foreign
    // rows counted, never disclosed) and the caller's actionable rows are
    // clear — exactly the state that still restricts new exposure.
    const scanComplete = actionable.complete && accountScan.complete;
    const healthy =
      scanComplete && unresolved.length === 0 && unresolvedForeign === 0;
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
          ? `Orders reconciled against provider ledger evidence. Resolved: ${resolved.map((r) => `${r.orderId} ${r.from}->${r.to}${r.fillAccounted ? " (fill accounted)" : ""}`).join(", ") || "none"}. Scan complete; no unresolved submission remains on the shared execution account or in the caller's actionable set.`
          : `${scanComplete ? "" : "INCOMPLETE SCAN (bounded read saturated) — additional orders may remain unreconciled and the result is NOT fully healthy. "}${unresolved.length > 0 ? `Unresolved orders remain: ${unresolved.map((u) => `${u.orderId} [${u.state}/${u.category}]`).join(", ")}. ` : ""}${unresolvedForeign > 0 ? `${unresolvedForeign} unresolved order(s) on the shared execution account are owned by other users (not disclosed; their owner must reconcile them) — the account stays blocked. ` : ""}NEW EXPOSURE IS BLOCKED until reconciliation succeeds.`,
      },
      now,
    );

    return { healthy, scanComplete, resolved, unresolved, unresolvedForeign };
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
    // OWNERSHIP (G1 hotfix): a learning event may only reference an order the
    // caller may view — their OWN order or a shared SYSTEM record. A missing,
    // foreign-owned, or unresolvable order is rejected BEFORE anything is
    // stored and BEFORE any private strategy parameters can be reached. The
    // client-supplied order id is a REFERENCE, never proof of ownership — the
    // caller's rights are recomputed server-side from stored ownership fields.
    // Missing and foreign orders get the SAME sanitized response (no ID
    // oracle); both are audited as denied.
    const referencedOrderId = args.orderId;
    if (referencedOrderId !== undefined) {
      const referencedOrder = await ctx.db
        .query("orders")
        .withIndex("by_orderId", (q) => q.eq("orderId", referencedOrderId))
        .first();
      if (!referencedOrder || !canViewRecord(referencedOrder.ownerUserId, userId)) {
        await appendAudit(
          ctx,
          {
            actor: `user:${userId}`,
            actorType: "USER",
            action: "LEARNING_EVENT_DENIED",
            resourceType: "learningEvent",
            resourceId: "none",
            outcome: "DENIED",
            correlationId: `LEARN-${now}`,
            detail:
              "Refused: the referenced order is not resolvable for this caller (missing or not owned). Nothing stored.",
          },
          now,
        );
        return {
          ok: false as const,
          learningEventId: null as string | null,
          reason: "Order not found.",
        };
      }
    }
    // Collision-proof destination-record identity: `LEARN-<ms>` alone collides
    // when two events are created in the same millisecond (even by different
    // callers), which would make the destination record ambiguous across users.
    // The id binds the server-derived owner and probes for clashes (the
    // analysis.ts executeAnalysis precedent).
    let learningEventId = `LEARN-${now}-${sha256Hex(`${userId}|${referencedOrderId ?? ""}|${now}`).slice(0, 12)}`;
    for (let i = 2; i <= 10; i++) {
      const clash = await ctx.db
        .query("learningEvents")
        .withIndex("by_learningEventId", (q) => q.eq("learningEventId", learningEventId))
        .first();
      if (clash === null) break;
      learningEventId = `LEARN-${now}-${sha256Hex(`${userId}|${referencedOrderId ?? ""}|${now}|${i}`).slice(0, 12)}`;
    }
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
    return { ok: true as const, learningEventId };
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

    // OWNERSHIP (G1 hotfix): every record on the path to the COPIED definition
    // must be visible to the caller — the source order AND the parent strategy
    // version. A missing, foreign-owned, or inconsistent record fails with the
    // SAME sanitized response (no ID oracle) BEFORE any private strategy
    // parameter is read or copied. Record ids are REFERENCES, never proof of
    // ownership; rights are recomputed server-side from stored ownership
    // fields. Indexed order lookup keeps the check complete at any table size.
    const sourceOrderId = learning.sourceOrderId;
    const sourceOrder = sourceOrderId
      ? await ctx.db
          .query("orders")
          .withIndex("by_orderId", (q) => q.eq("orderId", sourceOrderId))
          .first()
      : null;
    const parent = sourceOrder
      ? await ctx.db
          .query("strategyVersions")
          .withIndex("by_versionId", (q) => q.eq("strategyVersionId", sourceOrder.strategyVersionId))
          .first()
      : null;
    if (
      (sourceOrderId !== undefined &&
        (!sourceOrder || !canViewRecord(sourceOrder.ownerUserId, userId))) ||
      !parent ||
      !canViewRecord(parent.ownerUserId, userId)
    ) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "CANDIDATE_CREATION_DENIED",
          resourceType: "strategyVersion",
          resourceId: "none",
          outcome: "DENIED",
          correlationId: args.learningEventId,
          detail:
            "Refused: the source order or parent strategy version is not resolvable for this caller (missing, foreign-owned, or inconsistent). No definition read, nothing created.",
        },
        now,
      );
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
      // Releasing ALSO requires healthy reconciliation — fail closed
      // otherwise. The release gate uses the SAME order-state policy as the
      // execution gate (UNRESOLVED_SUBMISSION_STATES: SUBMITTING/SUBMITTED/
      // UNKNOWN) and is GLOBAL by design: the kill switch is a shared
      // platform control (not a customer risk decision). BOUNDED-SCAN SAFETY:
      // indexed state reads — complete at any table size (an unresolved order
      // beyond a scan boundary must never slip past this release gate).
      let unresolvedForRelease = 0;
      for (const state of UNRESOLVED_SUBMISSION_STATES) {
        unresolvedForRelease += (
          await ctx.db
            .query("orders")
            .withIndex("by_state", (q) => q.eq("state", state))
            .take(SCAN_CAP)
        ).length;
      }
      if (unresolvedForRelease > 0) {
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
            detail: `Release refused: ${unresolvedForRelease} order(s) in an unresolved submission state (SUBMITTING/SUBMITTED/UNKNOWN) must be reconciled first.`,
          },
          now,
        );
        return { ok: false as const, reason: "Unresolved submission orders outstanding — reconcile before release." };
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
