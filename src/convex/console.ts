/**
 * SENTINEL PRIME — CONSOLE QUERIES (read-only)
 *
 * Presentation layer. The frontend is never trusted (Section 04): these
 * queries only project deterministic state that the backend already computed.
 * Nothing here authorizes a financial action.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { query, QueryCtx } from "./_generated/server";
import { verifyAuditChain, AuditRecord } from "./lib/audit";

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("UNAUTHENTICATED");
  return userId;
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const state = await ctx.db.query("systemState").first();
    const markets = await ctx.db.query("markets").take(50);
    const quality = await ctx.db.query("dataQualityReports").take(50);
    const versions = await ctx.db.query("strategyVersions").take(50);
    const validations = await ctx.db.query("validationRuns").take(50);
    const orders = await ctx.db.query("orders").take(100);
    const audit = await ctx.db.query("auditEvents").take(200);
    const agents = await ctx.db.query("agents").take(50);

    const sortedAudit = audit
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(
        (r): AuditRecord => ({
          sequence: r.sequence,
          at: r.at,
          actor: r.actor,
          actorType: r.actorType,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          outcome: r.outcome,
          correlationId: r.correlationId,
          detail: r.detail,
          prevHash: r.prevHash,
          hash: r.hash,
        }),
      );

    return {
      systemState: state ?? null,
      marketCount: markets.length,
      qualitySummary: quality.map((q) => ({
        marketId: q.marketId,
        symbol: q.symbol,
        state: q.state,
      })),
      strategyVersionCount: versions.length,
      latestValidations: validations
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3)
        .map((v) => ({
          validationId: v.validationId,
          strategyVersionId: v.strategyVersionId,
          state: v.state,
          leakageState: v.leakageState,
          tradeCount: v.metrics?.tradeCount ?? null,
          netReturn: v.metrics?.netReturn ?? null,
          maxDrawdown: v.metrics?.maxDrawdown ?? null,
        })),
      orderCounts: {
        total: orders.length,
        unknown: orders.filter((o) => o.state === "UNKNOWN").length,
        filled: orders.filter((o) => o.state === "FILLED").length,
      },
      auditChain: verifyAuditChain(sortedAudit),
      recentAudit: sortedAudit.slice(-6).reverse(),
      agentCounts: {
        total: agents.length,
        deterministic: agents.filter((a) => a.isDeterministic).length,
        unavailable: agents.filter((a) => a.state === "UNAVAILABLE").length,
      },
    };
  },
});

export const data = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const markets = await ctx.db.query("markets").take(50);
    const quality = await ctx.db.query("dataQualityReports").take(50);
    const snapshots = await ctx.db.query("dataSnapshots").take(20);
    const candles = await ctx.db.query("candles").take(2000);

    return {
      markets,
      quality,
      snapshots,
      series: markets.map((m) => ({
        marketId: m.marketId,
        symbol: m.symbol,
        points: candles
          .filter((c) => c.marketId === m.marketId)
          .sort((a, b) => a.eventTime - b.eventTime)
          .slice(-120)
          .map((c) => ({ t: c.eventTime, close: c.close })),
      })),
    };
  },
});

export const strategies = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const strategies = await ctx.db.query("strategies").take(50);
    const versions = await ctx.db.query("strategyVersions").take(100);
    const evidence = await ctx.db.query("evidenceRecords").take(100);
    const fitness = await ctx.db.query("botFitnessRecords").take(100);
    const learning = await ctx.db.query("learningEvents").take(50);

    return {
      strategies,
      versions: versions.map((v) => ({
        ...v,
        evidence: evidence.find((e) => e.strategyVersionId === v.strategyVersionId) ?? null,
        fitness: fitness.find((f) => f.strategyVersionId === v.strategyVersionId) ?? null,
      })),
      learningEvents: learning,
    };
  },
});

export const validation = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const runs = (await ctx.db.query("validationRuns").take(50)).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const evidence = await ctx.db.query("evidenceRecords").take(50);
    const fitness = await ctx.db.query("botFitnessRecords").take(50);

    return {
      runs,
      evidence,
      fitness,
    };
  },
});

export const risk = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const policies = await ctx.db.query("riskPolicies").take(20);
    const decisions = (await ctx.db.query("riskDecisions").take(50)).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const state = await ctx.db.query("systemState").first();
    return { policies, decisions, systemState: state ?? null };
  },
});

export const execution = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const authorizations = await ctx.db.query("executionAuthorizations").take(50);
    const orders = (await ctx.db.query("orders").take(100)).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const positions = await ctx.db.query("positions").take(50);
    const monitoring = await ctx.db.query("monitoringEvents").take(50);
    return { authorizations, orders, positions, monitoring };
  },
});

export const agents = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const agents = await ctx.db.query("agents").take(50);
    const learning = (await ctx.db.query("learningEvents").take(50)).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    return { agents, learningEvents: learning };
  },
});

export const audit = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("auditEvents").take(250);
    const sorted = rows
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(
        (r): AuditRecord => ({
          sequence: r.sequence,
          at: r.at,
          actor: r.actor,
          actorType: r.actorType,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          outcome: r.outcome,
          correlationId: r.correlationId,
          detail: r.detail,
          prevHash: r.prevHash,
          hash: r.hash,
        }),
      );
    return { events: sorted.slice().reverse(), chain: verifyAuditChain(sorted) };
  },
});
