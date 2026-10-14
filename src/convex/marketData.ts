/**
 * SENTINEL PRIME — MARKET DATA MODULE (Section 06)
 *
 * Persisted market-data access with INSTRUMENT-SPECIFIC, TIMEFRAME-SPECIFIC,
 * BOUNDED queries (the previous global `candles.take(2000)` scan is gone).
 *
 * Every read returns an explicit data label — LIVE / CACHED / STALE /
 * SIMULATED / UNAVAILABLE — derived from the rows' actual origin and age
 * (`lib/marketData.deriveDataLabel`). Simulated rows are never presented as
 * live, and an empty range is an honest empty state — never padded with
 * generated candles.
 */

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { MutationCtx, appendAudit } from "./lib/store";
import {
  deriveDataLabel,
  healthAfterFailure,
  healthAfterSuccess,
  initialHealth,
  instrumentConfig,
  isSimulatedSource,
  ProviderFailureClass,
  ProviderHealthState,
  timeframeMs,
  TIMEFRAMES,
} from "./lib/marketData";
import { validateCandles } from "./lib/dataQuality";

const MAX_CHART_BARS = 500;
const DEFAULT_CHART_BARS = 200;
const MAX_FX_RATES = 30;
const MAX_HEALTH_ROWS = 50;

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;

function validToken(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);
}

/**
 * Instrument- and timeframe-specific chart query with validated values,
 * chronological ordering, explicit freshness and bounded ranges/counts.
 */
export const candles = query({
  args: {
    marketId: v.string(),
    timeframe: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    if (!Object.prototype.hasOwnProperty.call(TIMEFRAMES, args.timeframe))
      throw new Error("INVALID_REQUEST: unsupported timeframe");
    const tfMs = timeframeMs(args.timeframe)!;
    const limit = args.limit ?? DEFAULT_CHART_BARS;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHART_BARS)
      throw new Error("INVALID_REQUEST: limit out of range");
    const now = Date.now();
    const startTime = args.startTime ?? 0;
    const endTime = args.endTime ?? now;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime)
      throw new Error("INVALID_REQUEST: invalid range");
    // Bounded range: never more than `limit` bars' worth of time is scanned.
    const boundedStart = Math.max(startTime, endTime - limit * tfMs);

    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
      .first();

    const rows = await ctx.db
      .query("candles")
      .withIndex("by_market_tf_time", (q) =>
        q
          .eq("marketId", args.marketId)
          .eq("timeframe", args.timeframe)
          .gte("eventTime", boundedStart)
          .lte("eventTime", endTime),
      )
      .order("asc")
      .take(limit);

    // Still-forming provider bars are marked INCOMPLETE at persist time and
    // are reported separately — never mixed into the completed series.
    const complete = rows.filter((c) => c.qualityStatus !== "INCOMPLETE");
    const partialBars = rows.length - complete.length;

    const providerRows = complete.filter((c) => !isSimulatedSource(c.source));
    const useProvider = providerRows.length > 0;
    const series = useProvider ? providerRows : complete;
    const labelResult = deriveDataLabel({
      barCount: series.length,
      origin: useProvider ? "PERSISTED" : series.length > 0 ? "SIMULATED" : "PERSISTED",
      retrievedAt: useProvider
        ? series.reduce((a, c) => Math.max(a, c.receivedTime), 0)
        : null,
      lastBarEventTime: series.length > 0 ? series[series.length - 1].eventTime : null,
      now,
      staleAfterMs: 2 * tfMs,
    });

    const quality = validateCandles(series, {
      marketId: args.marketId,
      symbol: market?.symbol ?? args.marketId,
      timeframe: args.timeframe,
      timeframeMs: tfMs,
      now,
      staleAfterMs: 2 * tfMs,
      providerState: market?.providerState ?? "UNAVAILABLE",
    });

    // Forex: the verified FX feed is close-only — surfaced as rate
    // observations alongside an honest "no OHLC candles" state.
    const fxRates =
      market?.assetClass === "FOREX"
        ? (
            await ctx.db
              .query("rateObservations")
              .withIndex("by_market_date", (q) => q.eq("marketId", args.marketId))
              .order("desc")
              .take(MAX_FX_RATES)
          ).reverse()
        : [];

    return {
      marketId: args.marketId,
      symbol: market?.symbol ?? null,
      assetClass: market?.assetClass ?? null,
      timeframe: args.timeframe,
      status: series.length > 0 ? "OK" : "EMPTY",
      label: labelResult.label,
      labelReason: labelResult.reason,
      freshnessAgeMs: labelResult.freshnessAgeMs,
      qualityState: quality.state,
      qualityCounts: quality.counts,
      partialBars,
      range: {
        startTime: boundedStart,
        endTime,
        maxBars: limit,
        returned: series.length,
      },
      bars: series.map((c) => ({
        t: c.eventTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        source: c.source,
        availabilityTime: c.availabilityTime,
      })),
      // Close-only ECB reference fixes — explicitly NOT candles.
      closeOnlyRates: fxRates.map((r) => ({
        rateDate: r.rateDate,
        rate: r.rate,
        provider: r.provider,
        sourceUrl: r.sourceUrl,
        labelNote: r.labelNote,
      })),
      closeOnlyNote:
        market?.assetClass === "FOREX"
          ? "FX providers available to this build publish close-only reference rates. No synthetic OHLC candles are generated from them."
          : null,
    };
  },
});

/** Provider health: real request outcomes, failures, rate limits, freshness. */
export const health = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("providerHealth").take(MAX_HEALTH_ROWS);
    return rows.map((r) => ({
      provider: r.provider,
      kind: r.kind,
      assetClass: r.assetClass ?? null,
      status: r.status,
      failureClass: r.failureClass ?? null,
      consecutiveFailures: r.consecutiveFailures,
      lastSuccessAt: r.lastSuccessAt ?? null,
      lastFailureAt: r.lastFailureAt ?? null,
      rateLimitUntil: r.rateLimitUntil ?? null,
      lastLatencyMs: r.lastLatencyMs ?? null,
      note: r.note,
      updatedAt: r.updatedAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Internal persistence (called by the provider actions only)
// ---------------------------------------------------------------------------

export const persistCandles = internalMutation({
  args: {
    marketId: v.string(),
    symbol: v.string(),
    timeframe: v.string(),
    provider: v.string(),
    retrievedAt: v.number(),
    bars: v.array(
      v.object({
        eventTime: v.number(),
        open: v.number(),
        high: v.number(),
        low: v.number(),
        close: v.number(),
        volume: v.number(),
      }),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
      .first();
    if (market === null) throw new Error("INVALID_REQUEST: unknown market");
    const tfMs = timeframeMs(args.timeframe);
    if (tfMs === null) throw new Error("INVALID_REQUEST: unsupported timeframe");
    if (args.bars.length === 0 || args.bars.length > 1000)
      throw new Error("INVALID_REQUEST: bar count out of range");

    let inserted = 0;
    let skippedDuplicates = 0;
    for (const bar of args.bars) {
      const existing = await ctx.db
        .query("candles")
        .withIndex("by_market_tf_time", (q) =>
          q.eq("marketId", args.marketId).eq("timeframe", args.timeframe).eq("eventTime", bar.eventTime),
        )
        .first();
      if (existing !== null) {
        // Idempotent refresh: an identical re-retrieval is skipped; a
        // CONFLICTING re-retrieval is preserved as-is (never overwritten —
        // conflicting duplicates are surfaced by the quality engine).
        skippedDuplicates += 1;
        continue;
      }
      // A bar whose close time is still in the future at retrieval is a
      // still-forming bar — stored, but explicitly INCOMPLETE.
      const forming = bar.eventTime + tfMs > args.retrievedAt;
      await ctx.db.insert("candles", {
        marketId: args.marketId,
        symbol: market.symbol,
        assetClass: market.assetClass,
        venue: args.provider,
        timeframe: args.timeframe,
        eventTime: bar.eventTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: args.provider,
        providerTimestamp: bar.eventTime,
        receivedTime: args.retrievedAt,
        availabilityTime: bar.eventTime + tfMs,
        qualityStatus: forming ? "INCOMPLETE" : "VALID",
      });
      inserted += 1;
    }

    await appendAudit(
      ctx,
      {
        actor: "system:market-data",
        actorType: "SERVICE",
        action: "MARKET_DATA_PERSISTED",
        resourceType: "candles",
        resourceId: `${args.marketId}/${args.timeframe}`,
        outcome: "SUCCESS",
        correlationId: `md-${args.marketId}-${args.retrievedAt}`,
        detail: `${inserted} validated ${args.provider} bars persisted for ${args.symbol} ${args.timeframe} (${skippedDuplicates} duplicates skipped). Labels are derived from origin at read time; nothing is presented as live without a provider fetch.`,
      },
      args.retrievedAt,
    );
    return { inserted, skippedDuplicates };
  },
});

export const persistRates = internalMutation({
  args: {
    marketId: v.string(),
    symbol: v.string(),
    base: v.string(),
    quote: v.string(),
    provider: v.string(),
    sourceUrl: v.string(),
    retrievedAt: v.number(),
    labelNote: v.string(),
    observations: v.array(
      v.object({ rate: v.number(), rateDate: v.string() }),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    if (args.observations.length === 0 || args.observations.length > 400)
      throw new Error("INVALID_REQUEST: observation count out of range");
    let inserted = 0;
    for (const obs of args.observations) {
      const existing = await ctx.db
        .query("rateObservations")
        .withIndex("by_market_date", (q) =>
          q.eq("marketId", args.marketId).eq("rateDate", obs.rateDate),
        )
        .first();
      if (existing !== null) continue;
      await ctx.db.insert("rateObservations", {
        marketId: args.marketId,
        symbol: args.symbol,
        base: args.base,
        quote: args.quote,
        rate: obs.rate,
        rateDate: obs.rateDate,
        provider: args.provider,
        sourceUrl: args.sourceUrl,
        retrievedAt: args.retrievedAt,
        labelNote: args.labelNote,
      });
      inserted += 1;
    }
    return { inserted };
  },
});

export const recordHealth = internalMutation({
  args: {
    provider: v.string(),
    kind: v.union(v.literal("MARKET_DATA"), v.literal("NEWS")),
    assetClass: v.optional(v.union(v.literal("CRYPTO"), v.literal("FOREX"))),
    ok: v.boolean(),
    failureClass: v.optional(v.string()),
    note: v.string(),
    rateLimitUntil: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    at: v.number(),
  },
  handler: async (ctx: MutationCtx, args) => {
    const existing = await ctx.db
      .query("providerHealth")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .first();
    const prev: ProviderHealthState =
      existing === null
        ? initialHealth(args.provider, args.kind, args.assetClass ?? null)
        : {
            provider: existing.provider,
            kind: existing.kind,
            assetClass: existing.assetClass ?? null,
            status: existing.status,
            failureClass: (existing.failureClass as ProviderFailureClass | null) ?? null,
            consecutiveFailures: existing.consecutiveFailures,
            lastSuccessAt: existing.lastSuccessAt ?? null,
            lastFailureAt: existing.lastFailureAt ?? null,
            rateLimitUntil: existing.rateLimitUntil ?? null,
            lastLatencyMs: existing.lastLatencyMs ?? null,
            note: existing.note,
            updatedAt: existing.updatedAt,
          };
    const next = args.ok
      ? healthAfterSuccess(prev, args.at, args.latencyMs ?? null, args.note)
      : healthAfterFailure(
          prev,
          args.at,
          (args.failureClass ?? "UNKNOWN") as ProviderFailureClass,
          args.note,
          args.rateLimitUntil ?? null,
        );
    const doc = {
      provider: next.provider,
      kind: next.kind,
      assetClass: next.assetClass ?? undefined,
      status: next.status,
      failureClass: next.failureClass ?? undefined,
      consecutiveFailures: next.consecutiveFailures,
      lastSuccessAt: next.lastSuccessAt ?? undefined,
      lastFailureAt: next.lastFailureAt ?? undefined,
      rateLimitUntil: next.rateLimitUntil ?? undefined,
      lastLatencyMs: next.lastLatencyMs ?? undefined,
      note: next.note,
      updatedAt: next.updatedAt,
    };
    if (existing === null) {
      await ctx.db.insert("providerHealth", doc);
    } else {
      await ctx.db.replace(existing._id, doc);
    }
    return { provider: next.provider, status: next.status };
  },
});

/** Instrument registry (for clients building pickers; read-only). */
export const instruments = query({
  args: {},
  handler: async (ctx) => {
    const markets = await ctx.db.query("markets").take(50);
    return markets.map((m) => {
      const cfg = instrumentConfig(m.symbol);
      return {
        marketId: m.marketId,
        symbol: m.symbol,
        assetClass: m.assetClass,
        providerState: m.providerState,
        supportedTimeframes: Object.keys(TIMEFRAMES),
        hasCandleProvider: cfg !== null && (cfg.krakenPair !== null || cfg.coinbaseProduct !== null),
        hasRateFeedOnly: cfg !== null && cfg.ecbBase !== null,
      };
    });
  },
});
