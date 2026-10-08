/**
 * SENTINEL PRIME — DETERMINISTIC EVIDENCE ENGINE (Section 08)
 *
 * Evidence is computed from deterministic validation results by an explicit,
 * versioned rubric. AI cannot upgrade evidence (WEAK may not become STRONG).
 * Evidence is not a guarantee, not a trust score, and never authorizes a trade.
 */

import { Metrics } from "./backtest";

export type EvidenceLevel = "STRONG" | "MODERATE" | "WEAK" | "INSUFFICIENT";

export const EVIDENCE_RUBRIC_VERSION = "sp-evidence-rubric-1.0.0";

export interface EvidenceFactors {
  sampleSize: "ADEQUATE" | "THIN" | "INSUFFICIENT";
  dataQuality: "VALID" | "DEGRADED" | "FAILED";
  leakage: "NO_LEAKAGE_DETECTED" | "POSSIBLE_LEAKAGE" | "CONFIRMED_LEAKAGE" | "NOT_ASSESSABLE";
  oos: "ASSESSED" | "NOT_ASSESSABLE";
  oosProfitable: boolean | null;
  stressSurvives: boolean | null;
  maxDrawdown: number | null;
  tradeCount: number;
}

export interface EvidenceInput {
  metrics: Metrics;
  oos: Metrics | null;
  oosState: "ASSESSED" | "NOT_ASSESSABLE";
  leakageState: EvidenceFactors["leakage"];
  dataQualityState: EvidenceFactors["dataQuality"];
  stressResults: { scenario: string; metrics: Metrics }[];
}

export interface EvidenceResult {
  level: EvidenceLevel;
  rubricVersion: string;
  factors: EvidenceFactors;
  rationale: string[];
}

const MIN_ADEQUATE_TRADES = 30;
const MIN_THIN_TRADES = 10;

export function computeEvidence(input: EvidenceInput): EvidenceResult {
  const rationale: string[] = [];
  const m = input.metrics;

  const sampleSize: EvidenceFactors["sampleSize"] =
    m.tradeCount >= MIN_ADEQUATE_TRADES
      ? "ADEQUATE"
      : m.tradeCount >= MIN_THIN_TRADES
        ? "THIN"
        : "INSUFFICIENT";

  const oosProfitable =
    input.oosState === "ASSESSED" && input.oos !== null && input.oos.tradeCount > 0
      ? (input.oos.netReturn ?? 0) > 0
      : null;

  const baseline = input.stressResults.find((s) => s.scenario === "NORMAL");
  const worst = input.stressResults.reduce(
    (acc, s) =>
      s.metrics.netReturn !== null &&
      (acc === null || s.metrics.netReturn < acc)
        ? s.metrics.netReturn
        : acc,
    null as number | null,
  );
  const stressSurvives =
    baseline && baseline.metrics.netReturn !== null && worst !== null
      ? worst > -0.05 // declared rubric threshold: no stress scenario beyond -5% net return
      : null;

  const factors: EvidenceFactors = {
    sampleSize,
    dataQuality: input.dataQualityState,
    leakage: input.leakageState,
    oos: input.oosState,
    oosProfitable,
    stressSurvives,
    maxDrawdown: m.maxDrawdown,
    tradeCount: m.tradeCount,
  };

  // ---- Rubric (explicit, ordered, fail-closed) -----------------------------
  if (input.dataQualityState === "FAILED") {
    rationale.push(
      "Data quality FAILED — quantitative results cannot be trusted; evidence is INSUFFICIENT.",
    );
    return { level: "INSUFFICIENT", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }
  if (input.leakageState === "CONFIRMED_LEAKAGE") {
    rationale.push(
      "CONFIRMED_LEAKAGE invalidates the affected result — evidence is INSUFFICIENT.",
    );
    return { level: "INSUFFICIENT", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }
  if (sampleSize === "INSUFFICIENT") {
    rationale.push(
      `Trade count ${m.tradeCount} is below the minimum sample of ${MIN_THIN_TRADES} — INSUFFICIENT DATA.`,
    );
    return { level: "INSUFFICIENT", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }
  if (input.dataQualityState !== "VALID") {
    rationale.push(
      `Data quality ${input.dataQualityState} degrades every quantitative claim — evidence capped at WEAK.`,
    );
    return { level: "WEAK", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }
  if (input.leakageState === "POSSIBLE_LEAKAGE" || input.leakageState === "NOT_ASSESSABLE") {
    rationale.push(
      `Leakage state ${input.leakageState} — evidence capped at WEAK until resolved.`,
    );
    return { level: "WEAK", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }
  if (input.oosState !== "ASSESSED" || input.oos === null || input.oos.tradeCount === 0) {
    rationale.push(
      "No independent out-of-sample evidence — evidence capped at WEAK (backtest != trust).",
    );
    return { level: "WEAK", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }

  const positive = (m.netReturn ?? 0) > 0;
  const ddOk = m.maxDrawdown !== null && m.maxDrawdown <= 0.25; // declared rubric threshold
  const oosOk = oosProfitable === true;
  const stressOk = stressSurvives === true;

  if (positive && ddOk && oosOk && stressOk && sampleSize === "ADEQUATE") {
    rationale.push(
      "In-sample net return positive, max drawdown within rubric threshold (<=25%), OOS net return positive, and all declared stress scenarios survive.",
    );
    rationale.push(
      "Sample size adequate. STRONG evidence is still NOT a guarantee and does NOT authorize trading.",
    );
    return { level: "STRONG", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }

  if (positive && (oosOk || stressOk)) {
    rationale.push(
      "In-sample net return positive with partial corroboration (OOS or stress), but at least one rubric condition for STRONG is unmet.",
    );
    rationale.push(`Drawdown ${m.maxDrawdown === null ? "N/A" : (m.maxDrawdown * 100).toFixed(1) + "%"}, OOS profitable: ${oosOk}, stress survives: ${stressOk}.`);
    return { level: "MODERATE", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
  }

  rationale.push(
    "Deterministic results do not corroborate the strategy: weak OOS, failing stress, negative net return, or excessive drawdown.",
  );
  return { level: "WEAK", rubricVersion: EVIDENCE_RUBRIC_VERSION, factors, rationale };
}
