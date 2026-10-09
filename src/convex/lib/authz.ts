/**
 * SENTINEL PRIME — AUTHORIZATION BOUNDARY (Section 04)
 *
 * Pure, deterministic authorization helpers. The caller identity ALWAYS comes
 * from trusted server-side authentication (getAuthUserId); a client-supplied
 * user id / role / ownership claim is never consulted.
 *
 * Fail-closed contract (enforced by TEST-AUTHZ-*):
 *   - a record with no owner is a shared SYSTEM record (seed/demo workspace)
 *   - an execution authorization is a capability token: it may only be used by
 *     its owner. Legacy/missing ownership = DENIED (never guessed).
 *   - role checks require an EXACT match; a missing role is never admin.
 */

export type Role = "admin" | "user" | "member";

/** Undefined/empty owner marks a shared SYSTEM (seeded/demo) record. */
export function isSystemRecord(ownerUserId: string | undefined | null): boolean {
  return ownerUserId === undefined || ownerUserId === null || ownerUserId === "";
}

/** Read visibility: own records + shared system records. Never other users'. */
export function canViewRecord(
  ownerUserId: string | undefined | null,
  viewerUserId: string,
): boolean {
  return isSystemRecord(ownerUserId) || ownerUserId === viewerUserId;
}

/**
 * Capability-token rule: an execution authorization may only be consumed by
 * its owner. A legacy authorization without an owner field is NOT usable —
 * unknown ownership must never become permitted (fail closed).
 */
export function canUseAuthorization(
  ownerUserId: string | undefined | null,
  userId: string,
): boolean {
  return !isSystemRecord(ownerUserId) && ownerUserId === userId;
}

/**
 * Privileged operations require an exact role match. `undefined` (no role on
 * record) is NEVER privileged. SPEC-GAP-008: role provisioning flow is not
 * specified; the initial admin must be provisioned out-of-band.
 */
export function requireRole(
  role: string | undefined | null,
  required: Role,
): boolean {
  return role === required;
}

/** Modes in which (simulated) order submission is permitted at all. */
export function executionAllowedInMode(mode: string | undefined | null): boolean {
  return mode === "PAPER" || mode === "DEMO";
}
