import { ArrowRight, Bot, Check, CircleSlash, Lock, Rocket, Scale, ShieldCheck, Sparkles, X } from "lucide-react";
import logo from "@/assets/logo.svg";
import { ThemeToggle } from "@/components/ThemeToggle";

const sections = [
  {
    id: "how-it-works",
    icon: Rocket,
    title: "How it works",
    subtitle: "Four steps from idea to a safe trade.",
    items: [
      {
        title: "Describe the idea",
        body: "Tell the system the market, time frame and setup you want to test. Structured input only.",
      },
      {
        title: "Check the data",
        body: "Every price candle is scanned for gaps, duplicates and corruption. Broken data stops the run.",
      },
      {
        title: "Run the math",
        body: "Indicators, risk veto and performance tests are computed exactly, with no AI involvement in the numbers.",
      },
      {
        title: "Try it safely",
        body: "Approve a proposal and watch it run in paper mode. Real money stays disabled until you explicitly enable it.",
      },
    ],
  },
  {
    id: "guardrails",
    icon: ShieldCheck,
    title: "Guardrails that always win",
    subtitle: "AI can suggest. The deterministic layer decides.",
    items: [
      {
        title: "Deny by default",
        body: "No agent holds credentials, shell access or the ability to approve itself.",
      },
      {
        title: "No hidden approval",
        body: "Orders never reach an exchange without a scoped, verified proposal first.",
      },
      {
        title: "One wrong number",
        body: "A failed data gate or blocked risk check pauses everything. Nothing is fabricated to keep going.",
      },
    ],
  },
  {
    id: "designed-for-people",
    icon: Sparkles,
    title: "Designed for people",
    subtitle: "Clear language, plain numbers, honest status.",
    items: [
      {
        title: "Plain-English feedback",
        body: "Every outcome is translated for normal readers. No code, no jargon, just what happened.",
      },
      {
        title: "Real scores, no fake wins",
        body: "Returns, drawdowns and win rates are shown with honest N/A when the data does not support a number.",
      },
      {
        title: "Always know the mode",
        body: "Paper, demo, research or active simulation — the app tells you what it is doing right now.",
      },
    ],
  },
];

const aiMay = [
  "Spot market patterns and suggest setups",
  "Explain what happened in plain words",
  "Suggest parameter changes on paper",
  "Alert you when conditions change",
];
const aiMayNot = [
  "Place orders without a scoped safety check",
  "Bypass or ignore risk limits",
  "Alter or fake profit and loss numbers",
  "Change saved strategy rules behind your back",
  "See or export exchange passwords",
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
    <div className="flex flex-col min-h-screen bg-background text-foreground">
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
          <a href="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="hidden text-[11px] text-muted-foreground sm:block">Safe automated trading</div>
            </div>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#guardrails" className="transition-colors hover:text-foreground">Guardrails</a>
            <a href="#designed-for-people" className="transition-colors hover:text-foreground">For people</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href="/auth"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
            >
              Sign in
            </a>
            <a
              href="/auth?returnTo=%2Fdashboard"
              className="group inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
            >
              Open app
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16">
          <div {...fadeUp} className="max-w-3xl">
            <SectionLabel>Paper-safe automated trading</SectionLabel>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              AI finds the ideas.
              <span className="text-primary"> The safety layer makes the decisions.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Describe a market idea. The system verifies every price, runs the math exactly and only
              shows you what actually passed. Nothing risky reaches the market unless you explicitly
              say so.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="/auth?returnTo=%2Fdashboard"
                className="group inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Open the app
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted">
                See how safety works
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-primary" /> Safe by default</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" /> Every number checked</span>
              <span className="inline-flex items-center gap-1.5"><CircleSlash className="size-3.5 text-primary" /> Risk-free paper mode</span>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div {...fadeUp}>
              <SectionLabel>How it works</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                From idea to a safe trade in four steps
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                No complex setup. No guesswork. The app walks you through structured input, data
                verification, exact math and a final safety gate.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-2">
              {sections[0].items.map((item) => (
                <div key={item.title} className="flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/80 px-4 py-4 text-left backdrop-blur-sm">
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>

            <div {...fadeUp} className="mt-12 rounded-2xl border border-border/60 bg-card p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">The core principle</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Not trading</span> is always better
                      than placing <span className="font-medium text-foreground">an unsafe trade</span>.
                      If data is broken, risk is unclear or a connection is uncertain, the app pauses
                      and asks.
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-primary/5 px-4 py-3 text-xs text-primary">
                  You keep the wheel. The guardrails just make sure you do not accidentally hit it.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Guardrails */}
        <section id="guardrails" className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div {...fadeUp}>
              <SectionLabel>Guardrails that always win</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                AI can suggest. The deterministic layer decides.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                The system separates helpful assistance from authority. Suggestions are welcome;
                execution is a separate, verified and locked step.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sections[1].items.map((item) => (
                <div
                  key={item.title}
                  {...fadeUp}
                  className="h-full rounded-2xl border border-border/70 bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
                    <Scale className="size-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Designed for people */}
        <section id="designed-for-people" className="border-y border-border/60 bg-card/50 py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div {...fadeUp}>
              <SectionLabel>Designed for people</SectionLabel>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Clear language, plain numbers, honest status.
              </h2>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Everything is written so a normal reader can tell what the app is doing, why it
                stopped, and what happens next.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sections[2].items.map((item) => (
                <div
                  key={item.title}
                  {...fadeUp}
                  className="h-full rounded-2xl border border-border/70 bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div {...fadeUp} className="rounded-2xl border border-border/70 bg-card p-6">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="size-4 text-primary" />
                  Helpful by design
                </div>
                <ul className="mt-4 space-y-3">
                  {aiMay.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div {...fadeUp} className="rounded-2xl border border-destructive/25 bg-card p-6">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CircleSlash className="size-4 text-destructive" />
                  Paused on purpose
                </div>
                <ul className="mt-4 space-y-3">
                  {aiMayNot.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <X className="mt-0.5 size-4 shrink-0 text-destructive/80" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-24">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div {...fadeUp} className="relative overflow-hidden rounded-3xl border border-border/70 bg-card px-8 py-14 text-center shadow-sm">
              <div className="relative z-10">
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Try the safe path before anything else.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                  Open the app, sign in, and run your first idea in paper mode. No real money, no
                  hidden approvals.
                </p>
                <div className="mt-8 flex justify-center">
                  <a
                    href="/auth?returnTo=%2Fdashboard"
                    className="group inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
                  >
                    Start in paper mode
                    <Rocket className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </a>
                </div>
              </div>
              <div className="absolute inset-0 -translate-x-1/2 translate-y-1/2 rounded-3xl bg-primary/5 pointer-events-none" aria-hidden />
            </div>
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
    </div>
  );
}
