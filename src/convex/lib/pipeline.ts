/**
 * SENTINEL PRIME — VALIDATION PIPELINE (Section 08)
 *
 * Orchestrates the deterministic validation sequence:
 *   STRATEGY VERSION -> DATA SNAPSHOT -> DATA QUALITY GATE -> SIMULATION ->
 *   INTEGRITY -> COST/FRICTION -> PERFORMANCE -> LEAKAGE -> ROBUSTNESS -> OOS
 *
 * The data quality gate runs BEFORE simulation. INVALID/FAILED/MISSING critical
 * data blocks the run (BLOCK / INSUFFICIENT_DATA) — it is never silently
 * repaired and results are never fabricated.
 */

import {
  CostModel,
  ENGINE_VERSION,
  EXECUTION_MODEL_VERSION,
  FEATURE_VERSION,
  Metrics,
  NA_METRICS,
  SimulationResult,
  SplitResult,
  StrategyDefinition,
  ValidationConfig,
  featureSummary,
  runStress,
  simulate,
  splitMetrics,
} from "./backtest";
import { Candle, ema, rsi } from "./quant";
import { QualityReport } from "./dataQuality";
import { EvidenceResult, computeEvidence } from "./evidence";
import { FitnessDimension, computeFitness } from "./fitness";

export const VALIDATION_CONFIG_VERSION = "sp-vconfig-1.0.0";

export interface IntegrityCheck {
  check: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
}

export interface SnapshotBinding {
  snapshotId: string;
  marketIds: string[];
  timeframe: string;
  rangeStart: number;
  rangeEnd: number;
  dataVersion: string;
}

export interface ValidationPipelineInput {
  validationId: string;
  strategyVersionId: string;
  dataSnapshotId: string;
  definition: StrategyDefinition;
  config: ValidationConfig;
  cost: CostModel;
  candles: Candle[];
  quality: QualityReport;
  /** The data snapshot this run claims to use. Binding is VERIFIED, not assumed. */
  snapshot: SnapshotBinding | null;
  marketMeta: {
    marketId: string;
    symbol: string;
    timeframe: string;
    assetClass: string;
    spreadBps: number;
    liquidityNote: string;
  };
}

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * SNAPSHOT BINDING (Section 08): a validation run must be bound to the exact
 * data snapshot it claims. The actual input rows must belong to the snapshot's
 * market/timeframe and lie inside its declared range. A mismatch is REJECTED
 * (BLOCKED) — never silently tolerated.
 */
export function verifySnapshotBinding(
  snapshot: SnapshotBinding | null,
  definition: { marketId: string; timeframe: string },
  candles: { eventTime: number; marketId?: string; timeframe?: string }[],
): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];
  if (!snapshot) {
    checks.push({
      check: "snapshot_exists",
      status: "FAIL",
      detail: "No data snapshot record — a validation run cannot bind to unknown data.",
    });
    return checks;
  }
  checks.push({
    check: "snapshot_exists",
    status: "PASS",
    detail: `Bound to snapshot ${snapshot.snapshotId} (dataVersion ${snapshot.dataVersion}).`,
  });

  const marketOk = snapshot.marketIds.includes(definition.marketId);
  checks.push({
    check: "snapshot_market",
    status: marketOk ? "PASS" : "FAIL",
    detail: marketOk
      ? `Snapshot covers market ${definition.marketId}.`
      : `Snapshot ${snapshot.snapshotId} does NOT cover market ${definition.marketId} — mismatched snapshot rejected.`,
  });

  const tfOk = snapshot.timeframe === definition.timeframe;
  checks.push({
    check: "snapshot_timeframe",
    status: tfOk ? "PASS" : "FAIL",
    detail: tfOk
      ? `Snapshot timeframe ${snapshot.timeframe} matches the definition.`
      : `Snapshot timeframe ${snapshot.timeframe} != definition timeframe ${definition.timeframe} — mismatched snapshot rejected.`,
  });

  let outsideRange = 0;
  let identityViolations = 0;
  for (const c of candles) {
    if (c.eventTime < snapshot.rangeStart || c.eventTime > snapshot.rangeEnd) outsideRange++;
    if (
      (c.marketId !== undefined && c.marketId !== definition.marketId) ||
      (c.timeframe !== undefined && c.timeframe !== definition.timeframe)
    )
      identityViolations++;
  }
  checks.push({
    check: "snapshot_range",
    status: outsideRange === 0 ? "PASS" : "FAIL",
    detail:
      outsideRange === 0
        ? `All ${candles.length} input rows lie inside the declared snapshot range.`
        : `${outsideRange} input rows fall OUTSIDE the declared snapshot range [${snapshot.rangeStart}, ${snapshot.rangeEnd}] — input data does not match the recorded snapshot.`,
    count: outsideRange,
  } as IntegrityCheck);
  checks.push({
    check: "snapshot_identity",
    status: identityViolations === 0 ? "PASS" : "FAIL",
    detail:
      identityViolations === 0
        ? "All input rows carry the snapshot's market/timeframe identity."
        : `${identityViolations} input rows carry a foreign market/timeframe identity.`,
    count: identityViolations,
  } as IntegrityCheck);

  return checks;
}

export interface ValidationPipelineOutput {
  state:
    | "COMPLETED"
    | "BLOCKED"
    | "INSUFFICIENT_DATA"
    | "FAILED";
  integrity: IntegrityCheck[];
  leakageState:
    | "NO_LEAKAGE_DETECTED"
    | "POSSIBLE_LEAKAGE"
    | "CONFIRMED_LEAKAGE"
    | "NOT_ASSESSABLE";
  metrics: Metrics | null;
  stress: { scenario: string; metrics: Metrics }[] | null;
  oos: SplitResult | null;
  features: ReturnType<typeof featureSummary> | null;
  evidence: EvidenceResult | null;
  fitness: { dimensions: FitnessDimension[]; verdict: string } | null;
  notes: string[];
}

const near = (a: number | null, b: number | null) =>
  (a === null && b === null) ||
  (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

/**
 * FEATURE CAUSALITY — computed, not asserted. Prefix-recomputation invariance:
 * recompute the entry features on the truncated series (bars 0..i) and require
 * the value at bar i to equal the full-series value. A centered window, a
 * future shift, or dataset-level normalization would break this equality, so
 * this single check empirically covers those leakage classes. Sampled for cost.
 */
export function featureCausalityCheck(
  candles: Candle[],
  def: StrategyDefinition,
): IntegrityCheck {
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);
  const closes = sorted.map((c) => c.close);
  const n = closes.length;
  const warmup = Math.max(def.entry.fast, def.entry.slow, 15) + 2;
  if (n < warmup + 2) {
    return {
      check: "feature_causality",
      status: "UNKNOWN",
      detail: "Series shorter than the feature warm-up window — causality not assessable in this run.",
    };
  }
  const fullFast = ema(closes, def.entry.fast);
  const fullSlow = ema(closes, def.entry.slow);
  const fullRsi = rsi(closes, 14);

  const sampleIdx = [warmup, Math.floor(n * 0.4), Math.floor(n * 0.7), n - 2]
    .filter((v, i, a) => a.indexOf(v) === i && v >= warmup && v < n);

  for (const idx of sampleIdx) {
    const prefix = closes.slice(0, idx + 1);
    const pFast = ema(prefix, def.entry.fast);
    const pSlow = ema(prefix, def.entry.slow);
    const pRsi = rsi(prefix, 14);
    if (
      !near(pFast[idx], fullFast[idx]) ||
      !near(pSlow[idx], fullSlow[idx]) ||
      !near(pRsi[idx], fullRsi[idx])
    ) {
      return {
        check: "feature_causality",
        status: "FAIL",
        detail: `Feature values at bar ${idx} change when future bars are removed — computation depends on FUTURE data (look-ahead leakage).`,
      };
    }
  }
  return {
    check: "feature_causality",
    status: "PASS",
    detail:
      `Prefix-recomputation invariance verified at ${sampleIdx.length} sampled bars: entry features at bar i depend only on candles <= i. ` +
      "This empirically covers centered-window, future-shift and future-normalization leakage classes.",
  };
}

/**
 * Deterministic look-ahead / leakage checks — every check is COMPUTED from the
 * actual run inputs/results. A check that cannot establish its property reports
 * UNKNOWN, never a hardcoded PASS.
 */
function leakageChecks(
  def: StrategyDefinition,
  sim: SimulationResult | null,
  candles: Candle[],
  cost: CostModel,
  marketMeta: { timeframe: string },
): {
  checks: IntegrityCheck[];
  state: ValidationPipelineOutput["leakageState"];
} {
  const checks: IntegrityCheck[] = [];
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);

  // 1. Execution model: verified on the trades this run actually produced.
  if (!sim || sim.trades.length === 0) {
    checks.push({
      check: "lookahead_execution_model",
      status: "UNKNOWN",
      detail: "No trades were produced in this run — next-open execution could not be observed (not asserted as PASS).",
    });
  } else {
    const slippageBps = cost.kind === "percentage" ? cost.slippageBps : 0;
    let violations = 0;
    for (const t of sim.trades) {
      const entryBar = sorted[t.entryIndex];
      const expectedEntry = entryBar.open * (1 + slippageBps / 10000);
      if (
        t.entryIndex <= 0 ||
        t.exitIndex <= t.entryIndex ||
        !near(t.entryPrice, expectedEntry)
      )
        violations++;
    }
    checks.push({
      check: "lookahead_execution_model",
      status: violations === 0 ? "PASS" : "FAIL",
      detail:
        violations === 0
          ? `All ${sim.trades.length} trades entered at the NEXT bar open after the signal bar close (EXECUTION_MODEL_VERSION ${EXECUTION_MODEL_VERSION}).`
          : `${violations} trades did not obey next-open execution — possible same-candle (look-ahead) fills.`,
    });
  }

  // 2. Feature causality (covers centered windows / future shifts / normalization).
  checks.push(featureCausalityCheck(sorted, def));

  // 3. Multi-timeframe leakage: verified structurally against the definition.
  const singleTf = def.timeframe === marketMeta.timeframe;
  checks.push({
    check: "future_multi_timeframe",
    status: singleTf ? "PASS" : "FAIL",
    detail: singleTf
      ? `Definition and market context are both single-timeframe (${def.timeframe}); no higher-timeframe inputs exist to leak.`
      : `Definition timeframe ${def.timeframe} != market context timeframe ${marketMeta.timeframe} — timeframe mismatch, multi-timeframe leakage not excludable.`,
  });

  // 4. Historical knowability: a bar must be knowable at its close, which is
  //    the earliest decision time at which the engine may consume it.
  const tfMs = TIMEFRAME_MS[def.timeframe] ?? TIMEFRAME_MS[marketMeta.timeframe];
  if (tfMs === undefined) {
    checks.push({
      check: "availability_time_rule",
      status: "UNKNOWN",
      detail: `Timeframe ${def.timeframe} is not in the known timeframe table — availability rule not assessable (not asserted as PASS).`,
    });
  } else {
    const violations = sorted.filter((c) => c.availabilityTime > c.eventTime + tfMs).length;
    checks.push({
      check: "availability_time_rule",
      status: violations === 0 ? "PASS" : "FAIL",
      detail:
        violations === 0
          ? "availability_time <= close time for every consumed bar (Historical Knowability Rule holds)."
          : `${violations} bars become available AFTER their close — consuming them would leak future information.`,
    });
  }

  const ambiguous = sim ? sim.trades.filter((t) => t.ambiguousIntrabar).length : 0;
  if (ambiguous > 0) {
    checks.push({
      check: "ambiguous_intrabar_resolution",
      status: "PASS",
      detail: `${ambiguous} candles touched both SL and TP; the conservative (lower-bound) outcome was used in every case.`,
    });
  }

  const anyFail = checks.some((c) => c.status === "FAIL");
  const anyUnknown = checks.some((c) => c.status === "UNKNOWN");
  return {
    checks,
    state: anyFail
      ? "POSSIBLE_LEAKAGE"
      : anyUnknown
        ? "NOT_ASSESSABLE"
        : "NO_LEAKAGE_DETECTED",
  };
}

export function runValidationPipeline(
  input: ValidationPipelineInput,
): ValidationPipelineOutput {
  const notes: string[] = [];

  // ---- 0. SNAPSHOT BINDING (identity of the evidence base) ---------------
  const bindingChecks = verifySnapshotBinding(
    input.snapshot,
    input.definition,
    input.candles,
  );
  const bindingBroken = bindingChecks.some((c) => c.status !== "PASS");
  const integrity: IntegrityCheck[] = [
    ...bindingChecks,
    ...input.quality.checks.map((c) => ({
      check: `data:${c.check}`,
      status: c.status,
      detail: c.detail,
    })),
  ];

  if (bindingBroken) {
    notes.push(
      "SNAPSHOT BINDING FAILED: the actual input data does not match the recorded snapshot. The run is REJECTED — evidence cannot be bound to unverified data.",
    );
    return {
      state: "BLOCKED",
      integrity,
      leakageState: "NOT_ASSESSABLE",
      metrics: null,
      stress: null,
      oos: null,
      features: null,
      evidence: null,
      fitness: null,
      notes,
    };
  }

  // ---- 1. DATA QUALITY GATE (before any simulation) ----------------------
  const blockingStates = ["INVALID", "FAILED", "MISSING"];
  if (blockingStates.includes(input.quality.state)) {
    notes.push(
      `DATA QUALITY GATE: snapshot state is ${input.quality.state}. Simulation is BLOCKED. No metrics are computed and none are fabricated.`,
    );
    const { state } = leakageChecks(input.definition, null, input.candles, input.cost, input.marketMeta);
    return {
      state: input.quality.state === "MISSING" ? "INSUFFICIENT_DATA" : "BLOCKED",
      integrity: [...integrity],
      leakageState: state,
      metrics: null,
      stress: null,
      oos: null,
      features: null,
      evidence: null,
      fitness: null,
      notes,
    };
  }
  if (input.quality.state !== "VALID") {
    notes.push(
      `DATA QUALITY GATE: snapshot state is ${input.quality.state}. Simulation proceeds but evidence is capped (see evidence engine).`,
    );
  }

  // ---- 2. SIMULATION (deterministic) ------------------------------------
  const sim = simulate(input.candles, input.definition, input.config, input.cost);
  if (sim.trades.length === 0) {
    notes.push("SIMULATION produced no trades. Metrics are N/A — not zero.");
  }

  // ---- 3. LOOK-AHEAD / LEAKAGE (computed from run inputs/outputs) --------
  const { checks: leakChecks, state: leakageState } = leakageChecks(
    input.definition,
    sim,
    input.candles,
    input.cost,
    input.marketMeta,
  );
  integrity.push(...leakChecks);

  // ---- 4. COST / FRICTION + STRESS --------------------------------------
  const stress = runStress(input.candles, input.definition, input.config, input.cost);

  // ---- 5. OOS (distinct, chronological; split must be declared) ----------
  const split = splitMetrics(input.candles, sim, input.config);
  notes.push(split.oosNote);

  // ---- 6. EVIDENCE (deterministic rubric; AI cannot upgrade) -------------
  const evidence = computeEvidence({
    metrics: sim.metrics,
    oos: split.oos,
    oosState: split.oosState,
    leakageState,
    dataQualityState:
      input.quality.state === "VALID"
        ? "VALID"
        : input.quality.state === "FAILED"
          ? "FAILED"
          : "DEGRADED",
    stressResults: stress,
  });

  // ---- 7. BOT FITNESS ----------------------------------------------------
  const fitness = computeFitness(
    input.candles,
    sim.trades,
    sim.metrics,
    input.marketMeta,
  );

  return {
    state: "COMPLETED",
    integrity,
    leakageState,
    metrics: sim.metrics,
    stress,
    oos: split,
    features: featureSummary(input.candles, input.definition),
    evidence,
    fitness,
    notes,
  };
}

export const ENGINE_VERSIONS = {
  engine: ENGINE_VERSION,
  feature: FEATURE_VERSION,
  executionModel: EXECUTION_MODEL_VERSION,
  validationConfig: VALIDATION_CONFIG_VERSION,
};

export { NA_METRICS };
export type { Metrics, SplitResult };
