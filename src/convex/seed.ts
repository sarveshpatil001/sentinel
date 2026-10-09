/**
 * SENTINEL PRIME — DETERMINISTIC SEED
 *
 * Idempotent: runs at most once. All generated market data is SYNTHETIC and
 * produced by a seeded PRNG so it is reproducible (Section 18). It is labeled
 * with its synthetic source in every record — it is never presented as real
 * market data.
 *
 * The seed deliberately includes data-defect scenarios so the data-quality
 * engine has real states to classify (FAILED != EMPTY, MISSING != ZERO):
 *   - BTC/USD  : clean series                    -> VALID
 *   - ETH/USD  : 3-candle gap                    -> INCOMPLETE
 *   - EUR/USD  : gap + OHLC violations + duplicate (provider DEGRADED) -> INVALID
 */

import { mutation } from "./_generated/server";
import { MutationCtx, appendAudit } from "./lib/store";
import { validateCandles } from "./lib/dataQuality";
import { CostModel, StrategyDefinition, ValidationConfig } from "./lib/backtest";
import { runValidationPipeline, SnapshotBinding } from "./lib/pipeline";
import { verifyAuditChain } from "./lib/audit";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible synthetic data.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3600_000;
const TIMEFRAME = "1h";
const PAPER_EQUITY_BASE = 100000;

interface MarketSpec {
  marketId: string;
  symbol: string;
  assetClass: "CRYPTO" | "FOREX";
  venue: string;
  provider: string;
  baseAsset: string;
  quoteAsset: string;
  providerState: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  seed: number;
  startPrice: number;
  drift: number;
  vol: number;
  bars: number;
  defects: ("gap_small" | "gap_large" | "ohlc_violation" | "duplicate")[];
}

const MARKET_SPECS: MarketSpec[] = [
  {
    marketId: "MKT-BTCUSD-SIM",
    symbol: "BTC/USD",
    assetClass: "CRYPTO",
    venue: "SIM-VENUE-CRYPTO",
    provider: "SIM-CRYPTO-PROVIDER",
    baseAsset: "BTC",
    quoteAsset: "USD",
    providerState: "AVAILABLE",
    seed: 1337,
    startPrice: 62000,
    drift: 0.0006,
    vol: 0.007,
    bars: 1000,
    defects: [],
  },
  {
    marketId: "MKT-ETHUSD-SIM",
    symbol: "ETH/USD",
    assetClass: "CRYPTO",
    venue: "SIM-VENUE-CRYPTO",
    provider: "SIM-CRYPTO-PROVIDER",
    baseAsset: "ETH",
    quoteAsset: "USD",
    providerState: "AVAILABLE",
    seed: 9001,
    startPrice: 3100,
    drift: 0.0003,
    vol: 0.009,
    bars: 1000,
    defects: ["gap_small"],
  },
  {
    marketId: "MKT-EURUSD-SIM",
    symbol: "EUR/USD",
    assetClass: "FOREX",
    venue: "SIM-VENUE-FX",
    provider: "SIM-FX-PROVIDER",
    baseAsset: "EUR",
    quoteAsset: "USD",
    providerState: "DEGRADED",
    seed: 4242,
    startPrice: 1.085,
    drift: 0.0,
    vol: 0.0012,
    bars: 1000,
    defects: ["gap_large", "ohlc_violation", "duplicate"],
  },
];

function generateCandles(spec: MarketSpec, endTime: number) {
  const rand = mulberry32(spec.seed);
  const rows: {
    eventTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];
  let price = spec.startPrice;
  for (let i = 0; i < spec.bars; i++) {
    // Only FULLY CLOSED bars are generated: the bar opening at `endTime` is
    // still forming and is therefore not knowable — it is never included.
    const eventTime = endTime - (spec.bars - i) * HOUR - HOUR;
    const open = price;
    const shock = (rand() - 0.5) * 2 * spec.vol + spec.drift;
    const close = open * (1 + shock);
    const wick = open * spec.vol * (0.4 + rand() * 0.8);
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    const volume = 100 + rand() * 900;
    rows.push({ eventTime, open, high, low, close, volume });
    price = close;
  }

  // --- Deliberate, documented defect scenarios ---------------------------
  let out = [...rows];
  if (spec.defects.includes("gap_small")) {
    out = out.filter((_, i) => i < 420 || i > 422); // 3 missing candles
  }
  if (spec.defects.includes("gap_large")) {
    out = out.filter((_, i) => i < 300 || i > 311); // 12 missing candles
  }
  if (spec.defects.includes("ohlc_violation")) {
    // high below close — violates HIGH >= CLOSE. NOT corrected, NOT repaired.
    const target = out[200];
    out[200] = { ...target, high: target.low * 0.999 };
    const target2 = out[260];
    out[260] = { ...target2, low: target2.high * 1.001 };
  }
  if (spec.defects.includes("duplicate")) {
    // Conflicting duplicate — both rows preserved, never merged/selected.
    const dup = out[150];
    out.splice(151, 0, { ...dup, close: dup.close * 1.002, high: dup.high * 1.002 });
  }

  return out.map((r) => ({
    eventTime: r.eventTime,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    providerTimestamp: r.eventTime + HOUR,
    receivedTime: r.eventTime + HOUR,
    // A bar becomes knowable exactly at its close (event_time + timeframe).
    availabilityTime: r.eventTime + HOUR,
    source: `synthetic-seeded:${spec.provider}:${spec.symbol}`,
  }));
}

// ---------------------------------------------------------------------------
// Canonical agent registry (Section 05) with DENY-BY-DEFAULT scoping.
// ---------------------------------------------------------------------------
interface AgentSpec {
  agentKey: string;
  agentName: string;
  agentType: string;
  ownerDomain: string;
  description: string;
  allowedTools: string[];
  allowedData: string[];
  isDeterministic: boolean;
}

const AI_AGENTS: AgentSpec[] = [
  ["data-agent", "Data Agent", "MARKET_INTELLIGENCE", "Market Data", "Observes provider feeds and classifies data quality.", ["read_market_data"], ["market_data", "data_quality"]],
  ["chart-agent", "Chart Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Reads chart structure and price action.", ["read_market_data", "read_indicators"], ["market_data", "indicators"]],
  ["news-agent", "News Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Summarizes news as untrusted external text.", ["read_news"], ["news"]],
  ["macro-agent", "Macro Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Tracks macro context.", ["read_macro"], ["macro"]],
  ["crypto-agent", "Crypto Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Crypto-specific intelligence.", ["read_market_data"], ["market_data", "crypto_metrics"]],
  ["forex-agent", "Forex Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Forex-specific intelligence.", ["read_market_data"], ["market_data", "fx_metrics"]],
  ["liquidity-agent", "Liquidity Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Observes liquidity and depth.", ["read_market_data"], ["order_book", "spread"]],
  ["sentiment-agent", "Sentiment Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Sentiment signals with source-quality caveats.", ["read_news"], ["news", "sentiment"]],
  ["correlation-agent", "Correlation Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Cross-market correlation observations.", ["read_market_data"], ["market_data"]],
  ["regime-agent", "Regime Agent", "MARKET_INTELLIGENCE", "Market Intelligence", "Market regime interpretation.", ["read_indicators"], ["indicators", "market_data"]],
  ["mind-agent", "Mind Agent", "STRATEGY", "Strategy Engine", "Forms market understanding and hypotheses.", ["read_market_data", "read_indicators", "read_validation"], ["market_data", "indicators", "validation"]],
  ["strategy-builder-agent", "Strategy Builder Agent", "STRATEGY", "Strategy Engine", "Proposes structured strategy versions. Never deploys or executes.", ["propose_strategy_version"], ["validation", "evidence"]],
  ["evidence-agent", "Evidence Agent", "TRUST_VALIDATION", "Validation Engine", "Interprets deterministic evidence. Cannot upgrade it.", ["read_validation", "read_evidence"], ["validation", "evidence"]],
  ["bot-fitness-agent", "Bot Fitness Agent", "TRUST_VALIDATION", "Validation Engine", "Interprets segmented fitness results.", ["read_validation", "read_fitness"], ["validation", "fitness"]],
  ["risk-agent", "Risk Agent", "TRADING_CONTROL", "Risk Engine", "Recommends risk actions. NOT final authority.", ["read_risk", "recommend_risk_action"], ["risk", "market_data"]],
  ["monitoring-agent", "Monitoring Agent", "TRADING_CONTROL", "Monitoring Engine", "Observes trade/market/thesis health and recommends.", ["read_monitoring", "recommend_action"], ["monitoring", "market_data"]],
  ["learning-agent", "Learning Agent", "LEARNING", "Learning Engine", "Analyzes outcomes and proposes candidate versions.", ["read_trades", "propose_strategy_version"], ["trades", "validation"]],
].map(([agentKey, agentName, agentType, ownerDomain, description, allowedTools, allowedData]) => ({
  agentKey: agentKey as string,
  agentName: agentName as string,
  agentType: agentType as string,
  ownerDomain: ownerDomain as string,
  description: description as string,
  allowedTools: allowedTools as string[],
  allowedData: allowedData as string[],
  isDeterministic: false,
}));

const DETERMINISTIC_COMPONENTS: AgentSpec[] = [
  ["quant-engine", "Quant Engine", "DETERMINISTIC", "Quantitative Engine", "Deterministic indicators and statistics.", ["compute_indicators"], ["market_data"]],
  ["deterministic-risk-engine", "Deterministic Risk Engine", "DETERMINISTIC", "Risk Engine", "Evaluates proposals against versioned policy.", ["evaluate_risk"], ["risk", "market_data"]],
  ["deterministic-risk-veto", "Deterministic Risk Veto", "DETERMINISTIC", "Risk Engine", "Final authority. Fails closed.", ["veto"], ["risk"]],
  ["execution-engine", "Execution Engine", "DETERMINISTIC", "Execution Engine", "Executes authorized intents only.", ["submit_order", "cancel_order"], ["orders", "authorizations"]],
  ["reconciliation-engine", "Reconciliation Engine", "DETERMINISTIC", "Execution Engine", "Authoritative for external state.", ["reconcile"], ["orders", "positions", "balances"]],
].map(([agentKey, agentName, agentType, ownerDomain, description, allowedTools, allowedData]) => ({
  agentKey: agentKey as string,
  agentName: agentName as string,
  agentType: agentType as string,
  ownerDomain: ownerDomain as string,
  description: description as string,
  allowedTools: allowedTools as string[],
  allowedData: allowedData as string[],
  isDeterministic: true,
}));

const FORBIDDEN_FOR_ALL = [
  "submit_orders_unauthorized",
  "modify_balances",
  "modify_positions",
  "bypass_risk",
  "change_risk_limits",
  "modify_audit_history",
  "mark_failed_data_valid",
  "fabricate_quantitative_results",
  "self_approve",
  "self_validate",
  "modify_live_strategy",
  "access_credentials",
  "execute_arbitrary_code",
];

const CONTROLLED_LIVE_GATES = [
  "authentication", "authorization", "security", "strategy_eligibility", "validation",
  "evidence", "fitness", "risk", "risk_veto", "execution_authorization", "execution",
  "reconciliation", "monitoring", "audit", "recovery", "credential_isolation",
  "agent_isolation", "ai_safety", "environment_isolation", "kill_switch",
].map((gate) => ({
  gate,
  satisfied: false,
  note:
    gate === "environment_isolation" || gate === "kill_switch"
      ? "Implemented in this build; NOT VERIFIED to production standard — readiness review required."
      : "NOT VERIFIED in this environment — controlled-live readiness review required.",
}));

export const seed = mutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const existing = await ctx.db.query("systemState").first();
    if (existing) {
      return { alreadySeeded: true as const };
    }

    const now = Date.now();
    const endTime = Math.floor(now / HOUR) * HOUR;

    // ---- System state: PAPER mode, live disabled, no auto-resume ----------
    await ctx.db.insert("systemState", {
      key: "global",
      mode: "PAPER",
      killSwitchEngaged: false,
      liveAutoResume: false,
      environment: "PAPER",
      // Server-side test/demo configuration of the SIMULATED provider adapter.
      simulatedProviderBehavior: "ACK" as const,
      // Risk accounting state (maintained at fill time from here on).
      peakEquity: PAPER_EQUITY_BASE,
      controlledLiveGates: CONTROLLED_LIVE_GATES,
      updatedAt: now,
    });

    await appendAudit(
      ctx,
      {
        actor: "system:seed",
        actorType: "SERVICE",
        action: "SYSTEM_INITIALIZED",
        resourceType: "systemState",
        resourceId: "global",
        outcome: "SUCCESS",
        correlationId: `seed-${now}`,
        detail: "Sentinel Prime initialized in PAPER mode. Controlled live disabled. No automatic live activation or resume.",
      },
      now,
    );

    // ---- Markets + candles + data quality --------------------------------
    const qualitySummary: { marketId: string; state: "VALID" | "INCOMPLETE" | "STALE" | "MISSING" | "INVALID" | "FAILED" }[] = [];

    for (const spec of MARKET_SPECS) {
      await ctx.db.insert("markets", {
        marketId: spec.marketId,
        symbol: spec.symbol,
        assetClass: spec.assetClass,
        venue: spec.venue,
        provider: spec.provider,
        baseAsset: spec.baseAsset,
        quoteAsset: spec.quoteAsset,
        timezone: "UTC",
        status: "OPEN",
        providerState: spec.providerState,
      });

      const candles = generateCandles(spec, endTime);
      for (const c of candles) {
        await ctx.db.insert("candles", {
          marketId: spec.marketId,
          symbol: spec.symbol,
          assetClass: spec.assetClass,
          venue: spec.venue,
          timeframe: TIMEFRAME,
          eventTime: c.eventTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          source: c.source,
          providerTimestamp: c.providerTimestamp,
          receivedTime: c.receivedTime,
          availabilityTime: c.availabilityTime,
          qualityStatus: "VALID",
        });
      }

      const report = validateCandles(candles, {
        marketId: spec.marketId,
        symbol: spec.symbol,
        timeframe: TIMEFRAME,
        timeframeMs: HOUR,
        now: endTime,
        staleAfterMs: 2 * HOUR,
        providerState: spec.providerState,
      });

      await ctx.db.insert("dataQualityReports", {
        marketId: spec.marketId,
        symbol: spec.symbol,
        timeframe: TIMEFRAME,
        state: report.state,
        checks: report.checks,
        counts: report.counts,
        generatedAt: now,
      });

      qualitySummary.push({ marketId: spec.marketId, state: report.state });
      await appendAudit(
        ctx,
        {
          actor: "system:seed",
          actorType: "SERVICE",
          action: "DATA_QUALITY_CLASSIFIED",
          resourceType: "market",
          resourceId: spec.marketId,
          outcome: report.state === "VALID" ? "SUCCESS" : "DEGRADED",
          correlationId: `seed-${now}`,
          detail: `${spec.symbol} classified ${report.state} (provider ${spec.providerState}). No values fabricated or repaired.`,
        },
        now,
      );
    }

    // Snapshot range is derived from the ACTUAL generated series (first bar
    // opens at endTime - (bars + 1)h): the recorded snapshot must contain the
    // data it names — binding is verified on every validation run.
    await ctx.db.insert("dataSnapshots", {
      snapshotId: "SNAP-SEED-0001",
      marketIds: MARKET_SPECS.map((s) => s.marketId),
      timeframe: TIMEFRAME,
      rangeStart: endTime - (MARKET_SPECS[0].bars + 1) * HOUR,
      rangeEnd: endTime,
      dataVersion: "synthetic-seeded-v1",
      qualitySummary,
      revision: 1,
      createdAt: now,
    });

    const seedSnapshot: SnapshotBinding = {
      snapshotId: "SNAP-SEED-0001",
      marketIds: MARKET_SPECS.map((s) => s.marketId),
      timeframe: TIMEFRAME,
      rangeStart: endTime - (MARKET_SPECS[0].bars + 1) * HOUR,
      rangeEnd: endTime,
      dataVersion: "synthetic-seeded-v1",
    };

    // ---- Risk policy (PROVISIONAL — numerics await ADR ratification) -----
    await ctx.db.insert("riskPolicies", {
      policyId: "RISK-POLICY-CORE",
      version: 1,
      status: "PROVISIONAL",
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
      createdAt: now,
    });

    // ---- Strategies + IMMUTABLE versions --------------------------------
    await ctx.db.insert("strategies", {
      strategyId: "STRAT-EMA-MOMENTUM",
      name: "Adaptive EMA Momentum",
      description:
        "Structured EMA-crossover momentum with RSI no-trade filter, ATR-context exits and fixed-fraction sizing. Structured definition only — no executable trading code.",
      marketId: "MKT-BTCUSD-SIM",
      timeframe: TIMEFRAME,
      createdAt: now,
    });

    const btcDefinition: StrategyDefinition = {
      marketId: "MKT-BTCUSD-SIM",
      symbol: "BTC/USD",
      timeframe: TIMEFRAME,
      entry: { indicator: "ema_cross", fast: 5, slow: 13 },
      exit: { stopLossPct: 0.02, takeProfitPct: 0.045, timeExitBars: 36 },
      filters: { rsiMin: 45, rsiMax: 85 },
      sizing: { kind: "fixed_fraction", fraction: 0.25 },
    };

    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-EMA-MOMENTUM-V1",
      strategyId: "STRAT-EMA-MOMENTUM",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: btcDefinition,
      provenance: {
        authorType: "AI",
        authorRef: "strategy-builder-agent",
        rationale:
          "Hypothesis: BTC/USD 1h exhibits momentum continuation after fast/slow EMA confirmation when RSI is not exhausted. Proposed as a structured definition for deterministic validation.",
        modelProvider: "NOT_CONFIGURED",
        modelVersion: "NOT_CONFIGURED",
        promptConfigVersion: "NOT_CONFIGURED",
        createdAt: now,
      },
    });

    await ctx.db.insert("strategies", {
      strategyId: "STRAT-RSI-REVERSION",
      name: "FX RSI Reversion",
      description:
        "Structured mean-reversion candidate on EUR/USD 1h. Included to exercise the data-quality gate against a defective feed.",
      marketId: "MKT-EURUSD-SIM",
      timeframe: TIMEFRAME,
      createdAt: now,
    });

    const eurDefinition: StrategyDefinition = {
      marketId: "MKT-EURUSD-SIM",
      symbol: "EUR/USD",
      timeframe: TIMEFRAME,
      entry: { indicator: "ema_cross", fast: 5, slow: 15 },
      exit: { stopLossPct: 0.004, takeProfitPct: 0.006, timeExitBars: 24 },
      filters: { rsiMin: 20, rsiMax: 60 },
      sizing: { kind: "fixed_fraction", fraction: 0.1 },
    };

    await ctx.db.insert("strategyVersions", {
      strategyVersionId: "SV-RSI-REVERSION-V1",
      strategyId: "STRAT-RSI-REVERSION",
      version: 1,
      status: "VERSION",
      immutable: true,
      definition: eurDefinition,
      provenance: {
        authorType: "AI",
        authorRef: "strategy-builder-agent",
        rationale:
          "Hypothesis: EUR/USD 1h mean-reverts after short-horizon EMA dislocations. Requires clean FX data before any evidence can exist.",
        modelProvider: "NOT_CONFIGURED",
        modelVersion: "NOT_CONFIGURED",
        promptConfigVersion: "NOT_CONFIGURED",
        createdAt: now,
      },
    });

    // ---- Agents ----------------------------------------------------------
    for (const a of [...AI_AGENTS, ...DETERMINISTIC_COMPONENTS]) {
      await ctx.db.insert("agents", {
        ...a,
        agentVersion: "1.0.0",
        contractVersion: "sp-agent-contract-1.0.0",
        modelPolicy: a.isDeterministic
          ? "none (deterministic component)"
          : "ai-gateway-not-configured (SPEC-GAP-006): agents are registered and scoped but report UNAVAILABLE — no fabricated outputs",
        forbiddenActions: FORBIDDEN_FOR_ALL,
        state: a.isDeterministic ? "COMPLETED" : "UNAVAILABLE",
      });
    }

    await appendAudit(
      ctx,
      {
        actor: "system:seed",
        actorType: "SERVICE",
        action: "AGENTS_REGISTERED",
        resourceType: "agents",
        resourceId: "canonical-registry",
        outcome: "SUCCESS",
        correlationId: `seed-${now}`,
        detail: "22 canonical agents/components registered with deny-by-default scoping. No agent holds execution credentials or unrestricted data access.",
      },
      now,
    );

    // ---- Baseline validations (deterministic, computed here) -------------
    const validationConfig: ValidationConfig = {
      // DECLARED split — the constitution forbids inventing split percentages.
      // This value is flagged SPEC-GAP-004 for ADR ratification.
      oosSplitFraction: 0.3,
      startingEquity: 100000,
      periodsPerYear: 24 * 365,
    };
    const cost: CostModel = {
      kind: "percentage",
      version: "sp-cost-1.0.0",
      feeRate: 0.001,
      slippageBps: 5,
    };

    const btcCandles = (await ctx.db
      .query("candles")
      .withIndex("by_market_tf_time", (q) =>
        q.eq("marketId", "MKT-BTCUSD-SIM").eq("timeframe", TIMEFRAME),
      )
      .take(1000))
      .map((c) => ({
        eventTime: c.eventTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        availabilityTime: c.availabilityTime,
        marketId: c.marketId,
        timeframe: c.timeframe,
      }));

    const btcQualityRow = await ctx.db
      .query("dataQualityReports")
      .withIndex("by_market", (q) => q.eq("marketId", "MKT-BTCUSD-SIM"))
      .first();

    const btcRun = runValidationPipeline({
      validationId: "VAL-SEED-BTC-V1",
      strategyVersionId: "SV-EMA-MOMENTUM-V1",
      dataSnapshotId: "SNAP-SEED-0001",
      definition: btcDefinition,
      config: validationConfig,
      cost,
      snapshot: seedSnapshot,
      candles: btcCandles,
      quality: {
        state: btcQualityRow!.state,
        checks: btcQualityRow!.checks,
        counts: btcQualityRow!.counts,
      },
      marketMeta: {
        marketId: "MKT-BTCUSD-SIM",
        symbol: "BTC/USD",
        timeframe: TIMEFRAME,
        assetClass: "CRYPTO",
        spreadBps: 2,
        liquidityNote: "Synthetic venue; no book-depth feed",
      },
    });

    await ctx.db.insert("validationRuns", {
      validationId: "VAL-SEED-BTC-V1",
      strategyVersionId: "SV-EMA-MOMENTUM-V1",
      dataSnapshotId: "SNAP-SEED-0001",
      validationConfigVersion: "sp-vconfig-1.0.0",
      engineVersion: "sp-sim-1.0.0",
      featureVersion: "sp-features-1.0.0",
      costModelVersion: "sp-cost-1.0.0",
      executionModelVersion: "sp-exec-nextopen-conservative-1.0.0",
      state: btcRun.state,
      integrity: btcRun.integrity,
      leakageState: btcRun.leakageState,
      metrics: btcRun.metrics,
      stress: btcRun.stress,
      oos: btcRun.oos,
      createdAt: now,
      completedAt: now,
    });

    if (btcRun.evidence) {
      await ctx.db.insert("evidenceRecords", {
        evidenceId: "EV-SEED-BTC-V1",
        validationId: "VAL-SEED-BTC-V1",
        strategyVersionId: "SV-EMA-MOMENTUM-V1",
        level: btcRun.evidence.level,
        rubricVersion: btcRun.evidence.rubricVersion,
        factors: btcRun.evidence.factors,
        rationale: btcRun.evidence.rationale,
        createdAt: now,
      });
    }
    if (btcRun.fitness) {
      await ctx.db.insert("botFitnessRecords", {
        fitnessId: "FIT-SEED-BTC-V1",
        strategyVersionId: "SV-EMA-MOMENTUM-V1",
        dimensions: btcRun.fitness.dimensions,
        verdict: btcRun.fitness.verdict,
        createdAt: now,
      });
    }

    // Data-quality gate demo for the defective FX feed (BLOCKED, no metrics).
    const eurQualityRow = await ctx.db
      .query("dataQualityReports")
      .withIndex("by_market", (q) => q.eq("marketId", "MKT-EURUSD-SIM"))
      .first();
    const eurRun = runValidationPipeline({
      validationId: "VAL-SEED-EUR-V1",
      strategyVersionId: "SV-RSI-REVERSION-V1",
      dataSnapshotId: "SNAP-SEED-0001",
      definition: eurDefinition,
      config: validationConfig,
      cost,
      snapshot: seedSnapshot,
      candles: [],
      quality: {
        state: eurQualityRow!.state,
        checks: eurQualityRow!.checks,
        counts: eurQualityRow!.counts,
      },
      marketMeta: {
        marketId: "MKT-EURUSD-SIM",
        symbol: "EUR/USD",
        timeframe: TIMEFRAME,
        assetClass: "FOREX",
        spreadBps: 8,
        liquidityNote: "Synthetic venue; no book-depth feed",
      },
    });

    await ctx.db.insert("validationRuns", {
      validationId: "VAL-SEED-EUR-V1",
      strategyVersionId: "SV-RSI-REVERSION-V1",
      dataSnapshotId: "SNAP-SEED-0001",
      validationConfigVersion: "sp-vconfig-1.0.0",
      engineVersion: "sp-sim-1.0.0",
      featureVersion: "sp-features-1.0.0",
      costModelVersion: "sp-cost-1.0.0",
      executionModelVersion: "sp-exec-nextopen-conservative-1.0.0",
      state: eurRun.state,
      integrity: eurRun.integrity,
      leakageState: eurRun.leakageState,
      metrics: eurRun.metrics,
      stress: eurRun.stress,
      oos: eurRun.oos,
      createdAt: now,
      completedAt: now,
    });

    await appendAudit(
      ctx,
      {
        actor: "system:seed",
        actorType: "SERVICE",
        action: "VALIDATION_COMPLETED",
        resourceType: "validationRun",
        resourceId: "VAL-SEED-BTC-V1",
        outcome: "SUCCESS",
        correlationId: `seed-${now}`,
        detail: `Deterministic validation of SV-EMA-MOMENTUM-V1 on SNAP-SEED-0001 completed with evidence ${btcRun.evidence?.level ?? "INSUFFICIENT"}. Results tied to snapshot; reproducible from seed.`,
      },
      now,
    );

    // ---- Seeded PAPER ledger: one FILLED order, one reconciled UNKNOWN ----
    // The authorizations these orders consumed are recorded too — referential
    // integrity is part of the truth the database must preserve.
    for (const seedAuth of [
      { id: "AUTH-SEED-0001", orderId: "ORD-SEED-0001", marketId: "MKT-BTCUSD-SIM", side: "BUY", quantity: 0.25, issuedAt: now - 7200_000 },
      { id: "AUTH-SEED-0002", orderId: "ORD-SEED-0002", marketId: "MKT-ETHUSD-SIM", side: "BUY", quantity: 1.5, issuedAt: now - 3600_000 },
    ] as const) {
      await ctx.db.insert("executionAuthorizations", {
        authorizationId: seedAuth.id,
        riskDecisionId: `RISK-${seedAuth.id}`,
        proposalId: `PROP-${seedAuth.id}`,
        scope: {
          account: "PAPER:paper-account",
          strategyVersionId: "SV-EMA-MOMENTUM-V1",
          marketId: seedAuth.marketId,
          side: seedAuth.side,
          quantity: seedAuth.quantity,
          orderType: seedAuth.orderId === "ORD-SEED-0001" ? "MARKET" : "LIMIT",
          timeInForce: "GTC",
          riskPolicyRef: "RISK-POLICY-CORE@v1 (PROVISIONAL)",
          mode: "PAPER" as const,
          expiresAt: seedAuth.issuedAt + 15 * 60_000,
        },
        state: "CONSUMED" as const,
        issuedAt: seedAuth.issuedAt,
        consumedByOrderId: seedAuth.orderId,
      });
    }

    await ctx.db.insert("orders", {
      orderId: "ORD-SEED-0001",
      idempotencyKey: "seed-order-0001",
      authorizationId: "AUTH-SEED-0001",
      proposalId: "PROP-SEED-0001",
      strategyVersionId: "SV-EMA-MOMENTUM-V1",
      marketId: "MKT-BTCUSD-SIM",
      symbol: "BTC/USD",
      side: "BUY",
      quantity: 0.25,
      orderType: "MARKET",
      timeInForce: "GTC",
      mode: "PAPER",
      state: "FILLED",
      providerOrderId: "SIM-PROV-1001",
      providerTruth: "ACCEPTED",
      fillPrice: 62150.25,
      fillQuantity: 0.25,
      fees: 15.54,
      slippage: 7.77,
      history: [
        { state: "CREATED", at: now - 7200_000, note: "Order intent created from approved authorization." },
        { state: "VALIDATING", at: now - 7200_000 + 10, note: "Prechecks passed (paper mode, simulated provider)." },
        { state: "AUTHORIZED", at: now - 7200_000 + 20, note: "Authorization scope validated." },
        { state: "SUBMITTING", at: now - 7200_000 + 30, note: "Submitted to SIM-CRYPTO-PROVIDER." },
        { state: "SUBMITTED", at: now - 7200_000 + 40, note: "Provider accepted." },
        { state: "ACKNOWLEDGED", at: now - 7200_000 + 50, note: "Provider acknowledged." },
        { state: "FILLED", at: now - 7200_000 + 60, note: "Filled 0.25 @ 62150.25 (simulated)." },
      ],
      createdAt: now - 7200_000,
      updatedAt: now - 7200_000 + 60,
    });

    await ctx.db.insert("positions", {
      positionId: "POS-SEED-BTC",
      account: "PAPER:paper-account",
      marketId: "MKT-BTCUSD-SIM",
      symbol: "BTC/USD",
      side: "LONG",
      quantity: 0.25,
      avgEntryPrice: 62150.25,
      realizedPnl: 420.5,
      source: "PAPER",
      updatedAt: now - 7200_000 + 60,
    });

    await ctx.db.insert("orders", {
      orderId: "ORD-SEED-0002",
      idempotencyKey: "seed-order-0002",
      authorizationId: "AUTH-SEED-0002",
      proposalId: "PROP-SEED-0002",
      strategyVersionId: "SV-EMA-MOMENTUM-V1",
      marketId: "MKT-ETHUSD-SIM",
      symbol: "ETH/USD",
      side: "BUY",
      quantity: 1.5,
      orderType: "LIMIT",
      timeInForce: "GTC",
      mode: "PAPER",
      state: "ACKNOWLEDGED",
      providerOrderId: "SIM-PROV-1002",
      providerTruth: "ACCEPTED",
      history: [
        { state: "CREATED", at: now - 3600_000, note: "Order intent created from approved authorization." },
        { state: "VALIDATING", at: now - 3600_000 + 10, note: "Prechecks passed." },
        { state: "AUTHORIZED", at: now - 3600_000 + 20, note: "Authorization scope validated." },
        { state: "SUBMITTING", at: now - 3600_000 + 30, note: "Submitted to SIM-CRYPTO-PROVIDER." },
        { state: "UNKNOWN", at: now - 3600_000 + 90000, note: "Provider timeout after possible submission. ORDER = UNKNOWN — not assumed failed, not retried." },
        { state: "ACKNOWLEDGED", at: now - 3600_000 + 120000, note: "RECONCILIATION resolved state against provider ledger: ACCEPTED." },
      ],
      createdAt: now - 3600_000,
      updatedAt: now - 3600_000 + 120000,
    });

    await ctx.db.insert("monitoringEvents", {
      monitorId: "MON-SEED-0001",
      scope: "order",
      scopeId: "ORD-SEED-0002",
      state: "WARNING",
      observation:
        "Submission experienced provider timeout (UNKNOWN). Reconciliation resolved it to ACKNOWLEDGED. Blind retry was correctly prevented.",
      recommendation: "Watch provider SIM-CRYPTO-PROVIDER latency; escalate to incident if timeouts repeat.",
      createdAt: now - 3600_000 + 120000,
    });

    await appendAudit(
      ctx,
      {
        actor: "system:seed",
        actorType: "SERVICE",
        action: "RECONCILIATION_COMPLETED",
        resourceType: "order",
        resourceId: "ORD-SEED-0002",
        outcome: "SUCCESS",
        correlationId: `seed-${now}`,
        detail: "UNKNOWN order reconciled against provider ledger (ACCEPTED). No duplicate submission occurred.",
      },
      now,
    );

    // ---- Learning isolation demo ----------------------------------------
    await ctx.db.insert("learningEvents", {
      learningEventId: "LEARN-SEED-0001",
      sourceOrderId: "ORD-SEED-0001",
      failureClass: "REGIME_FAILURE",
      analysis:
        "Post-trade analysis: the entry followed a momentum regime that decayed within 12 bars. Outcome is consistent with regime transition rather than execution error.",          hypothesis:
        "A faster EMA confirmation with a tighter time exit may perform better in decaying-momentum regimes.",
      liveMutationAttempted: false,
      createdAt: now - 1800_000,
    });

    await appendAudit(
      ctx,
      {
        actor: "system:seed",
        actorType: "SERVICE",
        action: "LEARNING_EVENT_RECORDED",
        resourceType: "learningEvent",
        resourceId: "LEARN-SEED-0001",
        outcome: "SUCCESS",
        correlationId: `seed-${now}`,
        detail: "Learning recorded. Live strategy NOT modified (learning -> live mutation path does not exist).",
      },
      now,
    );

    // ---- Audit chain self-verification ----------------------------------
    const auditRows = await ctx.db.query("auditEvents").take(100);
    const chain = verifyAuditChain(
      auditRows
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((r) => ({
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
        })),
    );

    return {
      alreadySeeded: false as const,
      markets: MARKET_SPECS.length,
      candles: MARKET_SPECS.reduce((a, s) => a + s.bars, 0),
      btcEvidence: btcRun.evidence?.level ?? "INSUFFICIENT",
      eurValidationState: eurRun.state,
      auditChainValid: chain.valid,
    };
  },
});
