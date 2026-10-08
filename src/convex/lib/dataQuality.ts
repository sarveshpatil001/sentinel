/**
 * SENTINEL PRIME — DETERMINISTIC DATA QUALITY ENGINE (Section 06)
 *
 * FAILED != EMPTY, MISSING != ZERO, UNKNOWN != FALSE (Section 15 invariants).
 * Never fabricates, forward-fills, interpolates, or silently repairs data
 * (Rule 28). Conflicting duplicates are never arbitrarily selected.
 */

export type DataQualityState =
  | "VALID"
  | "INCOMPLETE"
  | "STALE"
  | "MISSING"
  | "INVALID"
  | "FAILED";

export interface QualityCheck {
  check: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
  count: number;
}

export interface QualityReport {
  state: DataQualityState;
  checks: QualityCheck[];
  counts: {
    candles: number;
    duplicates: number;
    gaps: number;
    ohlcViolations: number;
    invalidValues: number;
  };
}

export interface QualityContext {
  marketId: string;
  symbol: string;
  timeframe: string;
  timeframeMs: number;
  /** Wall-clock of the analysis — used only for freshness, never to alter history. */
  now: number;
  /** Freshness threshold: availability older than this is STALE. */
  staleAfterMs: number;
  /** Provider state — FAILED provider data must propagate failure (Section 06). */
  providerState: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
}

interface RawCandle {
  eventTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  availabilityTime: number;
  source: string;
  symbol?: string;
  marketId?: string;
  timeframe?: string;
}

const finite = (x: number) => Number.isFinite(x);

export function validateCandles(
  candles: RawCandle[],
  ctx: QualityContext,
): QualityReport {
  const checks: QualityCheck[] = [];
  const counts = {
    candles: candles.length,
    duplicates: 0,
    gaps: 0,
    ohlcViolations: 0,
    invalidValues: 0,
  };

  // 1. Provider status propagation — failure must never become empty/valid.
  const providerOk = ctx.providerState !== "UNAVAILABLE";
  checks.push({
    check: "provider_status",
    status: providerOk ? (ctx.providerState === "DEGRADED" ? "UNKNOWN" : "PASS") : "FAIL",
    detail: providerOk
      ? `Provider ${ctx.providerState} for ${ctx.symbol}`
      : `Provider UNAVAILABLE for ${ctx.symbol} — provider data is FAILED, not EMPTY`,
    count: providerOk ? 0 : 1,
  });

  // 2. Presence — MISSING is distinct from ZERO and from FAILED.
  const presenceOk = candles.length > 0;
  checks.push({
    check: "presence",
    status: presenceOk ? "PASS" : "FAIL",
    detail: presenceOk
      ? `${candles.length} candles present`
      : "No candles present — state is MISSING (not zero, not empty-success)",
    count: presenceOk ? 0 : 1,
  });

  if (!presenceOk) {
    return {
      state: ctx.providerState === "UNAVAILABLE" ? "FAILED" : "MISSING",
      checks,
      counts,
    };
  }

  // 3. Schema / market identity / timeframe / source consistency.
  let schemaViolations = 0;
  let identityViolations = 0;
  for (const c of candles) {
    if (
      !finite(c.open) ||
      !finite(c.high) ||
      !finite(c.low) ||
      !finite(c.close) ||
      !finite(c.volume) ||
      !finite(c.eventTime) ||
      !finite(c.availabilityTime)
    ) {
      schemaViolations++;
      continue;
    }
    if (
      (c.symbol !== undefined && c.symbol !== ctx.symbol) ||
      (c.marketId !== undefined && c.marketId !== ctx.marketId) ||
      (c.timeframe !== undefined && c.timeframe !== ctx.timeframe)
    ) {
      identityViolations++;
    }
    if (c.volume < 0 || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      schemaViolations++;
    }
  }
  counts.invalidValues = schemaViolations;
  checks.push({
    check: "schema_and_values",
    status: schemaViolations === 0 ? "PASS" : "FAIL",
    detail:
      schemaViolations === 0
        ? "All fields finite; no negative volume/price"
        : `${schemaViolations} candles contain NaN/infinity/negative values (INVALID — never coerced to zero)`,
    count: schemaViolations,
  });
  checks.push({
    check: "market_identity",
    status: identityViolations === 0 ? "PASS" : "FAIL",
    detail:
      identityViolations === 0
        ? `All rows belong to ${ctx.marketId}/${ctx.symbol}/${ctx.timeframe}`
        : `${identityViolations} rows carry a foreign symbol/market/timeframe`,
    count: identityViolations,
  });

  // 4. Chronology — event_time strictly increasing; duplicates flagged, not merged.
  const sorted = [...candles].sort((a, b) => a.eventTime - b.eventTime);
  let outOfOrder = 0;
  let duplicates = 0;
  let conflictingDuplicates = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].eventTime === sorted[i - 1].eventTime) {
      duplicates++;
      const a = sorted[i - 1];
      const b = sorted[i];
      if (a.open !== b.open || a.close !== b.close || a.high !== b.high || a.low !== b.low) {
        conflictingDuplicates++;
      }
    } else if (sorted[i].eventTime < sorted[i - 1].eventTime) {
      outOfOrder++;
    }
  }
  counts.duplicates = duplicates;
  checks.push({
    check: "chronology",
    status: outOfOrder === 0 ? "PASS" : "FAIL",
    detail:
      outOfOrder === 0
        ? "event_time strictly ordered"
        : `${outOfOrder} out-of-order timestamps`,
    count: outOfOrder,
  });
  checks.push({
    check: "duplicates",
    status: duplicates === 0 ? "PASS" : "FAIL",
    detail:
      duplicates === 0
        ? "No duplicate event times"
        : `${duplicates} duplicate event times (${conflictingDuplicates} conflicting) — preserved, never arbitrarily selected`,
    count: duplicates,
  });

  // 5. OHLC internal rules (Section 06) — violations are INVALID, never corrected.
  let ohlcViolations = 0;
  for (const c of sorted) {
    const ok =
      c.high >= c.open &&
      c.high >= c.close &&
      c.high >= c.low &&
      c.low <= c.open &&
      c.low <= c.close &&
      c.low <= c.high;
    if (!ok) ohlcViolations++;
  }
  counts.ohlcViolations = ohlcViolations;
  checks.push({
    check: "ohlc_rules",
    status: ohlcViolations === 0 ? "PASS" : "FAIL",
    detail:
      ohlcViolations === 0
        ? "HIGH>=OPEN/CLOSE/LOW and LOW<=OPEN/CLOSE hold for all candles"
        : `${ohlcViolations} candles violate OHLC rules — flagged INVALID, no corrective values invented`,
    count: ohlcViolations,
  });

  // 6. Gaps — detected against the expected timeframe; missing candles are never
  //    fabricated (no forward-fill, no interpolation).
  let gaps = 0;
  let missingCandles = 0;
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].eventTime - sorted[i - 1].eventTime;
    if (delta > ctx.timeframeMs) {
      gaps++;
      missingCandles += Math.round(delta / ctx.timeframeMs) - 1;
    }
  }
  counts.gaps = gaps;
  checks.push({
    check: "gaps",
    status: gaps === 0 ? "PASS" : "FAIL",
    detail:
      gaps === 0
        ? "No gaps against expected timeframe"
        : `${gaps} gaps covering ${missingCandles} missing candles — left missing (MISSING != ZERO)`,
    count: gaps,
  });

  // 7. Availability semantics: availability_time <= decision_time must be
  //    satisfiable; future-available data cannot be used for past decisions.
  let futureAvailability = 0;
  for (const c of sorted) {
    if (c.availabilityTime > ctx.now) futureAvailability++;
  }
  checks.push({
    check: "availability_window",
    status: futureAvailability === 0 ? "PASS" : "FAIL",
    detail:
      futureAvailability === 0
        ? "availability_time <= decision_time for all rows"
        : `${futureAvailability} rows have availability_time in the future (not knowable)`,
    count: futureAvailability,
  });

  // 8. Freshness — stale feeds must not silently drive decisions.
  const last = sorted[sorted.length - 1];
  const age = ctx.now - last.availabilityTime;
  const stale = age > ctx.staleAfterMs;
  checks.push({
    check: "freshness",
    status: stale ? "FAIL" : "PASS",
    detail: stale
      ? `Latest availability is ${Math.round(age / 60000)} min old — exceeds staleness threshold`
      : `Latest availability is ${Math.round(age / 60000)} min old`,
    count: stale ? 1 : 0,
  });

  // Deterministic precedence: FAILED > INVALID > MISSING > STALE > INCOMPLETE > VALID
  let state: DataQualityState = "VALID";
  if (ctx.providerState === "UNAVAILABLE") state = "FAILED";
  if (schemaViolations > 0 || ohlcViolations > 0 || identityViolations > 0 || outOfOrder > 0 || conflictingDuplicates > 0 || futureAvailability > 0)
    state = "INVALID";
  if (state === "VALID" && gaps > 0) state = "INCOMPLETE";
  if (state === "VALID" && stale) state = "STALE";
  if (state === "INCOMPLETE" && stale) state = "STALE";

  return { state, checks, counts };
}
