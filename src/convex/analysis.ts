/**
 * SENTINEL PRIME — ANALYSIS PIPELINE (Section 04 backend repair)
 *
 * One authenticated, traceable pipeline run:
 *   1. validate request + permissions (server-side identity only)
 *   2. retrieve market data for the requested instrument/timeframe
 *   3. retrieve relevant news (or disclose unavailability)
 *   4. validate data quality + freshness
 *   5. build a timestamped, traceable market snapshot
 *   6. evaluate every registered strategy candidate for the market
 *   7. record each strategy result and its evidence
 *   8. pass proposed outcomes through the EXISTING deterministic risk engine
 *   9. produce an honest verdict: BUY / SELL / WAIT / NO TRADE
 *  10. persist the analysis and return its actual status and evidence
 *
 * Honesty rules:
 *   - Strategy results, confidence, entry/stop/target prices are NEVER
 *     fabricated. An unevaluable candidate is recorded as NOT_EVALUATED.
 *   - SIMULATED and real data are never merged into one series; a run on
 *     synthetic data is labeled SIMULATED and cannot claim LIVE.
 *   - The risk engine is NEVER bypassed: a BUY/SELL verdict requires a real
 *     risk APPROVE; any BLOCK/UNKNOWN yields NO TRADE.
 *   - This pipeline creates NO financial state: it never writes orders,
 *     authorizations or positions (execution remains disabled).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { MutationCtx, appendAudit } from "./lib/store";
import { validateCandles } from "./lib/dataQuality";
import { deriveDataLabel, isSimulatedSource, timeframeMs, TIMEFRAMES } from "./lib/marketData";
import { evaluateStrategyDefinition, StrategyEvaluation } from "./lib/strategyEval";
import { selectHighImpactNews, NewsItem, NewsImpact } from "./lib/news";
import { loadRiskContext } from "./workflows";
import { evaluateRisk, TradeProposal } from "./lib/risk";
import { sha256Hex } from "./lib/audit";
import type { StrategyDefinition } from "./lib/backtest";

export const ANALYSIS_HORIZONS = ["SHORT", "MEDIUM", "LONG"] as const;

/** Bound on candles consumed per analysis (bounded queries everywhere). */
const MAX_BARS = 300;
const MAX_STRATEGIES = 20;
const MAX_NEWS_CONSIDERED = 20;
/** History page-size bounds (validated in the query). */
const PAGE_MIN = 1;
const PAGE_MAX = 100;

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;

export interface AnalysisRequest {
  marketId: string;
  timeframe: string;
  horizon: string;
}

function validToken(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);
}

/**
 * Validate every request field against server-side allowlists. Error messages
 * never echo caller input (safe error handling).
 */
export function validateAnalysisRequest(req: unknown): AnalysisRequest {
  const r = req as { marketId?: unknown; timeframe?: unknown; horizon?: unknown };
  if (!validToken(r.marketId)) throw new Error("INVALID_REQUEST: marketId is not a valid identifier");
  if (typeof r.timeframe !== "string" || !Object.prototype.hasOwnProperty.call(TIMEFRAMES, r.timeframe))
    throw new Error("INVALID_REQUEST: timeframe is not supported");
  if (typeof r.horizon !== "string" || !(ANALYSIS_HORIZONS as readonly string[]).includes(r.horizon))
    throw new Error("INVALID_REQUEST: horizon is not supported");
  return { marketId: r.marketId, timeframe: r.timeframe, horizon: r.horizon };
}

interface StoredBar {
  eventTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  availabilityTime: number;
  source: string;
  receivedTime: number;
}

/** The persisted, fully traceable analysis record (returned to its owner). */
export interface AnalysisRunRecord {
  analysisId: string;
  ownerUserId: string;
  request: { marketId: string; symbol: string; timeframe: string; horizon: string; requestedAt: number };
  data: {
    label: string;
    labelReason: string;
    origin: string;
    provider: string;
    barCount: number;
    lastBarEventTime?: number;
    freshnessAgeMs?: number;
    qualityState: string;
    qualityChecks: { check: string; status: string; detail: string; count: number }[];
  };
  snapshot: {
    snapshotId: string;
    timeframe: string;
    rangeStart: number;
    rangeEnd: number;
    dataVersion: string;
    revision: number;
  };
  news: {
    status: string;
    reason: string;
    newsId?: string;
    provider?: string;
    sourceName?: string;
    sourceUrl?: string;
    headline?: string;
    publishedAt?: number;
    retrievedAt?: number;
    impact?: string;
    impactEvidence: string[];
  };
  strategyResults: {
    strategyId: string;
    strategyVersionId: string;
    strategyName: string;
    evaluated: boolean;
    signal: string;
    reason: string;
    evidence: unknown;
  }[];
  risk: {
    evaluated: boolean;
    outcome: string;
    policyRef: string;
    note: string;
    evaluations: {
      strategyVersionId: string;
      side: string;
      outcome: string;
      checks: { check: string; status: string; detail: string }[];
    }[];
  };
  verdict: string;
  verdictEvidence: string[];
  status: string;
  errors: string[];
  startedAt: number;
  completedAt: number;
}

function serializeRun(row: AnalysisRunRecord): AnalysisRunRecord {
  // The stored record contains no secrets; it is returned as-is to its owner.
  return row;
}

/**
 * The pipeline core. `ownerUserId` is server-derived by every caller (public
 * mutation derives it from the auth identity; the internal mutation receives
 * it from an authenticated action that derived it the same way).
 */
export async function executeAnalysis(
  ctx: MutationCtx,
  ownerUserId: string,
  request: AnalysisRequest,
  now: number,
): Promise<AnalysisRunRecord> {
  const startedAt = now;
  // Traceable, collision-proof id: a same-millisecond rerun gets a
  // deterministic suffix instead of a duplicate identity.
  let analysisId = `ANL-${now}-${sha256Hex(`${ownerUserId}|${request.marketId}|${request.timeframe}|${startedAt}`).slice(0, 12)}`;
  for (let i = 2; i <= 10; i++) {
    const clash = await ctx.db
      .query("analysisRuns")
      .withIndex("by_analysisId", (q) => q.eq("analysisId", analysisId))
      .first();
    if (clash === null) break;
    analysisId = `ANL-${now}-${sha256Hex(`${ownerUserId}|${request.marketId}|${request.timeframe}|${startedAt}|${i}`).slice(0, 12)}`;
  }

  // ---- 1. Market (server-derived symbol; client symbols are ignored) ------
  const market = await ctx.db
    .query("markets")
    .withIndex("by_marketId", (q) => q.eq("marketId", request.marketId))
    .first();
  if (market === null) throw new Error("INVALID_REQUEST: unknown market");

  const tfMs = timeframeMs(request.timeframe) ?? 3600_000;
  const staleAfterMs = 2 * tfMs;

  const errors: string[] = [];

  // ---- 2. Market data: instrument + timeframe specific, bounded ----------
  // Provider-sourced and simulated bars are NEVER merged into one series.
  const rows = await ctx.db
    .query("candles")
    .withIndex("by_market_tf_time", (q) =>
      q.eq("marketId", request.marketId).eq("timeframe", request.timeframe),
    )
    .order("desc")
    .take(MAX_BARS);
  const allBars: StoredBar[] = rows.reverse().map((c) => ({
    eventTime: c.eventTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    availabilityTime: c.availabilityTime,
    source: c.source,
    receivedTime: c.receivedTime,
  }));
  const providerBars = allBars.filter((b) => !isSimulatedSource(b.source));
  const simulatedBars = allBars.filter((b) => isSimulatedSource(b.source));
  const useProvider = providerBars.length > 0;
  const bars = useProvider ? providerBars : simulatedBars;

  const retrievedAt = useProvider
    ? bars.reduce((a, b) => Math.max(a, b.receivedTime), 0)
    : null;
  const labelResult = deriveDataLabel({
    barCount: bars.length,
    origin: useProvider ? "PERSISTED" : bars.length > 0 ? "SIMULATED" : "PERSISTED",
    retrievedAt,
    lastBarEventTime: bars.length > 0 ? bars[bars.length - 1].eventTime : null,
    now,
    staleAfterMs,
  });
  if (!useProvider && bars.length > 0) {
    errors.push(
      "No provider-sourced candles for this instrument/timeframe — the evaluated series is SYNTHETIC SEED DATA (labeled SIMULATED).",
    );
  }

  // ---- 4. Data quality + freshness (deterministic engine) ----------------
  const quality = validateCandles(
    bars.map((b) => ({ ...b, symbol: market.symbol, marketId: market.marketId, timeframe: request.timeframe })),
    {
      marketId: market.marketId,
      symbol: market.symbol,
      timeframe: request.timeframe,
      timeframeMs: tfMs,
      now,
      staleAfterMs,
      providerState: market.providerState,
    },
  );
  if (quality.state !== "VALID") {
    errors.push(`Data quality state ${quality.state} (see quality checks).`);
  }

  // ---- 5. Timestamped, traceable snapshot (bound to the actual rows) -----
  const rangeStart = bars.length > 0 ? bars[0].eventTime : now;
  const rangeEnd = bars.length > 0 ? bars[bars.length - 1].eventTime : now;
  const providerTag = useProvider
    ? [...new Set(bars.map((b) => b.source))].join("+").toLowerCase()
    : "synthetic-seed";
  const dataVersion = `${labelResult.label.toLowerCase()}-${providerTag}-${request.timeframe}`;
  const snapshotId = `SNAP-${analysisId}`;
  await ctx.db.insert("dataSnapshots", {
    snapshotId,
    marketIds: [market.marketId],
    timeframe: request.timeframe,
    rangeStart,
    rangeEnd,
    dataVersion,
    qualitySummary: [{ marketId: market.marketId, state: quality.state }],
    revision: 1,
    createdAt: now,
  });

  // ---- 3. News: most relevant high-impact item, or disclosed absence ------
  const newsRows = await ctx.db
    .query("newsItems")
    .withIndex("by_market_retrieved", (q) => q.eq("marketId", market.marketId))
    .order("desc")
    .take(MAX_NEWS_CONSIDERED);
  const selection =
    newsRows.length === 0
      ? {
          selected: null,
          reason:
            "NO_NEWS_RETRIEVED: no news provider data exists for this market (news refresh has not succeeded). No headline is invented.",
          considered: 0,
        }
      : selectHighImpactNews(
          newsRows.map(
            (n): NewsItem => ({
              provider: n.provider,
              sourceName: n.sourceName,
              sourceUrl: n.sourceUrl,
              headline: n.headline,
              summary: n.summary,
              publishedAt: n.publishedAt ?? null,
              retrievedAt: n.retrievedAt,
              markets: [n.marketId],
              instruments: n.instruments,
              currencies: n.currencies,
              assets: n.assets,
              impact: n.impact as NewsImpact,
              impactEvidence: n.impactEvidence,
              relevanceScore: n.relevanceScore,
              contentHash: n.contentHash,
              freshness: n.freshness as NewsItem["freshness"],
            }),
          ),
          now,
        );
  const newsRecord =
    selection.selected === null
      ? {
          status: "UNAVAILABLE" as const,
          reason: selection.reason,
          impactEvidence: [] as string[],
        }
      : {
          status: "SELECTED" as const,
          reason: selection.reason,
          newsId: newsRows.find((n) => n.contentHash === selection.selected!.contentHash)?._id ?? undefined,
          provider: selection.selected.provider,
          sourceName: selection.selected.sourceName,
          sourceUrl: selection.selected.sourceUrl,
          headline: selection.selected.headline,
          publishedAt: selection.selected.publishedAt ?? undefined,
          retrievedAt: selection.selected.retrievedAt,
          impact: selection.selected.impact,
          impactEvidence: selection.selected.impactEvidence,
        };

  // ---- 6/7. Strategy candidates registered for this market ---------------
  const strategies = (await ctx.db.query("strategies").take(100))
    .filter((s) => s.marketId === market.marketId)
    .slice(0, MAX_STRATEGIES);
  const allVersions = await ctx.db.query("strategyVersions").take(200);
  const strategyResults: StrategyEvaluation[] = [];
  for (const s of strategies) {
    const versions = allVersions
      .filter((sv) => sv.strategyId === s.strategyId)
      .sort((a, b) => b.version - a.version);
    const latest = versions[0];
    if (latest === undefined) {
      strategyResults.push({
        strategyId: s.strategyId,
        strategyVersionId: "NONE",
        strategyName: s.name,
        evaluated: false,
        signal: "NOT_EVALUATED",
        reason: "No version exists for this candidate — nothing evaluated, nothing fabricated.",
        evidence: {
          barsAvailable: bars.length,
          barsRequired: 0,
          lastClose: null,
          prevFastEma: null,
          prevSlowEma: null,
          fastEma: null,
          slowEma: null,
          rsi: null,
          rsiBounds: { min: null, max: null },
          entryIndicator: "unknown",
        },
      });
      continue;
    }
    const def = latest.definition as StrategyDefinition | null;
    const evaluation = evaluateStrategyDefinition(def, bars, {
      strategyId: s.strategyId,
      strategyVersionId: latest.strategyVersionId,
      strategyName: s.name,
    });
    if (def !== null && def.timeframe !== request.timeframe) {
      evaluation.evaluated = false;
      evaluation.signal = "NOT_EVALUATED";
      evaluation.reason = `Candidate is defined for timeframe ${def.timeframe}, requested ${request.timeframe} — not evaluated on mismatched data.`;
    }
    strategyResults.push(evaluation);
  }

  // ---- 8. Proposed outcomes through the EXISTING deterministic risk engine
  const riskEvaluations: {
    strategyVersionId: string;
    side: string;
    outcome: string;
    checks: { check: string; status: string; detail: string }[];
  }[] = [];
  let riskPolicyRef = "NONE";
  let riskNote = "No proposed outcome was generated; the risk engine was not invoked.";
  for (const result of strategyResults) {
    if (result.signal !== "LONG" && result.signal !== "SHORT") continue;
    const lastClose = result.evidence.lastClose;
    if (lastClose === null || !Number.isFinite(lastClose) || lastClose <= 0) continue;
    const latest = allVersions
      .filter((sv) => sv.strategyId === result.strategyId)
      .sort((a, b) => b.version - a.version)[0];
    const fraction = (latest?.definition as StrategyDefinition | null)?.sizing?.fraction ?? 0;
    if (!(fraction > 0)) continue;

    const bundle = await loadRiskContext(ctx, {
      strategyVersionId: result.strategyVersionId,
      marketId: market.marketId,
      proposalIdempotencyKey: `${analysisId}:${result.strategyId}`,
    });
    // Hypothetical proposal derived from REAL data + the candidate's own
    // sizing definition. Analysis-only: no order/authorization is created.
    const quantity =
      Math.round(((bundle.ctx.equity * fraction) / lastClose) * 1e8) / 1e8;
    const proposal: TradeProposal = {
      proposalId: `${analysisId}:${result.strategyId}`,
      side: result.signal === "LONG" ? "BUY" : "SELL",
      quantity,
      referencePrice: lastClose,
      orderType: "MARKET",
      mode: bundle.ctx.mode,
    };
    const decision = evaluateRisk(proposal, bundle.ctx, bundle.policy);
    riskPolicyRef = decision.policyRef;
    riskNote =
      "Proposed outcomes evaluated by the deterministic risk engine. Analysis-only: no order was created and no execution is possible from this path.";
    riskEvaluations.push({
      strategyVersionId: result.strategyVersionId,
      side: proposal.side,
      outcome: decision.outcome,
      checks: decision.checks.map((c) => ({ check: c.check, status: c.status, detail: c.detail })),
    });
  }

  // ---- 9. Honest verdict -------------------------------------------------
  const verdictEvidence: string[] = [];
  let verdict: "BUY" | "SELL" | "WAIT" | "NO TRADE" = "NO TRADE";
  let status: "COMPLETED" | "BLOCKED" | "INSUFFICIENT_DATA" | "FAILED" = "COMPLETED";

  const dataUsable =
    bars.length > 0 &&
    quality.state !== "MISSING" &&
    quality.state !== "FAILED" &&
    quality.state !== "INVALID";
  const entryCandidates = strategyResults.filter(
    (r) => r.signal === "LONG" || r.signal === "SHORT",
  );
  const anyEvaluated = strategyResults.some((r) => r.evaluated);

  if (!dataUsable) {
    verdict = "NO TRADE";
    status = quality.state === "INVALID" ? "BLOCKED" : "INSUFFICIENT_DATA";
    verdictEvidence.push(
      `Market data is ${quality.state} (label ${labelResult.label}) — no trade verdict can be supported.`,
    );
  } else if (strategyResults.length === 0) {
    verdict = "NO TRADE";
    status = "BLOCKED";
    verdictEvidence.push(
      "No strategy candidates are registered for this market — the system cannot support any trade verdict.",
    );
  } else if (!anyEvaluated) {
    verdict = "NO TRADE";
    status = "BLOCKED";
    verdictEvidence.push(
      "Strategy candidates could not be evaluated on the available data — no verdict can be supported.",
    );
  } else if (entryCandidates.length === 0) {
    verdict = "WAIT";
    status = "COMPLETED";
    verdictEvidence.push(
      "Validated data, but no strategy candidate proposes an entry on the latest completed bar.",
    );
  } else {
    const approved = riskEvaluations.find((e) => e.outcome === "APPROVE");
    if (approved) {
      verdict = approved.side === "BUY" ? "BUY" : "SELL";
      verdictEvidence.push(
        `Strategy ${approved.strategyVersionId} proposed ${approved.side} and the deterministic risk engine returned APPROVE (${riskPolicyRef}).`,
      );
    } else {
      verdict = "NO TRADE";
      status = "BLOCKED";
      for (const e of riskEvaluations) {
        const blocking = e.checks
          .filter((c) => c.status === "BLOCK")
          .map((c) => c.check);
        verdictEvidence.push(
          `Proposed ${e.side} from ${e.strategyVersionId} was ${e.outcome} by the deterministic risk engine${blocking.length > 0 ? ` (blocked: ${blocking.join(", ")})` : ""} — never bypassed.`,
        );
      }
      if (riskEvaluations.length === 0) {
        verdictEvidence.push("No valid proposed outcome could be constructed from the strategy results.");
      }
    }
  }
  if (labelResult.label !== "LIVE") {
    verdictEvidence.push(`Data label for this run: ${labelResult.label} — ${labelResult.reason}`);
  }

  const completedAt = Date.now();

  const record = {
    analysisId,
    ownerUserId,
    request: { ...request, symbol: market.symbol, requestedAt: startedAt },
    data: {
      label: labelResult.label,
      labelReason: labelResult.reason,
      origin: useProvider ? "PROVIDER_PERSISTED" : bars.length > 0 ? "SIMULATED" : "NONE",
      provider: providerTag,
      barCount: bars.length,
      lastBarEventTime: bars.length > 0 ? bars[bars.length - 1].eventTime : undefined,
      freshnessAgeMs: labelResult.freshnessAgeMs ?? undefined,
      qualityState: quality.state,
      qualityChecks: quality.checks,
    },
    snapshot: {
      snapshotId,
      timeframe: request.timeframe,
      rangeStart,
      rangeEnd,
      dataVersion,
      revision: 1,
    },
    news: newsRecord,
    strategyResults: strategyResults.map((r) => ({
      strategyId: r.strategyId,
      strategyVersionId: r.strategyVersionId,
      strategyName: r.strategyName,
      evaluated: r.evaluated,
      signal: r.signal,
      reason: r.reason,
      evidence: r.evidence,
    })),
    risk: {
      evaluated: riskEvaluations.length > 0,
      outcome:
        riskEvaluations.length === 0
          ? "NOT_EVALUATED"
          : riskEvaluations.every((e) => e.outcome === "APPROVE")
            ? "APPROVE"
            : riskEvaluations.some((e) => e.outcome === "BLOCK")
              ? "BLOCK"
              : "UNKNOWN",
      policyRef: riskPolicyRef,
      note: riskNote,
      evaluations: riskEvaluations,
    },
    verdict,
    verdictEvidence,
    status,
    errors,
    startedAt,
    completedAt,
  };

  await ctx.db.insert("analysisRuns", record);
  await appendAudit(
    ctx,
    {
      actor: `user:${ownerUserId}`,
      actorType: "USER",
      action: "ANALYSIS_RUN",
      resourceType: "analysisRuns",
      resourceId: analysisId,
      outcome: status,
      correlationId: analysisId,
      detail: `${market.symbol} ${request.timeframe} (${request.horizon}): verdict ${verdict} — status ${status}, data ${labelResult.label}, news ${newsRecord.status}, strategies ${strategyResults.length}, risk ${record.risk.outcome}. No order created; execution disabled.`,
    },
    startedAt,
  );

  return serializeRun(record as unknown as AnalysisRunRecord);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const run = mutation({
  args: {
    marketId: v.string(),
    timeframe: v.string(),
    horizon: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const request = validateAnalysisRequest(args);
    return await executeAnalysis(ctx, userId, request, Date.now());
  },
});

/**
 * Internal entry point for the authenticated orchestration action. The action
 * derives `ownerUserId` from the trusted auth identity before calling; a
 * client can never reach this function directly.
 */
export const runInternal = internalMutation({
  args: {
    ownerUserId: v.string(),
    marketId: v.string(),
    timeframe: v.string(),
    horizon: v.string(),
  },
  handler: async (ctx, args): Promise<AnalysisRunRecord> => {
    const request = validateAnalysisRequest(args);
    return await executeAnalysis(ctx, args.ownerUserId, request, Date.now());
  },
});

export const history = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const numItems = args.paginationOpts.numItems;
    if (!Number.isInteger(numItems) || numItems < PAGE_MIN || numItems > PAGE_MAX) {
      throw new Error("INVALID_REQUEST: pagination limit out of range");
    }
    // Owner-scoped at the index level: one user can never read another user's
    // analysis records (not-found ≡ not-owned; no ID oracle).
    const page = await ctx.db
      .query("analysisRuns")
      .withIndex("by_owner_started", (q) => q.eq("ownerUserId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: page.page.map((row) => serializeRun(row as unknown as AnalysisRunRecord)),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const get = query({
  args: { analysisId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    if (!validToken(args.analysisId)) throw new Error("INVALID_REQUEST: bad identifier");
    const row = await ctx.db
      .query("analysisRuns")
      .withIndex("by_analysisId", (q) => q.eq("analysisId", args.analysisId))
      .first();
    // Strict owner match. Not-found and not-owned are indistinguishable.
    if (row === null || row.ownerUserId !== userId) return null;
    return serializeRun(row as unknown as AnalysisRunRecord);
  },
});
