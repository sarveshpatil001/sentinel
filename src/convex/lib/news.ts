/**
 * SENTINEL PRIME — MARKET NEWS PROVIDER INTERFACE (Section 06)
 *
 * A real news-provider interface plus one implemented, connectivity-verified
 * adapter (Yahoo Finance RSS — verified from this project's build environment
 * on 2026-10-14; the recorded response shape is asserted in
 * `src/tests/marketdata-verification.ts`).
 *
 * Every news item carries: provider and original source URL, publication
 * timestamp AND retrieval timestamp, relevant market/currency/instrument/asset,
 * impact classification WITH supporting evidence, duplicate detection
 * (content hash) and freshness classification.
 *
 * Honesty rules:
 *   - A missing publication date is `null` with freshness "UNKNOWN" — never
 *     replaced with the retrieval time.
 *   - Impact without matching evidence is "UNKNOWN" — never guessed.
 *   - Items missing a source URL or headline are dropped, not invented.
 *   - When no reliable, relevant item exists, selection returns `null` with a
 *     precise reason — a headline is NEVER fabricated.
 *
 * Pure and deterministic: network access only through the injected `fetchImpl`.
 */

import { sha256Hex } from "./audit";
import { instrumentConfig, type FetchLike } from "./marketData";

export type NewsImpact = "HIGH" | "MEDIUM" | "UNKNOWN";
export type NewsFreshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export interface NewsItem {
  /** Provider adapter that produced this item. */
  provider: string;
  /** Human-readable original publisher, when derivable from the source URL. */
  sourceName: string;
  /** Original source URL of the article (never invented). */
  sourceUrl: string;
  headline: string;
  summary: string;
  /** Publication timestamp (ms) — null when the feed gave none/invalid. */
  publishedAt: number | null;
  /** Retrieval timestamp (ms) — when this system fetched the item. */
  retrievedAt: number;
  markets: string[];
  instruments: string[];
  currencies: string[];
  assets: string[];
  impact: NewsImpact;
  /** Phrases that actually matched the impact rules (evidence, not opinion). */
  impactEvidence: string[];
  relevanceScore: number;
  /** SHA-256 of normalized headline + source domain (duplicate detection). */
  contentHash: string;
  freshness: NewsFreshness;
}

export interface NewsParseResult {
  items: NewsItem[];
  /** Items dropped during parsing, with reasons (missing fields, etc.). */
  dropped: { reason: string; detail: string }[];
}

/**
 * News provider contract. Any adapter must be able to build a request and
 * strictly parse the response — no adapter may return placeholder content.
 */
export interface NewsProviderAdapter {
  provider: string;
  buildRequest(input: { symbol: string; marketId: string }): { url: string };
  parse(input: {
    body: string;
    retrievedAt: number;
    now: number;
    symbol: string;
    marketId: string;
  }): NewsParseResult;
}

// ---------------------------------------------------------------------------
// Impact classification — keyword evidence, allowlist style
// ---------------------------------------------------------------------------

const HIGH_IMPACT_PHRASES = [
  "rate decision",
  "interest rate",
  "rate cut",
  "rate hike",
  "fomc",
  "central bank",
  "fed ",
  "federal reserve",
  "ecb",
  "european central bank",
  "cpi",
  "inflation",
  "payroll",
  "nonfarm",
  "recession",
  "emergency",
  "bailout",
  "bankruptcy",
  "insolvency",
  "hack",
  "exploit",
  "halt trading",
  "etf approval",
  "etf approved",
  "sec ",
  "sanctions",
  "war ",
];

const MEDIUM_IMPACT_PHRASES = [
  "earnings",
  "forecast",
  "outlook",
  "guidance",
  "regulation",
  "regulator",
  "lawsuit",
  "investigation",
  "ipo",
  "merger",
  "acquisition",
  "liquidation",
  "upgrade",
  "downgrade",
  "partnership",
  "adoption",
];

export function classifyImpact(text: string): { impact: NewsImpact; evidence: string[] } {
  const haystack = ` ${text.toLowerCase()} `;
  const evidence: string[] = [];
  for (const phrase of HIGH_IMPACT_PHRASES) {
    if (haystack.includes(phrase)) evidence.push(`HIGH:${phrase.trim()}`);
  }
  if (evidence.length > 0) return { impact: "HIGH", evidence };
  for (const phrase of MEDIUM_IMPACT_PHRASES) {
    if (haystack.includes(phrase)) evidence.push(`MEDIUM:${phrase.trim()}`);
  }
  if (evidence.length > 0) return { impact: "MEDIUM", evidence };
  // No matched evidence => UNKNOWN. Impact is never invented.
  return { impact: "UNKNOWN", evidence: [] };
}

// ---------------------------------------------------------------------------
// Relevance classification — instrument/currency/asset term matching
// ---------------------------------------------------------------------------

export interface RelevanceClassification {
  score: number;
  markets: string[];
  instruments: string[];
  currencies: string[];
  assets: string[];
}

export function classifyRelevance(
  text: string,
  opts: { symbol: string; marketId: string; terms: string[] },
): RelevanceClassification {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of opts.terms) {
    if (haystack.includes(term.toLowerCase())) score += 1;
  }
  const [base, quote] = opts.symbol.split("/");
  return {
    score,
    markets: score > 0 ? [opts.marketId] : [],
    instruments: score > 0 ? [opts.symbol] : [],
    currencies: score > 0 ? [base, quote].filter((c) => typeof c === "string" && c.length > 0) : [],
    assets: score > 0 && (base === "BTC" || base === "ETH") ? [base] : [],
  };
}

// ---------------------------------------------------------------------------
// Freshness — publication based; unknown stays UNKNOWN
// ---------------------------------------------------------------------------

export const FRESH_MAX_AGE_MS = 24 * 3600_000;
export const AGING_MAX_AGE_MS = 72 * 3600_000;

export function newsFreshness(publishedAt: number | null, now: number): NewsFreshness {
  if (publishedAt === null || !Number.isFinite(publishedAt)) return "UNKNOWN";
  const age = now - publishedAt;
  if (age < 0) return "UNKNOWN"; // future-dated feed entry: untrusted clock
  if (age <= FRESH_MAX_AGE_MS) return "FRESH";
  if (age <= AGING_MAX_AGE_MS) return "AGING";
  return "STALE";
}

// ---------------------------------------------------------------------------
// Duplicate detection — normalized content hash
// ---------------------------------------------------------------------------

export function newsContentHash(headline: string, sourceUrl: string): string {
  let domain = "";
  try {
    domain = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    domain = "";
  }
  const normalized = headline.toLowerCase().replace(/\s+/g, " ").trim();
  return `sha256:${sha256Hex(`${domain}|${normalized}`)}`;
}

export function dedupeNews(items: NewsItem[]): {
  unique: NewsItem[];
  duplicates: number;
  conflicting: number;
} {
  const byHash = new Map<string, NewsItem>();
  let duplicates = 0;
  let conflicting = 0;
  for (const item of items) {
    const existing = byHash.get(item.contentHash);
    if (!existing) {
      byHash.set(item.contentHash, item);
      continue;
    }
    duplicates += 1;
    // Same normalized content from the same domain but different URLs is a
    // conflict — both are preserved as a count; neither is silently chosen.
    if (existing.sourceUrl !== item.sourceUrl) conflicting += 1;
  }
  return { unique: [...byHash.values()], duplicates, conflicting };
}

// ---------------------------------------------------------------------------
// High-impact selection — most relevant high-impact item, or an honest null
// ---------------------------------------------------------------------------

export interface NewsSelection {
  selected: NewsItem | null;
  reason: string;
  considered: number;
}

const IMPACT_RANK: Readonly<Record<NewsImpact, number>> = { HIGH: 3, MEDIUM: 2, UNKNOWN: 1 };

export function selectHighImpactNews(items: NewsItem[], now: number): NewsSelection {
  const { unique } = dedupeNews(items);
  const relevant = unique.filter((i) => i.relevanceScore > 0);
  if (relevant.length === 0) {
    return {
      selected: null,
      reason:
        "NO_RELIABLE_NEWS: no news item relevant to the requested instrument was retrieved. No headline is invented.",
      considered: unique.length,
    };
  }
  // Reliable = FRESH or AGING with a real publication timestamp. Freshness
  // is RECOMPUTED at selection time (never trusted from a stored field), and
  // STALE/UNKNOWN-freshness items are excluded rather than passed off as
  // current.
  const reliable = relevant.filter((i) => {
    const freshness = newsFreshness(i.publishedAt, now);
    return freshness === "FRESH" || freshness === "AGING";
  });
  if (reliable.length === 0) {
    return {
      selected: null,
      reason:
        "NO_RELIABLE_NEWS: relevant items exist but all are STALE or missing a trusted publication time — disclosed rather than presented as current.",
      considered: relevant.length,
    };
  }
  const ranked = [...reliable].sort((a, b) => {
    const impact = IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact];
    if (impact !== 0) return impact;
    if (a.relevanceScore !== b.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  });
  const top = ranked[0];
  return {
    selected: top,
    reason:
      top.impact === "UNKNOWN"
        ? "Selected as most relevant, but impact is UNKNOWN (no impact evidence matched) — disclosed as such."
        : `Selected highest-impact (${top.impact}) relevant item with ${top.impactEvidence.length} evidence phrase(s).`,
    considered: reliable.length,
  };
}

// ---------------------------------------------------------------------------
// Yahoo Finance RSS adapter (verified 2026-10-14)
// GET https://feeds.finance.yahoo.com/rss/2.0/headline?s=<TICKER>&region=US&lang=en-US
// RSS 2.0 <item> entries with <title>, <link>, <pubDate>, <description>.
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? decodeEntities(m[1]) : null;
}

function sourceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export const yahooFinanceRss: NewsProviderAdapter = {
  provider: "YAHOO_FINANCE_RSS",

  buildRequest({ symbol }) {
    const ticker = symbol.replace("/", "-");
    return {
      url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
    };
  },

  parse({ body, retrievedAt, now, symbol, marketId }) {
    const items: NewsItem[] = [];
    const dropped: { reason: string; detail: string }[] = [];

    if (typeof body !== "string" || !body.includes("<item")) {
      if (typeof body === "string" && body.toLowerCase().includes("<rss")) {
        return { items, dropped }; // valid feed, zero items — honest empty
      }
      dropped.push({ reason: "MALFORMED_RESPONSE", detail: "feed body is not RSS (no <item> or <rss>)" });
      return { items, dropped };
    }

    const blocks = body.split(/<item[\s>]/i).slice(1);
    for (const rawBlock of blocks) {
      const block = rawBlock.split("</item>")[0] ?? rawBlock;
      const headline = extractTag(block, "title");
      const link = extractTag(block, "link");
      const description = extractTag(block, "description");
      const pubDateRaw = extractTag(block, "pubDate");

      if (headline === null || headline === "") {
        dropped.push({ reason: "MISSING_FIELD", detail: "item has no <title> — dropped, never invented" });
        continue;
      }
      if (link === null || !/^https?:\/\//i.test(link)) {
        dropped.push({ reason: "MISSING_FIELD", detail: `item "${headline.slice(0, 60)}" has no valid source URL — dropped` });
        continue;
      }

      let publishedAt: number | null = null;
      if (pubDateRaw !== null) {
        const parsedDate = Date.parse(pubDateRaw);
        publishedAt = Number.isFinite(parsedDate) ? parsedDate : null;
        if (publishedAt === null) {
          dropped.push({ reason: "INVALID_TIMESTAMP", detail: `unparseable <pubDate> for "${headline.slice(0, 60)}" — publishedAt stays null` });
        }
      }

      const text = `${headline} ${description ?? ""}`;
      const { impact, evidence } = classifyImpact(text);
      const cfg = instrumentConfig(symbol);
      const relevance = classifyRelevance(text, {
        symbol,
        marketId,
        terms: cfg?.newsTerms ?? [symbol.split("/")[0] ?? ""].filter((t) => t.length > 0),
      });

      items.push({
        provider: yahooFinanceRss.provider,
        sourceName: sourceNameFromUrl(link),
        sourceUrl: link,
        headline,
        summary: description ?? "",
        publishedAt,
        retrievedAt,
        markets: relevance.markets,
        instruments: relevance.instruments,
        currencies: relevance.currencies,
        assets: relevance.assets,
        impact,
        impactEvidence: evidence,
        relevanceScore: relevance.score,
        contentHash: newsContentHash(headline, link),
        freshness: newsFreshness(publishedAt, now),
      });
    }
    return { items, dropped };
  },
};

// ---------------------------------------------------------------------------
// Provider fetch (injected fetch; failure is disclosed, never invented news)
// ---------------------------------------------------------------------------

export interface NewsFetchResult {
  ok: boolean;
  provider: string;
  items: NewsItem[];
  dropped: { reason: string; detail: string }[];
  retrievedAt: number;
  failureClass: string | null;
  detail: string;
}

export async function fetchYahooNews(req: {
  symbol: string;
  marketId: string;
  now: number;
  fetchImpl: FetchLike;
}): Promise<NewsFetchResult> {
  const request = yahooFinanceRss.buildRequest({ symbol: req.symbol, marketId: req.marketId });
  let body: string;
  try {
    const res = await req.fetchImpl(request.url, {
      headers: {
        accept: "application/rss+xml, application/xml, text/xml",
        "user-agent": "sentinel-prime/1.0 (news)",
      },
    });
    if (res.status === 429) {
      return {
        ok: false,
        provider: yahooFinanceRss.provider,
        items: [],
        dropped: [],
        retrievedAt: req.now,
        failureClass: "RATE_LIMITED",
        detail: "news provider rate limit (HTTP 429) — news unavailable for this run",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        provider: yahooFinanceRss.provider,
        items: [],
        dropped: [],
        retrievedAt: req.now,
        failureClass: "HTTP_ERROR",
        detail: `news provider HTTP ${res.status} — news unavailable for this run`,
      };
    }
    body = await res.text();
  } catch (e) {
    return {
      ok: false,
      provider: yahooFinanceRss.provider,
      items: [],
      dropped: [],
      retrievedAt: req.now,
      failureClass: "NETWORK_ERROR",
      detail: `news provider unreachable (${e instanceof Error ? e.name : "Error"}) — news unavailable for this run`,
    };
  }

  const parsed = yahooFinanceRss.parse({
    body,
    retrievedAt: req.now,
    now: req.now,
    symbol: req.symbol,
    marketId: req.marketId,
  });
  return {
    ok: true,
    provider: yahooFinanceRss.provider,
    items: parsed.items,
    dropped: parsed.dropped,
    retrievedAt: req.now,
    failureClass: parsed.items.length === 0 ? "EMPTY_FEED" : null,
    detail: `${parsed.items.length} parsed item(s), ${parsed.dropped.length} dropped`,
  };
}
