/**
 * SENTINEL PRIME — BOT FITNESS ENGINE (Section 09)
 *
 * Bot Fitness says where a strategy APPEARS suitable or unsuitable. It does NOT
 * authorize trades. Weaknesses are never aggregated away; missing evidence is
 * reported as INSUFFICIENT DATA, never as a favorable default.
 */

import { Metrics, SimTrade } from "./backtest";
import { Candle } from "./quant";

export type FitnessVerdict = "SUITABLE" | "MIXED" | "UNSUITABLE" | "INSUFFICIENT_DATA";

export interface FitnessDimension {
  dimension: string;
  segment: string;
  verdict: FitnessVerdict;
  detail: string;
  sampleSize: number;
}

export const MIN_SEGMENT_TRADES = 5;

/** Deterministic volatility segmentation from ATR%-of-price terciles. */
function volatilitySegment(candles: Candle[], index: number): "LOW" | "MEDIUM" | "HIGH" {
  const pct = candles.map((c) => (c.high - c.low) / c.close);
  const window = pct.slice(Math.max(0, index - 200), index + 1);
  const sorted = [...window].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const v = pct[index];
  if (v <= q(1 / 3)) return "LOW";
  if (v <= q(2 / 3)) return "MEDIUM";
  return "HIGH";
}

export function computeFitness(
  candles: Candle[],
  trades: SimTrade[],
  metrics: Metrics,
  ctx: {
    marketId: string;
    symbol: string;
    timeframe: string;
    assetClass: string;
    spreadBps: number;
    liquidityNote: string;
  },
): { dimensions: FitnessDimension[]; verdict: FitnessVerdict } {
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);
  const dimensions: FitnessDimension[] = [];

  // Market / asset / timeframe: whole-strategy sample, judged on deterministic results.
  const overall: FitnessVerdict =
    metrics.tradeCount === 0
      ? "INSUFFICIENT_DATA"
      : (metrics.netReturn ?? 0) > 0 && (metrics.maxDrawdown ?? 1) <= 0.25
        ? "SUITABLE"
        : (metrics.netReturn ?? 0) > 0
          ? "MIXED"
          : "UNSUITABLE";

  dimensions.push({
    dimension: "market",
    segment: ctx.marketId,
    verdict: metrics.tradeCount >= MIN_SEGMENT_TRADES ? overall : "INSUFFICIENT_DATA",
    detail:
      metrics.tradeCount >= MIN_SEGMENT_TRADES
        ? `${metrics.tradeCount} trades, net return ${metrics.netReturn === null ? "N/A" : (metrics.netReturn * 100).toFixed(2) + "%"}`
        : `Only ${metrics.tradeCount} trades on this market — INSUFFICIENT DATA`,
    sampleSize: metrics.tradeCount,
  });
  dimensions.push({
    dimension: "asset",
    segment: `${ctx.symbol} (${ctx.assetClass})`,
    verdict: metrics.tradeCount >= MIN_SEGMENT_TRADES ? overall : "INSUFFICIENT_DATA",
    detail:
      metrics.tradeCount >= MIN_SEGMENT_TRADES
        ? `Asset-level outcome follows the tested series`
        : `Only ${metrics.tradeCount} trades on this asset — INSUFFICIENT DATA`,
    sampleSize: metrics.tradeCount,
  });
  dimensions.push({
    dimension: "timeframe",
    segment: ctx.timeframe,
    verdict: metrics.tradeCount >= MIN_SEGMENT_TRADES ? overall : "INSUFFICIENT_DATA",
    detail: `All evidence derives from ${ctx.timeframe} closed candles`,
    sampleSize: metrics.tradeCount,
  });

  // Regime / volatility segments: never aggregate away poor segments.
  for (const seg of ["LOW", "MEDIUM", "HIGH"] as const) {
    const segTrades = trades.filter(
      (t) => volatilitySegment(sorted, t.entryIndex) === seg,
    );
    const segNet = segTrades.reduce((a, t) => a + t.netPnl, 0);
    let verdict: FitnessVerdict = "INSUFFICIENT_DATA";
    if (segTrades.length >= MIN_SEGMENT_TRADES) {
      verdict = segNet > 0 ? "SUITABLE" : "UNSUITABLE";
    }
    dimensions.push({
      dimension: "volatility",
      segment: seg,
      verdict,
      detail:
        segTrades.length >= MIN_SEGMENT_TRADES
          ? `${segTrades.length} trades, segment net ${segNet.toFixed(2)}`
          : `Only ${segTrades.length} trades in ${seg} volatility — INSUFFICIENT DATA`,
      sampleSize: segTrades.length,
    });
  }

  // Liquidity and spread are provider/market properties, not strategy results.
  dimensions.push({
    dimension: "liquidity",
    segment: ctx.marketId,
    verdict: "INSUFFICIENT_DATA",
    detail: `${ctx.liquidityNote} — no approved liquidity measurement methodology is configured (SPEC-GAP). INSUFFICIENT DATA.`,
    sampleSize: 0,
  });
  dimensions.push({
    dimension: "spread",
    segment: ctx.symbol,
    verdict: ctx.spreadBps >= 0 && ctx.spreadBps <= 10 ? "SUITABLE" : ctx.spreadBps <= 25 ? "MIXED" : "UNSUITABLE",
    detail: `Modeled spread ${ctx.spreadBps} bps at decision time (declared constant — live spread feed not configured).`,
    sampleSize: metrics.tradeCount,
  });

  const severe = dimensions.filter((d) => d.verdict === "UNSUITABLE").length;
  const unknown = dimensions.filter((d) => d.verdict === "INSUFFICIENT_DATA").length;
  const good = dimensions.filter((d) => d.verdict === "SUITABLE").length;
  const verdict: FitnessVerdict =
    severe > 0
      ? "UNSUITABLE"
      : unknown > 0
        ? "INSUFFICIENT_DATA"
        : good === dimensions.length
          ? "SUITABLE"
          : "MIXED";

  return { dimensions, verdict };
}
