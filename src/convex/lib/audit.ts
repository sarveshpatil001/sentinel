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

export type ChainScope = "FULL_CHAIN" | "WINDOW" | "EMPTY";

export interface ChainVerification {
  valid: boolean;
  brokenAt: number | null;
  reason: string | null;
  /**
   * What this verdict actually covers — never oversold:
   *  - FULL_CHAIN: linkage verified from GENESIS over records 1..n —
   *    whole-history integrity of THIS build's chain. It remains
   *    tamper-EVIDENT FNV-1a, NOT tamper-proof (no external anchoring).
   *  - WINDOW: linkage and record hashes INSIDE the verified range only,
   *    against an anchor taken from the log ITSELF (self-attested, NOT
   *    independently trusted). History BEFORE the anchor is NOT verified
   *    and this result is NOT proof of it.
   *  - EMPTY: no records in range — nothing was verified; not evidence.
   */
  scope: ChainScope;
  note: string;
  /**
   * Number of records whose linkage AND content hash actually passed in this
   * run — NOT the number of records visible after user filtering. On a broken
   * chain this counts only records verified BEFORE the break.
   */
  verifiedCount: number;
}

/**
 * Verify a chain — or a recent WINDOW of a longer chain; used by the console
 * to surface tamper evidence.
 *
 * `anchorPrevHash` is the hash the first record must LINK to. Defaults to
 * GENESIS. When verifying a WINDOW of a longer chain, pass the window's first
 * record's own prevHash: internal linkage and every record hash are verified,
 * and the anchor itself is SELF-ATTESTED — it is NOT independently trusted
 * unless checked against a separately protected checkpoint. That limitation
 * is declared in the result (`scope: "WINDOW"`), never hidden. A range that
 * does not start at record sequence 1 can NEVER be presented as whole-history
 * integrity, whatever anchor it claims. Sequence numbers within the verified
 * range must be consecutive: missing, duplicated or reordered records FAIL
 * verification.
 */
export function verifyAuditChain(
  records: AuditRecord[],
  anchorPrevHash: string = "GENESIS",
): ChainVerification {
  const scope: ChainScope =
    records.length === 0
      ? "EMPTY"
      : records[0].sequence === 1 && anchorPrevHash === "GENESIS"
        ? "FULL_CHAIN"
        : "WINDOW";
  const note =
    scope === "EMPTY"
      ? "No records in the verified range — nothing was verified; this is NOT evidence of integrity."
      : scope === "WINDOW"
        ? "Window linkage and record hashes verified against an anchor taken from the log ITSELF (self-attested, NOT independently trusted). History BEFORE the anchor is NOT verified. Tamper-evident FNV-1a only — NOT tamper-proof."
        : "Full chain verified from GENESIS. Tamper-evident FNV-1a chain — NOT tamper-proof (no external anchoring).";
  let prevHash = anchorPrevHash;
  // Sequence continuity WITHIN the verified range: missing, duplicated or
  // out-of-order sequence numbers mean records were removed, replayed or
  // reordered — the range is not a faithful chain segment.
  let expectedSequence = records.length > 0 ? records[0].sequence : 0;
  let verifiedCount = 0;
  for (const r of records) {
    if (r.sequence !== expectedSequence) {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: `sequence numbers not consecutive: expected ${expectedSequence}, found ${r.sequence} (missing, duplicated or reordered records)`,
        scope,
        note,
        verifiedCount,
      };
    }
    if (r.prevHash !== prevHash) {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: "prevHash linkage broken",
        scope,
        note,
        verifiedCount,
      };
    }
    const expected = computeAuditHash({ ...r, hash: "" } as AuditRecord);
    if (expected !== r.hash) {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: "record content does not match its hash",
        scope,
        note,
        verifiedCount,
      };
    }
    prevHash = r.hash;
    expectedSequence += 1;
    verifiedCount += 1;
  }
  return { valid: true, brokenAt: null, reason: null, scope, note, verifiedCount };
}
