import type { ReactNode } from "react";

/** Domain state -> visual tone. UNKNOWN-family states are amber (never green). */
const TONE_BY_STATE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral" | "locked"> = {
  // data quality
  VALID: "ok",
  INCOMPLETE: "warn",
  STALE: "warn",
  MISSING: "bad",
  INVALID: "bad",
  FAILED: "bad",
  // checks
  PASS: "ok",
  FAIL: "bad",
  UNKNOWN: "warn",
  // validation
  COMPLETED: "ok",
  BLOCKED: "bad",
  INSUFFICIENT_DATA: "bad",
  QUEUED: "neutral",
  RUNNING: "info",
  // leakage
  NO_LEAKAGE_DETECTED: "ok",
  POSSIBLE_LEAKAGE: "warn",
  CONFIRMED_LEAKAGE: "bad",
  NOT_ASSESSABLE: "warn",
  // evidence
  STRONG: "ok",
  MODERATE: "info",
  WEAK: "warn",
  INSUFFICIENT: "bad",
  // fitness
  SUITABLE: "ok",
  MIXED: "warn",
  UNSUITABLE: "bad",
  // risk
  APPROVE: "ok",
  BLOCK: "bad",
  DENIED: "bad",
  // authorization
  APPROVED: "ok",
  EXPIRED: "warn",
  REVOKED: "bad",
  CONSUMED: "neutral",
  // orders
  CREATED: "neutral",
  VALIDATING: "info",
  AUTHORIZED: "info",
  READY: "info",
  SUBMITTING: "info",
  SUBMITTED: "info",
  ACKNOWLEDGED: "info",
  PARTIALLY_FILLED: "warn",
  FILLED: "ok",
  REJECTED: "bad",
  CANCELLED: "neutral",
  // monitoring
  ON_TRACK: "ok",
  WARNING: "warn",
  FAILING: "bad",
  // agents
  UNAVAILABLE: "warn",
  TIMEOUT: "warn",
  // misc
  SUCCESS: "ok",
  HEALTHY: "ok",
  MISMATCH: "bad",
  PAPER: "info",
  PROVISIONAL: "warn",
  SUPERSEDED: "neutral",
  ENGAGED: "bad",
  RELEASED: "ok",
  VALIDATION: "info",
  VERSION: "neutral",
  PROPOSAL: "info",
  HYPOTHESIS: "neutral",
  DEPLOYMENT_ELIGIBLE: "ok",
  MONITORING: "info",
  RETIRED: "neutral",
};

const TONE_CLASSES: Record<string, string> = {
  ok: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-600/25 bg-amber-600/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-600/25 bg-red-600/10 text-red-700 dark:text-red-300",
  info: "border-primary/25 bg-primary/10 text-primary",
  neutral: "border-border/70 bg-muted text-muted-foreground",
  locked: "border-border/70 bg-card text-muted-foreground",
};

export function StateBadge({ state, label }: { state: string; label?: string }) {
  const tone = TONE_BY_STATE[state] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {label ?? state}
    </span>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const accent: Record<string, string> = {
    neutral: "text-foreground",
    ok: "text-emerald-600 dark:text-emerald-300",
    warn: "text-amber-600 dark:text-amber-300",
    bad: "text-red-600 dark:text-red-300",
  };
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tracking-tight ${accent[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function CheckRow({
  check,
  status,
  detail,
}: {
  check: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/50 py-2.5 last:border-b-0">
      <StateBadge state={status} />
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-medium text-foreground">{check}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

/** Honest number formatting: null renders "N/A", never 0. */
export function fmt(value: number | null | undefined, opts?: { pct?: boolean; digits?: number }) {
  if (value === null || value === undefined || Number.isFinite(value) === false) return "N/A";
  const digits = opts?.digits ?? 2;
  const rendered = value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return opts?.pct ? `${rendered}%` : rendered;
}

export function fmtPct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isFinite(value) === false) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtTime(ms: number | null | undefined) {
  if (!ms) return "N/A";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/80 bg-background/50 px-6 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
