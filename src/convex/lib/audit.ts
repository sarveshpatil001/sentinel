/**
 * SENTINEL PRIME — AUDIT CHAIN (Sections 15/16)
 *
 * Append-only, tamper-EVIDENT hash chain. Audit records are never deleted and
 * never rewritten by application code.
 *
 * HASH FORMAT (versioned):
 *  - "SHA256-V1" (current): `sha256:<64 lowercase hex>` — SHA-256 over an
 *    UNAMBIGUOUS length-prefixed canonical serialization of every field
 *    (see canonicalV1 below). Written by every new append.
 *  - absent / "FNV1A-64" (legacy): 16-hex 64-bit FNV-1a over a `|`-joined
 *    serialization. Kept ONLY so records written before the upgrade can
 *    still be verified; never written anymore. It is a non-cryptographic
 *    64-bit digest and MUST NOT be relied on for tamper resistance.
 *
 * CHECKPOINTS: a record with action "CHAIN_CHECKPOINT" whose detail is
 * `CHECKPOINT head=<hash> seq=<n>` declares the hash of record n. During
 * verification, in-range declarations must match the actual record hash.
 * A checkpoint is only INDEPENDENTLY protective once its declared head has
 * been exported to storage the database operator cannot rewrite (external
 * write-once log, notarization, KMS-anchored registry). THAT EXPORT IS NOT
 * IMPLEMENTED HERE (SPEC-GAP-005). In-log checkpoints alone remain
 * self-attested.
 *
 * HONEST LIMITATION (recorded, never oversold): this chain is tamper-EVIDENT,
 * NOT tamper-PROOF. A sufficiently privileged database operator can rewrite
 * records AND recompute the chain (and, without external anchoring, truncate
 * the tail undetectably). Application-level append-only conventions do not
 * prevent that. Whole-history proof requires external anchoring.
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
  /** Hash format tag. Absent on legacy (FNV-1a) records. */
  hashVersion?: string;
}

export const CURRENT_HASH_VERSION = "SHA256-V1";

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), pure and synchronous so it is deterministic inside
// Convex queries/mutations. Verified against published test vectors in the
// engine battery (TEST-AUDIT-201).
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = msg.length * 8;
  dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(total - 4, bitLen >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
  return out;
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * UNAMBIGUOUS canonical form: every field is length-prefixed (`<len>:<value>`),
 * so no choice of separator or delimiter characters inside a value can make
 * two different records serialize to the same string (unlike a plain join).
 * The format tag itself is the first field, so a digest can never be replayed
 * across hash formats.
 */
function canonicalV1(record: Omit<AuditRecord, "hash">): string {
  const fields = [
    CURRENT_HASH_VERSION,
    String(record.sequence),
    String(record.at),
    record.actor,
    record.actorType,
    record.action,
    record.resourceType,
    record.resourceId,
    record.outcome,
    record.correlationId,
    record.detail,
    record.prevHash,
  ];
  return fields.map((f) => `${f.length}:${f}`).join("|");
}

/** Legacy (pre-upgrade) serialization — kept ONLY to verify old records. */
function canonicalLegacy(record: Omit<AuditRecord, "hash">): string {
  return [
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

/**
 * Compute the record digest under the record's declared hash format.
 * Throws on an unknown format — a record must never silently fall back to a
 * weaker digest than it declares.
 */
export function computeAuditHash(record: Omit<AuditRecord, "hash">): string {
  const version = record.hashVersion ?? "FNV1A-64";
  if (version === CURRENT_HASH_VERSION) return "sha256:" + sha256Hex(canonicalV1(record));
  if (version === "FNV1A-64") return fnv1a64(canonicalLegacy(record));
  throw new Error(`Unknown audit hashVersion: ${String(record.hashVersion)}`);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type ChainScope = "FULL_CHAIN" | "WINDOW" | "EMPTY";

export interface ChainVerification {
  valid: boolean;
  brokenAt: number | null;
  reason: string | null;
  /**
   * What this verdict actually covers — never oversold:
   *  - FULL_CHAIN: linkage verified from GENESIS over records 1..n —
   *    whole-history integrity of THIS build's chain. It remains
   *    tamper-EVIDENT, NOT tamper-proof (no external anchoring; a tail
   *    truncation is undetectable without an externally stored head).
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
  /**
   * In-range checkpoint declarations whose declared head matched the actual
   * record hash. Still SELF-ATTESTED (in-log) unless the head was exported to
   * independently protected storage — not implemented here (SPEC-GAP-005).
   */
  checkpointsVerified: number;
}

function parseCheckpoint(
  detail: string,
): { head: string; seq: number } | null {
  const m = /^CHECKPOINT head=(\S+) seq=(\d+)$/.exec(detail);
  if (!m) return null;
  return { head: m[1], seq: Number(m[2]) };
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
 * verification. Records are hashed under their OWN declared hash format
 * (legacy FNV-1a records still verify; unknown formats FAIL closed).
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
        ? "Window linkage and record hashes verified against an anchor taken from the log ITSELF (self-attested, NOT independently trusted). History BEFORE the anchor is NOT verified. Tamper-EVIDENT hash chain only — NOT tamper-proof."
        : "Full chain verified from GENESIS. Tamper-EVIDENT hash chain — NOT tamper-proof (no external anchoring; tail truncation is undetectable without an externally stored head).";
  let prevHash = anchorPrevHash;
  // Sequence continuity WITHIN the verified range: missing, duplicated or
  // out-of-order sequence numbers mean records were removed, replayed or
  // reordered — the range is not a faithful chain segment.
  let expectedSequence = records.length > 0 ? records[0].sequence : 0;
  let verifiedCount = 0;
  let checkpointsVerified = 0;
  const bySequence = new Map<number, AuditRecord>();
  for (const r of records) {
    if (!Number.isInteger(r.sequence) || r.sequence < 1) {
      return {
        valid: false,
        brokenAt: Number.isFinite(r.sequence) ? r.sequence : 0,
        reason: "malformed record: sequence must be a positive integer",
        scope,
        note,
        verifiedCount,
        checkpointsVerified,
      };
    }
    if (r.sequence !== expectedSequence) {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: `sequence numbers not consecutive: expected ${expectedSequence}, found ${r.sequence} (missing, duplicated or reordered records)`,
        scope,
        note,
        verifiedCount,
        checkpointsVerified,
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
        checkpointsVerified,
      };
    }
    let expected: string;
    try {
      expected = computeAuditHash({ ...r, hash: "" } as AuditRecord);
    } catch {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: `unknown hashVersion ${String(r.hashVersion)} — record format cannot be verified (fail closed)`,
        scope,
        note,
        verifiedCount,
        checkpointsVerified,
      };
    }
    if (expected !== r.hash) {
      return {
        valid: false,
        brokenAt: r.sequence,
        reason: "record content does not match its hash",
        scope,
        note,
        verifiedCount,
        checkpointsVerified,
      };
    }
    // In-range checkpoint declarations: the declared head must equal the
    // actual hash of the referenced record. Declarations pointing outside the
    // verified range are NOT counted (nothing to check them against).
    if (r.action === "CHAIN_CHECKPOINT") {
      const cp = parseCheckpoint(r.detail);
      if (cp) {
        const target = bySequence.get(cp.seq);
        if (target) {
          if (target.hash !== cp.head) {
            return {
              valid: false,
              brokenAt: r.sequence,
              reason: `checkpoint at sequence ${r.sequence} declares head ${cp.head} but record ${cp.seq} hashes to ${target.hash} (history rewritten after checkpoint)`,
              scope,
              note,
              verifiedCount,
              checkpointsVerified,
            };
          }
          checkpointsVerified += 1;
        }
      }
    }
    bySequence.set(r.sequence, r);
    prevHash = r.hash;
    expectedSequence += 1;
    verifiedCount += 1;
  }
  return { valid: true, brokenAt: null, reason: null, scope, note, verifiedCount, checkpointsVerified };
}
