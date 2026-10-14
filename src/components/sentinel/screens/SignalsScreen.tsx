import { useState } from "react";
import { Link } from "react-router";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ClockIcon, TrendIcon } from "../icons";
import { GlassCard, StatCard, StatusRow } from "../cards";
import { PageHeading } from "../chrome";

type Stance = "BUY" | "WAIT" | "SELL";

export default function SignalsScreen() {
  const [notice, setNotice] = useState<string | null>(null);
  const [stance, setStance] = useState<Stance | null>(null);

  return (
    <>
      <PageHeading title="Market Signals" sub="Multi-agent consensus overview" />

      <div className="mt-3 space-y-3 px-5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNotice("Pair switching is locked to the seeded demo workspace.")}
            className="flex h-9 w-[140px] items-center rounded-[10px] border border-sp-chip bg-sp-glass px-[11px]"
          >
            <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#1A3B8B] text-[8px] leading-none">
              🇪🇺
            </span>
            <span className="ml-[7px] text-[13px] font-bold text-sp-text">EUR/USD</span>
            <ChevronDownIcon className="ml-auto h-[7px] w-[11px] text-sp-muted" />
          </button>
          <button
            type="button"
            onClick={() => setNotice("Timeframe switching is locked to the seeded demo workspace.")}
            className="flex h-9 w-[86px] items-center rounded-[10px] border border-sp-chip bg-sp-glass px-[13px]"
          >
            <span className="text-[13px] font-bold text-sp-text tabular-nums">15m</span>
            <ChevronDownIcon className="ml-auto h-[7px] w-[11px] text-sp-muted" />
          </button>
          <Link
            to="/charts"
            className="flex h-9 w-[108px] items-center rounded-[10px] border border-sp-chip bg-sp-glass px-[12px]"
          >
            <TrendIcon className="h-[12px] w-[18px] text-sp-cyan" />
            <span className="ml-[8px] text-[12px] font-semibold text-[#DCE8F5]">Charts</span>
          </Link>
        </div>
        {notice && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            {notice}
          </p>
        )}

        <GlassCard hero radius={16} className="min-h-[106px] px-4 pb-4 pt-[14px]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-[94px] items-center justify-center gap-1.5 rounded-[8px] border border-sp-amber bg-[#201503]">
              <ClockIcon className="h-4 w-4 text-sp-amber" />
              <span className="text-[14px] font-black tracking-[0.8px] text-sp-amber">WAIT</span>
            </span>
            <span className="flex h-6 w-[92px] items-center justify-center rounded-[12px] border border-sp-line bg-sp-raised text-[10.5px] font-medium text-[#7E93A9]">
              Consolidation
            </span>
          </div>
          <p className="mt-[10px] text-[13px] font-bold leading-snug text-sp-text">
            Market in tight compression range
          </p>
          <p className="mt-[3px] text-[11px] leading-snug text-sp-muted-2">
            No directional edge. Await breakout volume confirmation above 1.0850.
          </p>
        </GlassCard>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-sp-muted-2">Model Confidence</p>
            <p className="text-[13px] font-extrabold text-sp-amber tabular-nums">58%</p>
          </div>
          <div className="mt-[8px] h-1.5 w-full rounded-full bg-[#0E1624]">
            <div className="h-full w-[58%] rounded-full bg-linear-to-r from-[#FF9800] to-[#FFC107]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
          <StatCard label="Entry Zone" value="1.0835 – 1.0850" note="Pending breakout" noteTone="cyan" />
          <StatCard label="Stop Level" value="1.0810" tone="red" note="Below demand shelf" />
          <StatCard label="Target Range" value="1.0880 – 1.0910" tone="cyan" note="Next liquidity pool" />
          <StatCard label="Valid Horizon" value="2 Hours" note="15m frame expiry" />
        </div>

        <GlassCard radius={14} className="min-h-[106px] px-4 pb-4 pt-[14px]">
          <p className="text-[12px] font-bold text-sp-text">Consensus Evidence</p>
          <ul className="mt-[10px] space-y-[7px]">
            <StatusRow tone="cyan">
              Support held at 1.0835 shelf during London session
            </StatusRow>
            <StatusRow tone="cyan">
              RSI stable at 48.6 showing zero directional divergence
            </StatusRow>
            <StatusRow tone="amber">
              Volume tapering ahead of US macro release
            </StatusRow>
          </ul>
        </GlassCard>

        <div className="flex min-h-[38px] items-center rounded-[8px] border border-sp-line bg-[#0A0F1A] px-4 py-2">
          <p className="text-[10.5px] text-sp-muted">
            Seeded demo workspace synthesis • Informational only • Automated execution disabled
          </p>
        </div>
        {stance && (
          <p role="status" className="text-[10.5px] font-semibold text-sp-soft">
            Stance recorded: {stance} • Informational note only. No order was placed.
          </p>
        )}
      </div>

      <div
        data-decision-cluster="true"
        className="mt-auto flex gap-2.5 px-5 pb-[38px] pt-3"
      >
        <button
          type="button"
          aria-label="Record BUY stance (informational only)"
          aria-pressed={stance === "BUY"}
          onClick={() => setStance("BUY")}
          className="flex h-12 w-[108px] items-center justify-center gap-2 rounded-[12px] border border-[#0D3B31] bg-[#061814] transition-colors hover:border-sp-cyan"
        >
          <ArrowUpIcon className="h-[13px] w-[11px] text-sp-cyan" />
          <span className="text-[14px] font-extrabold tracking-[0.5px] text-sp-cyan">BUY</span>
        </button>
        <button
          type="button"
          aria-label="Record WAIT stance (informational only)"
          aria-pressed={stance === "WAIT"}
          onClick={() => setStance("WAIT")}
          className="relative flex h-12 w-[114px] items-center justify-center gap-1.5 overflow-hidden rounded-[12px] border-[1.6px] border-sp-amber bg-[#201503] transition-colors hover:bg-[#2A1B05]"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-3 top-0 h-px bg-linear-to-r from-transparent via-white/20 to-transparent"
          />
          <ClockIcon className="h-4 w-4 text-sp-amber" />
          <span className="text-[14px] font-extrabold tracking-[0.5px] text-sp-amber">WAIT</span>
        </button>
        <button
          type="button"
          aria-label="Record SELL stance (informational only)"
          aria-pressed={stance === "SELL"}
          onClick={() => setStance("SELL")}
          className="flex h-12 w-[108px] items-center justify-center gap-2 rounded-[12px] border border-[#3D141C] bg-[#1C090D] transition-colors hover:border-sp-red"
        >
          <ArrowDownIcon className="h-[13px] w-[11px] text-sp-red" />
          <span className="text-[14px] font-extrabold tracking-[0.5px] text-sp-red">SELL</span>
        </button>
      </div>
    </>
  );
}
