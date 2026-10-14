/**
 * SENTINEL PRIME — STRATEGY CANDIDATE EVALUATION (Sections 07/08)
 *
 * Deterministic evaluation of REGISTERED structured strategy candidates
 * against validated candles. Pure function of its inputs (Section 18).
 *
 * Honesty rules:
 *   - Insufficient data => signal "NOT_EVALUATED" with the reason. A result is
 *     NEVER fabricated to fill a slot.
 *   - Indicator values that are not computable are `null`, never 0.
 *   - The entry rule is the candidate's OWN declared definition
 *     (`entry: ema_cross` with fast/slow, plus the RSI no-trade filter) — no
 *     extra rules are invented, and no backtest metrics are claimed here.
 *   - Exit levels (stop-loss / take-profit) are NOT computed or presented as
 *     recommendations; they belong to the validated backtest path.
 */

import { Candle, ema, rsi, Series } from "./quant";
import type { StrategyDefinition } from "./backtest";

export type StrategySignal = "LONG" | "SHORT" | "FLAT" | "NOT_EVALUATED";

export interface StrategyEvaluationEvidence {
  barsAvailable: number;
  barsRequired: number;
  lastClose: number | null;
  prevFastEma: number | null;
  prevSlowEma: number | null;
  fastEma: number | null;
  slowEma: number | null;
  rsi: number | null;
  rsiBounds: { min: number | null; max: number | null };
  entryIndicator: string;
}

export interface StrategyEvaluation {
  strategyId: string;
  strategyVersionId: string;
  strategyName: string;
  evaluated: boolean;
  signal: StrategySignal;
  reason: string;
  evidence: StrategyEvaluationEvidence;
}

const RSI_PERIOD = 14;

function lastNonNull(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i];
  }
  return null;
}

function at(series: Series, index: number): number | null {
  return index >= 0 && index < series.length ? series[index] : null;
}

function positiveInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 10_000;
}

/**
 * Evaluate one strategy candidate on a validated, ascending candle series.
 * Garbage definitions fail honest (NOT_EVALUATED), never permissive.
 */
export function evaluateStrategyDefinition(
  def: StrategyDefinition | null | undefined,
  candles: Candle[],
  ids: { strategyId: string; strategyVersionId: string; strategyName: string },
): StrategyEvaluation {
  const emptyEvidence = (barsRequired: number): StrategyEvaluationEvidence => ({
    barsAvailable: candles.length,
    barsRequired,
    lastClose: null,
    prevFastEma: null,
    prevSlowEma: null,
    fastEma: null,
    slowEma: null,
    rsi: null,
    rsiBounds: { min: null, max: null },
    entryIndicator: "unknown",
  });

  if (
    def === null ||
    def === undefined ||
    !def.entry ||
    def.entry.indicator !== "ema_cross" ||
    !positiveInt(def.entry.fast) ||
    !positiveInt(def.entry.slow) ||
    def.entry.fast >= def.entry.slow
  ) {
    return {
      ...ids,
      evaluated: false,
      signal: "NOT_EVALUATED",
      reason:
        "Strategy definition is missing or not a valid structured ema_cross candidate (fast/slow must be positive integers with fast < slow). No result fabricated.",
      evidence: emptyEvidence(0),
    };
  }

  const { fast, slow } = def.entry;
  // EMA seeding needs `slow` bars; a crossover comparison needs one more bar;
  // the RSI filter needs RSI_PERIOD + 1 closes.
  const barsRequired = Math.max(slow + 2, RSI_PERIOD + 2);
  if (candles.length < barsRequired) {
    return {
      ...ids,
      evaluated: false,
      signal: "NOT_EVALUATED",
      reason: `Insufficient validated candles: ${candles.length} available, ${barsRequired} required for this candidate. No result fabricated.`,
      evidence: {
        ...emptyEvidence(barsRequired),
        lastClose: candles.length > 0 ? candles[candles.length - 1].close : null,
        entryIndicator: "ema_cross",
      },
    };
  }

  const closes = candles.map((c) => c.close);
  const fastEma: Series = ema(closes, fast);
  const slowEma: Series = ema(closes, slow);
  const rsiSeries: Series = rsi(closes, RSI_PERIOD);

  const i = candles.length - 1;
  const prev = i - 1;
  const f1 = at(fastEma, i);
  const s1 = at(slowEma, i);
  const f0 = at(fastEma, prev);
  const s0 = at(slowEma, prev);
  const rsiNow = at(rsiSeries, i);

  const evidence: StrategyEvaluationEvidence = {
    barsAvailable: candles.length,
    barsRequired,
    lastClose: candles[i].close,
    prevFastEma: f0,
    prevSlowEma: s0,
    fastEma: f1,
    slowEma: s1,
    rsi: rsiNow,
    rsiBounds: { min: def.filters?.rsiMin ?? null, max: def.filters?.rsiMax ?? null },
    entryIndicator: "ema_cross",
  };

  if (f1 === null || s1 === null || f0 === null || s0 === null) {
    return {
      ...ids,
      evaluated: false,
      signal: "NOT_EVALUATED",
      reason: "EMA series not computable on the supplied data — no signal asserted.",
      evidence,
    };
  }

  const crossedUp = f0 <= s0 && f1 > s1;
  const crossedDown = f0 >= s0 && f1 < s1;

  if (!crossedUp && !crossedDown) {
    return {
      ...ids,
      evaluated: true,
      signal: "FLAT",
      reason:
        "No ema_cross entry trigger on the latest completed bar (fast EMA did not cross the slow EMA). Candidate proposes no entry.",
      evidence,
    };
  }

  // RSI no-trade filter (declared in the candidate definition).
  const rsiMin = def.filters?.rsiMin ?? null;
  const rsiMax = def.filters?.rsiMax ?? null;
  if (rsiNow === null) {
    return {
      ...ids,
      evaluated: true,
      signal: "FLAT",
      reason: "Entry trigger present but RSI is not computable — the declared RSI filter cannot be satisfied. No entry proposed.",
      evidence,
    };
  }
  if ((rsiMin !== null && rsiNow < rsiMin) || (rsiMax !== null && rsiNow > rsiMax)) {
    return {
      ...ids,
      evaluated: true,
      signal: "FLAT",
      reason: `Entry trigger present but RSI ${rsiNow.toFixed(2)} is outside the declared no-trade bounds [${rsiMin ?? "-inf"}, ${rsiMax ?? "+inf"}] — candidate proposes no entry.`,
      evidence,
    };
  }

  return {
    ...ids,
    evaluated: true,
    signal: crossedUp ? "LONG" : "SHORT",
    reason: crossedUp
      ? `fast EMA (${fast}) crossed above slow EMA (${slow}) on the latest completed bar; RSI ${rsiNow.toFixed(2)} within declared bounds.`
      : `fast EMA (${fast}) crossed below slow EMA (${slow}) on the latest completed bar; RSI ${rsiNow.toFixed(2)} within declared bounds.`,
    evidence,
  };
}

/** Convenience: indicator series accessor kept for evidence consumers. */
export function lastComputable(series: Series): number | null {
  return lastNonNull(series);
}
