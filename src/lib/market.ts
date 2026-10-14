/**
 * Sentinel Prime — display derivations for seeded market series.
 *
 * Pure functions only: every value shown in the workspace is derived from
 * stored candle data at render time. Nothing here fabricates a quote, a
 * spread, or a level; callers must show an explicit "—" or a documented
 * empty state whenever an input is missing.
 */

export interface SeriesPoint {
  t: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface SeriesEntry {
  marketId: string;
  symbol: string;
  timeframe?: string | null;
  points: SeriesPoint[];
}

export interface MarketMeta {
  marketId: string;
  symbol: string;
  assetClass: string;
  providerState?: string;
}

const WORKSPACE_DEFAULT_SYMBOL = "EUR/USD";

export function workspaceSymbol(symbol: string | null | undefined): string {
  return symbol && symbol.length > 0 ? symbol : WORKSPACE_DEFAULT_SYMBOL;
}

export function selectSeries(
  entries: SeriesEntry[] | null | undefined,
  preferredSymbol = WORKSPACE_DEFAULT_SYMBOL,
): SeriesEntry | null {
  if (!entries || entries.length === 0) return null;
  const withPoints = entries.filter((entry) => entry.points.length > 0);
  const pool = withPoints.length > 0 ? withPoints : entries;
  return pool.find((entry) => entry.symbol === preferredSymbol) ?? pool[0];
}

function decimalsFor(assetClass: string | undefined): number {
  return assetClass === "CRYPTO" ? 2 : 5;
}

function groupInteger(part: string): string {
  return part.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatPrice(value: number, assetClass?: string): string {
  if (!Number.isFinite(value)) return "—";
  const [integer, fraction] = value.toFixed(decimalsFor(assetClass)).split(".");
  return fraction ? `${groupInteger(integer)}.${fraction}` : groupInteger(integer);
}

export function formatSignedPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

/** Percentage change of the last close versus the close `bars` earlier. */
export function changeOverWindow(points: SeriesPoint[], bars: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const reference = points[Math.max(0, points.length - 1 - bars)];
  if (!reference.close) return null;
  return ((last.close - reference.close) / reference.close) * 100;
}

/** Highest high and lowest low over the last `bars` candles (closes fallback). */
export function windowExtreme(
  points: SeriesPoint[],
  bars: number,
): { high: number | null; low: number | null } {
  if (points.length === 0) return { high: null, low: null };
  const window = points.slice(-bars);
  const highs = window.map((p) => (typeof p.high === "number" ? p.high : p.close));
  const lows = window.map((p) => (typeof p.low === "number" ? p.low : p.close));
  return { high: Math.max(...highs), low: Math.min(...lows) };
}

export function volumeSum(points: SeriesPoint[], bars: number): number | null {
  const window = points.slice(-bars);
  const volumes = window.filter((p) => typeof p.volume === "number");
  if (volumes.length === 0) return null;
  return volumes.reduce((sum, p) => sum + (p.volume ?? 0), 0);
}

/** Average true range over `period` bars; null when OHLC is not stored. */
export function atr(points: SeriesPoint[], period = 14): number | null {
  if (points.length < 2) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (
      typeof current.high !== "number" ||
      typeof current.low !== "number" ||
      typeof previous.close !== "number"
    ) {
      return null;
    }
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }
  const window = trueRanges.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

/** Sparkline path across the given box; null when fewer than two points. */
export function sparklinePath(
  points: SeriesPoint[],
  width: number,
  height: number,
): string | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function relativeTime(t: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function utcClock(t: number): string {
  const date = new Date(t);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

/** Trading session by UTC hour (client clock; no feed involved). */
export function sessionLabel(now: number = Date.now()): string {
  const hour = new Date(now).getUTCHours();
  if (hour >= 12 && hour < 16) return "London/NY";
  if (hour >= 7 && hour < 12) return "London";
  if (hour >= 16 && hour < 21) return "New York";
  return "Asia";
}

const FLAG_BY_BASE: Record<string, string> = {
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  USD: "🇺🇸",
  JPY: "🇯🇵",
  BTC: "₿",
  ETH: "Ξ",
};

export function flagForSymbol(symbol: string): string {
  const base = symbol.split(/[/\s]/)[0] ?? "";
  return FLAG_BY_BASE[base] ?? base.slice(0, 1).toUpperCase();
}

/** ATR expressed in pips for FX quotes, raw price units otherwise. */
export function atrLabel(value: number | null, assetClass?: string, quoteAsset?: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (assetClass === "FOREX") {
    const pip = quoteAsset === "JPY" ? 100 : 10_000;
    return `${Math.round(value * pip)} Pips`;
  }
  return formatPrice(value, assetClass);
}
