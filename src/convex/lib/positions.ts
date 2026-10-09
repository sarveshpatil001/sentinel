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
