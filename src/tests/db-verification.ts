/**
 * SENTINEL PRIME — DATABASE VERIFICATION BATTERY (convex-test harness)
 *
 * Exercises the REAL Convex mutation/query handlers against an in-memory
 * database via `convex-test` (the approved integration-test harness). This
 * covers the behaviors a pure-function battery cannot: transactional writes,
 * ownership enforcement with real identities, authorization consumption,
 * duplicate-submission protection, reconciliation state transitions, and
 * snapshot binding at the mutation boundary.
 *
 * Execute with: bun src/tests/db-verification.ts
 * Exit code 0 only when every check passes. Checks are never deleted to make
 * the build green (Rule 38/39).
 *
 * BOUNDARIES (deliberate):
 *  - Policy fixtures mirror the seeded PROVISIONAL configuration or declare NO
 *    limits at all. The single exception is DB-POLREF-* (P0 regression): it
 *    performs a REAL admin ratification of the seeded policy through the
 *    admin-gated `approveRiskPolicy` mutation, inside its own isolated
 *    in-memory database, to exercise the approved-proposal-to-order path.
 *    No numerical limit is changed, and nothing leaves that test database.
 *  - Execution authorization fixtures are inserted directly as capability
 *    tokens (owner-bound records) so that consumption/ownership behavior can
 *    be tested without ratifying any policy.
 *  - Everything is PAPER/DEMO: no live credentials, no provider adapters, no
 *    live-mode activation path is created or exercised.
 */
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { loadRiskContext } from "../convex/workflows";
import { evaluateRisk, vetoAllows, type RiskPolicy, type TradeProposal } from "../convex/lib/risk";

// Bun has no `import.meta.glob`, so the module map for convex-test is built
// explicitly. The `_generated` entry is required: convex-test derives the
// functions-directory prefix from it.
// NOTE: keys must include the real file extension — convex-test strips the
// final extension when indexing modules, and extension-less keys starting
// with ".." are mangled by that strip.
const modules: Record<string, () => Promise<unknown>> = {
  "../convex/_generated/api.ts": () => import("../convex/_generated/api"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/workflows.ts": () => import("../convex/workflows"),
  "../convex/console.ts": () => import("../convex/console"),
  "../convex/connections.ts": () => import("../convex/connections"),
  "../convex/databricks.ts": () => import("../convex/databricks"),
  "../convex/users.ts": () => import("../convex/users"),
  "../convex/seed.ts": () => import("../convex/seed"),
  "../convex/analysis.ts": () => import("../convex/analysis"),
  "../convex/marketData.ts": () => import("../convex/marketData"),
  "../convex/news.ts": () => import("../convex/news"),
  "../convex/preferences.ts": () => import("../convex/preferences"),
  "../convex/providers.ts": () => import("../convex/providers"),
};

function fresh() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof fresh>;

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

const HOUR = 3_600_000;
const CLOSE = 100; // fixture last close -> simulated fill price 100.05 (BUY)

/** PAPER workspace: system enabled, kill switch released, market open, fresh data. */
async function seedWorkspace(
  t: T,
  behavior: "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT",
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", { name: "User A" });
    const userB = await ctx.db.insert("users", { name: "User B" });
    await ctx.db.insert("systemState", {
      key: "global",
      mode: "PAPER",
      killSwitchEngaged: false,
      liveAutoResume: false,
      environment: "TEST",
      simulatedProviderBehavior: behavior,
      peakEquity: 100000,
      controlledLiveGates: [],
      updatedAt: now,
    });
    await ctx.db.insert("markets", {
      marketId: "MKT-T",
      symbol: "BTC/USD",
      assetClass: "CRYPTO",
      venue: "SIM-VENUE",
      provider: "SIMULATED",
      baseAsset: "BTC",
      quoteAsset: "USD",
      timezone: "UTC",
      status: "OPEN",
      providerState: "AVAILABLE",
    });
    await ctx.db.insert("candles", {
      marketId: "MKT-T",
      symbol: "BTC/USD",
      assetClass: "CRYPTO",
      venue: "SIM-VENUE",
      timeframe: "1h",
      eventTime: now - HOUR,
      open: CLOSE,
      high: CLOSE + 1,
      low: CLOSE - 1,
      close: CLOSE,
      volume: 10,
      source: "SIMULATED",
      providerTimestamp: now - HOUR,
      receivedTime: now - HOUR,
      availabilityTime: now,
      qualityStatus: "VALID",
    });
    await ctx.db.insert("dataQualityReports", {
      marketId: "MKT-T",
      symbol: "BTC/USD",
      timeframe: "1h",
      state: "VALID",
      checks: [],
      counts: { candles: 1, duplicates: 0, gaps: 0, ohlcViolations: 0, invalidValues: 0 },
      generatedAt: now,
    });
    // Shared SYSTEM strategy version (no ownerUserId): visible to every user,
    // which keeps proposal/validation fixtures usable across identities.
    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-T",
      strategyId: "STRAT-T",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: {
        marketId: "MKT-T",
        symbol: "BTC/USD",
        timeframe: "1h",
        entry: { indicator: "ema_cross", fast: 2, slow: 3 },
        exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
        filters: { rsiMin: null, rsiMax: null },
        sizing: { kind: "fixed_fraction", fraction: 1 },
      },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "Shared system fixture version",
        createdAt: now,
      },
    });
    return { userA: String(userA), userB: String(userB) };
  });
}

/**
 * Owner-bound execution authorization fixture (capability token). Inserted
 * directly so that consumption/ownership tests never require an APPROVED risk
 * policy. Scope matches the order intent exactly, as submitTradeProposal would
 * have issued it.
 */
async function seedAuthorization(
  t: T,
  opts: {
    authorizationId: string;
    ownerUserId?: string;
    side?: "BUY" | "SELL";
    quantity?: number;
  },
) {
  const now = Date.now();
  await t.run(async (ctx) =>
    ctx.db.insert("executionAuthorizations", {
      authorizationId: opts.authorizationId,
      riskDecisionId: "RISK-FIXTURE",
      proposalId: "PROP-FIXTURE",
      scope: {
        account: "PAPER:paper-account",
        strategyVersionId: "SV-T",
        marketId: "MKT-T",
        side: opts.side ?? "BUY",
        quantity: opts.quantity ?? 2,
        orderType: "MARKET",
        timeInForce: "GTC",
        riskPolicyRef: "TEST-FIXTURE-NOT-RATIFIED",
        mode: "PAPER",
        expiresAt: now + 15 * 60_000,
      },
      state: "APPROVED",
      issuedAt: now,
      ownerUserId: opts.ownerUserId,
    }),
  );
}

function placeArgs(authorizationId: string, idempotencyKey: string, side: "BUY" | "SELL" = "BUY", quantity = 2) {
  return {
    authorizationId,
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side,
    quantity,
    orderType: "MARKET",
    timeInForce: "GTC",
    idempotencyKey,
  };
}

const ordersIn = (t: T) =>
  t.run(async (ctx) => ctx.db.query("orders").collect());

type OrderRow = {
  orderId: string;
  state: "UNKNOWN" | "ACKNOWLEDGED";
  providerTruth?: "ACCEPTED" | "REJECTED" | "NONE";
  ownerUserId?: string;
};

/** Schema-complete fixture orders, inserted in one transaction. */
async function insertOrderRows(t: T, rows: OrderRow[]) {
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const r of rows) {
      await ctx.db.insert("orders", {
        orderId: r.orderId,
        idempotencyKey: `IK-${r.orderId}`,
        authorizationId: `AUTH-${r.orderId}`,
        proposalId: "PROP-BOUNDS",
        strategyVersionId: "SV-T",
        marketId: "MKT-T",
        symbol: "BTC/USD",
        side: "BUY",
        quantity: 1,
        orderType: "MARKET",
        timeInForce: "GTC",
        mode: "PAPER",
        state: r.state,
        providerTruth: r.providerTruth,
        history: [{ state: r.state, at: now, note: "fixture row (bounds regression)" }],
        ownerUserId: r.ownerUserId,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

/** Fixture positions with known realized PnL, inserted in one transaction. */
async function insertPositionRows(t: T, count: number, realizedEach: number) {
  const now = Date.now();
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("positions", {
        positionId: `POS-B${i}`,
        account: "PAPER:paper-account",
        marketId: "MKT-T",
        symbol: "BTC/USD",
        side: "LONG",
        quantity: 1,
        avgEntryPrice: 100,
        realizedPnl: realizedEach,
        source: "PAPER",
        updatedAt: now,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// DB-POLICY-* — provisional policy rejection, end to end through the mutation
// ---------------------------------------------------------------------------

// Mirrors the seeded configuration in seed.ts (RISK-POLICY-CORE@v1): declared
// values exist for review but the status is PROVISIONAL and MUST NOT authorize
// execution. Reproduced verbatim so this test proves the seeded state blocks.
const SEEDED_POLICY = {
  policyId: "RISK-POLICY-CORE",
  version: 1,
  status: "PROVISIONAL" as const,
  limits: {
    maxNotionalPerTrade: 25000,
    maxOpenPositions: 3,
    maxDailyLoss: 2000,
    maxDrawdown: 0.15,
    maxConsecutiveLosses: 4,
    maxSpreadBps: 15,
    maxDataAgeMs: 2 * HOUR,
  },
  provenanceNote:
    "PROVISIONAL. The constitution forbids inventing numerical risk limits; these values are declared here for review and must be ratified by ADR (SPEC-GAP-002) before any live consideration.",
};

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  await t.run(async (ctx) =>
    ctx.db.insert("riskPolicies", { ...SEEDED_POLICY, createdAt: Date.now() }),
  );
  const asA = t.withIdentity({ subject: userA });
  const res = await asA.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: 62000,
    idempotencyKey: "PK-1",
  });
  check(
    "DB-POLICY-001 seeded PROVISIONAL policy refuses execution authorization (end to end)",
    res.outcome === "BLOCK" &&
      res.authorizationId === null &&
      res.checks.some((c) => c.check === "policy_status" && c.status === "BLOCK"),
    JSON.stringify(res.checks.filter((c) => c.status !== "PASS")),
  );
  const authorizations = await t.run(async (ctx) =>
    ctx.db.query("executionAuthorizations").collect(),
  );
  check(
    "DB-POLICY-001b no authorization row is created for a blocked proposal",
    authorizations.length === 0,
  );
  const denied = await t.run(async (ctx) =>
    ctx.db
      .query("auditEvents")
      .filter((q) => q.eq(q.field("action"), "EXECUTION_AUTHORIZATION_DENIED"))
      .collect(),
  );
  check(
    "DB-POLICY-001c veto denial is recorded in the audit log",
    denied.length === 1 && denied[0].outcome === "DENIED",
  );
  const decisions = await t.run(async (ctx) => ctx.db.query("riskDecisions").collect());
  check(
    "DB-POLICY-001d risk decision is recorded and owner-bound to the caller",
    decisions.length === 1 &&
      decisions[0].outcome === "BLOCK" &&
      decisions[0].ownerUserId === userA,
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });
  const res = await asA.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: 62000,
    idempotencyKey: "PK-2",
  });
  check(
    "DB-POLICY-002 absent policy row defaults to PROVISIONAL and fails closed",
    res.outcome === "BLOCK" &&
      res.authorizationId === null &&
      res.checks.some(
        (c) => c.check === "policy_status" && c.detail.includes("PROVISIONAL"),
      ),
  );
}

// ---------------------------------------------------------------------------
// DB-AUTHZ-* — ownership boundary with real identities (cross-user isolation)
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-X", ownerUserId: userA });
  const asB = t.withIdentity({ subject: userB });
  const res = await asB.mutation(api.workflows.placeOrder, placeArgs("AUTH-X", "IK-B1"));
  check(
    "DB-AUTHZ-001 cross-user authorization consumption is denied (indistinguishable from not-found)",
    res.deduped === false &&
      res.orderId === null &&
      res.state === "REJECTED" &&
      res.note.includes("Authorization not found"),
    res.note,
  );
  const orders = await ordersIn(t);
  check("DB-AUTHZ-001b denied attempt creates no order row at all", orders.length === 0);
  const authRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-X"))
      .first(),
  );
  check(
    "DB-AUTHZ-001c a denied attempt does NOT consume the owner's authorization",
    authRow?.state === "APPROVED" && authRow?.consumedByOrderId === undefined,
  );
  const asA = t.withIdentity({ subject: userA });
  const ownerRes = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-X", "IK-A1"));
  check(
    "DB-AUTHZ-001d the owner can still consume it afterwards",
    ownerRes.deduped === false && ownerRes.state === "ACKNOWLEDGED",
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  // Legacy/unknown ownership: capability rule fails CLOSED.
  await seedAuthorization(t, { authorizationId: "AUTH-LEGACY" });
  const asA = t.withIdentity({ subject: userA });
  const res = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-LEGACY", "IK-L1"));
  const orders = await ordersIn(t);
  check(
    "DB-AUTHZ-002 authorization without an owner is unusable (fail closed, never guessed)",
    res.state === "REJECTED" &&
      res.note.includes("Authorization not found") &&
      orders.length === 0,
  );
}

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-ISO", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });
  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-ISO", "IK-ISO1"));
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("riskDecisions", {
      riskDecisionId: "RISK-A",
      proposalId: "PROP-A",
      strategyVersionId: "SV-T",
      mode: "PAPER",
      policyId: "RISK-POLICY-CORE",
      policyVersion: 1,
      checks: [],
      outcome: "BLOCK",
      actor: `user:${userA}`,
      ownerUserId: userA,
      createdAt: now,
    });
    await ctx.db.insert("riskDecisions", {
      riskDecisionId: "RISK-B",
      proposalId: "PROP-B",
      strategyVersionId: "SV-T",
      mode: "PAPER",
      policyId: "RISK-POLICY-CORE",
      policyVersion: 1,
      checks: [],
      outcome: "BLOCK",
      actor: `user:${userB}`,
      ownerUserId: userB,
      createdAt: now,
    });
    await ctx.db.insert("riskDecisions", {
      riskDecisionId: "RISK-SYSTEM",
      proposalId: "PROP-SYSTEM",
      strategyVersionId: "SV-T",
      mode: "PAPER",
      policyId: "RISK-POLICY-CORE",
      policyVersion: 1,
      checks: [],
      outcome: "BLOCK",
      actor: "system:seed",
      // no ownerUserId -> shared SYSTEM record
      createdAt: now,
    });
  });

  const execA = await t.withIdentity({ subject: userA }).query(api.console.execution);
  const execB = await t.withIdentity({ subject: userB }).query(api.console.execution);
  check(
    "DB-AUTHZ-003 owner sees their own orders/authorizations",
    execA.orders.length === 1 && execA.authorizations.length === 1,
    `orders=${execA.orders.length} auths=${execA.authorizations.length}`,
  );
  check(
    "DB-AUTHZ-003b another user sees NONE of them (console reads are owner-scoped)",
    execB.orders.length === 0 && execB.authorizations.length === 0,
    `orders=${execB.orders.length} auths=${execB.authorizations.length}`,
  );
  const riskA = await t.withIdentity({ subject: userA }).query(api.console.risk);
  const riskB = await t.withIdentity({ subject: userB }).query(api.console.risk);
  const idsA = riskA.decisions.map((d) => d.riskDecisionId).sort();
  const idsB = riskB.decisions.map((d) => d.riskDecisionId).sort();
  check(
    "DB-AUTHZ-003c risk decisions: own + shared system records only",
    JSON.stringify(idsA) === JSON.stringify(["RISK-A", "RISK-SYSTEM"]) &&
      JSON.stringify(idsB) === JSON.stringify(["RISK-B", "RISK-SYSTEM"]),
    `A=${JSON.stringify(idsA)} B=${JSON.stringify(idsB)}`,
  );
  const overviewA = await t.withIdentity({ subject: userA }).query(api.console.overview);
  const overviewB = await t.withIdentity({ subject: userB }).query(api.console.overview);
  check(
    "DB-AUTHZ-003d overview order counts are owner-scoped (1 vs 0)",
    overviewA.orderCounts.total === 1 && overviewB.orderCounts.total === 0,
    `A=${overviewA.orderCounts.total} B=${overviewB.orderCounts.total}`,
  );
  const auditB = await t.withIdentity({ subject: userB }).query(api.console.audit);
  check(
    "DB-AUTHZ-003e audit projection: other user's USER events never leak (chain still verified)",
    auditB.chain.valid &&
      auditB.events.every((e) => e.actorType === "SERVICE" || e.actor === `user:${userB}`),
  );
}

// ---------------------------------------------------------------------------
// DB-CONSUME-* — one authorization, one order (incl. concurrent duplicates)
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-C1", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });

  const first = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C1", "IK-1"));
  check(
    "DB-CONSUME-001 first use of an authorization submits exactly one order",
    first.deduped === false && first.state === "ACKNOWLEDGED" && first.orderId === "ORD-IK-1",
  );
  const authRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-C1"))
      .first(),
  );
  check(
    "DB-CONSUME-001b authorization is CONSUMED and bound to the surviving order",
    authRow?.state === "CONSUMED" && authRow?.consumedByOrderId === "ORD-IK-1",
    JSON.stringify({ state: authRow?.state, by: authRow?.consumedByOrderId }),
  );

  const second = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C1", "IK-2"));
  const orders = await ordersIn(t);
  const submitted = orders.filter((o) => o.state !== "REJECTED");
  check(
    "DB-CONSUME-001c reuse with a fresh idempotency key is rejected (one authorization, one order)",
    second.state === "REJECTED" &&
      second.note.includes("authorization_state") &&
      submitted.length === 1 &&
      submitted[0].orderId === "ORD-IK-1",
    `note=${second.note}`,
  );
  check(
    "DB-CONSUME-001d the failed attempt does not re-point consumedByOrderId",
    authRow?.consumedByOrderId === "ORD-IK-1",
  );
  const auditA = await asA.query(api.console.audit);
  check(
    "DB-CONSUME-001e audit hash chain remains intact after the writes",
    auditA.chain.valid,
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-C2", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });
  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C2", "IK-DUP"));
  const replay = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C2", "IK-DUP"));
  const orders = await ordersIn(t);
  check(
    "DB-CONSUME-002 same idempotency key replays without a second external mutation",
    replay.deduped === true && orders.length === 1,
    `deduped=${replay.deduped} orders=${orders.length}`,
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-C3", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });
  // Two submissions of ONE authorization issued together. Top-level mutations
  // are serialized transactions (in convex-test as in Convex), so the second
  // must observe the first's CONSUMED write — the OCC/serializability contract
  // the consumption invariant relies on.
  const [r1, r2] = await Promise.all([
    asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C3", "IK-P1")),
    asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-C3", "IK-P2")),
  ]);
  const orders = await ordersIn(t);
  const submitted = orders.filter((o) => o.state !== "REJECTED");
  const outcomes = [r1.state, r2.state].sort();
  check(
    "DB-CONSUME-003 concurrent duplicate submissions: exactly one order survives",
    submitted.length === 1 &&
      JSON.stringify(outcomes) === JSON.stringify(["ACKNOWLEDGED", "REJECTED"]),
    `states=${JSON.stringify(outcomes)} submitted=${submitted.length}`,
  );
  const authRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-C3"))
      .first(),
  );
  check(
    "DB-CONSUME-003b consumedByOrderId names the surviving order exactly once",
    authRow?.state === "CONSUMED" &&
      authRow?.consumedByOrderId === submitted[0]?.orderId,
  );
}

// ---------------------------------------------------------------------------
// DB-EXEC-001 — fill accounting through the real mutation (positions, PnL)
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "FILL");
  await seedAuthorization(t, { authorizationId: "AUTH-F1", ownerUserId: userA, side: "BUY", quantity: 2 });
  await seedAuthorization(t, { authorizationId: "AUTH-F2", ownerUserId: userA, side: "SELL", quantity: 1 });
  const asA = t.withIdentity({ subject: userA });

  const buy = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-F1", "IK-F1", "BUY", 2));
  const orders1 = await ordersIn(t);
  const o1 = orders1.find((o) => o.orderId === "ORD-IK-F1");
  check(
    "DB-EXEC-001 fill is recorded on the order (server-derived symbol, fees, truth)",
    buy.state === "FILLED" &&
      o1?.symbol === "BTC/USD" &&
      o1?.fillQuantity === 2 &&
      o1?.providerTruth === "ACCEPTED" &&
      (o1?.fees ?? 0) > 0 &&
      Math.abs((o1?.fillPrice ?? 0) - 100.05) < 1e-9,
    JSON.stringify(o1),
  );
  const pos1 = await t.run(async (ctx) => ctx.db.query("positions").first());
  check(
    "DB-EXEC-001b position opened at the weighted average entry price",
    pos1?.side === "LONG" &&
      pos1?.quantity === 2 &&
      Math.abs((pos1?.avgEntryPrice ?? 0) - 100.05) < 1e-9,
    JSON.stringify(pos1),
  );

  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-F2", "IK-F2", "SELL", 1));
  const pos2 = await t.run(async (ctx) => ctx.db.query("positions").first());
  check(
    "DB-EXEC-001c partial close realizes (exit - entry) * qty exactly once",
    pos2?.side === "LONG" &&
      pos2?.quantity === 1 &&
      Math.abs((pos2?.realizedPnl ?? 0) - -0.1) < 1e-9,
    JSON.stringify(pos2),
  );
  const state = await t.run(async (ctx) => ctx.db.query("systemState").first());
  check(
    "DB-EXEC-001d account risk accounting (daily PnL, peak equity) is maintained server-side",
    Math.abs((state?.realizedPnlDay ?? 999) - -0.1) < 1e-9 &&
      Math.abs((state?.peakEquity ?? 0) - 100000) < 1e-9,
    JSON.stringify({ pnlDay: state?.realizedPnlDay, peak: state?.peakEquity }),
  );
}

// ---------------------------------------------------------------------------
// DB-RECON-001 — UNKNOWN is first class: block, reconcile, then proceed
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "TIMEOUT");
  await seedAuthorization(t, { authorizationId: "AUTH-R1", ownerUserId: userA });
  await seedAuthorization(t, { authorizationId: "AUTH-R2", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });

  const timeoutOrder = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-R1", "IK-R1"));
  check(
    "DB-RECON-001 provider timeout -> order UNKNOWN (never assumed failed)",
    timeoutOrder.state === "UNKNOWN",
  );
  const o1 = (await ordersIn(t)).find((o) => o.orderId === "ORD-IK-R1");
  check(
    "DB-RECON-001b provider truth is preserved for reconciliation (ACCEPTED)",
    o1?.providerTruth === "ACCEPTED",
  );

  const blocked = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-R2", "IK-R2"));
  const auth2 = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-R2"))
      .first(),
  );
  check(
    "DB-RECON-002 unresolved UNKNOWN state blocks NEW exposure at the DB level",
    blocked.state === "REJECTED" &&
      blocked.note.includes("reconciliation_state") &&
      auth2?.state === "APPROVED",
    `note=${blocked.note}`,
  );

  const recon = await asA.mutation(api.workflows.reconcile, {});
  check(
    "DB-RECON-003 reconciliation resolves UNKNOWN from provider truth (no retry, no guess)",
    recon.healthy &&
      recon.unresolved.length === 0 &&
      recon.resolved.some(
        (r) => r.orderId === "ORD-IK-R1" && r.from === "UNKNOWN" && r.to === "ACKNOWLEDGED",
      ),
    JSON.stringify(recon),
  );

  await t.run(async (ctx) => {
    const state = await ctx.db.query("systemState").first();
    if (state) await ctx.db.patch(state._id, { simulatedProviderBehavior: "ACK" });
  });
  const retry = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-R2", "IK-R3"));
  check(
    "DB-RECON-004 once reconciled, the still-valid authorization proceeds",
    retry.state === "ACKNOWLEDGED",
    retry.note,
  );
}

// ---------------------------------------------------------------------------
// DB-VAL-001 — snapshot binding failure BLOCKS the validation mutation
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("markets", {
      marketId: "MKT-V",
      symbol: "V/USD",
      assetClass: "CRYPTO",
      venue: "SIM-VENUE",
      provider: "SIMULATED",
      baseAsset: "V",
      quoteAsset: "USD",
      timezone: "UTC",
      status: "OPEN",
      providerState: "AVAILABLE",
    });
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("candles", {
        marketId: "MKT-V",
        symbol: "V/USD",
        assetClass: "CRYPTO",
        venue: "SIM-VENUE",
        timeframe: "1h",
        eventTime: i * HOUR,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 10,
        source: "SIMULATED",
        providerTimestamp: i * HOUR,
        receivedTime: i * HOUR,
        availabilityTime: i * HOUR + HOUR,
        qualityStatus: "VALID",
      });
    }
    await ctx.db.insert("dataQualityReports", {
      marketId: "MKT-V",
      symbol: "V/USD",
      timeframe: "1h",
      state: "VALID",
      checks: [],
      counts: { candles: 3, duplicates: 0, gaps: 0, ohlcViolations: 0, invalidValues: 0 },
      generatedAt: now,
    });
    // Mismatched snapshot: the declared range excludes the first candle.
    await ctx.db.insert("dataSnapshots", {
      snapshotId: "SNAP-V",
      marketIds: ["MKT-V"],
      timeframe: "1h",
      rangeStart: 2 * HOUR,
      rangeEnd: 10 * HOUR,
      dataVersion: "test-v1",
      qualitySummary: [{ marketId: "MKT-V", state: "VALID" }],
      revision: 1,
      createdAt: now,
    });
    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-V",
      strategyId: "STRAT-V",
      version: 1,
      status: "PROPOSAL",
      immutable: true,
      definition: {
        marketId: "MKT-V",
        symbol: "V/USD",
        timeframe: "1h",
        entry: { indicator: "ema_cross", fast: 2, slow: 3 },
        exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
        filters: { rsiMin: null, rsiMax: null },
        sizing: { kind: "fixed_fraction", fraction: 1 },
      },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "DB-level snapshot-binding fixture",
        createdAt: now,
      },
    });
  });

  const asA = t.withIdentity({ subject: userA });
  const res = await asA.mutation(api.workflows.runValidation, { strategyVersionId: "SV-V" });
  check(
    "DB-VAL-001 mismatched data snapshot BLOCKS the validation run at the mutation boundary",
    res.ok === true && res.state === "BLOCKED",
    JSON.stringify(res),
  );
  const evidence = await t.run(async (ctx) => ctx.db.query("evidenceRecords").collect());
  const runs = await t.run(async (ctx) => ctx.db.query("validationRuns").collect());
  check(
    "DB-VAL-001b a blocked run produces metrics of nothing: no evidence, no fitness",
    evidence.length === 0 && runs.length === 1 && runs[0].metrics === null,
  );
}

// ---------------------------------------------------------------------------
// PRIORITY 4 EXTENSIONS — initialization auth, cross-user isolation,
// duplicate-key disclosure, OVERLAPPING concurrency, privileged mutations
// ---------------------------------------------------------------------------

/** Users only — for tests that must start from an EMPTY deployment. */
async function seedUsers(t: T) {
  return await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", { name: "User A" });
    const userB = await ctx.db.insert("users", { name: "User B" });
    return { userA: String(userA), userB: String(userB) };
  });
}

// ---- DB-SEED-* — initialization is privileged, audited, idempotent --------

{
  const t = fresh();
  const err = await t.mutation(api.seed.seed, {}).catch((e: unknown) => e);
  const states = await t.run(async (ctx) => ctx.db.query("systemState").collect());
  check(
    "DB-SEED-001 unauthenticated seed is rejected and initializes nothing",
    err instanceof Error && err.message.includes("UNAUTHENTICATED") && states.length === 0,
    String(err),
  );
}

{
  const t = fresh();
  const { userA } = await seedUsers(t);
  const asA = t.withIdentity({ subject: userA });
  const res = await asA.mutation(api.seed.seed, {});
  const states = await t.run(async (ctx) => ctx.db.query("systemState").collect());
  const denied = await t.run(async (ctx) =>
    ctx.db
      .query("auditEvents")
      .filter((q) => q.eq(q.field("action"), "SYSTEM_INITIALIZATION_DENIED"))
      .collect(),
  );
  check(
    "DB-SEED-002 non-admin initialization is refused, audited, and writes no state",
    "ok" in res && res.ok === false && states.length === 0 && denied.length === 1,
    JSON.stringify(res),
  );
}

{
  const t = fresh();
  const { userA } = await seedUsers(t);
  // Test fixture only: SIMULATES the documented out-of-band admin provisioning
  // (SPEC-GAP-008). Product code never provisions admin automatically.
  await t.run(async (ctx) => ctx.db.patch(userA as never, { role: "admin" }));
  const asAdmin = t.withIdentity({ subject: userA });
  const res = await asAdmin.mutation(api.seed.seed, {});
  const state = await t.run(async (ctx) => ctx.db.query("systemState").first());
  const init = await t.run(async (ctx) =>
    ctx.db
      .query("auditEvents")
      .filter((q) => q.eq(q.field("action"), "SYSTEM_INITIALIZED"))
      .collect(),
  );
  check(
    "DB-SEED-003 admin initialization works and leaves the kill-switch policy untouched (PAPER, released, no auto-resume)",
    "alreadySeeded" in res &&
      res.alreadySeeded === false &&
      state?.mode === "PAPER" &&
      state?.killSwitchEngaged === false &&
      state?.liveAutoResume === false &&
      init.length === 1 &&
      init[0].actor === `user:${userA}`,
    JSON.stringify({ res, mode: state?.mode, ks: state?.killSwitchEngaged }),
  );
}

{
  const t = fresh();
  const { userA } = await seedUsers(t);
  await t.run(async (ctx) => ctx.db.patch(userA as never, { role: "admin" }));
  const asAdmin = t.withIdentity({ subject: userA });
  await asAdmin.mutation(api.seed.seed, {});
  await asAdmin.mutation(api.workflows.setKillSwitch, { engaged: true, reason: "db-verification" });
  const again = await asAdmin.mutation(api.seed.seed, {});
  const state = await t.run(async (ctx) => ctx.db.query("systemState").first());
  const markets = await t.run(async (ctx) => ctx.db.query("markets").collect());
  check(
    "DB-SEED-004 re-running seed is a no-op: existing state (incl. engaged kill switch) is never reset",
    "alreadySeeded" in again &&
      again.alreadySeeded === true &&
      state?.killSwitchEngaged === true &&
      markets.length === 3,
    JSON.stringify({ again, ks: state?.killSwitchEngaged, markets: markets.length }),
  );
}

// ---- DB-AUTHZ-004 — private strategy versions are owner-bound -------------

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  const now = Date.now();
  await t.run(async (ctx) =>
    ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-PRIVATE-A",
      strategyId: "STRAT-PRIV-A",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: {
        marketId: "MKT-T",
        symbol: "BTC/USD",
        timeframe: "1h",
        entry: { indicator: "ema_cross", fast: 2, slow: 3 },
        exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
        filters: { rsiMin: null, rsiMax: null },
        sizing: { kind: "fixed_fraction", fraction: 1 },
      },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "Private fixture version owned by user A",
        createdAt: now,
      },
      ownerUserId: userA,
    }),
  );
  const asB = t.withIdentity({ subject: userB });
  const proposal = await asB.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-PRIVATE-A",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: 62000,
    idempotencyKey: "PK-PRIV",
  });
  const decisions = await t.run(async (ctx) => ctx.db.query("riskDecisions").collect());
  check(
    "DB-AUTHZ-004 a foreign strategy version cannot back a proposal (not-found ≡ not-owned)",
    proposal.outcome === "BLOCK" &&
      proposal.riskDecisionId === null &&
      proposal.checks.some((c) => c.check === "strategy_version_access") &&
      decisions.length === 0,
    JSON.stringify(proposal.checks),
  );
  const validation = await asB.mutation(api.workflows.runValidation, {
    strategyVersionId: "SV-PRIVATE-A",
  });
  const runs = await t.run(async (ctx) => ctx.db.query("validationRuns").collect());
  check(
    "DB-AUTHZ-004b a foreign strategy version cannot be validated (no validation record created)",
    validation.ok === false && runs.length === 0,
    JSON.stringify(validation),
  );
}

// ---- DB-ISO-001 — five private record classes stay invisible -------------

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("strategies", {
      strategyId: "STRAT-B",
      name: "B private strategy",
      description: "owned by user B",
      marketId: "MKT-T",
      timeframe: "1h",
      ownerUserId: userB,
      createdAt: now,
    });
    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-B",
      strategyId: "STRAT-B",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: { marketId: "MKT-T" },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "private",
        createdAt: now,
      },
      ownerUserId: userB,
    });
    await ctx.db.insert("validationRuns", {
      validationId: "VAL-B",
      strategyVersionId: "SV-B",
      dataSnapshotId: "SNAP-B",
      validationConfigVersion: "v",
      engineVersion: "e",
      featureVersion: "f",
      costModelVersion: "c",
      executionModelVersion: "x",
      state: "COMPLETED",
      integrity: [],
      leakageState: "NOT_ASSESSABLE",
      metrics: null,
      stress: null,
      oos: null,
      createdAt: now,
      completedAt: now,
      ownerUserId: userB,
    });
    await ctx.db.insert("evidenceRecords", {
      evidenceId: "EV-B",
      validationId: "VAL-B",
      strategyVersionId: "SV-B",
      level: "WEAK",
      rubricVersion: "r",
      factors: {},
      rationale: [],
      createdAt: now,
      ownerUserId: userB,
    });
    await ctx.db.insert("botFitnessRecords", {
      fitnessId: "FIT-B",
      strategyVersionId: "SV-B",
      dimensions: {},
      verdict: "MIXED",
      createdAt: now,
      ownerUserId: userB,
    });
    await ctx.db.insert("positions", {
      positionId: "POS-B",
      account: "PAPER:paper-account",
      marketId: "MKT-T",
      symbol: "BTC/USD",
      side: "LONG",
      quantity: 1,
      avgEntryPrice: 100,
      realizedPnl: 0,
      source: "PAPER",
      updatedAt: now,
      ownerUserId: userB,
    });
    await ctx.db.insert("monitoringEvents", {
      monitorId: "MON-B",
      scope: "order",
      scopeId: "ORD-B",
      state: "WARNING",
      observation: "user B private monitoring event",
      recommendation: "none",
      createdAt: now,
      ownerUserId: userB,
    });
  });
  await seedAuthorization(t, { authorizationId: "AUTH-ISO-B", ownerUserId: userB });
  await t
    .withIdentity({ subject: userB })
    .mutation(api.workflows.placeOrder, placeArgs("AUTH-ISO-B", "IK-ISO-B"));

  const asA = t.withIdentity({ subject: userA });
  const stratsA = await asA.query(api.console.strategies);
  const valA = await asA.query(api.console.validation);
  const execA = await asA.query(api.console.execution);
  const overviewA = await asA.query(api.console.overview);
  check(
    "DB-ISO-001 user A cannot see user B's private strategies or versions",
    !stratsA.strategies.some((s) => s.strategyId === "STRAT-B") &&
      !stratsA.versions.some((v) => v.strategyVersionId === "SV-B"),
  );
  check(
    "DB-ISO-001b user A cannot see user B's private validation records (runs, evidence, fitness)",
    !valA.runs.some((r) => r.validationId === "VAL-B") &&
      !valA.evidence.some((e) => e.evidenceId === "EV-B") &&
      !valA.fitness.some((f) => f.fitnessId === "FIT-B"),
  );
  check(
    "DB-ISO-001c user A cannot see user B's private positions, monitoring events, or orders",
    !execA.positions.some((p) => p.positionId === "POS-B") &&
      !execA.monitoring.some((m) => m.monitorId === "MON-B") &&
      !execA.orders.some((o) => o.ownerUserId === userB),
  );
  check(
    "DB-ISO-001d overview aggregates never leak private validation records or foreign version counts",
    !overviewA.latestValidations.some((r) => r.validationId === "VAL-B") &&
      overviewA.strategyVersionCount === 1,
    `count=${overviewA.strategyVersionCount}`,
  );

  const asB2 = t.withIdentity({ subject: userB });
  const stratsB = await asB2.query(api.console.strategies);
  const valB = await asB2.query(api.console.validation);
  const execB = await asB2.query(api.console.execution);
  const overviewB = await asB2.query(api.console.overview);
  check(
    "DB-ISO-001e the owner sees all of their own records (positive control)",
    stratsB.strategies.some((s) => s.strategyId === "STRAT-B") &&
      stratsB.versions.some((v) => v.strategyVersionId === "SV-B") &&
      valB.runs.some((r) => r.validationId === "VAL-B") &&
      valB.evidence.some((e) => e.evidenceId === "EV-B") &&
      valB.fitness.some((f) => f.fitnessId === "FIT-B") &&
      execB.positions.some((p) => p.positionId === "POS-B") &&
      execB.monitoring.some((m) => m.monitorId === "MON-B") &&
      execB.orders.some((o) => o.orderId === "ORD-IK-ISO-B") &&
      overviewB.strategyVersionCount === 2,
  );
}

// ---- DB-DISCLOSE-001 — duplicate-key responses leak nothing --------------

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-D1", ownerUserId: userA });
  await seedAuthorization(t, { authorizationId: "AUTH-D2", ownerUserId: userB });
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });

  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-D1", "IK-SHARED"));
  const probe = await asB.mutation(api.workflows.placeOrder, placeArgs("AUTH-D2", "IK-SHARED"));
  const orders = await ordersIn(t);
  check(
    "DB-DISCLOSE-001 a duplicate-key response reveals no order id/state of another user",
    probe.deduped === false &&
      probe.orderId === null &&
      probe.state === "REJECTED" &&
      !probe.note.includes("ORD-") &&
      !probe.note.includes("ACKNOWLEDGED") &&
      orders.length === 1,
    JSON.stringify(probe),
  );
  const auth2 = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-D2"))
      .first(),
  );
  check(
    "DB-DISCLOSE-001b the probe consumes nothing and the owner's order is untouched",
    auth2?.state === "APPROVED" &&
      orders[0].state === "ACKNOWLEDGED" &&
      orders[0].ownerUserId === userA,
  );
  const ownerReplay = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-D1", "IK-SHARED"));
  check(
    "DB-DISCLOSE-001c duplicate-submission protection is preserved for the owner",
    ownerReplay.deduped === true && ownerReplay.orderId === "ORD-IK-SHARED",
  );
}

// ---- DB-CONC-* — OVERLAPPING requests (same-tick dispatch) ----------------
// Note (honest): convex-test serializes top-level transactions exactly as
// Convex does; these tests dispatch the requests OVERLAPPING (one tick) and
// assert the serialization invariant. True OCC retry interleaving is backend
// behavior and is reported as untested.

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-Q", ownerUserId: userA });
  const asA = t.withIdentity({ subject: userA });
  const results = await Promise.all(
    ["IK-Q1", "IK-Q2", "IK-Q3", "IK-Q4"].map((k) =>
      asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-Q", k)),
    ),
  );
  const orders = await ordersIn(t);
  const submitted = orders.filter((o) => o.state !== "REJECTED");
  const states = results.map((r) => r.state).sort();
  check(
    "DB-CONC-001 four OVERLAPPING submissions of one authorization -> exactly one order intent survives",
    submitted.length === 1 &&
      orders.length === 4 &&
      JSON.stringify(states) ===
        JSON.stringify(["ACKNOWLEDGED", "REJECTED", "REJECTED", "REJECTED"]),
    `states=${JSON.stringify(states)} orders=${orders.length}`,
  );
  const auth = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .filter((q) => q.eq(q.field("authorizationId"), "AUTH-Q"))
      .first(),
  );
  check(
    "DB-CONC-001b the surviving order owns the single consumption",
    auth?.state === "CONSUMED" && auth?.consumedByOrderId === submitted[0]?.orderId,
  );
}

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  await seedAuthorization(t, { authorizationId: "AUTH-RACE-A", ownerUserId: userA });
  await seedAuthorization(t, { authorizationId: "AUTH-RACE-B", ownerUserId: userB });
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });
  // Two users race for ONE idempotency key with overlapping dispatch.
  const [ra, rb] = await Promise.all([
    asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-RACE-A", "IK-RACE")),
    asB.mutation(api.workflows.placeOrder, placeArgs("AUTH-RACE-B", "IK-RACE")),
  ]);
  const orders = await ordersIn(t);
  const responses = [ra, rb];
  const rejected = responses.filter((r) => r.state === "REJECTED");
  const winners = responses.filter((r) => r.state !== "REJECTED");
  check(
    "DB-CONC-002 an overlapping duplicate-key race creates exactly one order intent",
    orders.length === 1 && winners.length === 1,
    `orders=${orders.length} winners=${winners.length}`,
  );
  check(
    "DB-CONC-002b the losing response discloses nothing about the winning order",
    rejected.length === 1 &&
      rejected[0].orderId === null &&
      !rejected[0].note.includes("ORD-") &&
      !rejected[0].note.includes("ACKNOWLEDGED"),
    JSON.stringify(rejected),
  );
}

// ---- DB-PRIV-* — unauthorized users cannot perform privileged mutations ---

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  await t.run(async (ctx) =>
    ctx.db.insert("riskPolicies", { ...SEEDED_POLICY, createdAt: Date.now() }),
  );
  const asA = t.withIdentity({ subject: userA });

  const roleRes = await asA.mutation(api.workflows.grantRole, {
    targetUserId: userB,
    role: "admin",
    reason: "db-verification",
  });
  const users = await t.run(async (ctx) => ctx.db.query("users").collect());
  const target = users.find((u) => u.name === "User B");
  check(
    "DB-PRIV-001 non-admin cannot change roles",
    roleRes.ok === false && target?.role === undefined,
  );

  const polRes = await asA.mutation(api.workflows.approveRiskPolicy, {
    policyId: "RISK-POLICY-CORE",
    version: 1,
    attestation: "db-verification",
  });
  const policy = await t.run(async (ctx) => ctx.db.query("riskPolicies").first());
  check(
    "DB-PRIV-002 non-admin cannot ratify a risk policy (it stays PROVISIONAL)",
    polRes.ok === false && policy?.status === "PROVISIONAL",
  );

  const simRes = await asA.mutation(api.workflows.setSimulatedProviderBehavior, {
    behavior: "FILL",
    reason: "db-verification",
  });
  const state = await t.run(async (ctx) => ctx.db.query("systemState").first());
  check(
    "DB-PRIV-003 non-admin cannot change the simulation configuration",
    simRes.ok === false && state?.simulatedProviderBehavior === "ACK",
  );

  const engage = await asA.mutation(api.workflows.setKillSwitch, {
    engaged: true,
    reason: "db-verification",
  });
  const release = await asA.mutation(api.workflows.setKillSwitch, {
    engaged: false,
    reason: "db-verification",
  });
  const state2 = await t.run(async (ctx) => ctx.db.query("systemState").first());
  check(
    "DB-PRIV-004 kill switch: engage is open (fail-safe), release is admin-only and it stays engaged",
    engage.ok === true && release.ok === false && state2?.killSwitchEngaged === true,
    JSON.stringify({ engage, release }),
  );
  const denials = await t.run(async (ctx) =>
    ctx.db.query("auditEvents").filter((q) => q.eq(q.field("outcome"), "DENIED")).collect(),
  );
  check(
    "DB-PRIV-004b every privileged denial is recorded in the audit log",
    denials.length === 4,
    `denials=${denials.length}`,
  );
}

{
  const t = fresh();
  const err = await t
    .mutation(api.workflows.grantRole, {
      targetUserId: "u",
      role: "admin",
      reason: "db-verification",
    })
    .catch((e: unknown) => e);
  const users = await t.run(async (ctx) => ctx.db.query("users").collect());
  check(
    "DB-PRIV-005 unauthenticated privileged mutations are rejected",
    err instanceof Error && err.message.includes("UNAUTHENTICATED") && users.length === 0,
    String(err),
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  // Anonymous guest sessions are free to create — they must never be able to
  // change the GLOBAL kill switch: engaging is a griefing/DoS vector against
  // everyone, releasing is an admin privilege.
  await t.run(async (ctx) => ctx.db.patch(userA as never, { isAnonymous: true }));
  const asGuest = t.withIdentity({ subject: userA });
  const engage = await asGuest.mutation(api.workflows.setKillSwitch, {
    engaged: true,
    reason: "db-verification",
  });
  const release = await asGuest.mutation(api.workflows.setKillSwitch, {
    engaged: false,
    reason: "db-verification",
  });
  const state = await t.run(async (ctx) => ctx.db.query("systemState").first());
  const denials = await t.run(async (ctx) =>
    ctx.db
      .query("auditEvents")
      .filter((q) => q.eq(q.field("action"), "KILL_SWITCH_CHANGE_DENIED"))
      .collect(),
  );
  check(
    "DB-PRIV-006 anonymous guest sessions cannot change the global kill switch (engage or release)",
    engage.ok === false &&
      release.ok === false &&
      denials.length === 2 &&
      state?.killSwitchEngaged === false,
    JSON.stringify({ engage, release }),
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });
  const empty = await asA.query(api.console.audit);
  await seedAuthorization(t, { authorizationId: "AUTH-AUD", ownerUserId: userA });
  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-AUD", "IK-AUD"));
  const after = await asA.query(api.console.audit);
  check(
    "DB-AUDIT-001 chain verdicts are scope-honest over the API (EMPTY / FULL_CHAIN / WINDOW, never oversold)",
    empty.chain.scope === "EMPTY" &&
      empty.chain.note.includes("NOT evidence") &&
      after.chain.scope === "FULL_CHAIN" &&
      after.chain.valid === true &&
      after.chain.note.includes("NOT tamper-proof"),
    JSON.stringify({ empty: empty.chain.scope, after: after.chain.scope }),
  );
}

// ---------------------------------------------------------------------------
// DB-BOUNDS-* — bounded-query safety. Regression for the old
// orders.take(500) / positions.take(100) scans: a safety-relevant record
// beyond those boundaries must never slip past the fail-closed exposure gate
// or silently undercount risk accounting.
// ---------------------------------------------------------------------------

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });

  // 550 orders: 549 resolved noise rows, then the UNKNOWN order at insertion
  // position 550 — BEYOND the old orders.take(500) boundary (and the gate must
  // find it regardless of record age/position).
  const rows: OrderRow[] = [];
  for (let i = 1; i <= 549; i++) rows.push({ orderId: `ORD-B${i}`, state: "ACKNOWLEDGED" });
  rows.push({
    orderId: "ORD-B550",
    state: "UNKNOWN",
    providerTruth: "NONE",
    ownerUserId: userA,
  });
  await insertOrderRows(t, rows);

  // 1) The risk context SEES the UNKNOWN order beyond the old boundary.
  const { ctx: riskCtx } = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T",
      marketId: "MKT-T",
      proposalIdempotencyKey: "IK-BOUNDS-1",
      accountOwnerUserId: userA,
    }),
  );
  check(
    "DB-BOUNDS-001a risk context detects the UNKNOWN order beyond the old take(500) boundary",
    riskCtx.unresolvedUnknownOrders >= 1,
    `unresolvedUnknownOrders=${riskCtx.unresolvedUnknownOrders}`,
  );

  // 2) The deterministic veto over that REAL DB-derived context blocks
  //    authorization at the reconciliation gate. TEST FIXTURE policy: the
  //    exact declared limits of RISK-POLICY-CORE (nothing invented), with
  //    status overridden to APPROVED ONLY to reach the gate under test — the
  //    DB policy stays PROVISIONAL and this fixture is never persisted.
  const fixturePolicy: RiskPolicy = {
    policyId: "TEST-FIXTURE-NOT-RATIFIED",
    version: 1,
    status: "APPROVED",
    limits: SEEDED_POLICY.limits,
  };
  const proposal: TradeProposal = {
    proposalId: "PROP-BOUNDS",
    side: "BUY",
    quantity: 0.1,
    referencePrice: CLOSE,
    orderType: "MARKET",
    mode: "PAPER",
  };
  const verdict = evaluateRisk(proposal, riskCtx, fixturePolicy);
  check(
    "DB-BOUNDS-001b risk authorization is blocked by the UNKNOWN gate beyond the boundary (fail-closed)",
    verdict.outcome === "BLOCK" &&
      !vetoAllows(verdict.outcome) &&
      verdict.checks.some((c) => c.check === "reconciliation_state" && c.status === "BLOCK"),
    JSON.stringify(verdict.checks.filter((c) => c.status !== "PASS")),
  );

  // 3) End-to-end: no risk authorization is issued by the real mutation.
  const res = await asA.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: CLOSE,
    idempotencyKey: "PK-BOUNDS-1",
  });
  check(
    "DB-BOUNDS-001c submitTradeProposal issues no authorization (fail closed)",
    res.outcome !== "APPROVE" && res.authorizationId === null,
  );

  // 4) Order submission is rejected at the same gate even with a valid token.
  await seedAuthorization(t, { authorizationId: "AUTH-BOUNDS", ownerUserId: userA });
  const placed = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-BOUNDS", "IK-BOUNDS-PLACE"));
  check(
    "DB-BOUNDS-001d order submission is rejected while the UNKNOWN order sits beyond the old boundary",
    placed.state === "REJECTED" && placed.note.includes("reconciliation_state"),
    placed.note,
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  // 150 positions with known realized PnL (+10 each = +1500) — beyond the old
  // positions.take(100) boundary. Shared SYSTEM rows legitimately aggregate
  // into every customer's risk scope (canViewRecord semantics — G2 keeps this
  // "explicitly authorized shared workspace" aggregation while excluding
  // OTHER customers' rows).
  await insertPositionRows(t, 150, 10);
  const { ctx: riskCtx } = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T",
      marketId: "MKT-T",
      proposalIdempotencyKey: "IK-BOUNDS-2",
      accountOwnerUserId: userA,
    }),
  );
  check(
    "DB-BOUNDS-002a open position count is complete beyond the old take(100) boundary",
    riskCtx.openPositions === 150,
    `openPositions=${riskCtx.openPositions}`,
  );
  check(
    "DB-BOUNDS-002b equity does not silently undercount realized PnL across all 150 rows",
    riskCtx.equity === 100000 + 1500,
    `equity=${riskCtx.equity}`,
  );
  check(
    "DB-BOUNDS-002c completeness is established below the cap (no false fail-closed)",
    riskCtx.accountStateComplete === true,
    `accountStateComplete=${String(riskCtx.accountStateComplete)}`,
  );
}

{
  const t = fresh();
  const { userA } = await seedWorkspace(t, "ACK");
  // Saturate the bounded read entirely (SCAN_CAP = 2000): completeness can no
  // longer be established and must surface as fail-closed, never a silent
  // undercount.
  await insertPositionRows(t, 2000, 0);
  const { ctx: riskCtx } = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T",
      marketId: "MKT-T",
      proposalIdempotencyKey: "IK-BOUNDS-3",
      accountOwnerUserId: userA,
    }),
  );
  check(
    "DB-BOUNDS-002d scan saturation -> accountStateComplete=false (incomplete = blocked, never silent)",
    riskCtx.accountStateComplete === false,
    `accountStateComplete=${String(riskCtx.accountStateComplete)}`,
  );
}

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });

  // 550 orders; the three reconcilable ones sit at positions 548–550 — BEYOND
  // the old take(500) boundary: own (A), foreign (B) and shared SYSTEM.
  const rows: OrderRow[] = [];
  for (let i = 1; i <= 547; i++) rows.push({ orderId: `ORD-R${i}`, state: "ACKNOWLEDGED" });
  rows.push({ orderId: "ORD-R548", state: "UNKNOWN", providerTruth: "ACCEPTED", ownerUserId: userA });
  rows.push({ orderId: "ORD-R549", state: "UNKNOWN", providerTruth: "ACCEPTED", ownerUserId: userB });
  rows.push({ orderId: "ORD-R550", state: "UNKNOWN", providerTruth: "REJECTED" }); // shared SYSTEM row
  await insertOrderRows(t, rows);

  const result = await asA.mutation(api.workflows.reconcile, {});
  const resolvedIds = result.resolved.map((r) => r.orderId);
  check(
    "DB-BOUNDS-003a reconciliation discovers own + shared orders beyond the old take(500) boundary",
    resolvedIds.includes("ORD-R548") && resolvedIds.includes("ORD-R550") && resolvedIds.length === 2,
    JSON.stringify(result.resolved),
  );
  const states = await t.run(async (ctx) => {
    const all = await ctx.db.query("orders").collect();
    const by = (id: string) => all.find((o) => o.orderId === id)?.state;
    return { a: by("ORD-R548"), b: by("ORD-R549"), shared: by("ORD-R550") };
  });
  check(
    "DB-BOUNDS-003b only authorized transitions applied (own + shared resolved, foreign untouched)",
    states.a === "ACKNOWLEDGED" && states.b === "UNKNOWN" && states.shared === "REJECTED",
    JSON.stringify(states),
  );
  check(
    "DB-BOUNDS-003c the foreign order is never exposed in the result payload (no cross-user leak)",
    !JSON.stringify(result).includes("ORD-R549"),
    JSON.stringify(result),
  );
}

// Post-reset coverage uses real handlers, never the UI's mocked API responses.
// All writes below stay in convex-test's isolated in-memory database.
{
  const t = fresh();
  for (const [name, ref] of Object.entries({
    overview: api.console.overview, data: api.console.data,
    strategies: api.console.strategies, validation: api.console.validation,
    risk: api.console.risk, execution: api.console.execution,
    agents: api.console.agents, audit: api.console.audit,
    connections: api.connections.list,
  })) {
    const error = await t.query(ref, {}).catch((e: unknown) => e);
    check(`DB-RESET-AUTH query ${name} denies signed-out access`,
      error instanceof Error && error.message.includes("UNAUTHENTICATED"));
  }
  const credential = {
    provider: "SIM-CRYPTO-PROVIDER", label: "Test connection", environment: "PAPER",
    accountRef: "test-paper-account", apiKey: "test-only-key-0123456789",
    permissions: ["READ_ACCOUNT"],
  };
  const attempts: [string, () => Promise<unknown>][] = [
    ["register", () => t.mutation(api.connections.register, credential)],
    ["verify", () => t.mutation(api.connections.verify, { connectionId: "none" })],
    ["revoke", () => t.mutation(api.connections.revoke, { connectionId: "none", reason: "test" })],
    ["proposal", () => t.mutation(api.workflows.submitTradeProposal, { strategyVersionId: "none", marketId: "none", side: "BUY", quantity: 1, referencePrice: 1, idempotencyKey: "test" })],
    ["order", () => t.mutation(api.workflows.placeOrder, placeArgs("none", "test"))],
    ["reconcile", () => t.mutation(api.workflows.reconcile, {})],
    ["validation", () => t.mutation(api.workflows.runValidation, { strategyVersionId: "none" })],
    ["candidate", () => t.mutation(api.workflows.proposeCandidateVersion, { learningEventId: "none", params: {} })],
    ["kill switch", () => t.mutation(api.workflows.setKillSwitch, { engaged: true, reason: "test" })],
    ["provider behavior", () => t.mutation(api.workflows.setSimulatedProviderBehavior, { behavior: "ACK", reason: "test" })],
    ["Databricks action", () => t.action(api.databricks.checkWorkspace, {})],
  ];
  for (const [name, attempt] of attempts) {
    const error = await attempt().catch((e: unknown) => e);
    check(`DB-RESET-AUTH action ${name} denies signed-out access`,
      error instanceof Error && error.message.includes("UNAUTHENTICATED"));
  }
  const catalog = await t.query(api.connections.catalog, {});
  check("DB-RESET-CATALOG public catalog exposes only declared non-secret metadata",
    catalog.environments.join(",") === "PAPER,DEMO" && catalog.disabledEnvironments.includes("CONTROLLED_LIVE"));
}

{
  const t = fresh();
  const { userA, userB } = await seedUsers(t);
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });
  const credential = {
    provider: "SIM-CRYPTO-PROVIDER", label: "Test connection", environment: "PAPER",
    accountRef: "test-paper-account", apiKey: "test-only-key-0123456789",
    apiSecret: "test-only-secret-9876543210", permissions: ["READ_ACCOUNT"],
  };
  const deniedLive = await asA.mutation(api.connections.register, { ...credential, environment: "CONTROLLED_LIVE" });
  check("DB-RESET-CONN live credential ingestion is rejected without storing a connection",
    !deniedLive.ok && (await asA.query(api.connections.list, {})).length === 0);
  const registered = await asA.mutation(api.connections.register, credential);
  const own = await asA.query(api.connections.list, {});
  const foreign = await asB.query(api.connections.list, {});
  check("DB-RESET-CONN register/list return real pending owner-scoped metadata",
    registered.ok && own.length === 1 && own[0].status === "PENDING_VERIFICATION" && foreign.length === 0);
  const stored = await t.run(async (ctx) => ({
    connections: await ctx.db.query("brokerConnections").collect(),
    audit: await ctx.db.query("auditEvents").collect(),
  }));
  const serialized = JSON.stringify({ registered, own, stored });
  check("DB-RESET-CONN raw test key and secret never enter stored rows, audit, or responses",
    !serialized.includes(credential.apiKey) && !serialized.includes(credential.apiSecret));
  const connectionId = registered.connectionId;
  if (!connectionId) throw new Error("Registration failed; broker lifecycle cannot be tested.");
  const foreignVerify = await asB.mutation(api.connections.verify, { connectionId });
  const foreignRevoke = await asB.mutation(api.connections.revoke, { connectionId, reason: "test" });
  check("DB-RESET-CONN foreign verify/revoke are denied without altering the owner's record",
    !foreignVerify.ok && !foreignRevoke.ok && (await asA.query(api.connections.list, {}))[0].status === "PENDING_VERIFICATION");
  const verified = await asA.mutation(api.connections.verify, { connectionId });
  check("DB-RESET-CONN simulated verification is explicitly NOT real connectivity",
    verified.ok && verified.status === "VERIFIED_SIMULATED" && verified.note.includes("NOT evidence of real provider connectivity"));
  const revoked = await asA.mutation(api.connections.revoke, { connectionId, reason: "test cleanup" });
  const verifyRevoked = await asA.mutation(api.connections.verify, { connectionId });
  check("DB-RESET-CONN revoke persists and verification cannot reactivate a revoked connection",
    revoked.ok && !verifyRevoked.ok && (await asA.query(api.connections.list, {}))[0].status === "REVOKED");
  const unconfigured = await asB.mutation(api.connections.register, { ...credential, provider: "BINANCE" });
  if (!unconfigured.connectionId) throw new Error("Unconfigured-adapter registration failed.");
  const realProvider = await asB.mutation(api.connections.verify, { connectionId: unconfigured.connectionId });
  check("DB-RESET-CONN unimplemented provider remains pending, never faked connected",
    realProvider.status === "PENDING_VERIFICATION" && realProvider.note.includes("NOT VERIFIED"));
}

{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });
  await seedAuthorization(t, { authorizationId: "AUTH-RESET", ownerUserId: userA });
  const order = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-RESET", "IK-RESET"));
  const learning = await asA.mutation(api.workflows.recordLearningEvent, {
    orderId: order.orderId ?? undefined, failureClass: "REGIME_SHIFT",
    analysis: "Isolated test analysis", hypothesis: "Isolated candidate hypothesis",
  });
  // G1 hotfix: recordLearningEvent now returns a discriminated result and
  // rejects missing/foreign order references. The fixture's own order must
  // still yield a learning event (same-customer behavior preserved).
  if (!learning.learningEventId) throw new Error("Learning-event fixture failed; candidate lifecycle cannot be tested.");
  const original = (await asA.query(api.console.strategies)).versions.find((v) => v.strategyVersionId === "SV-T");
  const denied = await asB.mutation(api.workflows.proposeCandidateVersion, { learningEventId: learning.learningEventId, params: { fast: 3 } });
  const candidate = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: learning.learningEventId, params: { fast: 3, slow: 7, timeExitBars: 10 },
  });
  const after = await asA.query(api.console.strategies);
  const parent = after.versions.find((v) => v.strategyVersionId === "SV-T");
  const child = after.versions.find((v) => candidate.ok && v.strategyVersionId === candidate.strategyVersionId);
  check("DB-RESET-CANDIDATE only owner creates a new PROPOSAL; parent definition and provenance remain unchanged",
    !denied.ok && candidate.ok && child?.status === "PROPOSAL" && child?.immutable === true &&
    JSON.stringify(parent?.definition) === JSON.stringify(original?.definition) &&
    JSON.stringify(parent?.provenance) === JSON.stringify(original?.provenance));
  const data = await asA.query(api.console.data, {});
  const candles = await t.run(async (ctx) => ctx.db.query("candles").collect());
  check("DB-RESET-DATA API market series equals stored candle timestamps and prices, not UI constants",
    data.series.length === 1 && data.series[0].points.length === candles.length &&
    data.series[0].points[0].t === candles[0].eventTime && data.series[0].points[0].close === candles[0].close);
  const agentsA = await asA.query(api.console.agents);
  const agentsB = await asB.query(api.console.agents);
  check("DB-RESET-AGENTS registry stays empty without invented AI and learning records remain owner-scoped",
    agentsA.agents.length === 0 && agentsA.learningEvents.length === 1 && agentsB.learningEvents.length === 0);
  check("DB-RESET-USER current-user endpoint returns the authenticated user, null for signed-out callers",
    String((await asA.query(api.users.currentUser))?._id) === userA && (await t.query(api.users.currentUser)) === null);
}

// ---------------------------------------------------------------------------
// DB-POLREF-* — P0 REGRESSION: approved proposal -> order through REAL handlers.
// This exercises the actual producer-to-consumer workflow (evaluateRisk ->
// authorization scope -> validateAuthorizationScope -> order lifecycle), not
// manually inserted authorization fixtures. Before the policy-reference
// contract repair, step (e) failed closed every time: the risk engine wrote a
// human-readable label ("RISK-POLICY-CORE@v1 (APPROVED)") into the identifier
// field `scope.riskPolicyRef`, which the execution validator rejects.
// ---------------------------------------------------------------------------
{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "FILL");
  await t.run(async (ctx) => {
    // Out-of-band admin provisioning (SPEC-GAP-008): the initial admin is
    // provisioned outside the application, exactly as documented.
    await ctx.db.patch(userA as never, { role: "admin" });
    await ctx.db.insert("riskPolicies", { ...SEEDED_POLICY, createdAt: Date.now() });
    // Strategy-eligibility evidence for SV-T (precondition of the risk gate).
    await ctx.db.insert("validationRuns", {
      validationId: "VAL-POLREF",
      strategyVersionId: "SV-T",
      dataSnapshotId: "SNAP-POLREF",
      validationConfigVersion: "test",
      engineVersion: "test",
      featureVersion: "test",
      costModelVersion: "test",
      executionModelVersion: "test",
      state: "COMPLETED",
      integrity: [],
      leakageState: "NO_LEAKAGE_DETECTED",
      metrics: { tradeCount: 1, netReturn: 0 },
      stress: {},
      oos: {},
      createdAt: Date.now(),
      completedAt: Date.now(),
    });
    await ctx.db.insert("evidenceRecords", {
      evidenceId: "EV-POLREF",
      validationId: "VAL-POLREF",
      strategyVersionId: "SV-T",
      level: "MODERATE",
      rubricVersion: "test",
      factors: {},
      rationale: ["Test fixture evidence for the eligibility gate."],
      createdAt: Date.now(),
    });
  });
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });

  const mismatch = await asA.mutation(api.workflows.approveRiskPolicy, {
    policyId: "RISK-POLICY-CORE",
    version: 99,
    attestation: "version-mismatch probe",
  });
  check(
    "DB-POLREF-001 mismatched policy version cannot be ratified (exact version binding)",
    mismatch.ok === false,
  );

  const ratified = await asA.mutation(api.workflows.approveRiskPolicy, {
    policyId: "RISK-POLICY-CORE",
    version: 1,
    attestation: "Test-only ratification inside an isolated in-memory database (P0 integration path).",
  });
  check("DB-POLREF-002 admin ratification of the declared policy succeeds (limits unchanged)", ratified.ok === true);

  const prop = await asA.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: 62000,
    idempotencyKey: "PK-POLREF-1",
  });
  check(
    "DB-POLREF-003 eligible proposal under the APPROVED policy is APPROVED and yields an authorization",
    prop.outcome === "APPROVE" && prop.authorizationId !== null,
    JSON.stringify(prop.checks.filter((c) => c.status !== "PASS")),
  );

  const authRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", prop.authorizationId ?? ""))
      .first(),
  );
  check(
    "DB-POLREF-004 authorization scope binds the canonical version-pinned policy identity",
    authRow?.scope.riskPolicyRef === "RISK-POLICY-CORE@v1",
    authRow?.scope.riskPolicyRef,
  );

  const order = await asA.mutation(api.workflows.placeOrder, {
    authorizationId: prop.authorizationId ?? "",
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    orderType: "MARKET",
    timeInForce: "GTC",
    idempotencyKey: "IK-POLREF-1",
  });
  const orderRow = await t.run(async (ctx) =>
    ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", "IK-POLREF-1"))
      .first(),
  );
  check(
    "DB-POLREF-005 approved proposal reaches a PAPER order through the real producer/consumer path",
    order.orderId !== null &&
      orderRow?.mode === "PAPER" &&
      orderRow?.state === "FILLED" &&
      orderRow?.history.some((h) => h.state === "AUTHORIZED") === true,
    `${order.state} ${order.note}`,
  );

  const consumedRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", prop.authorizationId ?? ""))
      .first(),
  );
  check(
    "DB-POLREF-006 authorization is atomically CONSUMED and bound to the surviving order",
    consumedRow?.state === "CONSUMED" && consumedRow?.consumedByOrderId === order.orderId,
  );

  const reuse = await asA.mutation(api.workflows.placeOrder, {
    authorizationId: prop.authorizationId ?? "",
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    orderType: "MARKET",
    timeInForce: "GTC",
    idempotencyKey: "IK-POLREF-2",
  });
  const reuseRow = await t.run(async (ctx) =>
    ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", "IK-POLREF-2"))
      .first(),
  );
  check(
    "DB-POLREF-007 consumed authorization cannot be reused (single use preserved)",
    reuse.state === "REJECTED" &&
      reuseRow?.state === "REJECTED" &&
      !reuseRow?.providerOrderId &&
      reuse.note.includes("authorization_state"),
    `state=${reuse.state} row=${String(reuseRow?.state)} note=${reuse.note}`,
  );

  const foreign = await asB.mutation(api.workflows.placeOrder, {
    authorizationId: prop.authorizationId ?? "",
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    orderType: "MARKET",
    timeInForce: "GTC",
    idempotencyKey: "IK-POLREF-3",
  });
  check(
    "DB-POLREF-008 foreign owner cannot consume the authorization (not-found ≡ not-owned)",
    foreign.state === "REJECTED" && foreign.orderId === null,
  );

  const prop2 = await asA.mutation(api.workflows.submitTradeProposal, {
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    referencePrice: 62000,
    idempotencyKey: "PK-POLREF-2",
  });
  check("DB-POLREF-009 second clean proposal also yields an authorization", prop2.authorizationId !== null);
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", prop2.authorizationId ?? ""))
      .first();
    if (row) {
      // Tamper: legacy human-readable label in the identifier field.
      await ctx.db.patch(row._id, {
        scope: { ...row.scope, riskPolicyRef: "RISK-POLICY-CORE@v1 (APPROVED)" },
      });
    }
  });
  const malformed = await asA.mutation(api.workflows.placeOrder, {
    authorizationId: prop2.authorizationId ?? "",
    strategyVersionId: "SV-T",
    marketId: "MKT-T",
    side: "BUY",
    quantity: 0.1,
    orderType: "MARKET",
    timeInForce: "GTC",
    idempotencyKey: "IK-POLREF-4",
  });
  const malformedRow = await t.run(async (ctx) =>
    ctx.db
      .query("executionAuthorizations")
      .withIndex("by_authorizationId", (q) => q.eq("authorizationId", prop2.authorizationId ?? ""))
      .first(),
  );
  const malformedOrderRow = await t.run(async (ctx) =>
    ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", "IK-POLREF-4"))
      .first(),
  );
  check(
    "DB-POLREF-010 malformed (display-label) policy reference fails closed and consumes nothing",
    malformed.state === "REJECTED" &&
      malformedOrderRow?.state === "REJECTED" &&
      !malformedOrderRow?.providerOrderId &&
      malformedRow?.state === "APPROVED" &&
      malformed.note.includes("input_validity"),
    `state=${malformed.state} row=${String(malformedOrderRow?.state)} authState=${String(malformedRow?.state)} note=${malformed.note}`,
  );
}

// ===========================================================================
// BACKEND REPAIR BATTERY — market data, news, analysis pipeline (Section 04).
// Real handlers against the in-memory database: pipeline honesty (LIVE vs
// SIMULATED labels), risk-engine non-bypass, ownership + pagination,
// instrument/timeframe chart queries, preferences validation, credential
// secrecy, and execution remaining disabled.
// ===========================================================================

async function seedAnalysisWorkspace(
  t: T,
  pattern: "SPIKE" | "FLAT",
): Promise<{ userA: string; userB: string }> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", { name: "Repair User A" });
    const userB = await ctx.db.insert("users", { name: "Repair User B" });
    await ctx.db.insert("systemState", {
      key: "global",
      mode: "PAPER",
      killSwitchEngaged: false,
      liveAutoResume: false,
      environment: "TEST",
      simulatedProviderBehavior: "ACK",
      peakEquity: 100000,
      controlledLiveGates: [],
      updatedAt: now,
    });
    await ctx.db.insert("markets", {
      marketId: "MKT-T",
      symbol: "BTC/USD",
      assetClass: "CRYPTO",
      venue: "SIM-VENUE",
      provider: "SIMULATED",
      baseAsset: "BTC",
      quoteAsset: "USD",
      timezone: "UTC",
      status: "OPEN",
      providerState: "AVAILABLE",
    });
    // 30 synthetic 1h bars ending one hour ago (availability_time <= now).
    for (let i = 0; i < 30; i++) {
      const eventTime = now - 30 * HOUR + i * HOUR;
      const close = pattern === "SPIKE" && i === 29 ? 110 : 100;
      await ctx.db.insert("candles", {
        marketId: "MKT-T",
        symbol: "BTC/USD",
        assetClass: "CRYPTO",
        venue: "SIM-VENUE",
        timeframe: "1h",
        eventTime,
        open: 100,
        high: Math.max(100, close) + 1,
        low: Math.min(100, close) - 1,
        close,
        volume: 10,
        source: "SIMULATED",
        providerTimestamp: eventTime,
        receivedTime: eventTime,
        availabilityTime: eventTime + HOUR,
        qualityStatus: "VALID",
      });
    }
    await ctx.db.insert("strategies", {
      strategyId: "STRAT-T",
      name: "Repair Fixture Candidate",
      description: "Deterministic fixture candidate for the analysis pipeline battery.",
      marketId: "MKT-T",
      timeframe: "1h",
      createdAt: now,
    });
    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-T",
      strategyId: "STRAT-T",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: {
        marketId: "MKT-T",
        symbol: "BTC/USD",
        timeframe: "1h",
        entry: { indicator: "ema_cross", fast: 2, slow: 3 },
        exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
        filters: { rsiMin: null, rsiMax: null },
        sizing: { kind: "fixed_fraction", fraction: 1 },
      },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "Fixture candidate for deterministic pipeline tests.",
        createdAt: now,
      },
    });
    return { userA: String(userA), userB: String(userB) };
  });
}

async function backendRepairBattery() {
  // ---- analysis pipeline: success path on SIMULATED data -----------------
  {
    const t = fresh();
    const { userA, userB } = await seedAnalysisWorkspace(t, "SPIKE");
    const asA = t.withIdentity({ subject: userA });
    const asB = t.withIdentity({ subject: userB });

    let unauth = false;
    try {
      await t.mutation(api.analysis.run, { marketId: "MKT-T", timeframe: "1h", horizon: "SHORT" });
    } catch (e) {
      unauth = String(e).includes("UNAUTHENTICATED");
    }
    check("DB-ANALYSIS-001 unauthenticated analysis run is refused", unauth);

    let badTf = false;
    try {
      await asA.mutation(api.analysis.run, { marketId: "MKT-T", timeframe: "7m", horizon: "SHORT" });
    } catch (e) {
      badTf = String(e).includes("INVALID_REQUEST");
    }
    let badHorizon = false;
    try {
      await asA.mutation(api.analysis.run, { marketId: "MKT-T", timeframe: "1h", horizon: "YOLO" });
    } catch (e) {
      badHorizon = String(e).includes("INVALID_REQUEST");
    }
    check("DB-ANALYSIS-002 unsupported timeframe and horizon are rejected server-side", badTf && badHorizon);

    const run1 = await asA.mutation(api.analysis.run, {
      marketId: "MKT-T",
      timeframe: "1h",
      horizon: "SHORT",
    });
    check(
      "DB-ANALYSIS-003 pipeline persists SIMULATED-labeled run: evaluated LONG candidate, risk BLOCK on PROVISIONAL policy, honest NO TRADE verdict",
      run1.data.label === "SIMULATED" &&
        run1.status === "BLOCKED" &&
        run1.verdict === "NO TRADE" &&
        run1.strategyResults.length === 1 &&
        run1.strategyResults[0].signal === "LONG" &&
        run1.strategyResults[0].evaluated === true &&
        run1.risk.evaluated === true &&
        run1.risk.outcome === "BLOCK" &&
        run1.risk.evaluations.length === 1 &&
        run1.risk.evaluations[0].checks.some(
          (c) => c.check === "policy_status" && c.status === "BLOCK",
        ) &&
        run1.news.status === "UNAVAILABLE",
      JSON.stringify({ verdict: run1.verdict, risk: run1.risk.outcome, label: run1.data.label }),
    );

    check(
      "DB-ANALYSIS-004 run record is traceable: snapshot binding, quality checks and verdict evidence recorded",
      run1.snapshot.snapshotId === `SNAP-${run1.analysisId}` &&
        run1.snapshot.rangeEnd > run1.snapshot.rangeStart &&
        run1.data.qualityChecks.length > 0 &&
        run1.verdictEvidence.length > 0 &&
        run1.errors.some((e) => e.includes("SYNTHETIC SEED DATA")),
    );

    check("DB-ANALYSIS-005 analysis creates NO orders/authorizations/positions (execution disabled)",
      await (async () => {
        const counts = await t.run(async (ctx) => ({
          orders: (await ctx.db.query("orders").collect()).length,
          auths: (await ctx.db.query("executionAuthorizations").collect()).length,
          positions: (await ctx.db.query("positions").collect()).length,
        }));
        return counts.orders === 0 && counts.auths === 0 && counts.positions === 0;
      })(),
    );

    check("DB-ANALYSIS-006 audit event recorded (correlation id, execution-disabled note, no secrets)",
      await (async () => {
        const events = await t.run(async (ctx) => ctx.db.query("auditEvents").collect());
        const ev = events.find((e) => e.action === "ANALYSIS_RUN");
        return (
          ev !== undefined &&
          ev.correlationId === run1.analysisId &&
          ev.detail.includes("execution disabled") &&
          ev.detail.includes("verdict NO TRADE") &&
          !JSON.stringify(events).includes("sk_live")
        );
      })(),
    );

    // ---- ownership + pagination ---------------------------------------
    const foreign = await asB.query(api.analysis.get, { analysisId: run1.analysisId });
    const own = await asA.query(api.analysis.get, { analysisId: run1.analysisId });
    const histB = await asB.query(api.analysis.history, { paginationOpts: { numItems: 10, cursor: null } });
    const histA = await asA.query(api.analysis.history, { paginationOpts: { numItems: 10, cursor: null } });
    check("DB-ANALYSIS-007 records are owner-scoped: not-found == not-owned, history never crosses owners",
      foreign === null && own !== null && histA.page.length === 1 && histB.page.length === 0);

    let badPage = false;
    try {
      await asA.query(api.analysis.history, { paginationOpts: { numItems: 0, cursor: null } });
    } catch (e) {
      badPage = String(e).includes("INVALID_REQUEST");
    }
    let bigPage = false;
    try {
      await asA.query(api.analysis.history, { paginationOpts: { numItems: 500, cursor: null } });
    } catch (e) {
      bigPage = String(e).includes("INVALID_REQUEST");
    }
    check("DB-ANALYSIS-008 pagination limits are validated (1..100)", badPage && bigPage);

    // 4 more runs -> 5 total; page size 2 must walk 2/2/1.
    for (let i = 0; i < 4; i++) {
      await asA.mutation(api.analysis.run, { marketId: "MKT-T", timeframe: "1h", horizon: "SHORT" });
    }
    const p1 = await asA.query(api.analysis.history, { paginationOpts: { numItems: 2, cursor: null } });
    const p2 = await asA.query(api.analysis.history, { paginationOpts: { numItems: 2, cursor: p1.continueCursor } });
    const p3 = await asA.query(api.analysis.history, { paginationOpts: { numItems: 2, cursor: p2.continueCursor } });
    const ids = new Set(
      [...p1.page, ...p2.page, ...p3.page].map((r) => r.analysisId),
    );
    check("DB-ANALYSIS-009 pagination walks 5 runs as 2/2/1 with distinct traceable ids",
      p1.page.length === 2 && p2.page.length === 2 && p3.page.length === 1 &&
      p3.isDone === true && ids.size === 5,
      JSON.stringify({ a: p1.page.length, b: p2.page.length, c: p3.page.length, ids: ids.size }));

    let badId = false;
    try {
      await asA.query(api.analysis.get, { analysisId: "bad id with spaces" });
    } catch (e) {
      badId = String(e).includes("INVALID_REQUEST");
    }
    check("DB-ANALYSIS-010 malformed identifiers are rejected before any lookup", badId);
  }

  // ---- analysis pipeline: WAIT path (no entry trigger) -------------------
  {
    const t = fresh();
    const { userA } = await seedAnalysisWorkspace(t, "FLAT");
    const asA = t.withIdentity({ subject: userA });
    const run = await asA.mutation(api.analysis.run, {
      marketId: "MKT-T",
      timeframe: "1h",
      horizon: "SHORT",
    });
    check("DB-ANALYSIS-011 no entry trigger on validated data => WAIT (never a fabricated entry)",
      run.verdict === "WAIT" && run.status === "COMPLETED" &&
      run.strategyResults[0].signal === "FLAT" && run.risk.evaluated === false);
  }

  // ---- analysis pipeline: failure path (missing data) --------------------
  {
    const t = fresh();
    const { userA } = await seedAnalysisWorkspace(t, "SPIKE");
    const asA = t.withIdentity({ subject: userA });
    const run = await asA.mutation(api.analysis.run, {
      marketId: "MKT-T",
      timeframe: "1d",
      horizon: "MEDIUM",
    });
    check("DB-ANALYSIS-012 missing market data => UNAVAILABLE label + NO TRADE + INSUFFICIENT_DATA (honest)",
      run.data.label === "UNAVAILABLE" && run.verdict === "NO TRADE" &&
      run.status === "INSUFFICIENT_DATA" && run.data.qualityState === "MISSING");

    // Unknown market: refused before anything is written.
    let unknown = false;
    try {
      await asA.mutation(api.analysis.run, { marketId: "MKT-NOPE", timeframe: "1h", horizon: "SHORT" });
    } catch (e) {
      unknown = String(e).includes("INVALID_REQUEST");
    }
    check("DB-ANALYSIS-013 unknown market is refused with no record written", unknown);
  }

  // ---- chart queries: instrument/timeframe specific, bounded ------------
  {
    const t = fresh();
    const { userA } = await seedAnalysisWorkspace(t, "FLAT");
    const asA = t.withIdentity({ subject: userA });
    const now = Date.now();
    // Provider-sourced bars (fresh) + synthetic bars + a forming bar + a
    // second timeframe + a second market: the query must never mix any of it.
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("candles", {
          marketId: "MKT-T",
          symbol: "BTC/USD",
          assetClass: "CRYPTO",
          venue: "KRAKEN",
          timeframe: "4h",
          eventTime: now - (5 - i) * 4 * HOUR,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1,
          source: "KRAKEN",
          providerTimestamp: now - (5 - i) * 4 * HOUR,
          receivedTime: now - 10 * 60_000,
          availabilityTime: now - (5 - i) * 4 * HOUR + 4 * HOUR,
          qualityStatus: "VALID",
        });
      }
      await ctx.db.insert("candles", {
        marketId: "MKT-T",
        symbol: "BTC/USD",
        assetClass: "CRYPTO",
        venue: "KRAKEN",
        timeframe: "4h",
        eventTime: now - 30 * 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
        source: "KRAKEN",
        providerTimestamp: now - 30 * 60_000,
        receivedTime: now - 5 * 60_000,
        availabilityTime: now - 30 * 60_000 + 4 * HOUR,
        qualityStatus: "INCOMPLETE", // still forming — never in the series
      });
      await ctx.db.insert("markets", {
        marketId: "MKT-T2",
        symbol: "ETH/USD",
        assetClass: "CRYPTO",
        venue: "SIM-VENUE",
        provider: "SIMULATED",
        baseAsset: "ETH",
        quoteAsset: "USD",
        timezone: "UTC",
        status: "OPEN",
        providerState: "AVAILABLE",
      });
      await ctx.db.insert("candles", {
        marketId: "MKT-T2",
        symbol: "ETH/USD",
        assetClass: "CRYPTO",
        venue: "SIM-VENUE",
        timeframe: "4h",
        eventTime: now - 4 * HOUR,
        open: 5,
        high: 6,
        low: 4,
        close: 5,
        volume: 1,
        source: "SIMULATED",
        providerTimestamp: now - 4 * HOUR,
        receivedTime: now - 4 * HOUR,
        availabilityTime: now,
        qualityStatus: "VALID",
      });
    });

    const chart = await asA.query(api.marketData.candles, {
      marketId: "MKT-T",
      timeframe: "4h",
      limit: 10,
    });
    check("DB-CHART-001 instrument+timeframe query returns only that series, CACHED (never LIVE/SIMULATED), excludes forming bars",
      chart.status === "OK" && chart.symbol === "BTC/USD" && chart.timeframe === "4h" &&
      chart.label === "CACHED" && chart.partialBars === 1 &&
      chart.bars.length === 5 &&
      chart.bars.every((b) => b.source === "KRAKEN") &&
      chart.bars.every((b, i, arr) => i === 0 || arr[i - 1].t < b.t),
      JSON.stringify({ label: chart.label, bars: chart.bars.length, partial: chart.partialBars }));

    const limited = await asA.query(api.marketData.candles, {
      marketId: "MKT-T",
      timeframe: "4h",
      limit: 3,
    });
    const ranged = await asA.query(api.marketData.candles, {
      marketId: "MKT-T",
      timeframe: "4h",
      startTime: now - 2 * 4 * HOUR,
      endTime: now,
      limit: 50,
    });
    // The `limit`-derived window is anchored at query time, so the oldest bar
    // may sit on the moving boundary: assert the real invariants — never more
    // than `limit` bars, recent bars always present, range honored strictly.
    check("DB-CHART-002 result count and date range are bounded and honored",
      limited.bars.length <= 3 && limited.bars.length >= 2 &&
      ranged.bars.length <= 2 && ranged.bars.length >= 1 &&
      ranged.bars.every((b) => b.t >= now - 2 * 4 * HOUR && b.t <= now),
      JSON.stringify({ limited: limited.bars.length, ranged: ranged.bars.length }));

    const empty = await asA.query(api.marketData.candles, {
      marketId: "MKT-T",
      timeframe: "1m",
      limit: 10,
    });
    check("DB-CHART-003 empty instrument/timeframe is an honest EMPTY/UNAVAILABLE state (no filler candles)",
      empty.status === "EMPTY" && empty.label === "UNAVAILABLE" && empty.bars.length === 0);

    let badLimit = false;
    try {
      await asA.query(api.marketData.candles, { marketId: "MKT-T", timeframe: "4h", limit: 9999 });
    } catch (e) {
      badLimit = String(e).includes("INVALID_REQUEST");
    }
    let badTf2 = false;
    try {
      await asA.query(api.marketData.candles, { marketId: "MKT-T", timeframe: "7m" });
    } catch (e) {
      badTf2 = String(e).includes("INVALID_REQUEST");
    }
    check("DB-CHART-004 chart query validates limit and timeframe", badLimit && badTf2);

    // Provider health via the real internal mutation.
    await t.mutation(internal.marketData.recordHealth, {
      provider: "KRAKEN",
      kind: "MARKET_DATA",
      assetClass: "CRYPTO",
      ok: true,
      note: "verified test fetch",
      latencyMs: 42,
      at: now,
    });
    await t.mutation(internal.marketData.recordHealth, {
      provider: "KRAKEN",
      kind: "MARKET_DATA",
      assetClass: "CRYPTO",
      ok: false,
      failureClass: "NETWORK_ERROR",
      note: "down",
      at: now + 1,
    });
    const health = await asA.query(api.marketData.health, {});
    const kraken = health.find((h) => h.provider === "KRAKEN");
    check("DB-HEALTH-001 provider health tracks success/failure transitions honestly",
      kraken !== undefined && kraken.status === "DEGRADED" &&
      kraken.failureClass === "NETWORK_ERROR" && kraken.consecutiveFailures === 1 &&
      kraken.lastSuccessAt !== null && kraken.lastFailureAt !== null);
  }

  // ---- news persistence + selection -------------------------------------
  {
    const t = fresh();
    const { userA } = await seedAnalysisWorkspace(t, "FLAT");
    const asA = t.withIdentity({ subject: userA });
    const now = Date.now();
    const base = {
      provider: "YAHOO_FINANCE_RSS",
      sourceName: "example.com",
      sourceUrl: "https://example.com/a",
      headline: "Fed signals rate decision surprise",
      summary: "FOMC cites inflation",
      publishedAt: now - 2 * HOUR,
      retrievedAt: now,
      instruments: ["BTC/USD"],
      currencies: ["BTC", "USD"],
      assets: ["BTC"],
      impact: "HIGH" as const,
      impactEvidence: ["HIGH:rate decision"],
      relevanceScore: 2,
      contentHash: "sha256:aaaa",
      freshness: "FRESH",
    };
    const res = await t.mutation(internal.news.persist, {
      marketId: "MKT-T",
      items: [base, { ...base }, { ...base, contentHash: "sha256:bbbb", sourceUrl: "https://example.com/b", headline: "quiet" }],
    });
    check("DB-NEWS-001 news persistence deduplicates by content hash", res.inserted === 2 && res.duplicates === 1);

    const latest = await asA.query(api.news.latest, { marketId: "MKT-T", limit: 10 });
    check("DB-NEWS-002 news read is bounded, market-scoped, carries source URLs and impact evidence",
      latest.length === 2 && latest.every((n) => n.sourceUrl.startsWith("https://")) &&
      latest.some((n) => n.impact === "HIGH" && n.impactEvidence.length > 0));

    const top = await asA.query(api.news.topImpact, { marketId: "MKT-T" });
    check("DB-NEWS-003 high-impact selection returns the evidence-backed item",
      top.selected !== null && top.selected.impact === "HIGH" && top.reason.includes("HIGH"));

    const topNone = await asA.query(api.news.topImpact, { marketId: "MKT-T2" });
    check("DB-NEWS-004 no news for a market discloses the limitation (null + reason, never invented)",
      topNone.selected === null && topNone.reason.includes("NO_RELIABLE_NEWS"));

    let badNewsLimit = false;
    try {
      await asA.query(api.news.latest, { marketId: "MKT-T", limit: 0 });
    } catch (e) {
      badNewsLimit = String(e).includes("INVALID_REQUEST");
    }
    check("DB-NEWS-005 news query limit is validated", badNewsLimit);
  }

  // ---- user preferences: validation + ownership --------------------------
  {
    const t = fresh();
    const { userA, userB } = await seedAnalysisWorkspace(t, "FLAT");
    const asA = t.withIdentity({ subject: userA });
    const asB = t.withIdentity({ subject: userB });

    const before = await asA.query(api.preferences.get, {});
    check("DB-PREF-001 missing preferences return safe defaults with an explicit reason",
      before.saved === null && before.reason === "NO_SAVED_PREFERENCES" && before.defaults !== null);

    const saved = await asA.mutation(api.preferences.save, {
      marketId: "MKT-T",
      timeframe: "4h",
      horizon: "MEDIUM",
      notifications: { analysisComplete: true, riskBlocked: true, providerFailure: true, highImpactNews: false },
    });
    const after = await asA.query(api.preferences.get, {});
    check("DB-PREF-002 save/get roundtrip persists validated settings; symbol is server-derived",
      saved.ok === true && after.saved !== null && after.saved.symbol === "BTC/USD" &&
      after.saved.timeframe === "4h" && after.saved.horizon === "MEDIUM" &&
      after.saved.notifications.highImpactNews === false);

    const forB = await asB.query(api.preferences.get, {});
    check("DB-PREF-003 preferences are owner-scoped (one user never sees another's)",
      forB.saved === null);

    let badTf = false;
    try {
      await asA.mutation(api.preferences.save, {
        marketId: "MKT-T", timeframe: "3h", horizon: "SHORT",
        notifications: { analysisComplete: true, riskBlocked: true, providerFailure: true, highImpactNews: false },
      });
    } catch (e) {
      badTf = String(e).includes("INVALID_REQUEST");
    }
    let badMarket = false;
    try {
      await asA.mutation(api.preferences.save, {
        marketId: "MKT-NOPE", timeframe: "1h", horizon: "SHORT",
        notifications: { analysisComplete: true, riskBlocked: true, providerFailure: true, highImpactNews: false },
      });
    } catch (e) {
      badMarket = String(e).includes("INVALID_REQUEST");
    }
    check("DB-PREF-004 invalid timeframe/market are rejected server-side", badTf && badMarket);

    // Corrupt stored row (simulating an out-of-range legacy value): must be
    // reported invalid, never silently used.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("userPreferences").collect();
      await ctx.db.replace(rows[0]._id, { ...rows[0], timeframe: "3h" });
    });
    const invalid = await asA.query(api.preferences.get, {});
    check("DB-PREF-005 invalid stored settings are reported and replaced by defaults (safe fallback)",
      invalid.saved === null && (invalid.reason ?? "").includes("SAVED_PREFERENCES_INVALID") &&
      invalid.defaults !== null);
  }

  // ---- credential secrecy over the whole new surface ---------------------
  {
    const t = fresh();
    const { userA } = await seedAnalysisWorkspace(t, "SPIKE");
    const asA = t.withIdentity({ subject: userA });
    await asA.mutation(api.analysis.run, { marketId: "MKT-T", timeframe: "1h", horizon: "SHORT" });
    await t.mutation(internal.marketData.recordHealth, {
      provider: "ECB-RATES",
      kind: "MARKET_DATA",
      assetClass: "FOREX",
      ok: false,
      failureClass: "NOT_CONFIGURED",
      note: "no keyed FX provider configured; close-only ECB feed only",
      at: Date.now(),
    });
    const dump = await t.run(async (ctx) => JSON.stringify({
      runs: await ctx.db.query("analysisRuns").collect(),
      health: await ctx.db.query("providerHealth").collect(),
      audit: await ctx.db.query("auditEvents").collect(),
      news: await ctx.db.query("newsItems").collect(),
      prefs: await ctx.db.query("userPreferences").collect(),
    }));
    check("DB-SEC-001 no secret material appears in any new row (runs, health, audit, news, prefs)",
      !dump.includes("sk_live") && !dump.includes("api_key") && !dump.includes("Bearer ") &&
      !dump.includes("secret"));
  }
}

// ---------------------------------------------------------------------------
// DB-G1-* — G1 HOTFIX REGRESSION: cross-customer strategy-disclosure.
// Before the fix: (a) recordLearningEvent accepted ANY orderId with no
// ownership check, and (b) proposeCandidateVersion followed
// learning.sourceOrderId to a foreign order's parent strategy version with no
// visibility check, copying the parent's private definition
// (entry/exit/filters/sizing) into an attacker-owned record. Order ids are
// predictable (ORD-<idempotencyKey>), so any two registered users could
// exploit this. These checks exercise the real handlers with real identities.
// ---------------------------------------------------------------------------
{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "ACK");
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });

  // Disclosure target: B's PRIVATE strategy version with distinctive marker
  // parameters, plus B's own order referencing it (the G1 pivot record).
  await t.run(async (ctx) => {
    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-B-PRIV",
      strategyId: "STRAT-B-PRIV",
      version: 3,
      status: "VERSION",
      immutable: true,
      definition: {
        marketId: "MKT-B-PRIV",
        symbol: "PRIV/X",
        timeframe: "1h",
        entry: { indicator: "ema_cross", fast: 131, slow: 277 },
        exit: { stopLossPct: 0.02, takeProfitPct: 0.02, timeExitBars: 100 },
        filters: { rsiMin: null, rsiMax: null },
        sizing: { kind: "fixed_fraction", fraction: 1 },
      },
      provenance: {
        authorType: "HUMAN",
        authorRef: "test-fixture",
        rationale: "B private fixture version (G1 disclosure target)",
        createdAt: Date.now(),
      },
      ownerUserId: userB,
    });
    await ctx.db.insert("orders", {
      orderId: "ORD-B-PRIV",
      idempotencyKey: "IK-ORD-B-PRIV",
      authorizationId: "AUTH-B-PRIV",
      proposalId: "PROP-B-PRIV",
      strategyVersionId: "SV-B-PRIV",
      marketId: "MKT-T",
      symbol: "BTC/USD",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      timeInForce: "GTC",
      mode: "PAPER",
      state: "FILLED",
      history: [{ state: "FILLED", at: Date.now(), note: "G1 fixture (foreign order)" }],
      ownerUserId: userB,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // (1) Legitimate same-customer flow preserved: A's own order -> A's learning
  // event -> candidate derived from a VISIBLE parent (shared SYSTEM SV-T).
  await seedAuthorization(t, { authorizationId: "AUTH-G1", ownerUserId: userA });
  const ownOrder = await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-G1", "IK-G1"));
  const ownLearning = await asA.mutation(api.workflows.recordLearningEvent, {
    orderId: ownOrder.orderId ?? undefined, failureClass: "REGIME_FAILURE",
    analysis: "G1 own-order analysis", hypothesis: "G1 own-order hypothesis",
  });
  const ownCandidate = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: ownLearning.learningEventId ?? "none", params: { fast: 5 },
  });
  const versions1 = await t.run(async (ctx) => ctx.db.query("strategyVersions").collect());
  check("DB-G1-001 owner derives a candidate from their own order and a visible parent (legitimate flow preserved)",
    ownOrder.orderId !== null && ownLearning.ok !== false && ownCandidate.ok === true &&
    versions1.some((v) => ownCandidate.ok && v.strategyVersionId === ownCandidate.strategyVersionId &&
      v.ownerUserId === userA && v.parentVersionId === "SV-T"));

  // (2) Customer A cannot use Customer B's order id to disclose strategy
  // parameters: rejected at recordLearningEvent, before anything is stored.
  const foreignRef = await asA.mutation(api.workflows.recordLearningEvent, {
    orderId: "ORD-B-PRIV", failureClass: "REGIME_FAILURE",
    analysis: "G1 probe", hypothesis: "G1 probe",
  });
  check("DB-G1-002 referencing a foreign order id is rejected before storage (no strategy disclosure)",
    foreignRef.ok === false && foreignRef.learningEventId === null &&
    !JSON.stringify(foreignRef).includes("131") && !JSON.stringify(foreignRef).includes("PRIV"));

  // (4) Missing records are rejected SAFELY and indistinguishably (no ID
  // oracle: missing ≡ foreign), and no learning row is created for either.
  const missingRef = await asA.mutation(api.workflows.recordLearningEvent, {
    orderId: "ORD-DOES-NOT-EXIST", failureClass: "REGIME_FAILURE",
    analysis: "G1 probe", hypothesis: "G1 probe",
  });
  const learningRows = await t.run(async (ctx) => ctx.db.query("learningEvents").collect());
  check("DB-G1-003 missing and foreign order references are indistinguishable and nothing is stored",
    JSON.stringify(foreignRef) === JSON.stringify(missingRef) &&
    missingRef.ok === false && learningRows.length === 1);

  // Defense in depth: a legacy/pre-fix learning row that already references a
  // foreign order (inserted directly, bypassing the fixed mutation) must still
  // be refused at the derivation boundary — before any parameter is copied.
  await t.run(async (ctx) =>
    ctx.db.insert("learningEvents", {
      learningEventId: "LEARN-G1-LEGACY",
      sourceOrderId: "ORD-B-PRIV",
      failureClass: "REGIME_FAILURE",
      analysis: "legacy row referencing a foreign order",
      hypothesis: "legacy row",
      liveMutationAttempted: false,
      ownerUserId: userA,
      createdAt: Date.now(),
    }),
  );
  const deriveForeign = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: "LEARN-G1-LEGACY", params: { fast: 9 },
  });
  const versions2 = await t.run(async (ctx) => ctx.db.query("strategyVersions").collect());
  check("DB-G1-004 a learning row pivoting to a foreign order cannot reach the parent definition (defense in depth)",
    deriveForeign.ok === false && !JSON.stringify(deriveForeign).includes("131") &&
    !JSON.stringify(deriveForeign).includes("PRIV") && !versions2.some((v) => v.parentVersionId === "SV-B-PRIV"));

  // (3) Customer A cannot reference Customer B's strategy version, even when
  // the pivot order is A's OWN but its strategyVersionId points at B's private
  // version (inconsistent association) — the parent visibility re-check holds.
  await t.run(async (ctx) =>
    ctx.db.insert("orders", {
      orderId: "ORD-A-MISLINKED",
      idempotencyKey: "IK-ORD-A-MISLINKED",
      authorizationId: "AUTH-A-MISLINKED",
      proposalId: "PROP-A-MISLINKED",
      strategyVersionId: "SV-B-PRIV",
      marketId: "MKT-T",
      symbol: "BTC/USD",
      side: "BUY",
      quantity: 1,
      orderType: "MARKET",
      timeInForce: "GTC",
      mode: "PAPER",
      state: "FILLED",
      history: [{ state: "FILLED", at: Date.now(), note: "G1 fixture (own order, foreign parent)" }],
      ownerUserId: userA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const mislinkedLearning = await asA.mutation(api.workflows.recordLearningEvent, {
    orderId: "ORD-A-MISLINKED", failureClass: "REGIME_FAILURE",
    analysis: "G1 mislinked analysis", hypothesis: "G1 mislinked hypothesis",
  });
  const deriveMislinked = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: mislinkedLearning.learningEventId ?? "none", params: {},
  });
  check("DB-G1-005 an own order pointing at a foreign strategy version cannot copy its parameters",
    mislinkedLearning.ok !== false && deriveMislinked.ok === false &&
    !JSON.stringify(deriveMislinked).includes("131") && !JSON.stringify(deriveMislinked).includes("PRIV"));

  // (4 continued) Missing and unauthorized LEARNING records are rejected with
  // indistinguishable responses (existing no-oracle rule kept as regression).
  const bLearning = await asB.mutation(api.workflows.recordLearningEvent, {
    orderId: "ORD-B-PRIV", failureClass: "REGIME_FAILURE",
    analysis: "B own analysis", hypothesis: "B own hypothesis",
  });
  const foreignLearning = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: bLearning.learningEventId ?? "none", params: { fast: 1 },
  });
  const missingLearning = await asA.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: "LEARN-DOES-NOT-EXIST", params: { fast: 1 },
  });
  check("DB-G1-006 foreign and missing learning events are rejected with indistinguishable responses",
    bLearning.ok !== false && foreignLearning.ok === false && missingLearning.ok === false &&
    foreignLearning.reason === missingLearning.reason &&
    // Destination-record identity is collision-proof across users even when
    // both events are created in the same millisecond.
    bLearning.learningEventId !== mislinkedLearning.learningEventId &&
    !JSON.stringify(foreignLearning).includes("131"));

  // (1 continued) B's own flow on their OWN private parent still works — the
  // fix narrows cross-customer access only, never same-customer behavior.
  const bCandidate = await asB.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: bLearning.learningEventId ?? "none", params: { fast: 7 },
  });
  const versions3 = await t.run(async (ctx) => ctx.db.query("strategyVersions").collect());
  check("DB-G1-007 the owner derives from their own private parent (same-customer behavior preserved)",
    bCandidate.ok === true && versions3.some((v) => bCandidate.ok &&
      v.strategyVersionId === bCandidate.strategyVersionId &&
      v.ownerUserId === userB && v.parentVersionId === "SV-B-PRIV"));

  // Authentication is not weakened: signed-out callers still cannot record
  // learning events or derive candidates.
  const anonLearning = await t.mutation(api.workflows.recordLearningEvent, {
    orderId: "ORD-B-PRIV", failureClass: "REGIME_FAILURE", analysis: "x", hypothesis: "x",
  }).catch((e: unknown) => e);
  const anonCandidate = await t.mutation(api.workflows.proposeCandidateVersion, {
    learningEventId: "LEARN-G1-LEGACY", params: {},
  }).catch((e: unknown) => e);
  check("DB-G1-008 signed-out callers cannot record learning events or derive candidates",
    anonLearning instanceof Error && anonLearning.message.includes("UNAUTHENTICATED") &&
    anonCandidate instanceof Error && anonCandidate.message.includes("UNAUTHENTICATED"));

  // Audit trail is not weakened: both denial paths are recorded, and the
  // DENIAL records themselves carry no private parameters. (Scoped to the
  // denial records on purpose: B's own successful derivation legitimately
  // names B's own record ids in its audit entry — that is not a leak — and
  // timestamp digits can coincidentally contain any 3-digit string.)
  const denials = await t.run(async (ctx) =>
    (await ctx.db.query("auditEvents").collect()).filter(
      (a) => a.action === "LEARNING_EVENT_DENIED" || a.action === "CANDIDATE_CREATION_DENIED",
    ),
  );
  check("DB-G1-009 denials are recorded in the audit trail without leaking private parameters",
    denials.some((a) => a.action === "LEARNING_EVENT_DENIED") &&
    denials.some((a) => a.action === "CANDIDATE_CREATION_DENIED") &&
    !denials.some((a) =>
      a.detail.includes("131") || a.detail.includes("277") ||
      a.detail.includes("PRIV") || a.resourceId.includes("PRIV")));
  // And no audit record anywhere contains B's private DEFINITION PARAMETER
  // values (fixed fixture numbers), whatever the actor.
  const auditAll = await t.run(async (ctx) => ctx.db.query("auditEvents").collect());
  check("DB-G1-010 no audit record contains private strategy definition parameters",
    !auditAll.some((a) => a.detail.includes("131") || a.detail.includes("277")));
}

// ---------------------------------------------------------------------------
// DB-G2-* — G2 HOTFIX REGRESSION: per-customer risk isolation.
// Before the fix, loadRiskContext aggregated positions/equity/realized PnL
// over ALL owners and read daily-PnL/peak-equity from the SHARED systemState
// row: one customer's positions or losses changed every other customer's risk
// verdict. Now risk inputs come from the caller's risk scope only (own +
// shared SYSTEM rows — canViewRecord semantics; the shared SYSTEM demo
// workspace is explicitly authorized for every customer), and accounting
// lives in a PER-CUSTOMER ledger (riskAccountState).
// ---------------------------------------------------------------------------
{
  const t = fresh();
  const { userA, userB } = await seedWorkspace(t, "FILL");
  const asA = t.withIdentity({ subject: userA });
  const asB = t.withIdentity({ subject: userB });

  // Fixture: A owns +100 and +50 across two markets; B owns -5000; one shared
  // SYSTEM demo row (+1000). Per-customer ledgers: A's daily PnL -100, B's
  // daily PnL -3000 (beyond the seeded maxDailyLoss of 2000).
  const dayKey = new Date().toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const now = Date.now();
    const insertPos = (positionId: string, ownerUserId: string | undefined, marketId: string, symbol: string, realizedPnl: number) =>
      ctx.db.insert("positions", {
        positionId,
        account: "PAPER:paper-account",
        marketId,
        symbol,
        side: "LONG",
        quantity: 1,
        avgEntryPrice: 100,
        realizedPnl,
        source: "PAPER",
        updatedAt: now,
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      });
    await insertPos("POS-G2-A1", userA, "MKT-T", "BTC/USD", 100);
    await insertPos("POS-G2-A2", userA, "MKT-G2-2", "ETH/USD", 50);
    await insertPos("POS-G2-B1", userB, "MKT-T", "BTC/USD", -5000);
    await insertPos("POS-G2-SYS", undefined, "MKT-T", "BTC/USD", 1000);
    await ctx.db.insert("riskAccountState", {
      ownerUserId: userA, peakEquity: 100000, pnlDay: dayKey, realizedPnlDay: -100, updatedAt: now,
    });
    await ctx.db.insert("riskAccountState", {
      ownerUserId: userB, peakEquity: 100000, pnlDay: dayKey, realizedPnlDay: -3000, updatedAt: now,
    });
  });

  const scopeA = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T", marketId: "MKT-T",
      proposalIdempotencyKey: "IK-G2-A", accountOwnerUserId: userA,
    }),
  );
  const scopeB = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T", marketId: "MKT-T",
      proposalIdempotencyKey: "IK-G2-B", accountOwnerUserId: userB,
    }),
  );

  // (1) A's risk inputs exclude B's positions and losses:
  // equity = 100000 + 100 + 50 (own) + 1000 (shared SYSTEM); B's -5000 gone.
  check("DB-G2-001 customer A's risk context excludes customer B's positions and losses",
    scopeA.ctx.equity === 100000 + 150 + 1000 &&
    scopeA.ctx.openPositions === 3 &&
    scopeA.ctx.realizedPnlToday === -100 &&
    scopeA.ctx.accountStateComplete === true,
    JSON.stringify({ equity: scopeA.ctx.equity, open: scopeA.ctx.openPositions, today: scopeA.ctx.realizedPnlToday }));

  // (2) B's risk inputs exclude A's positions and losses:
  // equity = 100000 - 5000 (own) + 1000 (shared SYSTEM); A's +150 gone.
  check("DB-G2-002 customer B's risk context excludes customer A's positions and losses",
    scopeB.ctx.equity === 100000 - 5000 + 1000 &&
    scopeB.ctx.openPositions === 2 &&
    scopeB.ctx.realizedPnlToday === -3000,
    JSON.stringify({ equity: scopeB.ctx.equity, open: scopeB.ctx.openPositions, today: scopeB.ctx.realizedPnlToday }));

  // (3) One customer's loss does not alter another customer's risk verdict:
  // identical proposal + identical policy -> A's daily_loss PASSES (loss 100
  // within 2000) while B's daily_loss BLOCKS on B's OWN loss (3000 >= 2000).
  const fixturePolicy: RiskPolicy = {
    policyId: "TEST-FIXTURE-NOT-RATIFIED",
    version: 1,
    status: "APPROVED",
    limits: SEEDED_POLICY.limits,
  };
  const proposal: TradeProposal = {
    proposalId: "PROP-G2",
    side: "BUY",
    quantity: 0.1,
    referencePrice: CLOSE,
    orderType: "MARKET",
    mode: "PAPER",
  };
  const verdictA = evaluateRisk(proposal, scopeA.ctx, fixturePolicy);
  const verdictB = evaluateRisk(proposal, scopeB.ctx, fixturePolicy);
  const dailyA = verdictA.checks.find((c) => c.check === "daily_loss");
  const dailyB = verdictB.checks.find((c) => c.check === "daily_loss");
  check("DB-G2-003 one customer's loss does not alter another customer's risk verdict",
    dailyA?.status === "PASS" && dailyB?.status === "BLOCK",
    JSON.stringify({ a: dailyA, b: dailyB }));

  // (4) Same-customer positions aggregate correctly across markets, through
  // the REAL fill path (placeOrder with FILL behavior): A sells 1 BTC,
  // closing POS-G2-A1 at 99.95 -> realized 99.95; equity aggregates A's rows
  // (99.95 + 50) plus the shared SYSTEM row (1000).
  await seedAuthorization(t, { authorizationId: "AUTH-G2-A", ownerUserId: userA, side: "SELL", quantity: 1 });
  await asA.mutation(api.workflows.placeOrder, placeArgs("AUTH-G2-A", "IK-G2-AFILL", "SELL", 1));
  const scopeA2 = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T", marketId: "MKT-T",
      proposalIdempotencyKey: "IK-G2-A2", accountOwnerUserId: userA,
    }),
  );
  const acctA = await t.run(async (ctx) =>
    ctx.db.query("riskAccountState").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userA)).first());
  check("DB-G2-004 same-customer positions aggregate correctly and fills update the customer's own ledger",
    Math.abs(scopeA2.ctx.equity - (100000 + 99.95 + 50 + 1000)) < 1e-6 &&
    scopeA2.ctx.openPositions === 2 &&
    Math.abs((acctA?.realizedPnlDay ?? 999) - -100.05) < 1e-6 &&
    Math.abs((acctA?.peakEquity ?? 0) - (100000 + 99.95 + 50 + 1000)) < 1e-6,
    JSON.stringify({ equity: scopeA2.ctx.equity, open: scopeA2.ctx.openPositions, acctA }));

  // (5) Unauthorized account/position references are rejected: B's own fill
  // (SELL 1, closing POS-G2-B1 at 99.95 -> realized -5000.05) must touch ONLY
  // B's position and B's ledger — A's position row and A's ledger stay
  // byte-identical.
  const posA1Before = await t.run(async (ctx) =>
    (await ctx.db.query("positions").collect()).find((p) => p.positionId === "POS-G2-A1"));
  const acctABefore = await t.run(async (ctx) =>
    ctx.db.query("riskAccountState").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userA)).first());
  await seedAuthorization(t, { authorizationId: "AUTH-G2-B", ownerUserId: userB, side: "SELL", quantity: 1 });
  await asB.mutation(api.workflows.placeOrder, placeArgs("AUTH-G2-B", "IK-G2-BFILL", "SELL", 1));
  const posA1After = await t.run(async (ctx) =>
    (await ctx.db.query("positions").collect()).find((p) => p.positionId === "POS-G2-A1"));
  const acctAAfter = await t.run(async (ctx) =>
    ctx.db.query("riskAccountState").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userA)).first());
  const acctBAfter = await t.run(async (ctx) =>
    ctx.db.query("riskAccountState").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userB)).first());
  const posB1After = await t.run(async (ctx) =>
    (await ctx.db.query("positions").collect()).find((p) => p.positionId === "POS-G2-B1"));
  check("DB-G2-005 a fill never touches another customer's position or account state",
    JSON.stringify(posA1Before) === JSON.stringify(posA1After) &&
    JSON.stringify(acctABefore) === JSON.stringify(acctAAfter) &&
    Math.abs((acctBAfter?.realizedPnlDay ?? 999) - -3000.05) < 1e-6 &&
    Math.abs((posB1After?.realizedPnl ?? 0) - -5000.05) < 1e-6,
    JSON.stringify({ acctB: acctBAfter, posB: posB1After }));

  // (6) The shared platform controls remain separate from customer accounting:
  // the per-customer ledger is what feeds verdicts; and B's loss never moved
  // A's daily-loss input (re-checked after B's fill).
  const scopeA3 = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T", marketId: "MKT-T",
      proposalIdempotencyKey: "IK-G2-A3", accountOwnerUserId: userA,
    }),
  );
  const verdictA3 = evaluateRisk(proposal, scopeA3.ctx, fixturePolicy);
  check("DB-G2-006 after B's loss, A's daily-loss verdict is unchanged (controls stay separate)",
    scopeA3.ctx.realizedPnlToday === -100.05 &&
    verdictA3.checks.find((c) => c.check === "daily_loss")?.status === "PASS" &&
    scopeA3.ctx.killSwitchEngaged === false,
    JSON.stringify({ today: scopeA3.ctx.realizedPnlToday, checks: verdictA3.checks.filter((c) => c.status !== "PASS") }));
}

await backendRepairBattery();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
