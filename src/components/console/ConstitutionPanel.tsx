import { AlertTriangle, FileSearch, Landmark, ScrollText } from "lucide-react";
import { Panel, StateBadge } from "./shared";

const specGaps = [
  {
    id: "SPEC-GAP-001",
    domain: "Architecture",
    gap: "The constitution targets Python/FastAPI/PostgreSQL/TimescaleDB/Redis/S3/Docker. The mandated implementation environment (Freebuff) is Vite + React + Convex, with no Python runtime, no PostgreSQL and no Redis available.",
    handling: "Convex functions + ConvexDB provide the API, persistence and job layers with the SAME domain semantics and safety invariants. No safety rule was weakened. The architecture change is reported here per Rule 2 and requires an ADR before production progression.",
    status: "OPEN — ADR REQUIRED",
  },
  {
    id: "SPEC-GAP-002",
    domain: "Risk",
    gap: "The constitution forbids inventing numerical risk limits, and none were provided.",
    handling: "The risk engine evaluates only against a versioned risk policy record. The seeded policy is marked PROVISIONAL and its numerics are surfaced in the UI for ratification. The engine itself invents no thresholds.",
    status: "OPEN — RATIFICATION REQUIRED",
  },
  {
    id: "SPEC-GAP-003",
    domain: "Evidence",
    gap: "No approved evidence methodology ('Trust Score') was specified.",
    handling: "Evidence uses an explicit, versioned, fail-closed rubric (sp-evidence-rubric-1.0.0) whose rules and rationale are shown per run. It is labeled PROPOSED methodology; AI cannot alter its output.",
    status: "OPEN — RATIFICATION REQUIRED",
  },
  {
    id: "SPEC-GAP-004",
    domain: "Validation",
    gap: "Train/OOS split percentages 'MUST NOT be invented', yet none were supplied.",
    handling: "The engine refuses to compute OOS results without a split declared in the validation configuration (returns NOT_ASSESSABLE). The seeded configuration declares 0.3 explicitly and is flagged for ADR ratification.",
    status: "OPEN — RATIFICATION REQUIRED",
  },
  {
    id: "SPEC-GAP-005",
    domain: "Data / Audit",
    gap: "TimescaleDB decimal precision and SHA-256 + externally anchored audit chains are unavailable in this environment.",
    handling: "Financial arithmetic uses deterministic IEEE-754 with explicit rounding helpers (documented); audit uses a deterministic hash chain that is tamper-EVIDENT, not tamper-PROOF. Both limitations are stated rather than hidden.",
    status: "OPEN",
  },
  {
    id: "SPEC-GAP-006",
    domain: "AI Gateway",
    gap: "No AI model provider credentials are configured in this environment.",
    handling: "Agents are registered with deny-by-default scoped permissions and report UNAVAILABLE. No output is fabricated to simulate a model. Wiring an AI gateway requires provider keys and remains future approved work.",
    status: "OPEN",
  },
  {
    id: "SPEC-GAP-007",
    domain: "Secrets / Credentials",
    gap: "No KMS or secret vault exists in this environment, yet broker/platform API keys must be connected.",
    handling: "The Broker & API keys panel stores ONLY a one-way fingerprint (SHA-256 via Web Crypto, algorithm recorded per record) plus a masked suffix; raw key material is dropped inside the register/rotate mutation and is never returned, logged or audited. A fingerprint is NOT a vault: production requires a KMS/vault integration plus provider-side revocation workflows before any live credential path is considered.",
    status: "OPEN — VAULT REQUIRED FOR LIVE",
  },
  {
    id: "SPEC-GAP-008",
    domain: "Authorization / Roles",
    gap: "No process was specified for provisioning the initial administrator, yet initialization and privileged mutations require the admin role.",
    handling: "Privileged operations are gated by the server-side admin role and every denial is audited. NOTHING is auto-provisioned (the first registered user is NOT admin). The supported out-of-band procedure is a Convex dashboard / deployment-admin role assignment; the operational runbook requires product-owner approval.",
    status: "OPEN — PROVISIONING RUNBOOK REQUIRED",
  },
  {
    id: "SPEC-GAP-009",
    domain: "Execution / Accounts",
    gap: "Multi-user execution on a SHARED paper account has no specified tenancy model: one user's UNKNOWN order blocks new exposure for everyone (deliberate, fail-closed) and risk accounting is pooled.",
    handling: "DECISION A (recorded): the shared-account model is PRESERVED — the exposure gate stays GLOBAL and fail-closed while any order is UNKNOWN, and risk accounting stays account-global. Future multi-user execution requires ISOLATED per-user account ledgers with per-account exposure gates as a SEPARATE architectural requirement (docs/execution-architecture-decisions.md) — NOT implemented here.",
    status: "OPEN — SEPARATE ARCHITECTURAL REQUIREMENT",
  },
  {
    id: "SPEC-GAP-010",
    domain: "Execution / Reconciliation",
    gap: "No trusted server-side reconciliation service exists to resolve another user's UNKNOWN orders, and no authoritative provider ledger exists (all adapters SIMULATED/NOT_CONFIGURED).",
    handling: "DECISION B (recorded): ordinary users may reconcile ONLY their own + shared system orders, with evidence-based transitions (an UNKNOWN order is NEVER inferred failed from a timeout), idempotent replays, state-transition validation and audit. The cross-owner trusted service is PROPOSED (smallest design in docs/execution-architecture-decisions.md) and NOT implemented — it requires approval of the evidence contract first.",
    status: "OPEN — DESIGN AWAITING APPROVAL",
  },
];

const architectureConflicts = [
  {
    item: "Backend language / framework",
    specified: "Python + FastAPI + Pydantic v2 + SQLAlchemy + Alembic",
    implemented: "TypeScript + Convex functions (queries/mutations) with typed validators",
    impact: "Domain logic is deterministic and equivalently testable; deployment/runtime differs.",
  },
  {
    item: "Database",
    specified: "PostgreSQL + TimescaleDB (hypertables, SQL semantics)",
    implemented: "Convex document database with indexed tables and transactional mutations",
    impact: "No SQL/RLS; ownership enforcement is done in function layer. Numeric precision policy differs (SPEC-GAP-005).",
  },
  {
    item: "Cache / queue",
    specified: "Redis + Redis Streams",
    implemented: "Convex transactional writes + reactive queries (no external queue)",
    impact: "Redis is not the sole authority for anything here — persistence is the Convex DB.",
  },
  {
    item: "Frontend framework",
    specified: "Next.js",
    implemented: "Vite + React 19 + react-router (Freebuff platform requirement)",
    impact: "Presentation only; the frontend holds zero financial authority in both designs.",
  },
  {
    item: "Charts",
    specified: "TradingView Lightweight Charts",
    implemented: "Recharts (already present in the project dependency set)",
    impact: "Dependency policy: no new dependencies added without approval (Section 03).",
  },
  {
    item: "Observability",
    specified: "Prometheus + Grafana + structured JSON logging",
    implemented: "Correlation-ID structured audit + queryable domain state",
    impact: "Metrics scraping/alerting NOT VERIFIED in this environment.",
  },
];

const securityRisks = [
  { risk: "Single-tenant demo deployment; role model (USER/ADMIN) exists but privileged-action MFA is not wired", level: "MEDIUM", mitigation: "Auth required on every query/mutation; role escalation paths documented; privileged MFA flagged for ADR." },
  { risk: "Audit chain is tamper-evident, not tamper-proof (FNV-1a, no external anchoring)", level: "MEDIUM", mitigation: "Chain verification runs in the console; SHA-256 + anchoring specified as required production work (SPEC-GAP-005)." },
  { risk: "Console verifies a WINDOW of the audit chain (self-attested anchor) — window linkage is NOT whole-history proof", level: "MEDIUM", mitigation: "Results are labeled FULL_CHAIN vs WINDOW vs EMPTY; a range not starting at record 1 is never presented as whole-history integrity (docs/execution-architecture-decisions.md)." },
  { risk: "No real exchange/broker integration exists — provider adapters are simulated", level: "LOW (demo)", mitigation: "PROHIBITED PATHS structurally absent: no AI→exchange, frontend→exchange, learning→live-mutation code exists anywhere in the build." },
  { risk: "Prompt-injection surface exists when an AI gateway is later connected (news/web text)", level: "MEDIUM (future)", mitigation: "All external text is treated as untrusted input to scoped agents; agents hold no credentials or execution tools to steal." },
  { risk: "Secrets management: no secrets are stored in source; none are required by this build", level: "LOW", mitigation: "Environment keys are handled by the platform Keys UI; execution credentials would be isolated to the execution subsystem only." },
];

const implementationMap = [
  { domain: "Foundation", current: "Freebuff Vite/React/Convex template", target: "Sentinel Prime domains on Convex", files: "src/convex/schema.ts, src/index.css", security: "baseline", safety: "mode defaults to PAPER" },
  { domain: "Identity + Security", current: "Convex Auth (email OTP + anonymous)", target: "authenticated API boundary, RBAC, audit", files: "src/convex/auth.ts, lib/store.ts", security: "auth required on all functions", safety: "fail-closed on missing auth" },
  { domain: "Market Data", current: "none", target: "ingestion, normalization, validation, provenance, snapshots", files: "lib/dataQuality.ts, seed.ts", security: "source provenance recorded", safety: "FAILED≠EMPTY, MISSING≠ZERO enforced" },
  { domain: "Quant Engine", current: "none", target: "deterministic indicators + statistics", files: "lib/quant.ts", security: "n/a", safety: "pure functions, N/A never fabricated" },
  { domain: "Strategy Engine", current: "none", target: "structured immutable versions + genealogy", files: "seed.ts, workflows.ts, lib/backtest.ts", security: "no executable code", safety: "Rule 15 immutability enforced in code paths" },
  { domain: "Validation", current: "none", target: "quality gate, simulation, integrity, leakage, stress, OOS", files: "lib/backtest.ts, lib/pipeline.ts", security: "n/a", safety: "conservative intrabar, blocked ≠ zero" },
  { domain: "Evidence + Fitness", current: "none", target: "versioned rubric, segmented fitness", files: "lib/evidence.ts, lib/fitness.ts", security: "n/a", safety: "AI cannot upgrade evidence" },
  { domain: "Risk", current: "none", target: "deterministic engine + veto, versioned policy", files: "lib/risk.ts", security: "no bypass path", safety: "UNKNOWN → no trade" },
  { domain: "Execution + Reconciliation", current: "none (legacy ARISE MT5/MetaApi absent from repo)", target: "authorization → order lifecycle → reconcile", files: "lib/execution.ts, workflows.ts", security: "scoped authorizations, idempotency", safety: "UNKNOWN first-class, no blind retry" },
  { domain: "Monitoring + Learning", current: "none", target: "state monitoring, isolated learning → new versions", files: "workflows.ts", security: "no live mutation path", safety: "learning isolation enforced" },
  { domain: "AI Gateway + Agents", current: "none", target: "registry with deny-by-default scoping", files: "seed.ts, AgentsPanel", security: "no credentials to agents", safety: "UNAVAILABLE ≠ fabricated output" },
  { domain: "Audit + Observability", current: "none", target: "hash-chained append-only audit with correlation IDs", files: "lib/audit.ts, lib/store.ts", security: "tamper-evident", safety: "every decision recorded" },
];

const legacyReport = [
  "Repository inspection found NO legacy ARISE components: no MT5, no MetaApi, no Python backend, no Docker compose, no CI workflows, no stored provider credentials (secret scan limited to project files; no values printed).",
  "The repository consisted of the Freebuff starter template (landing/auth/dashboard placeholders). Classification of each: REUSE (auth, routing, UI kit, theme system), ADAPT (dashboard → control console), REBUILD (landing page), REJECT (placeholder content).",
  "No live-execution path, no unsafe shortcut, and no admin bypass existed or was created.",
];

function ReportBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ScrollText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Panel
      title={title}
      action={<Icon className="size-4 text-muted-foreground" />}
    >
      <div className="space-y-3">{children}</div>
    </Panel>
  );
}

export default function ConstitutionPanel() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-primary/25 bg-accent/50 px-6 py-5">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-semibold">Master engineering constitution — consolidated Phases 01–19</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This build follows the SPEC → INSPECT → PLAN → IMPLEMENT → TEST → VERIFY → REPORT loop.
              Where the constitution conflicted with the mandated implementation environment, nothing was
              silently changed: the conflicts and gaps below are the required STOP-and-report artifacts
              (Sections 21, 33, 36). Live trading is not implemented, not enabled, and not auto-resumable.
            </p>
          </div>
        </div>
      </div>

      <ReportBlock icon={AlertTriangle} title="Specification gap report">
        {specGaps.map((g) => (
          <div key={g.id} className="rounded-xl border border-amber-600/25 bg-amber-600/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">{g.id}</span>
              <StateBadge state="UNKNOWN" label={g.domain} />
              <span className="ml-auto text-[10px] font-medium text-amber-700 dark:text-amber-300">{g.status}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Gap:</span> {g.gap}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Handling:</span> {g.handling}
            </p>
          </div>
        ))}
      </ReportBlock>

      <ReportBlock icon={FileSearch} title="Architecture conflict report">
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 font-medium">Specified</th>
                <th className="px-3 py-2 font-medium">Implemented here</th>
                <th className="px-3 py-2 font-medium">Impact</th>
              </tr>
            </thead>
            <tbody>
              {architectureConflicts.map((c) => (
                <tr key={c.item} className="border-t border-border/50 align-top">
                  <td className="px-3 py-2 font-medium">{c.item}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.specified}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.implemented}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportBlock>

      <ReportBlock icon={ScrollText} title="Security risk report">
        {securityRisks.map((r) => (
          <div key={r.risk} className="flex flex-wrap items-start gap-3 rounded-xl border border-border/60 bg-background/60 p-4">
            <StateBadge state={r.level.startsWith("MEDIUM") ? "UNKNOWN" : "PASS"} label={r.level} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-foreground">{r.risk}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.mitigation}</div>
            </div>
          </div>
        ))}
      </ReportBlock>

      <ReportBlock icon={Landmark} title="Implementation map">
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Current state</th>
                <th className="px-3 py-2 font-medium">Target state</th>
                <th className="px-3 py-2 font-medium">Files</th>
                <th className="px-3 py-2 font-medium">Security impact</th>
                <th className="px-3 py-2 font-medium">Safety impact</th>
              </tr>
            </thead>
            <tbody>
              {implementationMap.map((m) => (
                <tr key={m.domain} className="border-t border-border/50 align-top">
                  <td className="px-3 py-2 font-medium">{m.domain}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.current}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.target}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{m.files}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.security}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.safety}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportBlock>

      <ReportBlock icon={ScrollText} title="Legacy component report">
        {legacyReport.map((line, i) => (
          <p key={i} className="text-[11px] leading-relaxed text-muted-foreground">
            · {line}
          </p>
        ))}
      </ReportBlock>

      <ReportBlock icon={ScrollText} title="Verification status (honest accounting)">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["TypeScript typecheck", "PASS — `tsc -b --noEmit` clean"],
            ["Convex functions push", "PASS — `convex dev --once` clean"],
            ["Deterministic engines", "Implemented as pure functions; formal pytest-style suites NOT RUN (no Python runtime in this environment)"],
            ["Security testing", "NOT VERIFIED — SAST/DAST/pen-test not run; see security risk report"],
            ["Performance / resource", "NOT VERIFIED — no benchmark harness in this environment"],
            ["Provider verification", "NOT APPLICABLE — providers are simulated; no live provider exists"],
            ["Controlled-live readiness", "NOT VERIFIED — gates listed in Overview; activation deliberately not implemented"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5">
              <div className="text-[11px] font-medium text-foreground">{k}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{v}</div>
            </div>
          ))}
        </div>
      </ReportBlock>
    </div>
  );
}
