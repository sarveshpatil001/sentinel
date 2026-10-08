import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bot,
  BrainCircuit,
  Check,
  CircleSlash2,
  DatabaseZap,
  Fingerprint,
  Gauge,
  Layers,
  Lock,
  Radar,
  Scale,
  ScrollText,
  ShieldCheck,
  Waves,
  X,
} from "lucide-react";
import { Link } from "react-router";
import logo from "@/assets/logo.svg";

const pipelineStages = [
  "Market Data",
  "Data Validation",
  "Market Intelligence",
  "Regime",
  "Strategy",
  "Backtest",
  "Validation",
  "Evidence",
  "Bot Fitness",
  "Risk Evaluation",
  "Deterministic Risk Veto",
  "Execution Authorization",
  "Execution",
  "Reconciliation",
  "Monitoring",
  "Learning",
  "New Version",
  "Revalidation",
];

const features = [
  {
    icon: DatabaseZap,
    title: "Provenance-first market data",
    body: "Every candle carries event, publication, availability and receipt times. FAILED is never treated as EMPTY, MISSING is never treated as ZERO, and defective feeds are classified — never silently repaired.",
  },
  {
    icon: BrainCircuit,
    title: "Deterministic quant engine",
    body: "PnL, equity, drawdown, Sharpe, Sortino, expectancy and fill simulation are computed by pure deterministic code. AI interprets results; it never calculates or replaces them.",
  },
  {
    icon: Layers,
    title: "Immutable strategy versions",
    body: "Strategies are structured definitions — no arbitrary executable code. A change creates a new version with preserved genealogy. Validated history can never be mutated.",
  },
  {
    icon: Scale,
    title: "Validation before trust",
    body: "Chronology, look-ahead and leakage tests, explicit cost and execution models, conservative intrabar resolution, stress scenarios and distinct out-of-sample evaluation. Backtest is never treated as trust.",
  },
  {
    icon: BadgeCheck,
    title: "Evidence & bot fitness",
    body: "Evidence levels are computed by a versioned rubric from deterministic results — an AI cannot upgrade WEAK to STRONG. Fitness is segmented by market, regime, volatility, liquidity and spread.",
  },
  {
    icon: ShieldCheck,
    title: "Deterministic risk veto",
    body: "Risk AI may recommend. The deterministic risk veto decides. Unknown risk state means no trade. There is no admin force-trade path and no bypass.",
  },
  {
    icon: Fingerprint,
    title: "Scoped execution authorization",
    body: "Orders require an unexpired authorization matching account, strategy version, market, side, quantity and mode. Idempotency keys make every external mutation duplicate-safe.",
  },
  {
    icon: Radar,
    title: "Reconciliation & UNKNOWN",
    body: "A provider timeout is UNKNOWN — never assumed failure, never blindly retried. Reconciliation against provider state resolves it before any new exposure is allowed.",
  },
  {
    icon: ScrollText,
    title: "Tamper-evident audit",
    body: "Every decision, veto, authorization, order state change and learning event lands in an append-only hash-chained log with full correlation identifiers.",
  },
];

const aiMay = [
  "Generate market intelligence and hypotheses",
  "Propose structured strategy versions",
  "Interpret deterministic results and evidence",
  "Recommend risk actions and monitoring responses",
  "Classify failures and propose experiments",
];

const aiMayNot = [
  "Submit, cancel or modify orders",
  "Bypass or override the deterministic risk veto",
  "Calculate or alter financial results",
  "Mark failed data as valid",
  "Modify validated strategies or audit history",
  "Access execution credentials",
];

const modes = [
  { name: "RESEARCH", tone: "quiet" },
  { name: "BACKTEST", tone: "quiet" },
  { name: "OUT_OF_SAMPLE", tone: "quiet" },
  { name: "PAPER", tone: "active" },
  { name: "DEMO", tone: "quiet" },
  { name: "CONTROLLED_LIVE", tone: "locked" },
  { name: "DISABLED", tone: "quiet" },
];

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.22, 0.61, 0.36, 1] as const },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground">
      <span className="size-1.5 rounded-full bg-primary" />
      {children}
    </div>
  );
}

export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen flex flex-col"
    >
      {/* Ambient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 480px at 72% -8%, oklch(0.505 0.104 193 / 0.10), transparent 65%), radial-gradient(720px 420px at 8% 12%, oklch(0.545 0.095 250 / 0.07), transparent 60%), var(--background)",
        }}
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="text-[11px] text-muted-foreground">Trading Intelligence System</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#authority" className="transition-colors hover:text-foreground">Authority chain</a>
            <a href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</a>
            <a href="#boundary" className="transition-colors hover:text-foreground">AI boundary</a>
            <a href="#modes" className="transition-colors hover:text-foreground">Modes</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/auth?returnTo=%2Fdashboard"
              className="group inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
            >
              Open console
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16">
          <motion.div {...fadeUp} className="max-w-3xl">
            <SectionLabel>Autonomous crypto + forex trading intelligence</SectionLabel>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              AI proposes.
              <span className="text-primary"> Deterministic systems decide.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Sentinel Prime is a multi-agent trading intelligence and execution system where
              data validity, quantitative results, risk, authorization and execution remain
              under deterministic control. When evidence is thin or state is unknown, the
              answer is no trade.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/auth?returnTo=%2Fdashboard"
                className="group inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Enter the control console
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#authority"
                className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                Trace the safety chain
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-primary" /> Fail closed by design</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" /> Risk veto is final authority</span>
              <span className="inline-flex items-center gap-1.5"><CircleSlash2 className="size-3.5 text-primary" /> Live trading stays gated</span>
            </div>
          </motion.div>

          {/* Hero console schematic */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
            className="mt-14 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-24px_rgba(15,23,42,0.18)]"
          >
            <div className="flex items-center gap-2 border-b border-border/70 px-5 py-3">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
              </div>
              <div className="ml-2 text-xs font-medium text-muted-foreground">
                console · authority chain · paper mode
              </div>
              <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
                <Activity className="size-3" />
                deterministic
              </div>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              {[
                {
                  label: "Data quality",
                  status: "VALID",
                  detail: "availability_time ≤ decision_time · gaps preserved",
                  icon: Waves,
                },
                {
                  label: "Risk veto",
                  status: "APPROVE / BLOCK",
                  detail: "unknown critical state ⇒ no trade",
                  icon: ShieldCheck,
                },
                {
                  label: "Order state",
                  status: "UNKNOWN → RECONCILE",
                  detail: "timeouts never auto-retry · idempotent submissions",
                  icon: Radar,
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-border/70 bg-background/60 p-4 transition-colors hover:border-primary/35 hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <card.icon className="size-3.5 text-primary" />
                      {card.label}
                    </div>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary">
                      {card.status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{card.detail}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Authority chain */}
        <section id="authority" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>Master authority chain</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                No component may skip required authority.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Every action travels the same chain. The orchestrator cannot bypass domain
                safety, the frontend cannot authorize financial action, and learning can never
                mutate a live strategy.
              </p>
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-10 flex flex-wrap gap-2"
            >
              {pipelineStages.map((stage, i) => (
                <div key={stage} className="flex items-center gap-2">
                  <div
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      stage === "Deterministic Risk Veto" || stage === "Execution Authorization"
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 bg-card text-foreground/85"
                    }`}
                  >
                    <span className="mr-1.5 text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    {stage}
                  </div>
                  {i < pipelineStages.length - 1 && (
                    <ArrowRight className="size-3 text-muted-foreground/50" />
                  )}
                </div>
              ))}
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="mt-10 rounded-2xl border border-primary/25 bg-accent/50 p-6"
            >
              <div className="flex items-start gap-3">
                <Scale className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold">The operating preference</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">NO TRADE</span> is preferable
                    to an <span className="font-medium text-foreground">UNTRUSTED TRADE</span>.
                    Unknown remains unknown until verified. Failed remains failed until
                    recovered and validated. Missing remains missing.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="capabilities" className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>Capabilities</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                A complete intelligence loop — not just a backtester.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Understand → Create → Test → Trust → Trade → Monitor → Learn → Improve →
                Understand again, with deterministic controls at every hand-off.
              </p>
            </motion.div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => (
                <motion.div
                  key={f.title}
                  {...fadeUp}
                  transition={{ duration: 0.5, delay: Math.min(i * 0.05, 0.3) }}
                  className="group rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_2px_6px_rgba(15,23,42,0.05),0_18px_40px_-26px_rgba(15,23,42,0.28)]"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary transition-colors group-hover:bg-primary/15">
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* AI boundary */}
        <section id="boundary" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>AI authority boundary</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Confidence is not truth. An agent is not an authority.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Twenty-two specialized agents and deterministic components, deny-by-default
                permissions, scoped data access, and no path from any model to an exchange.
              </p>
            </motion.div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <motion.div
                {...fadeUp}
                className="rounded-2xl border border-border/70 bg-card p-6"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="size-4 text-primary" />
                  AI may
                </div>
                <ul className="mt-4 space-y-3">
                  {aiMay.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>

              <motion.div
                {...fadeUp}
                transition={{ duration: 0.55, delay: 0.1 }}
                className="rounded-2xl border border-destructive/25 bg-card p-6"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CircleSlash2 className="size-4 text-destructive" />
                  AI may not
                </div>
                <ul className="mt-4 space-y-3">
                  {aiMayNot.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <X className="mt-0.5 size-4 shrink-0 text-destructive/80" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Modes */}
        <section id="modes" className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>Product modes</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Modes never silently become more dangerous.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                This deployment runs in PAPER: real strategy, validation and risk logic with
                simulated execution. Controlled live remains disabled until a readiness review
                verifies every gate — and activation is a separate, explicit approval.
              </p>
            </motion.div>

            <motion.div {...fadeUp} transition={{ duration: 0.55, delay: 0.1 }} className="mt-8 flex flex-wrap gap-2.5">
              {modes.map((m) => (
                <div
                  key={m.name}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium tracking-wide ${
                    m.tone === "active"
                      ? "border-primary/45 bg-primary/10 text-primary"
                      : m.tone === "locked"
                        ? "border-border/70 bg-card text-muted-foreground"
                        : "border-border/70 bg-card/70 text-muted-foreground"
                  }`}
                >
                  {m.tone === "active" && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
                  {m.tone === "locked" && <Lock className="size-3" />}
                  {m.name}
                </div>
              ))}
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.55, delay: 0.16 }}
              className="mt-8 grid gap-4 sm:grid-cols-3"
            >
              {[
                { icon: Gauge, title: "Evidence before trust", body: "A backtest result is not a valid strategy. Trust requires validation, evidence and fitness — each computed, each versioned." },
                { icon: ShieldCheck, title: "Fail closed everywhere", body: "Security fails closed. Risk fails closed. Execution fails closed. Reconciliation fails closed. Unknown states block, never approve." },
                { icon: Activity, title: "Complete traceability", body: "Correlation IDs tie every workflow, agent run, risk decision, authorization and order into the audit chain." },
              ].map((c) => (
                <div key={c.title} className="rounded-2xl border border-border/70 bg-card p-6">
                  <c.icon className="size-5 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-24">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div
              {...fadeUp}
              className="relative overflow-hidden rounded-3xl border border-border/70 bg-card px-8 py-14 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_28px_60px_-32px_rgba(15,23,42,0.30)]"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(640px 300px at 50% -20%, oklch(0.505 0.104 193 / 0.12), transparent 70%)",
                }}
              />
              <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
                Operate the system that stays safe when everything else fails.
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-muted-foreground">
                Open the console to watch data quality gates, deterministic validation,
                evidence rubrics, the risk veto, authorization scopes and reconciliation
                work as one chain — on live paper state.
              </p>
              <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/auth?returnTo=%2Fdashboard"
                  className="group inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
                >
                  Launch Sentinel Prime console
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-background px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Create an account
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-6 rounded-md" />
            <span className="text-sm font-medium tracking-tight">Sentinel Prime</span>
            <span className="text-xs text-muted-foreground">
              · deterministic trading intelligence
            </span>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            Synthetic seeded market data · paper execution only · evidence levels are not
            guarantees · nothing on this page is financial advice
          </p>
        </div>
      </footer>
    </motion.div>
  );
}
