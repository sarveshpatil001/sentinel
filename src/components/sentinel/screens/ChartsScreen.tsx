import { useState } from "react";
import { Link } from "react-router";
import { ClockIcon } from "../icons";
import { GlassCard, StatCard } from "../cards";
import { PageHeading } from "../chrome";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const candles: Array<{ x: number; wickTop: number; wickBottom: number; bodyY: number; bodyH: number; kind: "up" | "down" | "doji" }> = [
  { x: 36, wickTop: 110, wickBottom: 175, bodyY: 125, bodyH: 35, kind: "down" },
  { x: 68, wickTop: 115, wickBottom: 170, bodyY: 120, bodyH: 38, kind: "up" },
  { x: 100, wickTop: 95, wickBottom: 160, bodyY: 105, bodyH: 42, kind: "up" },
  { x: 132, wickTop: 90, wickBottom: 150, bodyY: 100, bodyH: 30, kind: "down" },
  { x: 164, wickTop: 80, wickBottom: 140, bodyY: 90, bodyH: 38, kind: "up" },
  { x: 196, wickTop: 75, wickBottom: 145, bodyY: 85, bodyH: 16, kind: "doji" },
  { x: 228, wickTop: 85, wickBottom: 135, bodyY: 95, bodyH: 24, kind: "down" },
  { x: 260, wickTop: 75, wickBottom: 130, bodyY: 85, bodyH: 30, kind: "up" },
];

const candleColors = {
  up: { wick: "#00E5C9", body: "#04231B" },
  down: { wick: "#FF5252", body: "#24070B" },
  doji: { wick: "#FF9800", body: "#201503" },
};

function CandleChart() {
  return (
    <svg
      viewBox="0 0 350 254"
      className="font-sans"
      role="img"
      aria-label="Illustrative 15m candlestick chart with model supply ceiling at 1.0865 and sample price axis from 1.0820 to 1.0865"
    >
      {[40, 95, 150, 205].map((y) => (
        <line key={y} x1="16" y1={y} x2="286" y2={y} stroke="#162338" strokeDasharray="2 2" />
      ))}
      {[
        { y: 44, label: "1.0865" },
        { y: 99, label: "1.0850" },
        { y: 154, label: "1.0835" },
        { y: 209, label: "1.0820" },
      ].map(({ y, label }) => (
        <text key={label} x="296" y={y} fill="#6B809B" fontSize="10">
          {label}
        </text>
      ))}
      <rect x="16" y="32" width="270" height="18" fill="#FF5252" fillOpacity="0.08" />
      <line x1="16" y1="32" x2="286" y2="32" stroke="#FF5252" strokeDasharray="3 3" />
      <text x="20" y="44" fill="#FF5252" fontSize="8.5" fontWeight="600">
        Model Supply Ceiling: 1.0865
      </text>
      {candles.map((candle) => {
        const colors = candleColors[candle.kind];
        return (
          <g key={candle.x}>
            <line
              x1={candle.x}
              y1={candle.wickTop}
              x2={candle.x}
              y2={candle.wickBottom}
              stroke={colors.wick}
              strokeWidth="1.2"
            />
            <rect
              x={candle.x - 6}
              y={candle.bodyY}
              width="12"
              height={candle.bodyH}
              rx="2"
              fill={colors.body}
              stroke={colors.wick}
            />
          </g>
        );
      })}
      {[
        { x: 32, label: "13:30" },
        { x: 96, label: "14:00" },
        { x: 160, label: "14:30" },
        { x: 224, label: "15:00" },
      ].map(({ x, label }) => (
        <text key={label} x={x} y="240" fill="#6B809B" fontSize="9">
          {label}
        </text>
      ))}
      <rect x="262" y="6" width="80" height="18" rx="6" fill="#0B1322" stroke="#162338" />
      <text x="302" y="18" fill="#6B809B" fontSize="9" fontWeight="600" textAnchor="middle">
        Illustrative
      </text>
    </svg>
  );
}

export default function ChartsScreen() {
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeading title="Price Structure" sub={`${timeframe} candlestick chart and resistance shelf`} />

      <div className="mt-3 space-y-3 px-5">
        <div className="flex h-9 items-center rounded-[10px] border border-sp-chip bg-sp-glass px-4">
          {TIMEFRAMES.map((tf) => {
            const active = tf === timeframe;
            return (
              <button
                key={tf}
                type="button"
                aria-pressed={active}
                onClick={() => setTimeframe(tf)}
                className={`flex h-7 min-w-[46px] items-center justify-center rounded-[8px] text-[12px] tabular-nums ${
                  active
                    ? "border border-sp-cyan bg-sp-cyan/15 font-extrabold text-sp-cyan"
                    : "font-semibold text-sp-muted"
                }`}
              >
                {tf}
              </button>
            );
          })}
          <button
            type="button"
            aria-label="Chart settings"
            onClick={() => setNotice("Chart settings are not included in this prototype build.")}
            className="ml-auto flex h-7 w-7 items-center justify-center text-[12px] font-bold text-sp-muted hover:text-sp-soft"
          >
            ⚙
          </button>
        </div>
        {notice && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            {notice}
          </p>
        )}

        <GlassCard hero radius={16} className="min-h-[254px]">
          <CandleChart />
        </GlassCard>

        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
          <StatCard label="Pattern Detected" value="Compression Flag" note="Tightening inside 1.0840" noteTone="cyan" />
          <StatCard label="RSI Oscillator" value="48.6 Neutral" note="No divergence registered" />
          <StatCard label="Volume State" value="Low Taper" tone="amber" note="Pre-news deceleration" />
          <StatCard label="Breakout Trigger" value={"> 1.0855"} tone="cyan" note="Requires volume confirm" />
        </div>
      </div>

      <div className="mt-auto px-5 pb-[38px] pt-3">
        <Link
          to="/analysis"
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] border border-sp-cyan bg-sp-glass text-[12px] font-extrabold text-sp-cyan transition-colors hover:bg-sp-cyan/10"
        >
          <ClockIcon className="h-4 w-4" />
          Inspect Full AI Synthesis for this Candle Frame →
        </Link>
      </div>
    </>
  );
}
