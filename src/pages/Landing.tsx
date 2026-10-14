import { Link } from "react-router";
import { BrandMark } from "@/components/sentinel/icons";

const features = [
  {
    title: "Multi-agent synthesis",
    body: "Structure, momentum, volatility, and risk agents converge into one scored market stance.",
  },
  {
    title: "Decision support only",
    body: "BUY, WAIT, and SELL record an informational stance. Automated execution stays disabled.",
  },
  {
    title: "Simulated market workspace",
    body: "EUR/USD demo context with illustrative prices, catalysts, and an auditable analysis archive.",
  },
];

export default function Landing() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-sp-canvas text-sp-text">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] w-full">
        <defs>
          <radialGradient id="sp-mesh-landing" cx="50%" cy="0%" r="50%">
            <stop offset="0%" stopColor="#00E5C9" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#040810" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="420" fill="url(#sp-mesh-landing)" />
      </svg>

      <div className="relative z-10 mx-auto flex w-full max-w-[390px] flex-col px-5 pb-14 pt-12">
        <div className="flex items-center gap-2">
          <BrandMark className="h-[26px] w-[30px]" />
          <span className="text-[15px] font-extrabold tracking-[0.4px] text-sp-status">Sentinel Prime</span>
          <span className="ml-auto flex h-[26px] w-[88px] items-center justify-center gap-2 rounded-full border border-sp-cyan/30 bg-sp-raised">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-sp-cyan" />
            <span className="text-[11px] font-semibold text-[#DCE8F5]">Demo</span>
          </span>
        </div>

        <h1 className="mt-10 text-[34px] font-extrabold leading-[1.1] tracking-[-0.5px]">
          Institutional AI
          <br />
          Forex analysis,
          <br />
          <span className="text-sp-cyan">decision support only.</span>
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-sp-muted-2">
          A multi-agent market workspace for EUR/USD structure, catalysts, and scored synthesis —
          built as an educational prototype with simulated feeds and no order routing.
        </p>

        <div className="mt-8 flex flex-col gap-2.5">
          <Link
            to="/auth?returnTo=%2Fdashboard"
            className="flex h-12 items-center justify-center rounded-[12px] bg-sp-cyan text-[14px] font-extrabold text-sp-canvas transition-opacity hover:opacity-90"
          >
            Sign in to the workspace
          </Link>
          <Link
            to="/dashboard"
            className="flex h-12 items-center justify-center rounded-[12px] border border-sp-line-hero bg-sp-glass text-[13px] font-bold text-sp-soft transition-colors hover:border-sp-cyan hover:text-sp-cyan"
          >
            Open workspace
          </Link>
        </div>

        <div className="mt-10 space-y-2.5">
          {features.map((feature) => (
            <section
              key={feature.title}
              className="rounded-[12px] border border-sp-line bg-linear-to-b from-sp-glass to-sp-glass-deep px-4 py-4"
            >
              <h2 className="text-[13px] font-bold text-sp-text">{feature.title}</h2>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-sp-muted-2">{feature.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border border-sp-line bg-[#0A0F1A] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[10.5px] text-sp-muted">
            <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-sp-cyan" />
            Simulated market data
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-sp-muted">
            <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-sp-muted" />
            Broker not connected
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-sp-amber">
            <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-sp-amber" />
            Execution locked
          </span>
        </div>

        <p className="mt-6 text-[10px] leading-relaxed text-sp-muted">
          Educational Prototype Build 1.0.4 • Informational analysis only • Automated execution
          disabled • Nothing on this interface is financial advice.
        </p>
      </div>
    </main>
  );
}
