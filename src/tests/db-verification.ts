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
 *  - No risk policy is ever APPROVED by this suite. Policy fixtures either
 *    mirror the seeded PROVISIONAL configuration or declare NO limits at all.
 *  - Execution authorization fixtures are inserted directly as capability
 *    tokens (owner-bound records) so that consumption/ownership behavior can
 *    be tested without ratifying any policy.
 *  - Everything is PAPER/DEMO: no live credentials, no provider adapters, no
 *    live-mode activation path is created or exercised.
 */
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
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
  "../convex/users.ts": () => import("../convex/users"),
  "../convex/seed.ts": () => import("../convex/seed"),
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
  await seedWorkspace(t, "ACK");
  // 150 positions with known realized PnL (+10 each = +1500) — beyond the old
  // positions.take(100) boundary.
  await insertPositionRows(t, 150, 10);
  const { ctx: riskCtx } = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T",
      marketId: "MKT-T",
      proposalIdempotencyKey: "IK-BOUNDS-2",
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
  await seedWorkspace(t, "ACK");
  // Saturate the bounded read entirely (SCAN_CAP = 2000): completeness can no
  // longer be established and must surface as fail-closed, never a silent
  // undercount.
  await insertPositionRows(t, 2000, 0);
  const { ctx: riskCtx } = await t.run(async (ctx) =>
    loadRiskContext(ctx, {
      strategyVersionId: "SV-T",
      marketId: "MKT-T",
      proposalIdempotencyKey: "IK-BOUNDS-3",
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
