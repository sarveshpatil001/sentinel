/**
 * SENTINEL PRIME — MARKET NEWS MODULE (Section 06)
 *
 * Persists validated provider news items (source URL, publication + retrieval
 * timestamps, relevance, impact evidence, duplicate detection) and serves
 * bounded, market-scoped reads. Items are shared reference data (no per-user
 * content); no secrets or provider credentials are ever stored here.
 */

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { MutationCtx } from "./lib/store";
import { dedupeNews, NewsItem, newsFreshness, selectHighImpactNews } from "./lib/news";

const MAX_LATEST = 25;

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;

function validToken(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);
}

export const persist = internalMutation({
  args: {
    marketId: v.string(),
    items: v.array(
      v.object({
        provider: v.string(),
        sourceName: v.string(),
        sourceUrl: v.string(),
        headline: v.string(),
        summary: v.string(),
        publishedAt: v.optional(v.number()),
        retrievedAt: v.number(),
        instruments: v.array(v.string()),
        currencies: v.array(v.string()),
        assets: v.array(v.string()),
        impact: v.union(v.literal("HIGH"), v.literal("MEDIUM"), v.literal("UNKNOWN")),
        impactEvidence: v.array(v.string()),
        relevanceScore: v.number(),
        contentHash: v.string(),
        freshness: v.string(),
      }),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    if (args.items.length === 0 || args.items.length > 200)
      throw new Error("INVALID_REQUEST: item count out of range");
    const { unique, duplicates } = dedupeNews(args.items as NewsItem[]);
    let inserted = 0;
    for (const item of unique) {
      const existing = await ctx.db
        .query("newsItems")
        .withIndex("by_contentHash", (q) => q.eq("contentHash", item.contentHash))
        .first();
      if (existing !== null) continue; // duplicate detection at write time
      await ctx.db.insert("newsItems", {
        newsId: `NEWS-${item.contentHash.slice(7, 19)}`,
        provider: item.provider,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        headline: item.headline,
        summary: item.summary,
        publishedAt: item.publishedAt ?? undefined,
        retrievedAt: item.retrievedAt,
        marketId: args.marketId,
        instruments: item.instruments,
        currencies: item.currencies,
        assets: item.assets,
        impact: item.impact,
        impactEvidence: item.impactEvidence,
        relevanceScore: item.relevanceScore,
        contentHash: item.contentHash,
        freshness: item.freshness,
      });
      inserted += 1;
    }
    return { inserted, duplicates: duplicates + (unique.length - inserted) };
  },
});

/** Bounded, market-scoped news read with freshness re-checked at read time. */
export const latest = query({
  args: {
    marketId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    const limit = args.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LATEST)
      throw new Error("INVALID_REQUEST: limit out of range");
    const now = Date.now();
    const rows = await ctx.db
      .query("newsItems")
      .withIndex("by_market_retrieved", (q) => q.eq("marketId", args.marketId))
      .order("desc")
      .take(limit);
    return rows.map((n) => ({
      newsId: n.newsId,
      provider: n.provider,
      sourceName: n.sourceName,
      sourceUrl: n.sourceUrl,
      headline: n.headline,
      summary: n.summary,
      publishedAt: n.publishedAt ?? null,
      retrievedAt: n.retrievedAt,
      impact: n.impact,
      impactEvidence: n.impactEvidence,
      relevanceScore: n.relevanceScore,
      // Freshness is recomputed at read time — a stored "FRESH" never ages
      // into a lie.
      freshness: newsFreshness(n.publishedAt ?? null, now),
    }));
  },
});

/** Most relevant high-impact item right now, or an honest null + reason. */
export const topImpact = query({
  args: { marketId: v.string() },
  handler: async (ctx, args) => {
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    const now = Date.now();
    const rows = await ctx.db
      .query("newsItems")
      .withIndex("by_market_retrieved", (q) => q.eq("marketId", args.marketId))
      .order("desc")
      .take(20);
    const selection = selectHighImpactNews(
      rows.map(
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
          impact: n.impact,
          impactEvidence: n.impactEvidence,
          relevanceScore: n.relevanceScore,
          contentHash: n.contentHash,
          freshness: newsFreshness(n.publishedAt ?? null, now),
        }),
      ),
      now,
    );
    return {
      selected:
        selection.selected === null
          ? null
          : {
              newsId: rows.find((n) => n.contentHash === selection.selected!.contentHash)?.newsId ?? null,
              provider: selection.selected.provider,
              sourceName: selection.selected.sourceName,
              sourceUrl: selection.selected.sourceUrl,
              headline: selection.selected.headline,
              publishedAt: selection.selected.publishedAt,
              retrievedAt: selection.selected.retrievedAt,
              impact: selection.selected.impact,
              impactEvidence: selection.selected.impactEvidence,
              freshness: selection.selected.freshness,
            },
      reason: selection.reason,
      considered: selection.considered,
    };
  },
});
