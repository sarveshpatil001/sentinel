/**
 * SENTINEL PRIME — DETERMINISTIC BACKTEST / SIMULATION ENGINE (Section 08)
 *
 * Deterministic authority: PnL, equity, fees, slippage, drawdown, trade counts,
 * exposure, returns, Sharpe, Sortino, profit factor, expectancy, chronology and
 * fill simulation are computed HERE and nowhere else. AI may interpret these
 * numbers; it may never calculate or replace them.
 *
 * Execution realism rules enforced:
 *  - Signals evaluated on CLOSED candles only; execution at next bar open
 *    (no same-candle optimistic fills).
 *  - If SL and TP are both touched within one candle and the sequence cannot be
 *    determined, the CONSERVATIVE (lower-bound PnL) outcome is used. The
 *    favorable outcome is never chosen because it improves results (Section 08).
 *  - Costs are explicit and versioned; stress scenarios re-run the simulation
 *    with perturbed cost models rather than scaling results.
 *  - Missing data yields INSUFFICIENT/no-signal behavior, never fabricated bars.
 */

import {
  Candle,
  Series,
  atr,
  bollinger,
  cagr,
  ema,
  macd,
  maxDrawdown,
  peakEquity,
  rsi,
  round,
  sharpe,
  sma,
  sortino,
} from "./quant";

export const ENGINE_VERSION = "sp-sim-1.0.0";
export const FEATURE_VERSION = "sp-features-1.0.0";
export const EXECUTION_MODEL_VERSION = "sp-exec-nextopen-conservative-1.0.0";

export type CostModel =
  | { kind: "none"; version: string }
  | { kind: "percentage"; version: string; feeRate: number; slippageBps: number };

export interface StrategyDefinition {
  marketId: string;
  symbol: string;
  timeframe: string;
  /** Entry uses structured conditions only — no executable code (Section 07). */
  entry: { indicator: "ema_cross"; fast: number; slow: number };
  exit: {
    stopLossPct: number | null;
    takeProfitPct: number | null;
    timeExitBars: number | null;
  };
  filters: {
    /** No-trade rule: skip entries when RSI is beyond these bounds. */
    rsiMin: number | null;
    rsiMax: number | null;
  };
  sizing: { kind: "fixed_fraction"; fraction: number };
}

export interface ValidationConfig {
  /** Explicit, declared split. If null, OOS is NOT ASSESSABLE (never invented). */
  oosSplitFraction: number | null;
  startingEquity: number;
  periodsPerYear: number;
}

export interface SimTrade {
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  side: "LONG";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  netPnl: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "TIME_EXIT" | "END_OF_DATA";
  ambiguousIntrabar: boolean;
}

export interface Metrics {
  startingEquity: number | null;
  endingEquity: number | null;
  netReturn: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  peakEquity: number | null;
  sharpe: number | null;
  sortino: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  tradeCount: number;
  averageTrade: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  exposure: number | null;
  turnover: number | null;
  fees: number | null;
  slippage: number | null;
}

export const NA_METRICS: Metrics = {
  startingEquity: null,
  endingEquity: null,
  netReturn: null,
  cagr: null,
  maxDrawdown: null,
  peakEquity: null,
  sharpe: null,
  sortino: null,
  winRate: null,
  profitFactor: null,
  expectancy: null,
  tradeCount: 0,
  averageTrade: null,
  averageWin: null,
  averageLoss: null,
  exposure: null,
  turnover: null,
  fees: null,
  slippage: null,
};

export interface StressScenario {
  name: string;
  feeMultiplier: number;
  slippageMultiplier: number;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  { name: "NORMAL", feeMultiplier: 1, slippageMultiplier: 1 },
  { name: "FEES +25%", feeMultiplier: 1.25, slippageMultiplier: 1 },
  { name: "FEES +50%", feeMultiplier: 1.5, slippageMultiplier: 1 },
  { name: "SLIPPAGE +25%", feeMultiplier: 1, slippageMultiplier: 1.25 },
  { name: "SLIPPAGE +50%", feeMultiplier: 1, slippageMultiplier: 1.5 },
  { name: "SLIPPAGE +100%", feeMultiplier: 1, slippageMultiplier: 2 },
];

export interface SimulationResult {
  trades: SimTrade[];
  equityCurve: { time: number; equity: number }[];
  metrics: Metrics;
  insufficientReasons: string[];
}

interface FeatureSet {
  emaFast: Series;
  emaSlow: Series;
  rsi: Series;
  atr: Series;
}

function computeFeatures(candles: Candle[], def: StrategyDefinition): FeatureSet {
  const closes = candles.map((c) => c.close);
  return {
    emaFast: ema(closes, def.entry.fast),
    emaSlow: ema(closes, def.entry.slow),
    rsi: rsi(closes, 14),
    atr: atr(candles, 14),
  };
}

/**
 * Deterministic simulation. Chronologically walks CLOSED candles; every value
 * consumed at bar i has availability_time <= decision time of bar i.
 */
export function simulate(
  candles: Candle[],
  def: StrategyDefinition,
  config: ValidationConfig,
  cost: CostModel,
  costMultipliers: { fee: number; slippage: number } = { fee: 1, slippage: 1 },
): SimulationResult {
  const insufficientReasons: string[] = [];
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);

  if (sorted.length < Math.max(def.entry.slow, def.entry.fast) + 2) {
    insufficientReasons.push(
      "INSUFFICIENT DATA: fewer candles than the indicator warm-up window",
    );
    return { trades: [], equityCurve: [], metrics: NA_METRICS, insufficientReasons };
  }

  const f = computeFeatures(sorted, def);
  const feeRate = cost.kind === "percentage" ? cost.feeRate * costMultipliers.fee : 0;
  const slippageBps =
    cost.kind === "percentage" ? cost.slippageBps * costMultipliers.slippage : 0;

  let equity = config.startingEquity;
  const equityCurve: { time: number; equity: number }[] = [
    { time: sorted[0].eventTime, equity },
  ];
  const trades: SimTrade[] = [];
  let inPosition = false;
  let entryPrice = 0;
  let entryIndex = 0;
  let quantity = 0;
  let entryFees = 0;
  let entrySlippage = 0;
  let barsHeld = 0;

  const closePosition = (
    exitIndex: number,
    rawExitPrice: number,
    exitReason: SimTrade["exitReason"],
    ambiguous: boolean,
  ) => {
    const slip = rawExitPrice * (slippageBps / 10000);
    const exitPrice = rawExitPrice - slip; // long exit: slippage worsens the price
    const grossPnl = (exitPrice - entryPrice) * quantity;
    const exitFees = exitPrice * quantity * feeRate;
    const fees = entryFees + exitFees;
    const slippageCost = entrySlippage + slip * quantity;
    const netPnl = grossPnl - exitFees;
    equity += netPnl;
    trades.push({
      entryIndex,
      exitIndex,
      entryTime: sorted[entryIndex].eventTime,
      exitTime: sorted[exitIndex].eventTime,
      side: "LONG",
      entryPrice,
      exitPrice,
      quantity,
      grossPnl,
      fees,
      slippage: slippageCost,
      netPnl,
      exitReason,
      ambiguousIntrabar: ambiguous,
    });
    equityCurve.push({ time: sorted[exitIndex].eventTime, equity });
    inPosition = false;
    barsHeld = 0;
  };

  for (let i = 1; i < sorted.length; i++) {
    const bar = sorted[i];
    const prev = i - 1;

    if (inPosition) {
      barsHeld++;
      const slPct = def.exit.stopLossPct;
      const tpPct = def.exit.takeProfitPct;

      // Conservative intrabar resolution (Section 08 / TEST-EXEC ambiguous candle):
      // if both SL and TP are inside [low, high] the sequence is unknowable, so the
      // lower-bound (worse) outcome is used.
      const longSlPrice = slPct !== null ? entryPrice * (1 - slPct) : null;
      const longTpPrice = tpPct !== null ? entryPrice * (1 + tpPct) : null;
      const slHit = longSlPrice !== null && bar.low <= longSlPrice;
      const tpHit = longTpPrice !== null && bar.high >= longTpPrice;

      if (slHit && tpHit) {
        closePosition(i, longSlPrice!, "STOP_LOSS", true);
      } else if (slHit) {
        closePosition(i, longSlPrice!, "STOP_LOSS", false);
      } else if (tpHit) {
        closePosition(i, longTpPrice!, "TAKE_PROFIT", false);
      } else if (
        def.exit.timeExitBars !== null &&
        barsHeld >= def.exit.timeExitBars
      ) {
        closePosition(i, bar.close, "TIME_EXIT", false);
      }
    }

    if (!inPosition && i < sorted.length - 1) {
      // Signal on the CLOSE of bar `prev`, executed at OPEN of the NEXT bar (`i`).
      const fastPrev = f.emaFast[prev];
      const slowPrev = f.emaSlow[prev];
      const fastPrevPrev = f.emaFast[prev - 1];
      const slowPrevPrev = f.emaSlow[prev - 1];
      const rsiPrev = f.rsi[prev];

      if (
        fastPrev === null ||
        slowPrev === null ||
        fastPrevPrev === null ||
        slowPrevPrev === null
      ) {
        // Warm-up region: no signal. Missing != zero.
      } else {
        const crossedUp =
          fastPrevPrev <= slowPrevPrev && fastPrev > slowPrev;
        const filterPass =
          (def.filters.rsiMin === null ||
            (rsiPrev !== null && rsiPrev >= def.filters.rsiMin)) &&
          (def.filters.rsiMax === null ||
            (rsiPrev !== null && rsiPrev <= def.filters.rsiMax));

        if (crossedUp && filterPass) {
          const rawEntry = bar.open;
          const slip = rawEntry * (slippageBps / 10000);
          entryPrice = rawEntry + slip; // long entry: slippage worsens the price
          const notional = equity * def.sizing.fraction;
          quantity = notional / entryPrice;
          entryFees = entryPrice * quantity * feeRate;
          entrySlippage = slip * quantity;
          entryIndex = i;
          inPosition = true;
        }
      }
    }
  }

  if (inPosition) {
    // Open position closed at final close for reporting; flagged END_OF_DATA.
    closePosition(sorted.length - 1, sorted[sorted.length - 1].close, "END_OF_DATA", false);
  }

  const metrics = computeMetrics(trades, equityCurve, config);
  return { trades, equityCurve, metrics, insufficientReasons };
}

export function computeMetrics(
  trades: SimTrade[],
  equityCurve: { time: number; equity: number }[],
  config: ValidationConfig,
): Metrics {
  if (trades.length === 0) {
    return { ...NA_METRICS, startingEquity: config.startingEquity, tradeCount: 0 };
  }
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const netPnl = trades.reduce((a, t) => a + t.netPnl, 0);
  const equity = equityCurve.map((p) => p.equity);
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) returns.push(equity[i] / equity[i - 1] - 1);
  }
  const fees = trades.reduce((a, t) => a + t.fees, 0);
  const slippage = trades.reduce((a, t) => a + t.slippage, 0);
  const barsInMarket = trades.reduce((a, t) => a + (t.exitIndex - t.entryIndex), 0);

  return {
    startingEquity: config.startingEquity,
    endingEquity: equity[equity.length - 1],
    netReturn: config.startingEquity > 0 ? netPnl / config.startingEquity : null,
    cagr: cagr(
      config.startingEquity,
      equity[equity.length - 1],
      equity.length - 1,
      config.periodsPerYear,
    ),
    maxDrawdown: maxDrawdown(equity),
    peakEquity: peakEquity(equity),
    sharpe: sharpe(returns, config.periodsPerYear),
    sortino: sortino(returns, config.periodsPerYear),
    winRate: wins.length / trades.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: netPnl / trades.length,
    tradeCount: trades.length,
    averageTrade: netPnl / trades.length,
    averageWin: wins.length > 0 ? grossWin / wins.length : null,
    averageLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    exposure: equity.length > 1 ? barsInMarket / (equity.length - 1) : null,
    turnover: trades.reduce((a, t) => a + t.entryPrice * t.quantity, 0),
    fees: round(fees, 2),
    slippage: round(slippage, 2),
  };
}

export interface SplitResult {
  inSample: Metrics;
  oos: Metrics | null;
  oosState: "ASSESSED" | "NOT_ASSESSABLE";
  oosNote: string;
  splitIndex: number | null;
}

/**
 * Train/development and OOS remain distinct and time-ordered. The split
 * fraction must be explicitly declared in the validation config — this engine
 * will NOT invent one (Section 08 "Exact split percentages MUST NOT be
 * invented"). No shuffling of time-series data.
 */
export function splitMetrics(
  candles: Candle[],
  result: SimulationResult,
  config: ValidationConfig,
): SplitResult {
  if (candles.length === 0 || result.equityCurve.length < 2) {
    return {
      inSample: result.metrics,
      oos: null,
      oosState: "NOT_ASSESSABLE",
      oosNote: "INSUFFICIENT DATA for a chronological split",
      splitIndex: null,
    };
  }
  if (config.oosSplitFraction === null) {
    return {
      inSample: result.metrics,
      oos: null,
      oosState: "NOT_ASSESSABLE",
      oosNote:
        "No OOS split fraction declared in the validation configuration. NOT ASSESSABLE — a split percentage must not be invented.",
      splitIndex: null,
    };
  }
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);
  const splitTime =
    sorted[Math.floor(sorted.length * (1 - config.oosSplitFraction))].eventTime;
  const inSampleTrades = result.trades.filter((t) => t.exitTime <= splitTime);
  const oosTrades = result.trades.filter((t) => t.entryTime > splitTime);
  const inSampleCurve = result.equityCurve.filter((p) => p.time <= splitTime);
  const oosCurve = result.equityCurve.filter((p) => p.time > splitTime);
  const oosStartEquity =
    inSampleCurve.length > 0
      ? inSampleCurve[inSampleCurve.length - 1].equity
      : config.startingEquity;

  return {
    inSample: computeMetrics(inSampleTrades, inSampleCurve, {
      ...config,
      startingEquity: config.startingEquity,
    }),
    oos: computeMetrics(oosTrades, oosCurve, {
      ...config,
      startingEquity: oosStartEquity,
    }),
    oosState: "ASSESSED",
    oosNote: `Chronological split at ${new Date(splitTime).toISOString()} (fraction ${config.oosSplitFraction} declared in validation config).`,
    splitIndex: Math.floor(sorted.length * (1 - config.oosSplitFraction)),
  };
}

export function runStress(
  candles: Candle[],
  def: StrategyDefinition,
  config: ValidationConfig,
  cost: CostModel,
): { scenario: string; metrics: Metrics }[] {
  return STRESS_SCENARIOS.map((s) => ({
    scenario: s.name,
    metrics: simulate(candles, def, config, cost, {
      fee: s.feeMultiplier,
      slippage: s.slippageMultiplier,
    }).metrics,
  }));
}

// Feature projections exported for reproducibility reporting.
export function featureSummary(candles: Candle[], def: StrategyDefinition) {
  const closes = candles.map((c) => c.close);
  return {
    sma20_last: sma(closes, 20).slice(-1)[0] ?? null,
    emaFast_last: ema(closes, def.entry.fast).slice(-1)[0] ?? null,
    emaSlow_last: ema(closes, def.entry.slow).slice(-1)[0] ?? null,
    rsi14_last: rsi(closes, 14).slice(-1)[0] ?? null,
    macd_last: macd(closes).histogram.slice(-1)[0] ?? null,
    bollinger_mid_last: bollinger(closes).mid.slice(-1)[0] ?? null,
    atr14_last: atr(candles, 14).slice(-1)[0] ?? null,
    note: "All features computed on closed candles with availability_time <= decision_time.",
  };
}
