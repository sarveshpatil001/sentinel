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
import { ThemeToggle } from "@/components/ThemeToggle";

const pipelineStages = [
  "Get Market Prices",
  "Check Price Quality",
  "Spot Market Trends",
  "Strategy Rules",
  "Test on History",
  "Double-Check Accuracy",
  "Performance Score",
  "Check Safety Limits",
  "Safety Veto Check",
  "Approve Trade",
  "Place Order",
  "Confirm With Exchange",
  "Track Open Position",
  "Learn & Suggest Improvements",
];

const features = [
  {
    icon: DatabaseZap,
    title: "Clean, verified price data",
    body: "Every price candle is double-checked for accuracy. Missing or corrupted data is stopped immediately so trades only run on real numbers.",
  },
  {
    icon: BrainCircuit,
    title: "Exact math, zero guessing",
    body: "Profits, losses, win rates, and fees are calculated with 100% exact math. AI helps spot opportunities, but never guesses or alters financial math.",
  },
  {
    icon: Layers,
    title: "Locked & safe strategies",
    body: "Strategies follow clear, locked rules. When a strategy works, its rules cannot be accidentally broken or changed in the background.",
  },
  {
    icon: Scale,
    title: "Tested before real money",
    body: "Every strategy is thoroughly tested against past market history and sudden market drops before you ever trade with it.",
  },
  {
    icon: BadgeCheck,
    title: "Honest performance scores",
    body: "Strategies receive clear, easy-to-understand grades based on real test results, so you always know which setups perform best.",
  },
  {
    icon: ShieldCheck,
    title: "Automatic safety shield",
    body: "Strict limits prevent big drawdowns. If a trade looks uncertain or violates your rules, the safety shield blocks it instantly.",
  },
  {
    icon: Fingerprint,
    title: "Protected order placement",
    body: "Orders require explicit safety approval before being sent. Built-in protection prevents double-ordering or accidental duplicates.",
  },
  {
    icon: Radar,
    title: "Double-check exchange status",
    body: "If an exchange is slow or a connection drops, the system pauses and verifies what happened before trying anything else.",
  },
  {
    icon: ScrollText,
    title: "Permanent activity log",
    body: "Every trade idea, safety block, and completed order is permanently saved in a tamper-proof log so you can review everything.",
  },
];

const aiMay = [
  "Spot interesting market patterns and trends",
  "Suggest helpful strategy rules and settings",
  "Explain trading results in simple terms",
  "Alert you when market conditions change",
  "Suggest ways to improve trade settings",
];

const aiMayNot = [
  "Place or change orders without safety approval",
  "Bypass or ignore your risk limits",
  "Alter or fake your profit and loss numbers",
  "Use bad, broken, or missing price data",
  "Change your saved strategy rules behind your back",
  "See or export your exchange passwords",
];

const modes = [
  { name: "RESEARCH", label: "Research", tone: "quiet" },
  { name: "BACKTEST", label: "History Test", tone: "quiet" },
  { name: "PAPER", label: "Paper Trading (Active)", tone: "active" },
  { name: "DEMO", label: "Demo Mode", tone: "quiet" },
  { name: "CONTROLLED_LIVE", label: "Live Trading (Locked)", tone: "locked" },
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
            "radial-gradient(900px 480px at 72% -8%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 65%), radial-gradient(720px 420px at 8% 12%, color-mix(in srgb, var(--secondary) 12%, transparent), transparent 60%), var(--background)",
        }}
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="hidden text-[11px] text-muted-foreground sm:block">Automated Trading</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#ai-rules" className="transition-colors hover:text-foreground">Safety rules</a>
            <a href="#modes" className="transition-colors hover:text-foreground">Trading modes</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/auth"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
            >
              Sign in
            </Link>
            <Link
              to="/auth?returnTo=%2Fdashboard"
              className="group inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
            >
              Open app
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16">
          <motion.div {...fadeUp} className="max-w-3xl">
            <SectionLabel>Automated crypto & currency trading</SectionLabel>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              AI finds trade ideas.
              <span className="text-primary"> Strict safety rules protect your money.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Sentinel Prime makes automated trading safe and easy. Smart AI discovers market trends,
              while built-in safety shields automatically stop risky trades before they can hurt your balance.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/auth?returnTo=%2Fdashboard"
                className="group inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Start free paper trading
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                See how safety works
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-primary" /> Safe by default</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" /> Automatic loss limits</span>
              <span className="inline-flex items-center gap-1.5"><CircleSlash2 className="size-3.5 text-primary" /> Risk-free simulation</span>
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
                Live Safety Overview · Paper Mode
              </div>
              <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
                <Activity className="size-3 text-primary" />
                Safety Shield Active
              </div>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              {[
                {
                  label: "Price Data",
                  status: "VERIFIED",
                  detail: "All market prices are clean and verified in real time.",
                  icon: Waves,
                },
                {
                  label: "Risk Shield",
                  status: "PROTECTED",
                  detail: "Trades that exceed risk limits are automatically blocked.",
                  icon: ShieldCheck,
                },
                {
                  label: "Order Safety",
                  status: "SAFE",
                  detail: "Built-in protection prevents duplicate or accidental orders.",
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

        {/* How it works */}
        <section id="how-it-works" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>How safety works</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Every trade passes simple, strict safety checks.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Before any trade reaches an exchange, it travels through clear safety steps.
                No automated bot can skip checks or exceed risk limits.
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
                      stage === "Check Safety Limits" || stage === "Approve Trade"
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
                  <h3 className="text-sm font-semibold">Our core principle</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Not trading</span> is always better than placing
                    an <span className="font-medium text-foreground">unsafe trade</span>.
                    If market data looks corrupted or connection is uncertain, Sentinel safely pauses and waits.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>Features</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                A complete trading system built around your protection.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Discover ideas, test on market history, protect your balance, and improve over time — with clear controls at every step.
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
        <section id="ai-rules" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div {...fadeUp}>
              <SectionLabel>What AI can and cannot do</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Smart assistance with strict limits.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                AI helps you discover trends and analyze data. It never has permission to place random trades or ignore safety rules.
              </p>
            </motion.div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <motion.div
                {...fadeUp}
                className="rounded-2xl border border-border/70 bg-card p-6"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="size-4 text-primary" />
                  AI is allowed to
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
                  AI is NEVER allowed to
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
              <SectionLabel>Trading modes</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Safe simulation by default.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Sentinel Prime runs in paper simulation mode so you can try out strategies risk-free.
                Live real-money trading remains safely disabled until you are ready and explicitly approve it.
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
                  {m.label}
                </div>
              ))}
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.55, delay: 0.16 }}
              className="mt-8 grid gap-4 sm:grid-cols-3"
            >
              {[
                { icon: Gauge, title: "Test before you trust", body: "Check real performance and historical drawdown before deciding to run any strategy." },
                { icon: ShieldCheck, title: "Safe limits first", body: "If market conditions get strange or a connection is lost, trading pauses safely." },
                { icon: Activity, title: "Clear trade tracking", body: "See exactly why each trade was approved, filled, or blocked at any time." },
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
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Ready to explore automated trading safely?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Try out algorithms and simulate orders in paper mode with no real money at risk.
              </p>
              <div className="mt-8 flex justify-center">
                <Link
                  to="/auth?returnTo=%2Fdashboard"
                  className="group inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
                >
                  Open trading app
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Sentinel Prime" className="size-5 rounded" />
            <span>Sentinel Prime · Safe automated trading</span>
          </div>
          <div>Paper mode simulation · No financial advice</div>
        </div>
      </footer>
    </motion.div>
  );
}
