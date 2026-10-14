import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDownIcon } from "../icons";
import { GlassCard, MicroLabel, StatCard, StatusRow } from "../cards";
import { PageHeading } from "../chrome";

export default function TradingScreen() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeading title="Trading Desk" sub="Orderbook spread and session regime" />

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
          <div className="flex h-9 w-[108px] items-center rounded-[10px] border border-sp-chip bg-sp-glass px-[12px]">
            <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-sp-cyan" />
            <span className="ml-[6px] text-[11px] font-semibold text-[#DCE8F5]">London/NY</span>
          </div>
        </div>
        {notice && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            {notice}
          </p>
        )}

        <GlassCard hero radius={16} className="min-h-[106px] px-4 pb-4 pt-[14px]">
          <div className="flex items-center justify-between">
            <MicroLabel>SIMULATED MID-PRICE (DEMO DATA)</MicroLabel>
            <span className="flex h-5 items-center rounded-[6px] bg-[#04231B] px-[10px] text-[11px] font-bold text-sp-cyan tabular-nums">
              +0.18% 24h
            </span>
          </div>
          <p className="mt-[10px] text-[30px] font-extrabold leading-none tracking-[-0.5px] text-sp-text tabular-nums">
            1.08425
          </p>
          <p className="mt-[10px] text-[10.5px] text-sp-muted-2 tabular-nums">
            Sample workspace data • Spread 0.8 pips • High 1.08610 • Low 1.08190
          </p>
        </GlassCard>

        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
          <StatCard label="Session Volume" value="142.8k Lots" note="Normal liquidity" noteTone="cyan" />
          <StatCard label="ATR Range" value="42 Pips" note="Compression regime" />
          <StatCard label="Demand Shelf" value="1.0820" tone="cyan" note="Confirmed support" />
          <StatCard label="Supply Wall" value="1.0865" tone="red" note="Resting sell orders" />
        </div>

        <GlassCard radius={14} className="min-h-[106px] px-4 pb-4 pt-[14px]">
          <p className="text-[12px] font-bold text-sp-text">Desk Environment Status</p>
          <ul className="mt-[10px] space-y-[7px]">
            <StatusRow tone="cyan">
              London / New York overlap session active with steady spread
            </StatusRow>
            <StatusRow tone="cyan">
              No directional breakout registered inside the 15m channel
            </StatusRow>
            <StatusRow tone="amber">
              Direct broker execution disabled • Informational feed
            </StatusRow>
          </ul>
        </GlassCard>
      </div>

      <div className="mt-auto flex gap-2.5 px-5 pb-[38px] pt-3">
        <button
          type="button"
          onClick={() => navigate("/analysis")}
          className="flex h-12 w-[220px] items-center justify-center rounded-[12px] border border-sp-cyan bg-sp-glass text-[13px] font-extrabold text-sp-cyan transition-colors hover:bg-sp-cyan/10"
        >
          Open Model Synthesis →
        </button>
        <button
          type="button"
          onClick={() => setNotice("Orderbook depth view is not included in this prototype build.")}
          className="flex h-12 w-[120px] items-center justify-center rounded-[12px] border border-sp-line-hero bg-sp-glass text-[13px] font-bold text-sp-muted-2 transition-colors hover:border-sp-muted"
        >
          Orderbook
        </button>
      </div>
    </>
  );
}
