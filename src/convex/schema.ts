import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// ---------------------------------------------------------------------------
// SENTINEL PRIME DOMAIN ENUMS (deterministic vocabulary — Section 02/06/11)
// ---------------------------------------------------------------------------

export const marketModeValidator = v.union(
  v.literal("RESEARCH"),
  v.literal("BACKTEST"),
  v.literal("OUT_OF_SAMPLE"),
  v.literal("PAPER"),
  v.literal("DEMO"),
  v.literal("CONTROLLED_LIVE"),
  v.literal("DISABLED"),
);

export const dataQualityStateValidator = v.union(
  v.literal("VALID"),
  v.literal("INCOMPLETE"),
  v.literal("STALE"),
  v.literal("MISSING"),
  v.literal("INVALID"),
  v.literal("FAILED"),
);

export const checkStatusValidator = v.union(
  v.literal("PASS"),
  v.literal("FAIL"),
  v.literal("UNKNOWN"),
);

export const assetClassValidator = v.union(
  v.literal("CRYPTO"),
  v.literal("FOREX"),
);

export const providerStateValidator = v.union(
  v.literal("AVAILABLE"),
  v.literal("DEGRADED"),
  v.literal("UNAVAILABLE"),
);

export const candleStateValidator = v.union(
  v.literal("OPEN"),
  v.literal("PARTIALLY_FORMED"),
  v.literal("CLOSED"),
);

export const validationStateValidator = v.union(
  v.literal("QUEUED"),
  v.literal("RUNNING"),
  v.literal("COMPLETED"),
  v.literal("FAILED"),
  v.literal("BLOCKED"),
  v.literal("CANCELLED"),
  v.literal("INSUFFICIENT_DATA"),
);

export const leakageStateValidator = v.union(
  v.literal("NO_LEAKAGE_DETECTED"),
  v.literal("POSSIBLE_LEAKAGE"),
  v.literal("CONFIRMED_LEAKAGE"),
  v.literal("NOT_ASSESSABLE"),
);

export const evidenceLevelValidator = v.union(
  v.literal("STRONG"),
  v.literal("MODERATE"),
  v.literal("WEAK"),
  v.literal("INSUFFICIENT"),
);

export const strategyStatusValidator = v.union(
  v.literal("HYPOTHESIS"),
  v.literal("PROPOSAL"),
  v.literal("VERSION"),
  v.literal("VALIDATION"),
  v.literal("APPROVED"),
  v.literal("DEPLOYMENT_ELIGIBLE"),
  v.literal("MONITORING"),
  v.literal("RETIRED"),
);

export const riskOutcomeValidator = v.union(
  v.literal("APPROVE"),
  v.literal("BLOCK"),
  v.literal("UNKNOWN"),
);

export const authorizationStateValidator = v.union(
  v.literal("APPROVED"),
  v.literal("EXPIRED"),
  v.literal("REVOKED"),
  v.literal("CONSUMED"),
);

export const orderStateValidator = v.union(
  v.literal("CREATED"),
  v.literal("VALIDATING"),
  v.literal("AUTHORIZED"),
  v.literal("READY"),
  v.literal("SUBMITTING"),
  v.literal("SUBMITTED"),
  v.literal("ACKNOWLEDGED"),
  v.literal("PARTIALLY_FILLED"),
  v.literal("FILLED"),
  v.literal("REJECTED"),
  v.literal("CANCELLED"),
  v.literal("EXPIRED"),
  v.literal("UNKNOWN"),
);

export const agentStateValidator = v.union(
  v.literal("QUEUED"),
  v.literal("RUNNING"),
  v.literal("COMPLETED"),
  v.literal("FAILED"),
  v.literal("TIMEOUT"),
  v.literal("UNAVAILABLE"),
  v.literal("CANCELLED"),
);

export const monitoringStateValidator = v.union(
  v.literal("ON_TRACK"),
  v.literal("WARNING"),
  v.literal("FAILING"),
);

export const dataLabelValidator = v.union(
  v.literal("LIVE"),
  v.literal("CACHED"),
  v.literal("STALE"),
  v.literal("SIMULATED"),
  v.literal("UNAVAILABLE"),
);

export const newsImpactValidator = v.union(
  v.literal("HIGH"),
  v.literal("MEDIUM"),
  v.literal("UNKNOWN"),
);

export const analysisVerdictValidator = v.union(
  v.literal("BUY"),
  v.literal("SELL"),
  v.literal("WAIT"),
  v.literal("NO TRADE"),
);

export const failureClassValidator = v.union(
  v.literal("DATA_FAILURE"),
  v.literal("STRATEGY_FAILURE"),
  v.literal("REGIME_FAILURE"),
  v.literal("EXECUTION_FAILURE"),
  v.literal("LIQUIDITY_FAILURE"),
  v.literal("RISK_FAILURE"),
  v.literal("MODEL_FAILURE"),
  v.literal("UNEXPECTED_EVENT"),
  v.literal("UNKNOWN"),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // -----------------------------------------------------------------------
    // MARKET DATA (Section 06)
    // -----------------------------------------------------------------------
    markets: defineTable({
      marketId: v.string(),
      symbol: v.string(),
      assetClass: assetClassValidator,
      venue: v.string(),
      provider: v.string(),
      baseAsset: v.string(),
      quoteAsset: v.string(),
      timezone: v.string(),
      status: v.string(),
      providerState: providerStateValidator,
    }).index("by_marketId", ["marketId"]),

    candles: defineTable({
      marketId: v.string(),
      symbol: v.string(),
      assetClass: assetClassValidator,
      venue: v.string(),
      timeframe: v.string(),
      eventTime: v.number(),
      open: v.number(),
      high: v.number(),
      low: v.number(),
      close: v.number(),
      volume: v.number(),
      source: v.string(),
      providerTimestamp: v.number(),
      receivedTime: v.number(),
      availabilityTime: v.number(),
      qualityStatus: dataQualityStateValidator,
    }).index("by_market_tf_time", ["marketId", "timeframe", "eventTime"]),

    dataQualityReports: defineTable({
      marketId: v.string(),
      symbol: v.string(),
      timeframe: v.string(),
      state: dataQualityStateValidator,
      checks: v.array(
        v.object({
          check: v.string(),
          status: checkStatusValidator,
          detail: v.string(),
          count: v.number(),
        }),
      ),
      counts: v.object({
        candles: v.number(),
        duplicates: v.number(),
        gaps: v.number(),
        ohlcViolations: v.number(),
        invalidValues: v.number(),
      }),
      generatedAt: v.number(),
    }).index("by_market", ["marketId"]),

    dataSnapshots: defineTable({
      snapshotId: v.string(),
      marketIds: v.array(v.string()),
      timeframe: v.string(),
      rangeStart: v.number(),
      rangeEnd: v.number(),
      dataVersion: v.string(),
      qualitySummary: v.array(
        v.object({
          marketId: v.string(),
          state: dataQualityStateValidator,
        }),
      ),
      revision: v.number(),
      createdAt: v.number(),
    }).index("by_snapshotId", ["snapshotId"]),

    // -----------------------------------------------------------------------
    // STRATEGY ENGINE (Section 07) — versions are IMMUTABLE once created
    // -----------------------------------------------------------------------
    strategies: defineTable({
      strategyId: v.string(),
      name: v.string(),
      description: v.string(),
      marketId: v.string(),
      timeframe: v.string(),
      ownerUserId: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_strategyId", ["strategyId"]),

    strategyVersions: defineTable({
      strategyVersionId: v.string(),
      strategyId: v.string(),
      version: v.number(),
      parentVersionId: v.optional(v.string()),
      status: strategyStatusValidator,
      immutable: v.boolean(),
      definition: v.any(), // structured strategy definition (no executable code)
      provenance: v.object({
        authorType: v.union(v.literal("AI"), v.literal("HUMAN")),
        authorRef: v.string(),
        rationale: v.string(),
        modelProvider: v.optional(v.string()),
        modelVersion: v.optional(v.string()),
        promptConfigVersion: v.optional(v.string()),
        createdAt: v.number(),
      }),
      // Owner of the version (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    }).index("by_versionId", ["strategyVersionId"]),

    // -----------------------------------------------------------------------
    // VALIDATION (Section 08)
    // -----------------------------------------------------------------------
    validationRuns: defineTable({
      validationId: v.string(),
      strategyVersionId: v.string(),
      dataSnapshotId: v.string(),
      validationConfigVersion: v.string(),
      engineVersion: v.string(),
      featureVersion: v.string(),
      costModelVersion: v.string(),
      executionModelVersion: v.string(),
      state: validationStateValidator,
      integrity: v.array(
        v.object({
          check: v.string(),
          status: checkStatusValidator,
          detail: v.string(),
        }),
      ),
      leakageState: leakageStateValidator,
      metrics: v.any(),
      stress: v.any(),
      oos: v.any(),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
      // Owner of the run (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    }).index("by_strategyVersion", ["strategyVersionId"]),

    evidenceRecords: defineTable({
      evidenceId: v.string(),
      validationId: v.string(),
      strategyVersionId: v.string(),
      level: evidenceLevelValidator,
      rubricVersion: v.string(),
      factors: v.any(),
      rationale: v.array(v.string()),
      createdAt: v.number(),
      // Owner (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    }).index("by_strategyVersion", ["strategyVersionId"]),

    botFitnessRecords: defineTable({
      fitnessId: v.string(),
      strategyVersionId: v.string(),
      dimensions: v.any(),
      verdict: v.string(),
      createdAt: v.number(),
      // Owner (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    }).index("by_strategyVersion", ["strategyVersionId"]),

    // -----------------------------------------------------------------------
    // RISK (Section 10) — deterministic engine + veto
    // -----------------------------------------------------------------------
    riskPolicies: defineTable({
      policyId: v.string(),
      version: v.number(),
      status: v.union(
        v.literal("PROVISIONAL"),
        v.literal("APPROVED"),
        v.literal("SUPERSEDED"),
      ),
      limits: v.any(),
      provenanceNote: v.string(),
      createdAt: v.number(),
    }).index("by_policyId", ["policyId"]),

    riskDecisions: defineTable({
      riskDecisionId: v.string(),
      proposalId: v.string(),
      strategyVersionId: v.string(),
      mode: marketModeValidator,
      policyId: v.string(),
      policyVersion: v.number(),
      checks: v.array(
        v.object({
          check: v.string(),
          status: v.union(
            v.literal("PASS"),
            v.literal("BLOCK"),
            v.literal("UNKNOWN"),
          ),
          detail: v.string(),
        }),
      ),
      outcome: riskOutcomeValidator,
      actor: v.string(),
      // Owner of the record (server-derived from auth, never client-supplied).
      // Optional for pre-existing/system rows; undefined = shared system record.
      ownerUserId: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_proposalId", ["proposalId"])
      .index("by_ownerUserId", ["ownerUserId"]),

    // -----------------------------------------------------------------------
    // EXECUTION (Section 11) — authorization, order lifecycle, reconciliation
    // -----------------------------------------------------------------------
    executionAuthorizations: defineTable({
      authorizationId: v.string(),
      riskDecisionId: v.string(),
      proposalId: v.string(),
      scope: v.object({
        account: v.string(),
        strategyVersionId: v.string(),
        marketId: v.string(),
        side: v.string(),
        quantity: v.number(),
        orderType: v.string(),
        timeInForce: v.string(),
        riskPolicyRef: v.string(),
        mode: marketModeValidator,
        expiresAt: v.number(),
      }),
      state: authorizationStateValidator,
      issuedAt: v.number(),
      consumedByOrderId: v.optional(v.string()),
      revocationReason: v.optional(v.string()),
      // Capability tokens are owner-bound: only the issuing user may consume.
      ownerUserId: v.optional(v.string()),
    })
      .index("by_authorizationId", ["authorizationId"])
      .index("by_ownerUserId", ["ownerUserId"]),

    orders: defineTable({
      orderId: v.string(),
      idempotencyKey: v.string(),
      authorizationId: v.string(),
      proposalId: v.string(),
      strategyVersionId: v.string(),
      marketId: v.string(),
      symbol: v.string(),
      side: v.union(v.literal("BUY"), v.literal("SELL")),
      quantity: v.number(),
      orderType: v.string(),
      timeInForce: v.string(),
      mode: marketModeValidator,
      state: orderStateValidator,
      providerOrderId: v.optional(v.string()),
      providerTruth: v.optional(
        v.union(v.literal("ACCEPTED"), v.literal("REJECTED"), v.literal("NONE")),
      ),
      fillPrice: v.optional(v.number()),
      fillQuantity: v.optional(v.number()),
      // CUMULATIVE provider fill quantity already applied to position/P&L/
      // outcome accounting (finding D2). `fillQuantity` is what the provider
      // reported; `fillAppliedQuantity` is what has been accounted. Only the
      // difference may touch the ledger, so a re-applied or replayed fill
      // event can never double-count in any accounting record.
      fillAppliedQuantity: v.optional(v.number()),
      fees: v.optional(v.number()),
      slippage: v.optional(v.number()),
      history: v.array(
        v.object({
          state: orderStateValidator,
          at: v.number(),
          note: v.string(),
        }),
      ),
      ownerUserId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      // Exact order-id lookup (learning-event / candidate-derivation ownership
      // checks): indexed lookups stay complete at any table size — an
      // ownership check must never depend on a filtered scan.
      .index("by_orderId", ["orderId"])
      .index("by_idempotencyKey", ["idempotencyKey"])
      .index("by_ownerUserId", ["ownerUserId"])
      // Exhaustive state lookup (global release gate, reconciliation scans):
      // indexed existence checks stay complete at any table size — safety
      // decisions must never depend on a bounded scan.
      .index("by_state", ["state"])
      // PER-OWNER, PER-STATE lookup (the reconciliation ACTION scan — own +
      // shared SYSTEM rows the caller may act on): indexed reads stay complete
      // at any table size, and another customer's row volume can never
      // degrade this scope's scan completeness.
      .index("by_owner_state", ["ownerUserId", "state"])
      // PER-ACCOUNT, PER-STATE lookup (Decision A shared-account exposure
      // gate): the account is derived from `mode` per the authorization-scope
      // contract (`<mode>:paper-account`). EVERY order on the execution
      // account restricts that account regardless of owner, while unrelated
      // accounts are never scanned (their volume can never degrade this
      // account's scan completeness).
      .index("by_mode_state", ["mode", "state"]),

    positions: defineTable({
      positionId: v.string(),
      account: v.string(),
      marketId: v.string(),
      symbol: v.string(),
      side: v.union(v.literal("LONG"), v.literal("SHORT"), v.literal("FLAT")),
      quantity: v.number(),
      avgEntryPrice: v.number(),
      realizedPnl: v.number(),
      source: v.string(),
      updatedAt: v.number(),
      // Owner of the position (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    })
      .index("by_market", ["marketId"])
      .index("by_owner_market", ["ownerUserId", "marketId"]),

    // -----------------------------------------------------------------------
    // MONITORING + LEARNING (Sections 12–13)
    // -----------------------------------------------------------------------
    monitoringEvents: defineTable({
      monitorId: v.string(),
      scope: v.string(),
      scopeId: v.string(),
      state: monitoringStateValidator,
      observation: v.string(),
      recommendation: v.optional(v.string()),
      createdAt: v.number(),
      // Owner (server-derived; undefined = shared SYSTEM record).
      ownerUserId: v.optional(v.string()),
    }).index("by_scopeId", ["scopeId"]),

    learningEvents: defineTable({
      learningEventId: v.string(),
      sourceOrderId: v.optional(v.string()),
      failureClass: failureClassValidator,
      analysis: v.string(),
      hypothesis: v.string(),
      candidateStrategyVersionId: v.optional(v.string()),
      // LEARNING ISOLATION: learning never mutates a live/validated version.
      liveMutationAttempted: v.boolean(),
      ownerUserId: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_learningEventId", ["learningEventId"])
      .index("by_ownerUserId", ["ownerUserId"]),

    // -----------------------------------------------------------------------
    // AGENTS (Section 05) — registry, scoped permissions
    // -----------------------------------------------------------------------
    agents: defineTable({
      agentKey: v.string(),
      agentName: v.string(),
      agentType: v.string(),
      agentVersion: v.string(),
      contractVersion: v.string(),
      description: v.string(),
      ownerDomain: v.string(),
      modelPolicy: v.string(),
      allowedTools: v.array(v.string()),
      allowedData: v.array(v.string()),
      forbiddenActions: v.array(v.string()),
      isDeterministic: v.boolean(),
      state: agentStateValidator,
    }).index("by_agentKey", ["agentKey"]),

    // -----------------------------------------------------------------------
    // AUDIT (Section 15/16) — append-only, hash-chained
    // -----------------------------------------------------------------------
    auditEvents: defineTable({
      sequence: v.number(),
      at: v.number(),
      actor: v.string(),
      actorType: v.string(),
      action: v.string(),
      resourceType: v.string(),
      resourceId: v.string(),
      outcome: v.string(),
      correlationId: v.string(),
      detail: v.string(),
      prevHash: v.string(),
      hash: v.string(),
      // Hash format tag: "SHA256-V1" on every new record; absent on legacy
      // (FNV-1a) records written before the audit-chain upgrade.
      hashVersion: v.optional(v.string()),
    }).index("by_sequence", ["sequence"]),

    // -----------------------------------------------------------------------
    // BROKER / PLATFORM CONNECTIONS + API CREDENTIALS (Section 16)
    //
    // Key material is NEVER persisted: only a non-reversible fingerprint and a
    // masked suffix (last 4). Raw keys never leave the register/rotate mutation
    // that receives them, are never returned to any client, and never appear in
    // audit details (SECRET RULE: execution credentials -> execution only,
    // frontend -> ZERO credentials, logs -> ZERO secrets).
    // -----------------------------------------------------------------------
    brokerConnections: defineTable({
      connectionId: v.string(),
      userId: v.string(),
      provider: v.string(),
      providerKind: v.string(),
      label: v.string(),
      environment: v.union(
        v.literal("PAPER"),
        v.literal("DEMO"),
        v.literal("CONTROLLED_LIVE"),
      ),
      accountRef: v.string(),
      permissions: v.array(v.string()),
      keyFingerprint: v.string(),
      fingerprintAlgo: v.string(),
      keyMasked: v.string(),
      secretFingerprint: v.optional(v.string()),
      status: v.union(
        v.literal("PENDING_VERIFICATION"),
        v.literal("VERIFIED_SIMULATED"),
        v.literal("ACTIVE"),
        v.literal("DEGRADED"),
        v.literal("REVOKED"),
        v.literal("FAILED"),
      ),
      adapter: v.union(v.literal("SIMULATED"), v.literal("NOT_CONFIGURED")),
      verificationNote: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      rotatedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
    })
      .index("by_connectionId", ["connectionId"])
      .index("by_userId", ["userId"]),

    // -----------------------------------------------------------------------
    // ANALYSIS RUNS (Section 04 backend repair) — one traceable record per
    // authenticated analysis pipeline execution. Owner-scoped: the owner is
    // ALWAYS server-derived from the auth identity, never client-supplied.
    // -----------------------------------------------------------------------
    analysisRuns: defineTable({
      analysisId: v.string(),
      ownerUserId: v.string(),
      request: v.object({
        marketId: v.string(),
        symbol: v.string(),
        timeframe: v.string(),
        horizon: v.string(),
        requestedAt: v.number(),
      }),
      data: v.object({
        label: dataLabelValidator,
        labelReason: v.string(),
        origin: v.string(),
        provider: v.string(),
        barCount: v.number(),
        lastBarEventTime: v.optional(v.number()),
        freshnessAgeMs: v.optional(v.number()),
        qualityState: dataQualityStateValidator,
        qualityChecks: v.array(
          v.object({
            check: v.string(),
            status: checkStatusValidator,
            detail: v.string(),
            count: v.number(),
          }),
        ),
      }),
      snapshot: v.object({
        snapshotId: v.string(),
        timeframe: v.string(),
        rangeStart: v.number(),
        rangeEnd: v.number(),
        dataVersion: v.string(),
        revision: v.number(),
      }),
      news: v.object({
        status: v.union(v.literal("SELECTED"), v.literal("UNAVAILABLE")),
        reason: v.string(),
        newsId: v.optional(v.string()),
        provider: v.optional(v.string()),
        sourceName: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        headline: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        retrievedAt: v.optional(v.number()),
        impact: v.optional(newsImpactValidator),
        impactEvidence: v.array(v.string()),
      }),
      strategyResults: v.array(
        v.object({
          strategyId: v.string(),
          strategyVersionId: v.string(),
          strategyName: v.string(),
          evaluated: v.boolean(),
          signal: v.string(),
          reason: v.string(),
          evidence: v.any(),
        }),
      ),
      risk: v.object({
        evaluated: v.boolean(),
        outcome: v.string(),
        policyRef: v.string(),
        note: v.string(),
        evaluations: v.array(
          v.object({
            strategyVersionId: v.string(),
            side: v.string(),
            outcome: v.string(),
            checks: v.array(
              v.object({ check: v.string(), status: v.string(), detail: v.string() }),
            ),
          }),
        ),
      }),
      verdict: analysisVerdictValidator,
      verdictEvidence: v.array(v.string()),
      status: v.union(
        v.literal("COMPLETED"),
        v.literal("BLOCKED"),
        v.literal("INSUFFICIENT_DATA"),
        v.literal("FAILED"),
      ),
      errors: v.array(v.string()),
      startedAt: v.number(),
      completedAt: v.number(),
    })
      .index("by_analysisId", ["analysisId"])
      .index("by_owner_started", ["ownerUserId", "startedAt"]),

    // -----------------------------------------------------------------------
    // MARKET NEWS (Section 06) — provider items with source URL, publication
    // and retrieval timestamps, impact evidence and duplicate detection.
    // -----------------------------------------------------------------------
    newsItems: defineTable({
      newsId: v.string(),
      provider: v.string(),
      sourceName: v.string(),
      sourceUrl: v.string(),
      headline: v.string(),
      summary: v.string(),
      publishedAt: v.optional(v.number()),
      retrievedAt: v.number(),
      marketId: v.string(),
      instruments: v.array(v.string()),
      currencies: v.array(v.string()),
      assets: v.array(v.string()),
      impact: newsImpactValidator,
      impactEvidence: v.array(v.string()),
      relevanceScore: v.number(),
      contentHash: v.string(),
      freshness: v.string(),
    })
      .index("by_contentHash", ["contentHash"])
      .index("by_market_retrieved", ["marketId", "retrievedAt"]),

    // -----------------------------------------------------------------------
    // PROVIDER HEALTH — request outcomes, failures, rate limits, freshness.
    // Status is derived from real request results only; a provider is never
    // claimed connected without a verified response.
    // -----------------------------------------------------------------------
    providerHealth: defineTable({
      provider: v.string(),
      kind: v.union(v.literal("MARKET_DATA"), v.literal("NEWS")),
      assetClass: v.optional(assetClassValidator),
      status: providerStateValidator,
      failureClass: v.optional(v.string()),
      consecutiveFailures: v.number(),
      lastSuccessAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      rateLimitUntil: v.optional(v.number()),
      lastLatencyMs: v.optional(v.number()),
      note: v.string(),
      updatedAt: v.number(),
    }).index("by_provider", ["provider"]),

    // -----------------------------------------------------------------------
    // FX RATE OBSERVATIONS — ECB daily reference fixes via Frankfurter.
    // Close-ONLY by nature; deliberately NOT stored as candles (no synthetic
    // OHLC is ever derived from a single published fix).
    // -----------------------------------------------------------------------
    rateObservations: defineTable({
      marketId: v.string(),
      symbol: v.string(),
      base: v.string(),
      quote: v.string(),
      rate: v.number(),
      rateDate: v.string(),
      provider: v.string(),
      sourceUrl: v.string(),
      retrievedAt: v.number(),
      labelNote: v.string(),
    }).index("by_market_date", ["marketId", "rateDate"]),

    // -----------------------------------------------------------------------
    // USER PREFERENCES — server-validated market/instrument/timeframe/horizon
    // and notification preferences. Owner-scoped (by_userId).
    // -----------------------------------------------------------------------
    userPreferences: defineTable({
      userId: v.string(),
      marketId: v.string(),
      symbol: v.string(),
      timeframe: v.string(),
      horizon: v.string(),
      notifications: v.object({
        analysisComplete: v.boolean(),
        riskBlocked: v.boolean(),
        providerFailure: v.boolean(),
        highImpactNews: v.boolean(),
      }),
      updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    // -----------------------------------------------------------------------
    // RISK ACCOUNTING (per customer account) — G2 isolation.
    //
    // Server-derived at fill time and consumed ONLY by the owning customer's
    // risk context (`loadRiskContext`). One row per customer account: daily
    // realized PnL (UTC day) and all-time peak equity. Shared platform
    // controls (kill switch, mode, simulation config) stay in `systemState`
    // and never mix with customer-specific accounting.
    // -----------------------------------------------------------------------
    riskAccountState: defineTable({
      ownerUserId: v.string(),
      peakEquity: v.number(),
      pnlDay: v.optional(v.string()),
      realizedPnlDay: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_ownerUserId", ["ownerUserId"]),

    // -----------------------------------------------------------------------
    // REALIZED TRADE OUTCOMES (owner-scoped loss-streak accounting).
    //
    // Source of truth for completed realized trade outcomes: one row per
    // REALIZATION EVENT (the application of a fill that closes a positive
    // portion of a position — see lib/positions.ts), written in the SAME
    // transaction as the position/ledger accounting it belongs to.
    //
    // Idempotency: `outcomeId` is a STABLE event identifier (order id +
    // cumulative applied fill quantity), so repeated fills, retried mutations
    // and repeated reconciliation can never count the same realized result
    // more than once. `seq` is a per-owner monotonic sequence used to detect
    // missing history (gaps fail the streak closed — never a silent zero).
    // -----------------------------------------------------------------------
    realizedTradeOutcomes: defineTable({
      outcomeId: v.string(),
      ownerUserId: v.string(),
      orderId: v.string(),
      marketId: v.string(),
      // Realized PnL delta of this event (gross of fees, like positions.realizedPnl).
      realizedPnl: v.number(),
      outcome: v.union(v.literal("WIN"), v.literal("LOSS"), v.literal("BREAKEVEN")),
      // Closed quantity of this realization event (auditability of partial exits).
      closedQuantity: v.number(),
      // Per-owner monotonic sequence (1, 2, 3, ...) — gap detection.
      seq: v.number(),
      createdAt: v.number(),
    })
      .index("by_owner_seq", ["ownerUserId", "seq"])
      .index("by_outcomeId", ["outcomeId"])
      .index("by_orderId", ["orderId"]),

    // -----------------------------------------------------------------------
    // SYSTEM STATE — mode, kill switch, controlled-live gates (Section 30)
    // -----------------------------------------------------------------------
    systemState: defineTable({
      key: v.string(),
      mode: marketModeValidator,
      killSwitchEngaged: v.boolean(),
      killSwitchReason: v.optional(v.string()),
      liveAutoResume: v.boolean(),
      environment: v.string(),
      // Controlled TEST/DEMO configuration: which behavior the SIMULATED
      // provider adapter exhibits. Server-side config, never a per-request
      // client flag (admin-gated + mode-gated mutation).
      simulatedProviderBehavior: v.optional(
        v.union(
          v.literal("ACK"),
          v.literal("FILL"),
          v.literal("PARTIAL"),
          v.literal("REJECT"),
          v.literal("TIMEOUT"),
        ),
      ),
      // Risk accounting state (derived server-side at fill time only).
      peakEquity: v.optional(v.number()),
      pnlDay: v.optional(v.string()),
      realizedPnlDay: v.optional(v.number()),
      controlledLiveGates: v.array(
        v.object({ gate: v.string(), satisfied: v.boolean(), note: v.string() }),
      ),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
