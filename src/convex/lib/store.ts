/**
 * SENTINEL PRIME — PERSISTENCE HELPERS
 *
 * appendAudit writes to the append-only, hash-chained audit log (Sections 15/16).
 * Audit records are never updated or deleted.
 */

import { GenericMutationCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";
import { AuditInput, computeAuditHash } from "./audit";

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
  const withoutHash = { ...input, sequence, at, prevHash };
  const hash = computeAuditHash(withoutHash);

  await ctx.db.insert("auditEvents", {
    ...withoutHash,
    hash,
  });
}
