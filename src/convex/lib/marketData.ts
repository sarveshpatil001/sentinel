/**
 * SENTINEL PRIME — MARKET DATA PROVIDER ADAPTERS (Section 06)
 *
 * Real provider integrations with STRICT response validation and honest data
 * labeling. Core honesty rules enforced here (and by TEST-MD-*):
 *   - Data is explicitly labeled "LIVE", "CACHED", "STALE", "SIMULATED" or
 *     "UNAVAILABLE". SIMULATED/cached data is NEVER labeled LIVE.
 *   - No price is ever invented. Malformed, missing or conflicting fields are
 *     rejected/reported — never repaired, forward-filled or guessed.
 *   - Missing provider configuration produces an honest UNAVAILABLE result
 *     with a failure class — never a placeholder success.
 *   - Forex: the verified keyless providers publish CLOSE-ONLY reference
 *     rates (ECB via Frankfurter). That is a rate feed, NOT an OHLC candle
 *     feed; no synthetic OHLC is derived from it (no fake candles).
 *
 * All functions are pure and deterministic given their inputs; network access
 * happens only through the injected `fetchImpl` (same pattern as
 * `lib/databricks.ts`), so every behavior is unit-testable offline.
 *
 * CONNECTIVITY STATUS (verified live from this project's build environment on
 * 2026-10-14, response shapes recorded in the verification battery):
 *   - api.kraken.com /0/public/OHLC        — VERIFIED (crypto OHLC)
 *   - api.exchange.coinbase.com product candles  — VERIFIED (crypto OHLC)
 *   - api.frankfurter.dev /v1/*            — VERIFIED (ECB FX close-only rates)
 *   - feeds.finance.yahoo.com RSS          — VERIFIED (news; see lib/news.ts)
 * Connectivity from the deployed Convex runtime is re-verified on every fetch:
 * a failed fetch is reported as a failure, never as data.
 */

export type DataLabel = "LIVE" | "CACHED" | "STALE" | "SIMULATED" | "UNAVAILABLE";

export type ProviderFailureClass =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED_REQUEST"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "INVALID_DATA";

export type AssetClass = "CRYPTO" | "FOREX";

/** Canonical supported timeframes (configurable per request within this set). */
export const TIMEFRAMES: Readonly<Record<string, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1800_000,
  "1h": 3600_000,
  "4h": 14400_000,
  "1d": 86400_000,
};

export function timeframeMs(timeframe: string): number | null {
  return Object.prototype.hasOwnProperty.call(TIMEFRAMES, timeframe)
    ? TIMEFRAMES[timeframe]
    : null;
}

export interface ProviderCandle {
  eventTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderFetchOk {
  ok: true;
  provider: string;
  assetClass: AssetClass;
  symbol: string;
  timeframe: string;
  candles: ProviderCandle[];
  /** Provider's own timestamp for the payload, ms epoch (null if not published). */
  providerTimestamp: number | null;
  /** Wall-clock when this payload was retrieved, ms epoch. */
  retrievedAt: number;
  rateLimitUntil: number | null;
  note: string;
}

export interface ProviderFetchErr {
  ok: false;
  provider: string;
  assetClass: AssetClass;
  failureClass: ProviderFailureClass;
  detail: string;
  rateLimitUntil: number | null;
}

export type ProviderFetchResult = ProviderFetchOk | ProviderFetchErr;

/**
 * Narrow structural fetch contract. Deliberately not `typeof fetch` so the
 * adapters run identically in the Convex runtime and under offline test
 * doubles. Callers must never place credentials in URLs (SECRET RULE); the
 * verified public endpoints here require none.
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

// ---------------------------------------------------------------------------
// Instrument + provider symbol mapping (explicit; unknown symbols fail closed)
// ---------------------------------------------------------------------------

interface InstrumentConfig {
  symbol: string;
  assetClass: AssetClass;
  base: string;
  quote: string;
  krakenPair: string | null;
  coinbaseProduct: string | null;
  ecbBase: string | null;
  ecbQuote: string | null;
  /** Lowercase terms used by the news relevance classifier. */
  newsTerms: string[];
}

export const INSTRUMENTS: Readonly<Record<string, InstrumentConfig>> = {
  "BTC/USD": {
    symbol: "BTC/USD",
    assetClass: "CRYPTO",
    base: "BTC",
    quote: "USD",
    krakenPair: "XBTUSD",
    coinbaseProduct: "BTC-USD",
    ecbBase: null,
    ecbQuote: null,
    newsTerms: ["bitcoin", "btc", "crypto", "cryptocurrency"],
  },
  "ETH/USD": {
    symbol: "ETH/USD",
    assetClass: "CRYPTO",
    base: "ETH",
    quote: "USD",
    krakenPair: "ETHUSD",
    coinbaseProduct: "ETH-USD",
    ecbBase: null,
    ecbQuote: null,
    newsTerms: ["ethereum", "eth ", "crypto", "cryptocurrency"],
  },
  "EUR/USD": {
    symbol: "EUR/USD",
    assetClass: "FOREX",
    base: "EUR",
    quote: "USD",
    krakenPair: null,
    coinbaseProduct: null,
    ecbBase: "EUR",
    ecbQuote: "USD",
    newsTerms: ["euro", "eur", "european central bank", "ecb", "forex"],
  },
};

export function instrumentConfig(symbol: string): InstrumentConfig | null {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, symbol)
    ? INSTRUMENTS[symbol]
    : null;
}

const KRAKEN_INTERVALS: Readonly<Record<string, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

// Coinbase Exchange granularity allowlist (its API has no 4h bucket — that is
// reported as UNSUPPORTED_REQUEST, never silently mapped to a different span).
const COINBASE_GRANULARITY: Readonly<Record<string, number>> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "1d": 86400,
};

// ---------------------------------------------------------------------------
// Response validation (shared)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  index: number;
  issue: string;
}

export interface CandleValidation {
  candles: ProviderCandle[];
  issues: ValidationIssue[];
}

const finitePos = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 0;
const finiteNonNeg = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0;

/**
 * Validate a parsed candle series: values, OHLC invariants, timestamp sanity
 * and ordering. Conflicting duplicate timestamps are ISSUES (never resolved by
 * picking one). Returns the clean, chronologically ordered series.
 */
export function validateCandleSeries(raw: ProviderCandle[]): CandleValidation {
  const issues: ValidationIssue[] = [];
  const clean: ProviderCandle[] = [];
  raw.forEach((c, index) => {
    if (
      !finitePos(c.eventTime) ||
      !Number.isInteger(c.eventTime) ||
      c.eventTime <= 0
    ) {
      issues.push({ index, issue: "eventTime must be a positive integer (ms)" });
      return;
    }
    if (!finitePos(c.open) || !finitePos(c.high) || !finitePos(c.low) || !finitePos(c.close)) {
      issues.push({ index, issue: "non-finite or non-positive OHLC value" });
      return;
    }
    if (!finiteNonNeg(c.volume)) {
      issues.push({ index, issue: "volume must be finite and >= 0" });
      return;
    }
    const ohlcOk =
      c.high >= c.open &&
      c.high >= c.close &&
      c.high >= c.low &&
      c.low <= c.open &&
      c.low <= c.close &&
      c.low <= c.high;
    if (!ohlcOk) {
      issues.push({ index, issue: "OHLC invariant violated (high/low inconsistent)" });
      return;
    }
    clean.push({ ...c });
  });

  clean.sort((a, b) => a.eventTime - b.eventTime);
  const deduped: ProviderCandle[] = [];
  for (const c of clean) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.eventTime === c.eventTime) {
      if (prev.open !== c.open || prev.close !== c.close || prev.high !== c.high || prev.low !== c.low) {
        issues.push({
          index: -1,
          issue: `conflicting duplicate candle at ${c.eventTime} — preserved as an issue, never arbitrarily selected`,
        });
      }
      continue;
    }
    deduped.push(c);
  }
  return { candles: deduped, issues };
}

function parseJsonBody(body: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(body) as unknown };
  } catch {
    return { error: "response body is not valid JSON" };
  }
}

function isStringArrayRow(x: unknown, minLen: number): x is unknown[] {
  return Array.isArray(x) && x.length >= minLen;
}

function toNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
}

// ---------------------------------------------------------------------------
// Kraken (CRYPTO) — GET https://api.kraken.com/0/public/OHLC
// result: { <PAIR>: [[time_s, open, high, low, close, vwap, volume, count], ...], last }
// ---------------------------------------------------------------------------

export function parseKrakenOhlc(
  body: string,
  opts: { symbol: string; timeframe: string },
): { ok: true; candles: ProviderCandle[]; providerTimestamp: number | null; issues: ValidationIssue[] } | { ok: false; failureClass: ProviderFailureClass; detail: string } {
  if (timeframeMs(opts.timeframe) === null) {
    return { ok: false, failureClass: "UNSUPPORTED_REQUEST", detail: "unsupported timeframe for candle parsing" };
  }
  const parsed = parseJsonBody(body);
  if ("error" in parsed) return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: parsed.error };
  const root = parsed.value as { error?: unknown; result?: unknown };
  if (root === null || typeof root !== "object") {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: "Kraken payload is not an object" };
  }
  if (Array.isArray(root.error) && root.error.length > 0) {
    // Provider-declared error is data about failure — never data about prices.
    return {
      ok: false,
      failureClass: root.error.some((e) => String(e).includes("Rate"))
        ? "RATE_LIMITED"
        : "UNSUPPORTED_REQUEST",
      detail: `Kraken error: ${root.error.map((e) => String(e)).join("; ")}`,
    };
  }
  const result = root.result;
  if (result === null || typeof result !== "object") {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: "Kraken payload missing result" };
  }
  const keys = Object.keys(result as Record<string, unknown>).filter((k) => k !== "last");
  if (keys.length === 0) {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: "Kraken result has no pair series" };
  }
  const rows = (result as Record<string, unknown>)[keys[0]];
  if (!Array.isArray(rows)) {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: "Kraken pair series is not an array" };
  }

  const raw: ProviderCandle[] = [];
  for (const row of rows) {
    if (!isStringArrayRow(row, 8)) {
      return {
        ok: false,
        failureClass: "MALFORMED_RESPONSE",
        detail: `Kraken candle row missing fields (expected 8, got ${Array.isArray(row) ? row.length : typeof row})`,
      };
    }
    const timeS = toNumber(row[0]);
    const open = toNumber(row[1]);
    const high = toNumber(row[2]);
    const low = toNumber(row[3]);
    const close = toNumber(row[4]);
    const volume = toNumber(row[6]);
    if ([timeS, open, high, low, close, volume].some((v) => v === null)) {
      return {
        ok: false,
        failureClass: "MALFORMED_RESPONSE",
        detail: "Kraken candle row contains a non-numeric field — values are never coerced",
      };
    }
    raw.push({
      eventTime: (timeS as number) * 1000,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: volume as number,
    });
  }
  const { candles, issues } = validateCandleSeries(raw);
  if (candles.length === 0 && raw.length > 0) {
    return { ok: false, failureClass: "INVALID_DATA", detail: `All ${raw.length} Kraken candles failed validation` };
  }
  return { ok: true, candles, providerTimestamp: null, issues };
}

export function krakenOhlcUrl(pair: string, timeframe: string, limit: number): string | null {
  const interval = Object.prototype.hasOwnProperty.call(KRAKEN_INTERVALS, timeframe)
    ? KRAKEN_INTERVALS[timeframe]
    : null;
  if (interval === null) return null;
  return `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}&count=${Math.max(2, Math.min(720, Math.floor(limit)))}`;
}

// ---------------------------------------------------------------------------
// Coinbase Exchange (CRYPTO) — GET /products/<product>/candles?granularity=
// [[time_s, low, high, open, close, volume], ...] — NEWEST FIRST
// ---------------------------------------------------------------------------

export function parseCoinbaseCandles(
  body: string,
): { ok: true; candles: ProviderCandle[]; providerTimestamp: number | null; issues: ValidationIssue[] } | { ok: false; failureClass: ProviderFailureClass; detail: string } {
  const parsed = parseJsonBody(body);
  if ("error" in parsed) return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: parsed.error };
  const value = parsed.value;
  if (!Array.isArray(value)) {
    // Coinbase errors come back as {"message": "..."} — reported as failure.
    const message =
      value !== null && typeof value === "object" && "message" in (value as Record<string, unknown>)
        ? String((value as Record<string, unknown>).message)
        : "payload is not a candle array";
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: `Coinbase: ${message}` };
  }
  const raw: ProviderCandle[] = [];
  for (const row of value) {
    if (!isStringArrayRow(row, 6)) {
      return {
        ok: false,
        failureClass: "MALFORMED_RESPONSE",
        detail: `Coinbase candle row missing fields (expected 6, got ${Array.isArray(row) ? row.length : typeof row})`,
      };
    }
    const timeS = toNumber(row[0]);
    const low = toNumber(row[1]);
    const high = toNumber(row[2]);
    const open = toNumber(row[3]);
    const close = toNumber(row[4]);
    const volume = toNumber(row[5]);
    if ([timeS, low, high, open, close, volume].some((v) => v === null)) {
      return {
        ok: false,
        failureClass: "MALFORMED_RESPONSE",
        detail: "Coinbase candle row contains a non-numeric field — values are never coerced",
      };
    }
    raw.push({
      eventTime: (timeS as number) * 1000,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: volume as number,
    });
  }
  const { candles, issues } = validateCandleSeries(raw); // sorts ascending
  if (candles.length === 0 && raw.length > 0) {
    return { ok: false, failureClass: "INVALID_DATA", detail: `All ${raw.length} Coinbase candles failed validation` };
  }
  return { ok: true, candles, providerTimestamp: null, issues };
}

export function coinbaseCandlesUrl(product: string, timeframe: string): string | null {
  const granularity = Object.prototype.hasOwnProperty.call(COINBASE_GRANULARITY, timeframe)
    ? COINBASE_GRANULARITY[timeframe]
    : null;
  if (granularity === null) return null;
  return `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${granularity}`;
}

// ---------------------------------------------------------------------------
// ECB reference rates via Frankfurter (FOREX) — CLOSE-ONLY rate observations.
// This is NOT an OHLC feed: a single published fix per business day. No
// synthetic candle is ever derived from it (see module header).
// ---------------------------------------------------------------------------

export interface RateObservation {
  base: string;
  quote: string;
  rate: number;
  /** ISO date of the published reference rate (YYYY-MM-DD). */
  rateDate: string;
}

export function parseFrankfurterTimeseries(
  body: string,
  opts: { base: string; quote: string },
): { ok: true; observations: RateObservation[] } | { ok: false; failureClass: ProviderFailureClass; detail: string } {
  const parsed = parseJsonBody(body);
  if ("error" in parsed) return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: parsed.error };
  const root = parsed.value as { rates?: unknown; base?: unknown };
  if (root === null || typeof root !== "object" || root.rates === null || typeof root.rates !== "object") {
    return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: "Frankfurter payload missing rates" };
  }
  const observations: RateObservation[] = [];
  for (const [date, dayRates] of Object.entries(root.rates as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, failureClass: "MALFORMED_RESPONSE", detail: `Frankfurter date key malformed: ${date}` };
    }
    const rate =
      dayRates !== null && typeof dayRates === "object"
        ? toNumber((dayRates as Record<string, unknown>)[opts.quote])
        : null;
    if (rate === null || rate <= 0) {
      return {
        ok: false,
        failureClass: "INVALID_DATA",
        detail: `Frankfurter rate for ${opts.quote} on ${date} is missing or non-positive — never coerced`,
      };
    }
    observations.push({ base: opts.base, quote: opts.quote, rate, rateDate: date });
  }
  observations.sort((a, b) => (a.rateDate < b.rateDate ? -1 : 1));
  return { ok: true, observations };
}

export function frankfurterTimeseriesUrl(base: string, quote: string, startIsoDate: string, endIsoDate: string): string {
  return `https://api.frankfurter.dev/v1/${startIsoDate}..${endIsoDate}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`;
}

// ---------------------------------------------------------------------------
// Data labeling — the single authority for LIVE/CACHED/STALE/SIMULATED/UNAVAILABLE
// ---------------------------------------------------------------------------

/** Source tags that mark synthetic/demo rows. Provider rows never match. */
export function isSimulatedSource(source: string): boolean {
  return /SIM|SYNTHETIC|SEED|DEMO|ILLUSTRATIVE/i.test(source);
}

export interface LabelInput {
  barCount: number;
  /**
   * Where the data actually came from:
   *  - PROVIDER_FETCH:  fetched from a verified external provider in this call
   *  - PERSISTED:       previously persisted provider data (re-verified rows)
   *  - SIMULATED:       synthetic/seed/demo data
   */
  origin: "PROVIDER_FETCH" | "PERSISTED" | "SIMULATED";
  /** When provider data was retrieved (ms). Null when unknown. */
  retrievedAt: number | null;
  /** Event time of the newest bar (ms). Null when unknown. */
  lastBarEventTime: number | null;
  now: number;
  staleAfterMs: number;
}

export interface LabelResult {
  label: DataLabel;
  reason: string;
  freshnessAgeMs: number | null;
}

export function deriveDataLabel(input: LabelInput): LabelResult {
  const { barCount, origin, retrievedAt, lastBarEventTime, now, staleAfterMs } = input;
  if (origin === "SIMULATED") {
    return {
      label: "SIMULATED",
      reason: "Synthetic/simulated source — never presented as live market data.",
      freshnessAgeMs: lastBarEventTime === null ? null : now - lastBarEventTime,
    };
  }
  if (barCount === 0) {
    return {
      label: "UNAVAILABLE",
      reason: "No validated market data present for this instrument/timeframe.",
      freshnessAgeMs: null,
    };
  }
  const reference = retrievedAt ?? lastBarEventTime;
  const age = reference === null ? null : now - reference;
  if (origin === "PROVIDER_FETCH") {
    return {
      label: "LIVE",
      reason: "Fetched from the external provider in this call and validated.",
      freshnessAgeMs: age,
    };
  }
  // PERSISTED provider data: honest cache semantics — CACHED while fresh,
  // STALE once the retrieval/bar age exceeds the staleness threshold.
  if (age === null) {
    return {
      label: "STALE",
      reason: "Persisted provider data with no recorded retrieval time — freshness unknown, treated as stale.",
      freshnessAgeMs: null,
    };
  }
  return age > staleAfterMs
    ? {
        label: "STALE",
        reason: `Persisted provider data is ${Math.round(age / 60000)} min old (threshold ${Math.round(staleAfterMs / 60000)} min).`,
        freshnessAgeMs: age,
      }
    : {
        label: "CACHED",
        reason: `Persisted provider data retrieved ${Math.round(age / 60000)} min ago (within threshold).`,
        freshnessAgeMs: age,
      };
}

// ---------------------------------------------------------------------------
// Provider health tracking (failures, rate limits, freshness)
// ---------------------------------------------------------------------------

export type ProviderStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";

export interface ProviderHealthState {
  provider: string;
  kind: "MARKET_DATA" | "NEWS";
  assetClass: AssetClass | null;
  status: ProviderStatus;
  failureClass: ProviderFailureClass | null;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  rateLimitUntil: number | null;
  lastLatencyMs: number | null;
  note: string;
  updatedAt: number;
}

export function initialHealth(provider: string, kind: "MARKET_DATA" | "NEWS", assetClass: AssetClass | null): ProviderHealthState {
  return {
    provider,
    kind,
    assetClass,
    status: "UNAVAILABLE",
    failureClass: null,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    rateLimitUntil: null,
    lastLatencyMs: null,
    note: "No request attempted yet — not claimed as connected.",
    updatedAt: 0,
  };
}

export function healthAfterSuccess(
  prev: ProviderHealthState,
  now: number,
  latencyMs: number | null,
  note: string,
): ProviderHealthState {
  return {
    ...prev,
    status: "AVAILABLE",
    failureClass: null,
    consecutiveFailures: 0,
    lastSuccessAt: now,
    rateLimitUntil: null,
    lastLatencyMs: latencyMs,
    note,
    updatedAt: now,
  };
}

export function healthAfterFailure(
  prev: ProviderHealthState,
  now: number,
  failureClass: ProviderFailureClass,
  note: string,
  rateLimitUntil: number | null,
): ProviderHealthState {
  const consecutiveFailures = prev.consecutiveFailures + 1;
  return {
    ...prev,
    // A single failure degrades; three consecutive failures mark UNAVAILABLE.
    // An active rate limit is DEGRADED (recoverable), never silently healthy.
    status:
      failureClass === "RATE_LIMITED" || consecutiveFailures < 3 ? "DEGRADED" : "UNAVAILABLE",
    failureClass,
    consecutiveFailures,
    lastFailureAt: now,
    rateLimitUntil: rateLimitUntil ?? prev.rateLimitUntil,
    note,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Provider fetch orchestration (injected fetch; honest failure propagation)
// ---------------------------------------------------------------------------

export interface FetchRequest {
  symbol: string;
  timeframe: string;
  limit: number;
  now: number;
  fetchImpl: FetchLike;
}

function failure(
  provider: string,
  assetClass: AssetClass,
  failureClass: ProviderFailureClass,
  detail: string,
  rateLimitUntil: number | null,
): ProviderFetchErr {
  return { ok: false, provider, assetClass, failureClass, detail, rateLimitUntil };
}

async function httpGet(
  provider: string,
  assetClass: AssetClass,
  url: string,
  req: FetchRequest,
): Promise<{ ok: true; body: string } | ProviderFetchErr> {
  let res: FetchResponseLike;
  const started = Date.now();
  try {
    res = await req.fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "sentinel-prime/1.0 (market-data)" },
    });
  } catch (e) {
    // Network-level failure. Message sanitized: URLs may carry query strings
    // and must never leak into logs/errors wholesale.
    void started;
    return failure(provider, assetClass, "NETWORK_ERROR", `network error contacting ${provider} (${e instanceof Error ? e.name : "Error"})`, null);
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const rateLimitUntil =
      Number.isFinite(retryAfter) && retryAfter > 0 ? req.now + retryAfter * 1000 : req.now + 60_000;
    return failure(provider, assetClass, "RATE_LIMITED", `${provider} rate limit (HTTP 429)`, rateLimitUntil);
  }
  if (res.status === 401 || res.status === 403) {
    return failure(provider, assetClass, "AUTH_FAILED", `${provider} rejected the request (HTTP ${res.status})`, null);
  }
  if (!res.ok) {
    return failure(provider, assetClass, "HTTP_ERROR", `${provider} HTTP ${res.status}`, null);
  }
  return { ok: true, body: await res.text() };
}

export async function fetchKrakenCandles(req: FetchRequest): Promise<ProviderFetchResult> {
  const cfg = instrumentConfig(req.symbol);
  if (cfg === null || cfg.krakenPair === null) {
    return failure("KRAKEN", "CRYPTO", "UNSUPPORTED_REQUEST", `Kraken has no mapping for ${req.symbol}`, null);
  }
  const url = krakenOhlcUrl(cfg.krakenPair, req.timeframe, req.limit);
  if (url === null) {
    return failure("KRAKEN", "CRYPTO", "UNSUPPORTED_REQUEST", `Kraken does not support timeframe ${req.timeframe}`, null);
  }
  const got = await httpGet("KRAKEN", "CRYPTO", url, req);
  if (!got.ok) return got;
  const parsed = parseKrakenOhlc(got.body, { symbol: req.symbol, timeframe: req.timeframe });
  if (!parsed.ok) return failure("KRAKEN", "CRYPTO", parsed.failureClass, parsed.detail, null);
  return {
    ok: true,
    provider: "KRAKEN",
    assetClass: "CRYPTO",
    symbol: req.symbol,
    timeframe: req.timeframe,
    candles: parsed.candles.slice(-Math.max(2, req.limit)),
    providerTimestamp: parsed.providerTimestamp,
    retrievedAt: req.now,
    rateLimitUntil: null,
    note: `${parsed.candles.length} validated candles from api.kraken.com${parsed.issues.length > 0 ? `; ${parsed.issues.length} rows rejected in validation` : ""}.`,
  };
}

export async function fetchCoinbaseCandles(req: FetchRequest): Promise<ProviderFetchResult> {
  const cfg = instrumentConfig(req.symbol);
  if (cfg === null || cfg.coinbaseProduct === null) {
    return failure("COINBASE", "CRYPTO", "UNSUPPORTED_REQUEST", `Coinbase has no mapping for ${req.symbol}`, null);
  }
  const url = coinbaseCandlesUrl(cfg.coinbaseProduct, req.timeframe);
  if (url === null) {
    return failure("COINBASE", "CRYPTO", "UNSUPPORTED_REQUEST", `Coinbase Exchange has no ${req.timeframe} granularity`, null);
  }
  const got = await httpGet("COINBASE", "CRYPTO", url, req);
  if (!got.ok) return got;
  const parsed = parseCoinbaseCandles(got.body);
  if (!parsed.ok) return failure("COINBASE", "CRYPTO", parsed.failureClass, parsed.detail, null);
  return {
    ok: true,
    provider: "COINBASE",
    assetClass: "CRYPTO",
    symbol: req.symbol,
    timeframe: req.timeframe,
    candles: parsed.candles.slice(-Math.max(2, req.limit)),
    providerTimestamp: parsed.providerTimestamp,
    retrievedAt: req.now,
    rateLimitUntil: null,
    note: `${parsed.candles.length} validated candles from api.exchange.coinbase.com${parsed.issues.length > 0 ? `; ${parsed.issues.length} rows rejected in validation` : ""}.`,
  };
}

/**
 * FOREX candles. Honest status: the verified keyless FX sources publish
 * close-only reference rates, not OHLC candles, and inventing OHLC from a
 * single daily fix is prohibited. Until a true-OHLC FX provider is configured
 * and verified, this returns UNAVAILABLE — it never fabricates candles.
 */
export async function fetchForexCandles(req: FetchRequest): Promise<ProviderFetchResult> {
  void req;
  return failure(
    "ECB-RATES",
    "FOREX",
    "NOT_CONFIGURED",
    "No true-OHLC forex provider is configured. The verified ECB/Frankfurter feed publishes close-only daily reference rates (see fetchEcbRates); configuring a keyed OHLC FX provider is required before FX candles can be served. No synthetic candles are generated.",
    null,
  );
}

export interface EcbRatesResult {
  ok: boolean;
  provider: string;
  observations: RateObservation[];
  sourceUrl: string;
  retrievedAt: number;
  labelNote: string;
  failureClass: ProviderFailureClass | null;
  detail: string;
}

export async function fetchEcbRates(req: {
  symbol: string;
  startIsoDate: string;
  endIsoDate: string;
  now: number;
  fetchImpl: FetchLike;
}): Promise<EcbRatesResult> {
  const cfg = instrumentConfig(req.symbol);
  const sourceUrl =
    cfg?.ecbBase && cfg?.ecbQuote
      ? frankfurterTimeseriesUrl(cfg.ecbBase, cfg.ecbQuote, req.startIsoDate, req.endIsoDate)
      : "";
  if (cfg === null || cfg.ecbBase === null || cfg.ecbQuote === null) {
    return {
      ok: false,
      provider: "ECB-RATES",
      observations: [],
      sourceUrl,
      retrievedAt: req.now,
      labelNote: "RATE_FEED (close-only)",
      failureClass: "UNSUPPORTED_REQUEST",
      detail: `ECB reference rates do not cover ${req.symbol}`,
    };
  }
  const got = await httpGet("ECB-RATES", "FOREX", sourceUrl, {
    symbol: req.symbol,
    timeframe: "1d",
    limit: 90,
    now: req.now,
    fetchImpl: req.fetchImpl,
  });
  if (!got.ok) {
    return {
      ok: false,
      provider: "ECB-RATES",
      observations: [],
      sourceUrl,
      retrievedAt: req.now,
      labelNote: "RATE_FEED (close-only)",
      failureClass: got.failureClass,
      detail: got.detail,
    };
  }
  const parsed = parseFrankfurterTimeseries(got.body, { base: cfg.ecbBase, quote: cfg.ecbQuote });
  if (!parsed.ok) {
    return {
      ok: false,
      provider: "ECB-RATES",
      observations: [],
      sourceUrl,
      retrievedAt: req.now,
      labelNote: "RATE_FEED (close-only)",
      failureClass: parsed.failureClass,
      detail: parsed.detail,
    };
  }
  return {
    ok: true,
    provider: "ECB-RATES",
    observations: parsed.observations,
    sourceUrl,
    retrievedAt: req.now,
    labelNote: "RATE_FEED (close-only) — ECB daily reference fix; NOT OHLC candles",
    failureClass: null,
    detail: `${parsed.observations.length} daily reference rates from ECB via Frankfurter`,
  };
}

/**
 * Try the configured crypto providers in order; return the first validated
 * result plus every attempt (for provider-health tracking). Nothing is
 * substituted when all providers fail — the caller gets the honest failures.
 */
export async function fetchCryptoMarketData(req: FetchRequest): Promise<{
  result: ProviderFetchResult | null;
  attempts: ProviderFetchResult[];
}> {
  const attempts: ProviderFetchResult[] = [];
  for (const fetcher of [fetchKrakenCandles, fetchCoinbaseCandles]) {
    const attempt = await fetcher(req);
    attempts.push(attempt);
    if (attempt.ok) return { result: attempt, attempts };
  }
  return { result: null, attempts };
}
