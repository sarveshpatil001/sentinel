/**
 * SENTINEL PRIME — BROKER / PLATFORM CONNECTIONS (Section 16)
 *
 * The single boundary where customers register broker/platform credentials.
 *
 * SECRET RULES ENFORCED HERE:
 *  - Raw key material exists only inside the register/rotate handler frame.
 *    It is fingerprinted + masked and then dropped — never stored, never
 *    returned to any client, never written to audit, never logged.
 *  - Frontend holds ZERO execution credentials: the UI only ever receives
 *    masked suffix + fingerprint + status.
 *  - Every mutation is auth-gated and OWNERSHIP-checked (IDOR protection).
 *  - Live (CONTROLLED_LIVE) credential ingestion is refused until the
 *    controlled-live readiness review (Sections 27/30).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit } from "./lib/store";
import {
  ALL_PERMISSIONS,
  EXECUTION_PERMISSIONS,
  PROVIDERS,
  fingerprintSecret,
  getProviderSpec,
  maskKey,
  validateCredentialInput,
} from "./lib/credentials";

const MAX_CONNECTIONS_PER_USER = 20;

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("UNAUTHENTICATED");
  return userId;
}

/** Static, non-secret catalog exposed to the UI. */
export const catalog = query({
  args: {},
  handler: async () => {
    return {
      providers: PROVIDERS,
      permissions: ALL_PERMISSIONS,
      executionPermissions: EXECUTION_PERMISSIONS,
      environments: ["PAPER", "DEMO"],
      disabledEnvironments: ["CONTROLLED_LIVE"],
      policy: {
        storage:
          "Key material is never persisted. Only a one-way fingerprint and a masked suffix (last 4) are stored.",
        transport:
          "Keys transit once over TLS into this mutation, are fingerprinted, and dropped — never returned, never logged.",
        isolation:
          "Execution credentials are isolated to the execution subsystem. AI agents, the frontend and the risk engine receive ZERO credentials.",
        production:
          "Production-grade secret storage requires a KMS/vault integration (SPEC-GAP-007). A fingerprint is not a vault.",
      },
    };
  },
});

/** User-scoped list. Masked and redacted by construction. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("brokerConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    return rows
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        connectionId: r.connectionId,
        provider: r.provider,
        providerKind: r.providerKind,
        label: r.label,
        environment: r.environment,
        accountRef: r.accountRef,
        permissions: r.permissions,
        keyMasked: r.keyMasked,
        keyFingerprint: r.keyFingerprint,
        fingerprintAlgo: r.fingerprintAlgo,
        status: r.status,
        adapter: r.adapter,
        verificationNote: r.verificationNote,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        rotatedAt: r.rotatedAt,
        revokedAt: r.revokedAt,
      }));
  },
});

export const register = mutation({
  args: {
    provider: v.string(),
    label: v.string(),
    environment: v.string(),
    accountRef: v.string(),
    apiKey: v.string(),
    apiSecret: v.optional(v.string()),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();

    const validation = validateCredentialInput({
      provider: args.provider,
      label: args.label,
      environment: args.environment,
      accountRef: args.accountRef,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
      permissions: args.permissions,
    });
    if (!validation.ok) {
      await appendAudit(
        ctx,
        {
          actor: `user:${userId}`,
          actorType: "USER",
          action: "CONNECTION_REGISTER_REJECTED",
          resourceType: "brokerConnection",
          resourceId: "none",
          outcome: "REJECTED",
          correlationId: `CONN-${now}`,
          detail: `Credential validation failed (${validation.errors.length} errors). No key material recorded.`,
        },
        now,
      );
      return { ok: false as const, errors: validation.errors, connectionId: null as string | null };
    }

    const existing = await ctx.db
      .query("brokerConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    if (existing.length >= MAX_CONNECTIONS_PER_USER) {
      return {
        ok: false as const,
        errors: [`Connection limit reached (${MAX_CONNECTIONS_PER_USER}).`],
        connectionId: null as string | null,
      };
    }

    // Fingerprint key material. The raw values are dropped at the end of this
    // handler and never written anywhere.
    const keyPrint = await fingerprintSecret(args.apiKey);
    const secretPrint = args.apiSecret ? await fingerprintSecret(args.apiSecret) : null;
    const masked = maskKey(args.apiKey);

    const spec = getProviderSpec(args.provider)!;
    const connectionId = `CONN-${userId.slice(0, 8)}-${now}`;

    await ctx.db.insert("brokerConnections", {
      connectionId,
      userId,
      provider: args.provider,
      providerKind: spec.kind,
      label: args.label,
      environment: args.environment as never,
      accountRef: args.accountRef,
      permissions: args.permissions,
      keyFingerprint: keyPrint.fingerprint,
      fingerprintAlgo: keyPrint.algo,
      keyMasked: masked,
      secretFingerprint: secretPrint?.fingerprint,
      status: "PENDING_VERIFICATION",
      adapter: spec.adapter,
      verificationNote:
        spec.adapter === "SIMULATED"
          ? "Registered against the simulated adapter. Run verification to confirm simulated connectivity."
          : "Provider adapter NOT IMPLEMENTED in this build — connectivity cannot be verified (never assumed).",
      createdAt: now,
      updatedAt: now,
    });

    const executionPerms = args.permissions.filter((p) =>
      EXECUTION_PERMISSIONS.includes(p),
    );
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "CONNECTION_REGISTERED",
        resourceType: "brokerConnection",
        resourceId: connectionId,
        outcome: "SUCCESS",
        correlationId: connectionId,
        detail: `Provider ${args.provider} (${spec.kind}) in ${args.environment}. Key ${masked} (fingerprint ${keyPrint.fingerprint.slice(0, 12)}…, ${keyPrint.algo}). Permissions: ${args.permissions.join(", ")}${executionPerms.length > 0 ? ` — EXECUTION permissions granted: ${executionPerms.join(", ")}` : ""}. Key material NOT stored.`,
      },
      now,
    );

    return {
      ok: true as const,
      errors: [] as string[],
      connectionId,
      keyMasked: masked,
      fingerprintAlgo: keyPrint.algo,
    };
  },
});

export const verify = mutation({
  args: { connectionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("brokerConnections")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .first();

    if (!row || row.userId !== userId) {
      // IDOR protection: not found and not-owned are indistinguishable.
      return { ok: false as const, status: null as string | null, note: "Connection not found." };
    }
    if (row.status === "REVOKED") {
      return { ok: false as const, status: row.status, note: "Revoked connections cannot be verified." };
    }

    // Honest verification semantics (Rules 18/19/20):
    //  - SIMULATED adapter  -> VERIFIED_SIMULATED (explicitly NOT real connectivity)
    //  - NOT_CONFIGURED     -> stays PENDING_VERIFICATION (never faked ACTIVE)
    let status: typeof row.status = row.status;
    let note = row.verificationNote;
    if (row.adapter === "SIMULATED") {
      status = "VERIFIED_SIMULATED";
      note =
        "Verified against the SIMULATED provider adapter. This is NOT evidence of real provider connectivity and NOT a claim of live readiness.";
    } else {
      status = "PENDING_VERIFICATION";
      note =
        "Provider adapter NOT IMPLEMENTED in this build — connectivity NOT VERIFIED. The connection remains pending; success is never assumed.";
    }

    await ctx.db.patch(row._id, { status, verificationNote: note, updatedAt: now });
    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "CONNECTION_VERIFIED",
        resourceType: "brokerConnection",
        resourceId: row.connectionId,
        outcome: status,
        correlationId: row.connectionId,
        detail: `Verification result ${status}: ${note}`,
      },
      now,
    );

    return { ok: true as const, status, note };
  },
});

export const rotate = mutation({
  args: {
    connectionId: v.string(),
    apiKey: v.string(),
    apiSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("brokerConnections")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .first();
    if (!row || row.userId !== userId) {
      return { ok: false as const, note: "Connection not found." };
    }
    if (row.status === "REVOKED") {
      return { ok: false as const, note: "Revoked connections cannot be rotated. Register a new connection." };
    }
    if (typeof args.apiKey !== "string" || args.apiKey.length < 16 || args.apiKey.length > 256) {
      return { ok: false as const, note: "API key must be 16–256 characters." };
    }

    const keyPrint = await fingerprintSecret(args.apiKey);
    const secretPrint = args.apiSecret ? await fingerprintSecret(args.apiSecret) : null;
    const masked = maskKey(args.apiKey);

    await ctx.db.patch(row._id, {
      keyFingerprint: keyPrint.fingerprint,
      fingerprintAlgo: keyPrint.algo,
      keyMasked: masked,
      secretFingerprint: secretPrint?.fingerprint,
      status: "PENDING_VERIFICATION",
      verificationNote: "Credential rotated — re-verification required before use.",
      rotatedAt: now,
      updatedAt: now,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "CREDENTIAL_ROTATED",
        resourceType: "brokerConnection",
        resourceId: row.connectionId,
        outcome: "SUCCESS",
        correlationId: row.connectionId,
        detail: `Credential rotated. New key ${masked} (fingerprint ${keyPrint.fingerprint.slice(0, 12)}…). Previous credential invalidated locally; provider-side rotation is the operator's responsibility. Key material NOT stored.`,
      },
      now,
    );

    return { ok: true as const, note: "Credential rotated. Re-verification required." };
  },
});

export const revoke = mutation({
  args: { connectionId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("brokerConnections")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .first();
    if (!row || row.userId !== userId) {
      return { ok: false as const, note: "Connection not found." };
    }

    await ctx.db.patch(row._id, {
      status: "REVOKED",
      revokedAt: now,
      updatedAt: now,
      verificationNote: `Revoked locally. The API key must ALSO be revoked on the ${row.provider} side — local revocation alone does not invalidate the provider credential.`,
    });

    await appendAudit(
      ctx,
      {
        actor: `user:${userId}`,
        actorType: "USER",
        action: "CONNECTION_REVOKED",
        resourceType: "brokerConnection",
        resourceId: row.connectionId,
        outcome: "REVOKED",
        correlationId: row.connectionId,
        detail: `Connection revoked: ${args.reason}. Provider-side key revocation still required.`,
      },
      now,
    );

    return { ok: true as const, note: "Connection revoked. Revoke the key on the provider side too." };
  },
});
