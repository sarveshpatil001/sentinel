/**
 * SENTINEL PRIME — USER PREFERENCES (Section 07 / backend repair)
 *
 * Persisted, server-validated preferences: selected market/instrument,
 * timeframe, analysis horizon and supported notification flags. The client
 * never supplies the symbol — it is derived server-side from the market row.
 *
 * Missing or invalid stored settings are handled safely: an unreadable or
 * out-of-range row is reported as invalid and the caller falls back to the
 * returned defaults (never a crash, never a silently wrong value).
 *
 * Scope note (honest): notification flags are PERSISTED preferences only —
 * this build has no notification delivery channel; nothing is sent anywhere.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { TIMEFRAMES } from "./lib/marketData";
import { ANALYSIS_HORIZONS } from "./analysis";

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/;

function validToken(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && TOKEN_RE.test(x);
}

const notificationValidator = v.object({
  analysisComplete: v.boolean(),
  riskBlocked: v.boolean(),
  providerFailure: v.boolean(),
  highImpactNews: v.boolean(),
});

export interface NormalizedPreferences {
  marketId: string;
  symbol: string;
  timeframe: string;
  horizon: string;
  notifications: {
    analysisComplete: boolean;
    riskBlocked: boolean;
    providerFailure: boolean;
    highImpactNews: boolean;
  };
}

function validTimeframe(x: unknown): x is string {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(TIMEFRAMES, x);
}

function validHorizon(x: unknown): x is string {
  return typeof x === "string" && (ANALYSIS_HORIZONS as readonly string[]).includes(x);
}

/** Read-side validation of a stored row; invalid rows are reported, not used. */
function normalizeStored(
  row: {
    marketId: string;
    symbol: string;
    timeframe: string;
    horizon: string;
    notifications: NormalizedPreferences["notifications"];
  },
  marketIds: Set<string>,
): NormalizedPreferences | null {
  if (
    !validToken(row.marketId) ||
    !marketIds.has(row.marketId) ||
    !validTimeframe(row.timeframe) ||
    !validHorizon(row.horizon) ||
    typeof row.symbol !== "string" ||
    row.symbol.length === 0 ||
    row.symbol.length > 40
  ) {
    return null;
  }
  return {
    marketId: row.marketId,
    symbol: row.symbol,
    timeframe: row.timeframe,
    horizon: row.horizon,
    notifications: {
      analysisComplete: row.notifications.analysisComplete === true,
      riskBlocked: row.notifications.riskBlocked === true,
      providerFailure: row.notifications.providerFailure === true,
      highImpactNews: row.notifications.highImpactNews === true,
    },
  };
}

/**
 * Load preferences for the signed-in user. Returns the saved settings when
 * they are present AND valid; otherwise `saved: null` with safe defaults and
 * an explicit reason — the client must never guess.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    const markets = await ctx.db.query("markets").take(50);
    const marketIds = new Set(markets.map((m) => m.marketId));
    const defaultMarket = markets[0] ?? null;
    const defaults: NormalizedPreferences | null =
      defaultMarket === null
        ? null
        : {
            marketId: defaultMarket.marketId,
            symbol: defaultMarket.symbol,
            timeframe: "1h",
            horizon: "SHORT",
            notifications: {
              analysisComplete: true,
              riskBlocked: true,
              providerFailure: true,
              highImpactNews: false,
            },
          };

    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (row === null) {
      return {
        saved: null,
        defaults,
        reason: defaults === null ? "NO_MARKETS_CONFIGURED" : "NO_SAVED_PREFERENCES",
      };
    }
    const normalized = normalizeStored(row, marketIds);
    if (normalized === null) {
      return {
        saved: null,
        defaults,
        reason: "SAVED_PREFERENCES_INVALID: stored values are out of range for the current configuration; defaults are offered instead.",
      };
    }
    return { saved: normalized, defaults, reason: null };
  },
});

/** Save preferences. Every field is validated server-side before persisting. */
export const save = mutation({
  args: {
    marketId: v.string(),
    timeframe: v.string(),
    horizon: v.string(),
    notifications: notificationValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("UNAUTHENTICATED");
    if (!validToken(args.marketId)) throw new Error("INVALID_REQUEST: bad market identifier");
    if (!validTimeframe(args.timeframe)) throw new Error("INVALID_REQUEST: unsupported timeframe");
    if (!validHorizon(args.horizon)) throw new Error("INVALID_REQUEST: unsupported horizon");

    const market = await ctx.db
      .query("markets")
      .withIndex("by_marketId", (q) => q.eq("marketId", args.marketId))
      .first();
    if (market === null) throw new Error("INVALID_REQUEST: unknown market");

    const now = Date.now();
    const doc = {
      userId,
      marketId: market.marketId,
      symbol: market.symbol, // server-derived; the client cannot spoof it
      timeframe: args.timeframe,
      horizon: args.horizon,
      notifications: {
        analysisComplete: args.notifications.analysisComplete === true,
        riskBlocked: args.notifications.riskBlocked === true,
        providerFailure: args.notifications.providerFailure === true,
        highImpactNews: args.notifications.highImpactNews === true,
      },
      updatedAt: now,
    };

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing === null) {
      await ctx.db.insert("userPreferences", doc);
    } else {
      await ctx.db.replace(existing._id, doc);
    }
    return { ok: true, saved: { ...doc, updatedAt: now } };
  },
});
