/**
 * SENTINEL PRIME — AUDIT CHAIN (Sections 15/16)
 *
 * Append-only, tamper-evident hash chain. Audit records are never deleted and
 * never rewritten. The digest is a deterministic 64-bit FNV-1a chain over the
 * canonical record content plus the previous record hash.
 *
 * NOTE (recorded honestly): this is tamper-EVIDENT, not tamper-PROOF. A
 * cryptographic (SHA-256) chain with external anchoring is specified for the
 * production architecture and is reported as a spec gap in this environment.
 */

export interface AuditInput {
  actor: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  correlationId: string;
  detail: string;
}

export interface AuditRecord extends AuditInput {
  sequence: number;
  at: number;
  prevHash: string;
  hash: string;
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function computeAuditHash(record: Omit<AuditRecord, "hash">): string {
  const canonical = [
    record.sequence,
    record.at,
    record.actor,
    record.actorType,
    record.action,
    record.resourceType,
    record.resourceId,
    record.outcome,
    record.correlationId,
    record.detail,
    record.prevHash,
  ].join("|");
  return fnv1a64(canonical);
}

/**
 * Verify a chain — or a recent WINDOW of a longer chain; used by the console
 * to surface tamper evidence.
 *
 * `anchorPrevHash` is the hash the first record must link to. Defaults to
 * GENESIS (full chain). When verifying a WINDOW of a longer chain, pass the
 * window's first record's own prevHash: internal linkage and every record
 * hash are verified, and the anchor itself is TRUSTED — that trust is
 * declared here, never hidden.
 */
export function verifyAuditChain(
  records: AuditRecord[],
  anchorPrevHash: string = "GENESIS",
): {
  valid: boolean;
  brokenAt: number | null;
  reason: string | null;
} {
  let prevHash = anchorPrevHash;
  for (const r of records) {
    if (r.prevHash !== prevHash) {
      return { valid: false, brokenAt: r.sequence, reason: "prevHash linkage broken" };
    }
    const expected = computeAuditHash({ ...r, hash: "" } as AuditRecord);
    if (expected !== r.hash) {
      return { valid: false, brokenAt: r.sequence, reason: "record content does not match its hash" };
    }
    prevHash = r.hash;
  }
  return { valid: true, brokenAt: null, reason: null };
}
