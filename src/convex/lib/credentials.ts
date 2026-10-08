/**
 * SENTINEL PRIME — CREDENTIAL HANDLING (Section 16 secret rules)
 *
 * Pure helpers. Design contract, enforced by tests (TEST-SEC-CRED-*):
 *   - Raw key material is an INPUT-ONLY value. It is fingerprinted and masked,
 *     then dropped. Nothing in this module ever returns the raw key.
 *   - A fingerprint is NOT encryption and NOT a vault. It is a one-way digest
 *     used for identity/equality checks. Production secret storage requires a
 *     KMS/vault (SPEC-GAP-007).
 *   - Display helpers are REDACTED by construction: the only key-derived value
 *     any UI or log may contain is the masked suffix (last 4).
 */

export type ProviderKind = "CRYPTO_EXCHANGE" | "FOREX_BROKER" | "PLATFORM_BRIDGE";
export type AdapterState = "SIMULATED" | "NOT_CONFIGURED";

export interface ProviderSpec {
  provider: string;
  kind: ProviderKind;
  adapter: AdapterState;
  note: string;
}

/**
 * Honest provider catalog: adapters that do not exist in this build are
 * labeled NOT_CONFIGURED. Rule 18 — provider capabilities are never fabricated.
 */
export const PROVIDERS: ProviderSpec[] = [
  { provider: "SIM-CRYPTO-PROVIDER", kind: "CRYPTO_EXCHANGE", adapter: "SIMULATED", note: "Built-in simulated crypto adapter (paper execution engine)." },
  { provider: "SIM-FX-PROVIDER", kind: "FOREX_BROKER", adapter: "SIMULATED", note: "Built-in simulated FX adapter (paper execution engine)." },
  { provider: "BINANCE", kind: "CRYPTO_EXCHANGE", adapter: "NOT_CONFIGURED", note: "No adapter implemented in this build — connection is recorded but connectivity stays NOT VERIFIED." },
  { provider: "COINBASE", kind: "CRYPTO_EXCHANGE", adapter: "NOT_CONFIGURED", note: "No adapter implemented in this build — connectivity NOT VERIFIED." },
  { provider: "KRAKEN", kind: "CRYPTO_EXCHANGE", adapter: "NOT_CONFIGURED", note: "No adapter implemented in this build — connectivity NOT VERIFIED." },
  { provider: "METAAPI", kind: "PLATFORM_BRIDGE", adapter: "NOT_CONFIGURED", note: "Legacy ARISE bridge class — adapter NOT IMPLEMENTED here (see legacy component report)." },
  { provider: "METATRADER_5", kind: "PLATFORM_BRIDGE", adapter: "NOT_CONFIGURED", note: "Legacy ARISE platform class — adapter NOT IMPLEMENTED here." },
  { provider: "OANDA", kind: "FOREX_BROKER", adapter: "NOT_CONFIGURED", note: "No adapter implemented in this build — connectivity NOT VERIFIED." },
  { provider: "INTERACTIVE_BROKERS", kind: "FOREX_BROKER", adapter: "NOT_CONFIGURED", note: "No adapter implemented in this build — connectivity NOT VERIFIED." },
  { provider: "CUSTOM", kind: "PLATFORM_BRIDGE", adapter: "NOT_CONFIGURED", note: "Custom endpoint — adapter NOT IMPLEMENTED here." },
];

/** Read-only permissions are the DEFAULT. Execution permissions are opt-in. */
export const ALL_PERMISSIONS = [
  "READ_ACCOUNT",
  "READ_BALANCES",
  "READ_POSITIONS",
  "READ_ORDERS",
  "SUBMIT_ORDERS",
  "CANCEL_ORDERS",
] as const;

export const EXECUTION_PERMISSIONS = ["SUBMIT_ORDERS", "CANCEL_ORDERS"];

export function getProviderSpec(provider: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.provider === provider) ?? null;
}

export interface CredentialInput {
  provider: string;
  label: string;
  environment: string;
  accountRef: string;
  apiKey: string;
  apiSecret?: string;
  permissions: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Deterministic, fail-closed input validation. No guesses about formats. */
export function validateCredentialInput(input: CredentialInput): ValidationResult {
  const errors: string[] = [];

  if (!getProviderSpec(input.provider)) {
    errors.push(`Unknown provider "${input.provider}" — not in the approved provider catalog.`);
  }
  if (input.label.trim().length < 3 || input.label.length > 64) {
    errors.push("Label must be 3–64 characters.");
  }
  if (input.accountRef.trim().length === 0 || input.accountRef.length > 128) {
    errors.push("Account reference must be 1–128 characters.");
  }
  if (typeof input.apiKey !== "string" || input.apiKey.length < 16 || input.apiKey.length > 256) {
    errors.push("API key must be 16–256 characters.");
  }
  if (input.apiSecret !== undefined && (input.apiSecret.length > 256 || input.apiSecret.length === 0)) {
    errors.push("API secret must be 1–256 characters when provided.");
  }
  if (input.environment !== "PAPER" && input.environment !== "DEMO") {
    errors.push(
      "Environment must be PAPER or DEMO. Live credential ingestion is disabled until the controlled-live readiness review (Sections 27/30).",
    );
  }
  const unknownPerms = input.permissions.filter(
    (p) => !(ALL_PERMISSIONS as readonly string[]).includes(p),
  );
  if (unknownPerms.length > 0) {
    errors.push(`Unknown permissions: ${unknownPerms.join(", ")}.`);
  }
  if (input.permissions.length === 0) {
    errors.push("At least one permission is required (read-only by default).");
  }

  return { ok: errors.length === 0, errors };
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
 * One-way fingerprint of key material. Prefers SHA-256 via Web Crypto and
 * falls back to a deterministic FNV-1a chain; which algorithm was used is
 * recorded honestly alongside the digest. NEVER returns the input.
 */
export async function fingerprintSecret(material: string): Promise<{
  fingerprint: string;
  algo: "SHA-256" | "FNV1A-64";
}> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const bytes = new TextEncoder().encode(material);
      const digest = await subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return { fingerprint: hex, algo: "SHA-256" };
    }
  } catch {
    // fall through to deterministic fallback
  }
  return { fingerprint: fnv1a64(material) + fnv1a64([...material].reverse().join("")), algo: "FNV1A-64" };
}

/** The ONLY key-derived value allowed in any display or log: last 4. */
export function maskKey(key: string): string {
  const tail = key.length <= 4 ? "" : key.slice(-4);
  return `••••${tail}`;
}

/**
 * Redacted connection summary. Contract: the raw key never appears here —
 * enforced by TEST-SEC-CRED-005.
 */
export function redactedSummary(connection: {
  connectionId: string;
  provider: string;
  label: string;
  keyMasked: string;
  keyFingerprint: string;
  status: string;
}): string {
  return `${connection.connectionId} ${connection.provider} "${connection.label}" key ${connection.keyMasked} fp ${connection.keyFingerprint.slice(0, 12)}… status ${connection.status}`;
}
