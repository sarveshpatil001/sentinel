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
      .index("by_idempotencyKey", ["idempotencyKey"])
      .index("by_ownerUserId", ["ownerUserId"])
      // Exhaustive state lookup (UNKNOWN exposure gate, reconciliation):
      // indexed existence checks stay complete at any table size — safety
      // decisions must never depend on a bounded scan.
      .index("by_state", ["state"]),

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
