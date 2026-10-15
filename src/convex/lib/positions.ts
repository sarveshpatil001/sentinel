/**
 * SENTINEL PRIME — POSITION / FILL ACCOUNTING (Section 11 reconciliation)
 *
 * Canonical position accounting identities (standard accounting, no invented
 * thresholds): fills add to or reduce a position at a weighted average entry
 * price; realized PnL accrues on the closed portion as (exit - entry) * qty
 * with the sign of the closing direction. Order state != position state.
 *
 * Duplicate-fill protection: fills are recorded as CUMULATIVE filled quantity
 * per order; `fillDelta` returns only the not-yet-accounted portion, so
 * re-applying the same provider fill event never double-counts.
 */

export type PositionSide = "LONG" | "SHORT" | "FLAT";

export interface PositionState {
  side: PositionSide;
  quantity: number;
  avgEntryPrice: number;
  realizedPnl: number;
}

export interface Fill {
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
}

const FLAT: PositionState = {
  side: "FLAT",
  quantity: 0,
  avgEntryPrice: 0,
  realizedPnl: 0,
};

/**
 * Apply one fill to a position using canonical netting identities.
 * - BUY on LONG (or SELL on SHORT): adds to the position at the weighted
 *   average entry price.
 * - SELL against LONG (or BUY against SHORT): realizes (exit - entry) * qty
 *   on the closed portion.
 * - Over-closing flips through FLAT into the opposite side at the fill price.
 * Pure: same inputs -> same output. Never mutates its arguments.
 */
export function applyFill(
  position: PositionState | null,
  fill: Fill,
): PositionState {
  const pos: PositionState = position ?? { ...FLAT };
  const q = fill.quantity;
  const p = fill.price;

  if (fill.side === "BUY") {
    if (pos.side === "SHORT") {
      // Cover: realize on the closed portion of the short.
      const closeQty = Math.min(q, pos.quantity);
      const realized = (pos.avgEntryPrice - p) * closeQty;
      const rest = q - closeQty;
      if (rest > 0) {
        return {
          side: "LONG",
          quantity: rest,
          avgEntryPrice: p,
          realizedPnl: pos.realizedPnl + realized,
        };
      }
      const remaining = pos.quantity - closeQty;
      return {
        side: remaining > 0 ? "SHORT" : "FLAT",
        quantity: remaining,
        avgEntryPrice: remaining > 0 ? pos.avgEntryPrice : 0,
        realizedPnl: pos.realizedPnl + realized,
      };
    }
    // Add to long (or open long from flat).
    const newQty = pos.quantity + q;
    return {
      side: "LONG",
      quantity: newQty,
      avgEntryPrice:
        (pos.avgEntryPrice * pos.quantity + p * q) / newQty,
      realizedPnl: pos.realizedPnl,
    };
  }

  // SELL
  if (pos.side === "LONG") {
    const closeQty = Math.min(q, pos.quantity);
    const realized = (p - pos.avgEntryPrice) * closeQty;
    const rest = q - closeQty;
    if (rest > 0) {
      return {
        side: "SHORT",
        quantity: rest,
        avgEntryPrice: p,
        realizedPnl: pos.realizedPnl + realized,
      };
    }
    const remaining = pos.quantity - closeQty;
    return {
      side: remaining > 0 ? "LONG" : "FLAT",
      quantity: remaining,
      avgEntryPrice: remaining > 0 ? pos.avgEntryPrice : 0,
      realizedPnl: pos.realizedPnl + realized,
    };
  }
  // Add to short (or open short from flat).
  const newQty = pos.quantity + q;
  return {
    side: "SHORT",
    quantity: newQty,
    avgEntryPrice:
      (pos.avgEntryPrice * pos.quantity + p * q) / newQty,
    realizedPnl: pos.realizedPnl,
  };
}

/**
 * Duplicate-fill guard: provider fill events carry the CUMULATIVE filled
 * quantity for an order. Only the delta above the already-applied amount may
 * touch the position ledger; re-applying an old event yields delta 0.
 */
export function fillDelta(
  cumulativeFilled: number,
  alreadyApplied: number,
): number {
  if (!Number.isFinite(cumulativeFilled) || !Number.isFinite(alreadyApplied)) {
    return 0; // invalid accounting input -> apply nothing (fail closed)
  }
  return Math.max(0, cumulativeFilled - alreadyApplied);
}

/**
 * Closed portion of a position for one fill application (the repository's
 * accounting model realizes PnL per closed portion per fill):
 *   - SELL against a LONG closes up to the long quantity;
 *   - BUY against a SHORT closes up to the short quantity;
 *   - adds/opens (and the reopen leg of an over-close) close nothing.
 * Pure and validated; invalid input closes nothing (fail closed).
 */
export function closedQuantity(position: PositionState | null, fill: Fill): number {
  if (!position || !Number.isFinite(fill.quantity) || fill.quantity <= 0) return 0;
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) return 0;
  if (fill.side === "SELL" && position.side === "LONG") {
    return Math.min(fill.quantity, position.quantity);
  }
  if (fill.side === "BUY" && position.side === "SHORT") {
    return Math.min(fill.quantity, position.quantity);
  }
  return 0;
}

/**
 * MARK-TO-MARKET unrealized PnL of one open position at `markPrice`, with the
 * price-side convention appropriate to the position direction:
 *   LONG  -> (mark - avgEntry) * qty
 *   SHORT -> (avgEntry - mark) * qty
 * Returns null when the position or the mark cannot be valued reliably
 * (missing/invalid quantity, entry or price). null is NEVER coerced to 0:
 * an unvalued position must fail the valuation closed at the caller.
 */
export function unrealizedPnl(
  position: { side: PositionSide; quantity: number; avgEntryPrice: number },
  markPrice: number | null | undefined,
): number | null {
  if (!Number.isFinite(markPrice) || (markPrice as number) <= 0) return null;
  const mark = markPrice as number;
  if (!Number.isFinite(position.quantity) || position.quantity < 0) return null;
  if (position.quantity === 0) return 0; // nothing open (any side)
  if (!Number.isFinite(position.avgEntryPrice) || position.avgEntryPrice <= 0) return null;
  if (position.side === "LONG") return (mark - position.avgEntryPrice) * position.quantity;
  if (position.side === "SHORT") return (position.avgEntryPrice - mark) * position.quantity;
  return null; // unknown side -> not valuable (fail closed)
}

/**
 * COMPLETED REALIZED TRADE OUTCOMES (consecutive-loss accounting).
 *
 * In this repository's accounting model a "completed realized trade outcome"
 * is a REALIZATION EVENT: the application of a fill that CLOSES a positive
 * portion of a position (see closedQuantity), i.e. exactly the moment realized
 * PnL enters the ledger. Adds/opens produce no outcome. Partial exits across
 * separate orders are distinct outcomes; re-applying the SAME fill event is
 * idempotent (stable outcome id) and never counts twice.
 *
 * Classification is by the SIGN of the realized delta — no breakeven epsilon
 * is invented: delta < 0 LOSS, delta > 0 WIN, delta === 0 BREAKEVEN.
 * Returns null when there is no realization event (nothing closed) or the
 * accounting inputs are invalid (never fabricated).
 */
export type RealizedOutcome = "WIN" | "LOSS" | "BREAKEVEN";

export function classifyRealizedOutcome(
  realizedDelta: number,
  closedQty: number,
): RealizedOutcome | null {
  if (!Number.isFinite(closedQty) || closedQty <= 0) return null; // no close, no outcome
  if (!Number.isFinite(realizedDelta)) return null; // corrupt accounting input -> never fabricated
  if (realizedDelta < 0) return "LOSS";
  if (realizedDelta > 0) return "WIN";
  return "BREAKEVEN";
}

/**
 * LOSS STREAK POLICY (documented, deterministic):
 *   - a LOSS outcome extends the streak by 1;
 *   - a WIN outcome resets the streak to 0;
 *   - a BREAKEVEN outcome neither extends nor resets it (safer fail-closed
 *     reading: a scratch trade is no evidence the losing run is over).
 * The streak is therefore the number of losing outcomes since the most recent
 * winning outcome.
 *
 * `rows` must be ordered NEWEST FIRST and carry a per-owner monotonic `seq`.
 * Completeness is never assumed:
 *   - a seq gap (missing outcome history) -> complete: false (fail closed),
 *   - a non-finite/unknown outcome value  -> complete: false (fail closed),
 *   - reaching the end of the supplied rows without finding a WIN while
 *     `historyComplete` is false (the window was truncated by a bounded read)
 *     -> complete: false: the streak is a LOWER bound and the reported value
 *     is the counted lower bound — never a silently substituted 0.
 *
 * `historyComplete` states whether `rows` IS the owner's complete outcome
 * history (the caller's bounded read did not saturate).
 */
export function computeLossStreak(
  rows: { seq: number; outcome: string }[],
  historyComplete: boolean,
): { streak: number; complete: boolean } {
  let streak = 0;
  let expected = rows.length > 0 && Number.isInteger(rows[0].seq) ? rows[0].seq : null;
  if (rows.length > 0 && expected === null) return { streak: 0, complete: false };
  for (const row of rows) {
    if (expected === null || row.seq !== expected) {
      return { streak, complete: false }; // gap / malformed seq -> unreliable
    }
    expected -= 1;
    if (row.outcome === "WIN") return { streak, complete: true }; // run ends here
    if (row.outcome === "LOSS") {
      streak += 1;
    } else if (row.outcome === "BREAKEVEN") {
      // neither extends nor resets (policy above)
    } else {
      return { streak, complete: false }; // unknown outcome value -> unreliable
    }
  }
  // Reached the end of the supplied rows without a WIN. Complete only when the
  // caller's read holds the whole history; otherwise the streak is a lower
  // bound over a truncated window (fail closed upstream).
  return { streak, complete: historyComplete };
}
