/**
 * SENTINEL PRIME — DETERMINISTIC QUANT ENGINE
 *
 * Deterministic component (Section 05). AI must never calculate or override
 * these results (Section 08 "DETERMINISTIC AUTHORITY").
 *
 * Everything in this module is a pure function of its inputs: same inputs,
 * same outputs (Section 18 "REPRODUCIBILITY"). No wall-clock reads, no
 * randomness, no provider access.
 */

export interface Candle {
  eventTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  availabilityTime: number;
}

/** Null means "not computable at this index" — NEVER silently zero (Rule 12). */
export type Series = (number | null)[];

const isFiniteNum = (x: number) => Number.isFinite(x);

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macdLine: Series; signalLine: Series; histogram: Series } {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Series = values.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i]! - slowEma[i]! : null,
  );
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const compact: number[] = [];
  const compactIdx: number[] = [];
  for (let i = Math.max(firstIdx, 0); i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      compact.push(macdLine[i]!);
      compactIdx.push(i);
    }
  }
  const signalCompact = ema(compact, signalPeriod);
  const signalLine: Series = new Array(values.length).fill(null);
  compactIdx.forEach((idx, j) => {
    signalLine[idx] = signalCompact[j];
  });
  const histogram: Series = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? v - signalLine[i]! : null,
  );
  return { macdLine, signalLine, histogram };
}

export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)),
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function bollinger(
  values: number[],
  period = 20,
  multiplier = 2,
): { upper: Series; mid: Series; lower: Series } {
  const mid = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const m = mid[i]!;
    const variance = window.reduce((acc, x) => acc + (x - m) * (x - m), 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = m + multiplier * sd;
    lower[i] = m - multiplier * sd;
  }
  return { upper, mid, lower };
}

// ---------------------------------------------------------------------------
// PERFORMANCE STATISTICS (deterministic; N/A never fabricated — Section 08)
// ---------------------------------------------------------------------------

export interface MetricResult {
  value: number | null;
  note?: string;
}

export function maxDrawdown(equity: number[]): number | null {
  if (equity.length < 2) return null;
  let peak = equity[0];
  let maxDd = 0;
  for (const eq of equity) {
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function peakEquity(equity: number[]): number | null {
  if (equity.length === 0) return null;
  return equity.reduce((a, b) => (b > a ? b : a), equity[0]);
}

/** Arithmetic mean of per-period returns. */
export function sharpe(returns: number[], periodsPerYear: number): number | null {
  const n = returns.length;
  if (n < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance =
    returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0 || !isFiniteNum(sd)) return null;
  return (mean / sd) * Math.sqrt(periodsPerYear);
}

export function sortino(returns: number[], periodsPerYear: number): number | null {
  const n = returns.length;
  if (n < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return null;
  const dVariance =
    downside.reduce((a, b) => a + b * b, 0) / (n - 1);
  const dSd = Math.sqrt(dVariance);
  if (dSd === 0 || !isFiniteNum(dSd)) return null;
  return (mean / dSd) * Math.sqrt(periodsPerYear);
}

export function cagr(
  startEquity: number,
  endEquity: number,
  periods: number,
  periodsPerYear: number,
): number | null {
  if (startEquity <= 0 || periods <= 0) return null;
  const years = periods / periodsPerYear;
  if (years <= 0) return null;
  return Math.pow(endEquity / startEquity, 1 / years) - 1;
}

export function round(x: number | null, digits = 6): number | null {
  if (x === null || !isFiniteNum(x)) return null;
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}
