"use node";

/**
 * SENTINEL PRIME — PROVIDER ACTIONS (Section 06 / Section 04)
 *
 * The only code paths that touch external networks. Node runtime ("use node"),
 * authenticated (`getAuthUserId`), and fail-honest: a failed or unconfigured
 * provider produces an explicit UNAVAILABLE result — never placeholder data.
 *
 * Verified provider endpoints (see lib/marketData.ts and lib/news.ts):
 *   - Kraken public OHLC (crypto)          — connectivity VERIFIED 2026-10-14
 *   - Coinbase Exchange candles (crypto)   — connectivity VERIFIED 2026-10-14
 *   - ECB reference rates via Frankfurter  — connectivity VERIFIED 2026-10-14
 *   - Yahoo Finance RSS (news)             — connectivity VERIFIED 2026-10-14
 *
 * All four are keyless public endpoints — no credentials are read, sent,
 * logged or stored by these adapters (SECRET RULE preserved).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { AnalysisRunRecord } from "./analysis";
import {
  fetchCryptoMarketData,
  fetchEcbRates,
  fetchForexCandles,
  instrumentConfig,
  TIMEFRAMES,
  type FetchLike,
} from "./lib/marketData";
import { fetchYahooNews } from "./lib/news";

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;

function validToken(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);
}

interface MarketRef {
  marketId: string;
  symbol: string;
  assetClass: "CRYPTO" | "FOREX";
}

async function resolveMarket(ctx: ActionCtx, marketId: string): Promise<MarketRef | null> {
  const instruments = await ctx.runQuery(api.marketData.instruments, {});
  return instruments.find((m) => m.marketId === marketId) ?? null;
}

async function doRefreshMarketData(
  ctx: ActionCtx,
  args: { marketId: string; timeframe: string; limit: number },
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const market = await resolveMarket(ctx, args.marketId);
  if (market === null) throw new Error("INVALID_REQUEST: unknown market");
  if (!Object.prototype.hasOwnProperty.call(TIMEFRAMES, args.timeframe))
    throw new Error("INVALID_REQUEST: unsupported timeframe");

  const fetchImpl: FetchLike = fetch;
  const cfg = instrumentConfig(market.symbol);

  if (market.assetClass === "FOREX") {
    // Forex candles: honest NOT_CONFIGURED (the verified FX feed is
    // close-only; no synthetic OHLC is ever generated).
    const candleResult = await fetchForexCandles({
      symbol: market.symbol,
      timeframe: args.timeframe,
      limit: args.limit,
      now,
      fetchImpl,
    });
    // Close-only ECB reference rates — real, persisted, explicitly labeled.
    let rateFeed: Record<string, unknown>;
    if (cfg !== null && cfg.ecbBase !== null && cfg.ecbQuote !== null) {
      const rateResult = await fetchEcbRates({
        symbol: market.symbol,
        startIsoDate: new Date(now - 90 * 86400_000).toISOString().slice(0, 10),
        endIsoDate: new Date(now).toISOString().slice(0, 10),
        now,
        fetchImpl,
      });
      await ctx.runMutation(internal.marketData.recordHealth, {
        provider: "ECB-RATES",
        kind: "MARKET_DATA",
        assetClass: "FOREX",
        ok: rateResult.ok,
        failureClass: rateResult.failureClass ?? undefined,
        note: rateResult.detail,
        at: now,
      });
      if (rateResult.ok && rateResult.observations.length > 0) {
        await ctx.runMutation(internal.marketData.persistRates, {
          marketId: market.marketId,
          symbol: market.symbol,
          base: rateResult.observations[0].base,
          quote: rateResult.observations[0].quote,
          provider: rateResult.provider,
          sourceUrl: rateResult.sourceUrl,
          retrievedAt: now,
          labelNote: rateResult.labelNote,
          observations: rateResult.observations.map((o) => ({
            rate: o.rate,
            rateDate: o.rateDate,
          })),
        });
      }
      rateFeed = {
        ok: rateResult.ok,
        provider: rateResult.provider,
        observations: rateResult.observations.length,
        sourceUrl: rateResult.sourceUrl,
        labelNote: rateResult.labelNote,
        detail: rateResult.detail,
      };
    } else {
      rateFeed = { ok: false, detail: "no FX rate provider mapped for this symbol" };
    }
    return {
      status: "UNAVAILABLE",
      provider: null,
      label: "UNAVAILABLE",
      insertedCandles: 0,
      reason: candleResult.ok === false ? candleResult.detail : "no candles",
      rateFeed,
    };
  }

  const { result, attempts } = await fetchCryptoMarketData({
    symbol: market.symbol,
    timeframe: args.timeframe,
    limit: args.limit,
    now,
    fetchImpl,
  });

  for (const attempt of attempts) {
    await ctx.runMutation(internal.marketData.recordHealth, {
      provider: attempt.provider,
      kind: "MARKET_DATA",
      assetClass: "CRYPTO",
      ok: attempt.ok,
      failureClass: attempt.ok ? undefined : attempt.failureClass,
      note: attempt.ok ? attempt.note : attempt.detail,
      rateLimitUntil: attempt.ok ? undefined : (attempt.rateLimitUntil ?? undefined),
      at: now,
    });
  }

  if (result === null || !result.ok) {
    return {
      status: "UNAVAILABLE",
      provider: null,
      label: "UNAVAILABLE",
      insertedCandles: 0,
      reason:
        "All configured crypto providers failed — no market data substituted, no prices invented.",
      attempts: attempts.map((a) =>
        a.ok
          ? { provider: a.provider, ok: true }
          : { provider: a.provider, ok: false, failureClass: a.failureClass, detail: a.detail },
      ),
    };
  }

  const persisted = await ctx.runMutation(internal.marketData.persistCandles, {
    marketId: market.marketId,
    symbol: market.symbol,
    timeframe: args.timeframe,
    provider: result.provider,
    retrievedAt: result.retrievedAt,
    bars: result.candles,
  });

  return {
    status: "OK",
    provider: result.provider,
    // Fetched in THIS call from the live provider: LIVE by construction. The
    // label reverts to CACHED/STALE on later reads — never stuck at LIVE.
    label: "LIVE",
    insertedCandles: persisted.inserted,
    skippedDuplicates: persisted.skippedDuplicates,
    note: result.note,
  };
}

async function doRefreshNews(
  ctx: ActionCtx,
  args: { marketId: string },
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const market = await resolveMarket(ctx, args.marketId);
  if (market === null) throw new Error("INVALID_REQUEST: unknown market");

  const result = await fetchYahooNews({
    symbol: market.symbol,
    marketId: market.marketId,
    now,
    fetchImpl: fetch,
  });

  await ctx.runMutation(internal.marketData.recordHealth, {
    provider: result.provider,
    kind: "NEWS",
    ok: result.ok && result.items.length > 0,
    failureClass: result.ok ? (result.failureClass ?? undefined) : (result.failureClass ?? "UNKNOWN"),
    note: result.detail,
    at: now,
  });

  let itemsPersisted = 0;
  if (result.ok && result.items.length > 0) {
    const res = await ctx.runMutation(internal.news.persist, {
      marketId: market.marketId,
      items: result.items.map((i) => ({
        provider: i.provider,
        sourceName: i.sourceName,
        sourceUrl: i.sourceUrl,
        headline: i.headline,
        summary: i.summary,
        publishedAt: i.publishedAt ?? undefined,
        retrievedAt: i.retrievedAt,
        instruments: i.instruments,
        currencies: i.currencies,
        assets: i.assets,
        impact: i.impact,
        impactEvidence: i.impactEvidence,
        relevanceScore: i.relevanceScore,
        contentHash: i.contentHash,
        freshness: i.freshness,
      })),
    });
    itemsPersisted = res.inserted;
  }

  return {
    status: result.ok && result.items.length > 0 ? "OK" : "UNAVAILABLE",
    provider: result.provider,
    itemsParsed: result.items.length,
    itemsPersisted,
    dropped: result.dropped,
    reason: result.detail,
  };
}

// ---------------------------------------------------------------------------
// Public authenticated actions
// ---------------------------------------------------------------------------

export const refreshMarketData = action({
  args: {
    marketId: v.string(),
    timeframe: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    const limit = args.limit ?? 120;
    if (!Number.isInteger(limit) || limit < 2 || limit > 500)
      throw new Error("INVALID_REQUEST: limit out of range");
    return await doRefreshMarketData(ctx, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      limit,
    });
  },
});

export const refreshNews = action({
  args: { marketId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    return await doRefreshNews(ctx, { marketId: args.marketId });
  },
});

/**
 * The complete authenticated analysis workflow in one call:
 *   request validation -> provider market data -> provider news ->
 *   quality/freshness -> snapshot -> strategy candidates -> risk engine ->
 *   honest verdict -> persisted run. Execution remains disabled throughout.
 */
export const runAnalysisWithFreshData = action({
  args: {
    marketId: v.string(),
    timeframe: v.string(),
    horizon: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    marketDataRefresh: Record<string, unknown>;
    newsRefresh: Record<string, unknown>;
    analysis: AnalysisRunRecord;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");

    const marketDataRefresh = await doRefreshMarketData(ctx, {
      marketId: args.marketId,
      timeframe: args.timeframe,
      limit: 300,
    });
    const newsRefresh = await doRefreshNews(ctx, { marketId: args.marketId });

    const analysis: AnalysisRunRecord = await ctx.runMutation(
      internal.analysis.runInternal,
      {
        ownerUserId: userId,
        marketId: args.marketId,
        timeframe: args.timeframe,
        horizon: args.horizon,
      },
    );

    return { marketDataRefresh, newsRefresh, analysis };
  },
});
