/**
 * SENTINEL PRIME — PERSISTENCE HELPERS
 *
 * appendAudit writes to the append-only, hash-chained audit log (Sections 15/16).
 * Audit records are never updated or deleted.
 */

import { GenericMutationCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";
import { AuditInput, computeAuditHash, CURRENT_HASH_VERSION } from "./audit";

export type MutationCtx = GenericMutationCtx<DataModel>;

export async function appendAudit(
  ctx: MutationCtx,
  input: AuditInput,
  at: number,
): Promise<void> {
  const latest = await ctx.db
    .query("auditEvents")
    .withIndex("by_sequence", (q) => q.gte("sequence", 0))
    .order("desc")
    .first();

  const sequence = latest ? latest.sequence + 1 : 1;
  const prevHash = latest ? latest.hash : "GENESIS";
  // Every NEW record is written under the current cryptographic format; the
  // legacy FNV-1a format is verification-only for pre-upgrade records.
  const withoutHash = { ...input, sequence, at, prevHash, hashVersion: CURRENT_HASH_VERSION };
  const hash = computeAuditHash(withoutHash);

  await ctx.db.insert("auditEvents", {
    ...withoutHash,
    hash,
  });
}

/**
 * Append a CHAIN_CHECKPOINT record declaring the current head hash.
 *
 * The checkpoint is tamper-evident like every other record. It becomes
 * INDEPENDENTLY protective only when an operator exports its declared head
 * to storage the database operator cannot rewrite (SPEC-GAP-005: external
 * write-once anchoring is a production requirement and is NOT implemented
 * here). Until such an export exists, checkpoints are self-attested.
 */
export async function appendCheckpoint(
  ctx: MutationCtx,
  at: number,
  actor: string,
): Promise<void> {
  const latest = await ctx.db
    .query("auditEvents")
    .withIndex("by_sequence", (q) => q.gte("sequence", 0))
    .order("desc")
    .first();
  await appendAudit(
    ctx,
    {
      actor,
      actorType: "SERVICE",
      action: "CHAIN_CHECKPOINT",
      resourceType: "auditEvents",
      resourceId: latest ? String(latest.sequence) : "0",
      outcome: "SUCCESS",
      correlationId: `checkpoint-${at}`,
      detail: `CHECKPOINT head=${latest ? latest.hash : "GENESIS"} seq=${latest ? latest.sequence : 0}`,
    },
    at,
  );
}
