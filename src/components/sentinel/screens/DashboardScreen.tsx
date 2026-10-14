import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClockIcon } from "../icons";
import { GlassCard } from "../cards";
import { PageHeading } from "../chrome";

export default function DashboardScreen() {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);

  function runAnalysis() {
    if (running) return;
    setRunning(true);
    window.setTimeout(() => navigate("/analysis"), 700);
  }

  return (
    <>
      <PageHeading title="EUR/USD Workspace" sub="Multi-agent continuous market context" />

      <div className="mt-3 space-y-3 px-5">
        <GlassCard hero radius={16} className="min-h-[136px] px-4 pb-4 pt-[14px]">
          <svg
            aria-hidden="true"
            viewBox="0 0 350 136"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path
              d="M 16 110 Q 80 85, 140 100 T 260 85 T 330 80"
              fill="none"
              stroke="#00E5C9"
              strokeWidth="2"
            />
          </svg>
          <div className="relative z-10 flex h-5 items-center">
            <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#1A3B8B] text-[8px] leading-none">
              🇪🇺
            </span>
            <span className="ml-[7px] text-[14px] font-extrabold text-sp-text">EUR/USD</span>
            <span className="ml-[12px] flex h-5 w-[42px] items-center justify-center rounded-[6px] bg-sp-raised text-[11px] text-sp-muted-2 tabular-nums">
              15m
            </span>
            <span className="ml-auto flex h-5 w-[88px] items-center justify-center rounded-[6px] bg-[#04231B] text-[11px] font-bold text-sp-cyan tabular-nums">
              +0.18%
            </span>
          </div>
          <p className="relative z-10 mt-[12px] text-[28px] font-extrabold leading-none tracking-[-0.5px] text-sp-text tabular-nums">
            1.08425
          </p>
          <p className="relative z-10 mt-[26px] text-[10px] text-sp-muted tabular-nums">
            Sample quote • Simulated tick feed (not a live price)
          </p>
        </GlassCard>

        <GlassCard radius={14} className="min-h-[114px] px-4 pb-4 pt-[14px]">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold tracking-[0.6px] text-sp-muted">KEY MARKET CATALYST</p>
            <p className="text-[10.5px] text-sp-muted-2">ECB Bulletin</p>
          </div>
          <p className="mt-[10px] text-[13px] font-bold leading-snug text-sp-text">
            Eurozone Core Inflation Holds Steady at 2.7%
          </p>
          <p className="mt-[3px] text-[11.5px] leading-snug text-sp-muted-2">
            Rate cut expectations moderated across European rate desks.
          </p>
          <p className="mt-[10px] text-[10px] text-sp-muted tabular-nums">
            Sample workspace data • Not a live news feed
          </p>
        </GlassCard>

        <GlassCard radius={14} className="min-h-[110px] px-4 pb-4 pt-[14px]">
          <div className="flex items-center justify-between">
            <span className="flex h-[22px] items-center rounded-[6px] border border-sp-amber bg-[#201503] px-[10px] text-[11px] font-extrabold text-sp-amber tabular-nums">
              WAIT / 58%
            </span>
            <span className="text-[10.5px] text-sp-muted tabular-nums">14:30 UTC</span>
          </div>
          <p className="mt-[10px] text-[13px] font-bold leading-snug text-sp-text">
            Compression inside 1.0835 to 1.0850
          </p>
          <p className="mt-[3px] text-[11.5px] leading-snug text-sp-muted-2">
            No directional consensus. Volatility tapering ahead of data.
          </p>
          <Link
            to="/analysis"
            className="mt-[8px] inline-block text-[11px] font-bold text-sp-cyan hover:underline"
          >
            Inspect Multi-Agent Evidence →
          </Link>
        </GlassCard>
      </div>

      <div className="mt-auto px-5 pb-[38px] pt-3">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-sp-cyan text-[14px] font-extrabold text-sp-canvas transition-opacity hover:opacity-90 disabled:opacity-70"
        >
          <ClockIcon className="h-4 w-4" />
          Run Market Analysis
        </button>
        {running && (
          <p role="status" className="mt-2 text-center text-[10.5px] text-sp-muted">
            Opening the analysis workspace…
          </p>
        )}
      </div>
    </>
  );
}
