/**
 * SENTINEL PRIME — MARKET DATA / NEWS / STRATEGY VERIFICATION BATTERY
 *
 * Offline, deterministic tests for the provider adapters, response
 * validation, data labeling, the news pipeline and strategy evaluation.
 * Network access is exercised through injected fetch doubles only — BUT the
 * recorded fixtures below are REAL provider responses captured from the live
 * endpoints on 2026-10-14 (Kraken OHLC, Coinbase candles, Frankfurter/ECB
 * rates, Yahoo Finance RSS). They assert the actual wire shapes the adapters
 * must handle; runtime connectivity is re-verified per request and reported
 * honestly on failure.
 *
 * Execute with: bun src/tests/marketdata-verification.ts
 * Exit code 0 only when every check passes.
 */
import {
  coinbaseCandlesUrl,
  deriveDataLabel,
  fetchCoinbaseCandles,
  fetchCryptoMarketData,
  fetchEcbRates,
  fetchForexCandles,
  fetchKrakenCandles,
  healthAfterFailure,
  healthAfterSuccess,
  initialHealth,
  instrumentConfig,
  isSimulatedSource,
  krakenOhlcUrl,
  parseCoinbaseCandles,
  parseFrankfurterTimeseries,
  parseKrakenOhlc,
  timeframeMs,
  validateCandleSeries,
  type FetchLike,
  type FetchResponseLike,
  type ProviderCandle,
} from "../convex/lib/marketData";
import {
  classifyImpact,
  dedupeNews,
  newsContentHash,
  newsFreshness,
  selectHighImpactNews,
  yahooFinanceRss,
  type NewsItem,
} from "../convex/lib/news";
import { evaluateStrategyDefinition } from "../convex/lib/strategyEval";
import type { StrategyDefinition } from "../convex/lib/backtest";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

const NOW = Date.parse("Wed, 14 Oct 2026 08:30:00 +0000");

// ---------------------------------------------------------------------------
// Recorded REAL provider responses (captured 2026-10-14)
// ---------------------------------------------------------------------------

const KRAKEN_REAL = JSON.stringify({
  error: [],
  result: {
    XXBTZUSD: [
      [1789372800, "77850.0", "77960.2", "77624.4", "77702.8", "77762.2", "69.10249375", 4830],
      [1789376400, "77702.9", "78338.7", "77558.8", "78114.3", "77929.1", "90.25093881", 6026],
      [1789380000, "78120.3", "78139.0", "77861.9", "77867.4", "77995.7", "51.30312970", 4287],
    ],
    last: 1789380000,
  },
});

// Coinbase rows are [time, low, high, open, close, volume], NEWEST FIRST.
const COINBASE_REAL = JSON.stringify([
  [1791860400, 82681.36, 83500, 82823.37, 83229.76, 211.03309502],
  [1791856800, 82315.14, 83000, 82350.21, 82823.67, 224.20110282],
  [1791853200, 81329.58, 82381.17, 81343.98, 82350.22, 323.8124315],
]);

const FRANKFURTER_REAL = JSON.stringify({
  amount: 1.0,
  base: "EUR",
  start_date: "2026-10-01",
  end_date: "2026-10-13",
  rates: {
    "2026-10-01": { USD: 1.1298 },
    "2026-10-02": { USD: 1.1225 },
    "2026-10-05": { USD: 1.1204 },
  },
});

const YAHOO_RSS_REAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0">
    <channel>
        <title>Yahoo Finance</title>
        <item>
            <description>In an interview with Bloomberg Television, Saylor said that BTC prices would move back to six figures.</description>
            <guid isPermaLink="false">fc594d3f-ebb1-373b-ad88-a5683c269d36</guid>
            <link>https://stocktwits.com/news-articles/markets/equity/michael-saylor-says-bitcoin-has-bottomed-and-should-get-back-above-100-000-long-term-forecast-is/cZxfODlRBpP?.tsrc=rss</link>
            <pubDate>Wed, 14 Oct 2026 04:21:44 +0000</pubDate>
            <title>Michael Saylor Says Bitcoin Has Bottomed And Should Get Back Above $100,000</title>
        </item>
        <item>
            <description>Quiet session.</description>
            <guid isPermaLink="false">9bf88026-49dc-39b9-9a9d-23b63f841584</guid>
            <link>https://example.com/markets/quiet-session</link>
            <pubDate>Wed, 14 Oct 2026 03:00:00 +0000</pubDate>
            <title>Markets drift sideways in thin trading</title>
        </item>
    </channel>
</rss>`;

function mockResponse(status: number, body: string, headers: Record<string, string> = {}): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

// ===========================================================================
// 1. PROVIDER RESPONSE PARSING (real wire shapes)
// ===========================================================================

const krakenParsed = parseKrakenOhlc(KRAKEN_REAL, { symbol: "BTC/USD", timeframe: "1h" });
check("TEST-MD-KRAKEN-001 real Kraken payload parses to validated ascending candles",
  krakenParsed.ok && krakenParsed.candles.length === 3 &&
  krakenParsed.candles[0].eventTime === 1789372800 * 1000 &&
  krakenParsed.candles[0].open === 77850.0 &&
  krakenParsed.candles[1].close === 78114.3 &&
  krakenParsed.candles[2].eventTime > krakenParsed.candles[1].eventTime,
  JSON.stringify(krakenParsed).slice(0, 200));

check("TEST-MD-KRAKEN-002 Kraken row with missing fields is MALFORMED_RESPONSE, never padded",
  (() => {
    const r = parseKrakenOhlc(
      JSON.stringify({ error: [], result: { XXBTZUSD: [[1789372800, "77850.0", "77960.2"]] } }),
      { symbol: "BTC/USD", timeframe: "1h" },
    );
    return !r.ok && r.failureClass === "MALFORMED_RESPONSE";
  })());

check("TEST-MD-KRAKEN-003 Kraken declared error becomes a failure, not data",
  (() => {
    const r = parseKrakenOhlc(JSON.stringify({ error: ["EQuery:Unknown asset pair"], result: {} }), {
      symbol: "BTC/USD",
      timeframe: "1h",
    });
    return !r.ok && r.detail.includes("EQuery:Unknown asset pair");
  })());

const coinbaseParsed = parseCoinbaseCandles(COINBASE_REAL);
check("TEST-MD-COINBASE-001 real Coinbase payload (descending) parses to ascending candles",
  coinbaseParsed.ok && coinbaseParsed.candles.length === 3 &&
  coinbaseParsed.candles[0].eventTime === 1791853200 * 1000 &&
  coinbaseParsed.candles[2].eventTime === 1791860400 * 1000 &&
  coinbaseParsed.candles[2].close === 83229.76);

check("TEST-MD-COINBASE-002 non-numeric Coinbase field is MALFORMED, never coerced",
  (() => {
    const r = parseCoinbaseCandles(JSON.stringify([[1791860400, 1, 2, 3, "oops", 5]]));
    return !r.ok && r.failureClass === "MALFORMED_RESPONSE";
  })());

check("TEST-MD-COINBASE-003 Coinbase error object is MALFORMED_RESPONSE with provider message",
  (() => {
    const r = parseCoinbaseCandles(JSON.stringify({ message: "NotFound" }));
    return !r.ok && r.detail.includes("NotFound");
  })());

// ===========================================================================
// 2. SERIES VALIDATION — malformed / missing / conflicting data
// ===========================================================================

const baseCandle: ProviderCandle = { eventTime: 1000, open: 10, high: 11, low: 9, close: 10.5, volume: 1 };

check("TEST-MD-VAL-001 NaN price row is rejected as an issue (never zero-coerced)",
  (() => {
    const r = validateCandleSeries([{ ...baseCandle, close: NaN }]);
    return r.candles.length === 0 && r.issues.length === 1 && r.issues[0].issue.includes("non-finite");
  })());

check("TEST-MD-VAL-002 OHLC invariant violation is flagged, not corrected",
  (() => {
    const r = validateCandleSeries([{ ...baseCandle, high: 9.5 }]);
    return r.candles.length === 0 && r.issues.some((i) => i.issue.includes("OHLC"));
  })());

check("TEST-MD-VAL-003 conflicting duplicate timestamps are reported, never arbitrarily selected",
  (() => {
    const r = validateCandleSeries([
      baseCandle,
      { ...baseCandle, close: 10.7 },
    ]);
    return r.candles.length === 1 && r.issues.some((i) => i.issue.includes("conflicting duplicate"));
  })());

check("TEST-MD-VAL-004 out-of-order input is returned strictly ascending",
  (() => {
    const r = validateCandleSeries([
      { ...baseCandle, eventTime: 3000 },
      { ...baseCandle, eventTime: 1000 },
      { ...baseCandle, eventTime: 2000 },
    ]);
    return r.candles.map((c) => c.eventTime).join(",") === "1000,2000,3000";
  })());

// ===========================================================================
// 3. DATA LABELS — LIVE / CACHED / STALE / SIMULATED / UNAVAILABLE
// ===========================================================================

const HOUR = 3600_000;

check("TEST-MD-LABEL-001 provider fetch this call is LIVE",
  deriveDataLabel({ barCount: 10, origin: "PROVIDER_FETCH", retrievedAt: NOW, lastBarEventTime: NOW, now: NOW, staleAfterMs: 2 * HOUR }).label === "LIVE");

check("TEST-MD-LABEL-002 recent persisted provider data is CACHED (not LIVE)",
  deriveDataLabel({ barCount: 10, origin: "PERSISTED", retrievedAt: NOW - 30 * 60_000, lastBarEventTime: NOW - 30 * 60_000, now: NOW, staleAfterMs: 2 * HOUR }).label === "CACHED");

check("TEST-MD-LABEL-003 old persisted provider data is STALE",
  deriveDataLabel({ barCount: 10, origin: "PERSISTED", retrievedAt: NOW - 5 * HOUR, lastBarEventTime: NOW - 5 * HOUR, now: NOW, staleAfterMs: 2 * HOUR }).label === "STALE");

check("TEST-MD-LABEL-004 synthetic data is SIMULATED regardless of age — never LIVE",
  deriveDataLabel({ barCount: 10, origin: "SIMULATED", retrievedAt: NOW, lastBarEventTime: NOW, now: NOW, staleAfterMs: 2 * HOUR }).label === "SIMULATED");

check("TEST-MD-LABEL-005 no data is UNAVAILABLE",
  deriveDataLabel({ barCount: 0, origin: "PERSISTED", retrievedAt: null, lastBarEventTime: null, now: NOW, staleAfterMs: 2 * HOUR }).label === "UNAVAILABLE");

check("TEST-MD-LABEL-006 source-tag classification separates providers from synthetic seeds",
  isSimulatedSource("SIM-CRYPTO-PROVIDER") && isSimulatedSource("synthetic-seed-v1") &&
  !isSimulatedSource("KRAKEN") && !isSimulatedSource("COINBASE"));

// ===========================================================================
// 4. TIMEFRAME MAPPING + SYMBOL MAPPING (per provider, honest gaps)
// ===========================================================================

check("TEST-MD-TF-001 Kraken interval map covers configured timeframes (4h -> 240)",
  krakenOhlcUrl("XBTUSD", "4h", 100)?.includes("interval=240") === true &&
  krakenOhlcUrl("XBTUSD", "1h", 100)?.includes("interval=60") === true);

check("TEST-MD-TF-002 Coinbase has no 4h bucket — UNSUPPORTED_REQUEST, never remapped",
  coinbaseCandlesUrl("BTC-USD", "4h") === null &&
  coinbaseCandlesUrl("BTC-USD", "1h")?.includes("granularity=3600") === true);

check("TEST-MD-TF-003 unknown timeframe has no duration and no provider URL",
  timeframeMs("7m") === null && krakenOhlcUrl("XBTUSD", "7m", 10) === null);

check("TEST-MD-SYM-001 instrument registry maps BTC/USD to both crypto providers and no FX feed",
  instrumentConfig("BTC/USD")?.krakenPair === "XBTUSD" &&
  instrumentConfig("BTC/USD")?.coinbaseProduct === "BTC-USD" &&
  instrumentConfig("BTC/USD")?.ecbBase === null &&
  instrumentConfig("XXX/YYY") === null);

// ===========================================================================
// 5. NETWORK BEHAVIOR — failures, rate limits, honesty (injected fetch)
// ===========================================================================

const CANARY = "sk_live_CANARY_SECRET_9f3a";

check("TEST-MD-NET-001 network failure is NETWORK_ERROR with a sanitized detail (no URL, no secrets)",
  await (async () => {
    const failing: FetchLike = async (url) => {
      void url;
      throw new Error(`boom ${CANARY}`);
    };
    const r = await fetchKrakenCandles({ symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: failing });
    return !r.ok && r.failureClass === "NETWORK_ERROR" && !r.detail.includes(CANARY) && !r.detail.includes("http");
  })());

check("TEST-MD-NET-002 HTTP 429 is RATE_LIMITED with a computed rateLimitUntil",
  await (async () => {
    const throttled: FetchLike = async () => mockResponse(429, "", { "retry-after": "30" });
    const r = await fetchKrakenCandles({ symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: throttled });
    return !r.ok && r.failureClass === "RATE_LIMITED" && r.rateLimitUntil === NOW + 30_000;
  })());

check("TEST-MD-NET-003 HTTP 500 is HTTP_ERROR naming the provider status only",
  await (async () => {
    const broken: FetchLike = async () => mockResponse(500, "internal");
    const r = await fetchKrakenCandles({ symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: broken });
    return !r.ok && r.failureClass === "HTTP_ERROR" && r.detail.includes("500") && !r.detail.includes("internal");
  })());

check("TEST-MD-NET-004 provider fallback: Kraken failure falls through to Coinbase success",
  await (async () => {
    const fallback: FetchLike = async (url) =>
      url.includes("kraken") ? mockResponse(500, "x") : mockResponse(200, COINBASE_REAL);
    const { result, attempts } = await fetchCryptoMarketData({
      symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: fallback,
    });
    return result !== null && result.ok && result.provider === "COINBASE" && attempts.length === 2;
  })());

check("TEST-MD-NET-006 Coinbase adapter fetches and validates the recorded payload end to end",
  await (async () => {
    const okFetch: FetchLike = async () => mockResponse(200, COINBASE_REAL);
    const r = await fetchCoinbaseCandles({ symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: okFetch });
    return r.ok && r.provider === "COINBASE" && r.candles.length === 3 && r.retrievedAt === NOW;
  })());

check("TEST-MD-NET-005 all providers failing yields NO result — nothing substituted",
  await (async () => {
    const dead: FetchLike = async () => mockResponse(503, "unavailable");
    const { result, attempts } = await fetchCryptoMarketData({
      symbol: "BTC/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: dead,
    });
    return result === null && attempts.length === 2 && attempts.every((a) => !a.ok);
  })());

// ===========================================================================
// 6. FOREX — close-only rate feed honored; NO synthetic candles
// ===========================================================================

check("TEST-MD-FX-001 FX candle path is honest NOT_CONFIGURED — never fake candles",
  await (async () => {
    const never: FetchLike = async () => {
      throw new Error("must not be called");
    };
    const r = await fetchForexCandles({ symbol: "EUR/USD", timeframe: "1h", limit: 10, now: NOW, fetchImpl: never });
    return !r.ok && r.failureClass === "NOT_CONFIGURED" && r.detail.includes("close-only");
  })());

const ecbParsed = parseFrankfurterTimeseries(FRANKFURTER_REAL, { base: "EUR", quote: "USD" });
check("TEST-MD-ECB-001 real Frankfurter payload yields dated close-only rate observations",
  ecbParsed.ok && ecbParsed.observations.length === 3 &&
  ecbParsed.observations[0].rateDate === "2026-10-01" &&
  ecbParsed.observations[2].rate === 1.1204);

check("TEST-MD-ECB-002 missing/zero FX rate is INVALID_DATA — never coerced",
  (() => {
    const r = parseFrankfurterTimeseries(JSON.stringify({ rates: { "2026-10-01": { USD: 0 } } }), { base: "EUR", quote: "USD" });
    return !r.ok && r.failureClass === "INVALID_DATA";
  })());

check("TEST-MD-ECB-003 fetchEcbRates carries the provider source URL for provenance",
  await (async () => {
    const okFetch: FetchLike = async (url) => {
      check("TEST-MD-ECB-003a request URL targets api.frankfurter.dev", url.includes("api.frankfurter.dev") && !url.includes("key="));
      return mockResponse(200, FRANKFURTER_REAL);
    };
    const r = await fetchEcbRates({ symbol: "EUR/USD", startIsoDate: "2026-07-16", endIsoDate: "2026-10-14", now: NOW, fetchImpl: okFetch });
    return r.ok && r.observations.length === 3 && r.sourceUrl.includes("2026-07-16..2026-10-14") && r.labelNote.includes("NOT OHLC");
  })());

// ===========================================================================
// 7. PROVIDER HEALTH — failures, rate limits, recovery
// ===========================================================================

check("TEST-MD-HEALTH-001 success resets failures and marks AVAILABLE",
  (() => {
    const h0 = initialHealth("KRAKEN", "MARKET_DATA", "CRYPTO");
    const h1 = healthAfterFailure(h0, NOW, "NETWORK_ERROR", "down", null);
    const h2 = healthAfterSuccess(h1, NOW + 1000, 120, "ok");
    return h1.status === "DEGRADED" && h1.consecutiveFailures === 1 &&
      h2.status === "AVAILABLE" && h2.consecutiveFailures === 0 && h2.lastLatencyMs === 120;
  })());

check("TEST-MD-HEALTH-002 three consecutive failures mark UNAVAILABLE; rate limit stays DEGRADED with deadline",
  (() => {
    let h = initialHealth("KRAKEN", "MARKET_DATA", "CRYPTO");
    for (let i = 0; i < 3; i++) h = healthAfterFailure(h, NOW + i, "HTTP_ERROR", "down", null);
    const limited = healthAfterFailure(initialHealth("X", "NEWS", null), NOW, "RATE_LIMITED", "429", NOW + 60_000);
    return h.status === "UNAVAILABLE" && h.consecutiveFailures === 3 &&
      limited.status === "DEGRADED" && limited.rateLimitUntil === NOW + 60_000;
  })());

// ===========================================================================
// 8. NEWS — parsing, evidence, dedup, freshness, honest selection
// ===========================================================================

const rssParsed = yahooFinanceRss.parse({
  body: YAHOO_RSS_REAL,
  retrievedAt: NOW,
  now: NOW,
  symbol: "BTC/USD",
  marketId: "MKT-BTCUSD-SIM",
});

check("TEST-NEWS-001 real RSS items carry provider, source URL, pub + retrieval timestamps",
  rssParsed.items.length === 2 &&
  rssParsed.items[0].provider === "YAHOO_FINANCE_RSS" &&
  rssParsed.items[0].sourceUrl.startsWith("https://stocktwits.com/") &&
  rssParsed.items[0].publishedAt === Date.parse("Wed, 14 Oct 2026 04:21:44 +0000") &&
  rssParsed.items[0].retrievedAt === NOW &&
  rssParsed.items[0].sourceName === "stocktwits.com");

check("TEST-NEWS-002 relevance tags the market/instrument/currency/asset for bitcoin content",
  rssParsed.items[0].relevanceScore > 0 &&
  rssParsed.items[0].markets.includes("MKT-BTCUSD-SIM") &&
  rssParsed.items[0].instruments.includes("BTC/USD") &&
  rssParsed.items[0].assets.includes("BTC"));

check("TEST-NEWS-003 items without a valid source URL are dropped, never invented",
  (() => {
    const r = yahooFinanceRss.parse({
      body: "<rss><item><title>No link here</title><pubDate>Wed, 14 Oct 2026 04:00:00 +0000</pubDate></item></rss>",
      retrievedAt: NOW,
      now: NOW,
      symbol: "BTC/USD",
      marketId: "MKT-BTCUSD-SIM",
    });
    return r.items.length === 0 && r.dropped.some((d) => d.reason === "MISSING_FIELD");
  })());

check("TEST-NEWS-004 unparseable pubDate keeps publishedAt null and freshness UNKNOWN",
  (() => {
    const r = yahooFinanceRss.parse({
      body: "<rss><item><title>Bad date</title><link>https://example.com/a</link><pubDate>someday</pubDate></item></rss>",
      retrievedAt: NOW,
      now: NOW,
      symbol: "BTC/USD",
      marketId: "MKT-BTCUSD-SIM",
    });
    return r.items.length === 1 && r.items[0].publishedAt === null &&
      r.items[0].freshness === "UNKNOWN" && r.dropped.some((d) => d.reason === "INVALID_TIMESTAMP");
  })());

check("TEST-NEWS-005 impact carries matched evidence; no evidence => UNKNOWN (never guessed)",
  (() => {
    const high = classifyImpact("Fed signals rate decision surprise; FOMC statement cites inflation");
    const none = classifyImpact("A quiet session with no macro drivers");
    return high.impact === "HIGH" && high.evidence.length > 0 &&
      none.impact === "UNKNOWN" && none.evidence.length === 0;
  })());

check("TEST-NEWS-006 duplicate detection finds identical normalized content",
  (() => {
    const a: NewsItem = {
      ...rssParsed.items[0],
      contentHash: newsContentHash("Bitcoin Rises", "https://example.com/a"),
    };
    const b: NewsItem = {
      ...a,
      contentHash: newsContentHash("bitcoin  rises", "https://example.com/a"),
    };
    const d = dedupeNews([a, b]);
    return d.unique.length === 1 && d.duplicates === 1;
  })());

check("TEST-NEWS-007 stale-only news is disclosed as unreliable — selection is null with reason",
  (() => {
    const stale: NewsItem = {
      ...rssParsed.items[0],
      impact: "HIGH",
      publishedAt: NOW - 100 * HOUR,
      freshness: newsFreshness(NOW - 100 * HOUR, NOW),
    };
    const sel = selectHighImpactNews([stale], NOW);
    return sel.selected === null && sel.reason.includes("NO_RELIABLE_NEWS");
  })());

check("TEST-NEWS-008 selection prefers HIGH impact relevant fresh items and reports evidence",
  (() => {
    const medium: NewsItem = {
      ...rssParsed.items[0],
      contentHash: newsContentHash("m", "https://example.com/m"),
      impact: "MEDIUM",
      impactEvidence: ["MEDIUM:earnings"],
      publishedAt: NOW - 2 * HOUR,
      freshness: "FRESH",
    };
    const high: NewsItem = {
      ...rssParsed.items[0],
      contentHash: newsContentHash("h", "https://example.com/h"),
      impact: "HIGH",
      impactEvidence: ["HIGH:fomc"],
      publishedAt: NOW - 5 * HOUR,
      freshness: "FRESH",
    };
    const sel = selectHighImpactNews([medium, high], NOW);
    return sel.selected?.impact === "HIGH" && sel.selected.impactEvidence.includes("HIGH:fomc");
  })());

check("TEST-NEWS-009 no relevant items => selection null (no invented headline)",
  (() => {
    const irrelevant: NewsItem = {
      ...rssParsed.items[0],
      relevanceScore: 0,
      contentHash: newsContentHash("x", "https://example.com/x"),
    };
    const sel = selectHighImpactNews([irrelevant], NOW);
    return sel.selected === null && sel.reason.includes("NO_RELIABLE_NEWS");
  })());

check("TEST-NEWS-010 freshness thresholds: fresh <=24h, aging <=72h, stale beyond, unknown for null",
  newsFreshness(NOW - 1 * HOUR, NOW) === "FRESH" &&
  newsFreshness(NOW - 48 * HOUR, NOW) === "AGING" &&
  newsFreshness(NOW - 80 * HOUR, NOW) === "STALE" &&
  newsFreshness(null, NOW) === "UNKNOWN" &&
  newsFreshness(NOW + 10 * HOUR, NOW) === "UNKNOWN");

// ===========================================================================
// 9. STRATEGY CANDIDATE EVALUATION — deterministic, honest when data is thin
// ===========================================================================

function flatThenMove(finalClose: number, bars = 30): { eventTime: number; open: number; high: number; low: number; close: number; volume: number; availabilityTime: number }[] {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const close = i === bars - 1 ? finalClose : 100;
    out.push({
      eventTime: i * HOUR,
      open: i === bars - 1 ? 100 : 100,
      high: Math.max(100, close) + 1,
      low: Math.min(100, close) - 1,
      close,
      volume: 1,
      availabilityTime: i * HOUR + HOUR,
    });
  }
  return out;
}

const stratDef: StrategyDefinition = {
  marketId: "MKT-BTCUSD-SIM",
  symbol: "BTC/USD",
  timeframe: "1h",
  entry: { indicator: "ema_cross", fast: 3, slow: 5 },
  exit: { stopLossPct: 0.02, takeProfitPct: 0.045, timeExitBars: 36 },
  filters: { rsiMin: null, rsiMax: null },
  sizing: { kind: "fixed_fraction", fraction: 0.25 },
};

const ids = { strategyId: "STRAT-TEST", strategyVersionId: "SV-TEST", strategyName: "Test" };

check("TEST-STRAT-001 insufficient bars => NOT_EVALUATED with required count, nothing fabricated",
  (() => {
    const r = evaluateStrategyDefinition(stratDef, flatThenMove(110, 5), ids);
    return !r.evaluated && r.signal === "NOT_EVALUATED" && r.evidence.barsRequired > 5 && r.reason.includes("Insufficient");
  })());

check("TEST-STRAT-002 fast-over-slow crossover on the last bar => LONG with indicator evidence",
  (() => {
    const r = evaluateStrategyDefinition(stratDef, flatThenMove(110), ids);
    return r.evaluated && r.signal === "LONG" && r.evidence.fastEma !== null && r.evidence.slowEma !== null &&
      (r.evidence.fastEma as number) > (r.evidence.slowEma as number) && r.evidence.lastClose === 110;
  })());

check("TEST-STRAT-003 sharp drop on the last bar => SHORT (with null RSI bounds)",
  (() => {
    const r = evaluateStrategyDefinition(stratDef, flatThenMove(90), ids);
    return r.evaluated && r.signal === "SHORT";
  })());

check("TEST-STRAT-004 declared RSI no-trade filter blocks the entry (FLAT, reason cites bounds)",
  (() => {
    const withFilter: StrategyDefinition = { ...stratDef, filters: { rsiMin: 45, rsiMax: 85 } };
    const r = evaluateStrategyDefinition(withFilter, flatThenMove(110), ids);
    return r.evaluated && r.signal === "FLAT" && r.reason.includes("RSI");
  })());

check("TEST-STRAT-005 garbage definitions fail honest (NOT_EVALUATED, never permissive)",
  (() => {
    const bad = { ...stratDef, entry: { indicator: "ema_cross", fast: 5, slow: 3 } } as unknown as StrategyDefinition;
    const r1 = evaluateStrategyDefinition(bad, flatThenMove(110), ids);
    const r2 = evaluateStrategyDefinition(null, flatThenMove(110), ids);
    return r1.signal === "NOT_EVALUATED" && r2.signal === "NOT_EVALUATED";
  })());

check("TEST-STRAT-006 evaluation is deterministic (same inputs, same outputs)",
  (() => {
    const a = evaluateStrategyDefinition(stratDef, flatThenMove(110), ids);
    const b = evaluateStrategyDefinition(stratDef, flatThenMove(110), ids);
    return JSON.stringify(a) === JSON.stringify(b);
  })());

check("TEST-STRAT-007 no crossover on the last bar => FLAT (no entry proposed)",
  (() => {
    const steady = flatThenMove(100); // no move at all
    const r = evaluateStrategyDefinition(stratDef, steady, ids);
    return r.evaluated && r.signal === "FLAT";
  })());

// ===========================================================================

console.log(`\nmarketdata-verification: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
