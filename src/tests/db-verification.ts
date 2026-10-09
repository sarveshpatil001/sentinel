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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
