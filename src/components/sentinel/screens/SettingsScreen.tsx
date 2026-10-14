import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useConsoleAction } from "@/hooks/use-console-action";
import { GlassCard, MicroLabel } from "../cards";
import { PageHeading } from "../chrome";

function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex h-[26px] items-center justify-between">
      <span className="text-[13px] font-semibold text-sp-text">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold text-sp-muted">{on ? "On" : "Off"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          onClick={onToggle}
          className={`flex h-[22px] w-[40px] items-center rounded-full px-[3px] ${on ? "justify-end bg-sp-cyan" : "justify-start bg-sp-line"}`}
        >
          <span
            aria-hidden="true"
            className={`h-4 w-4 rounded-full ${on ? "bg-sp-canvas" : "bg-[#8C9EB5]"}`}
          />
        </button>
      </span>
    </div>
  );
}

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const action = useConsoleAction();
  const [chime, setChime] = useState(true);
  const [bulletins, setBulletins] = useState(true);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <PageHeading title="Preferences" sub="Workspace settings & execution safety boundaries" />

      <div className="mt-3 space-y-3 px-5">
        <GlassCard radius={16} className="min-h-[136px] px-4 pb-2 pt-[14px]">
          <MicroLabel>WORKSTATION DEFAULTS</MicroLabel>
          <div className="mt-[6px] divide-y divide-sp-line">
            {[
              { label: "Default Currency Pair", value: "EUR/USD ›" },
              { label: "Timeframe Anchor", value: "15m ›" },
              { label: "Analysis Forecast Horizon", value: "2 Hours ›" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-[10px]">
                <span className="text-[13px] font-semibold text-sp-text">{row.label}</span>
                <span className="text-[13px] text-sp-muted-2 tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard radius={16} hero accent="amber" className="min-h-[136px] px-4 pb-4 pt-[14px]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold tracking-[0.6px] text-sp-amber">
              SAFETY & BROKERAGE BOUNDARY
            </p>
            <span className="flex h-[22px] w-[106px] items-center justify-center rounded-[6px] bg-[#201503] text-[10.5px] font-extrabold text-sp-amber">
              Locked to Demo
            </span>
          </div>
          <p className="mt-[10px] text-[13px] font-bold leading-snug text-sp-text">
            Automated order execution is strictly disabled
          </p>
          <p className="mt-[4px] text-[11.5px] leading-snug text-sp-muted-2">
            Sentinel Prime functions purely as an analytical decision aid.
          </p>
          <p className="mt-[2px] text-[11.5px] leading-snug text-sp-muted-2">
            No direct brokerage APIs or capital custody connections are active.
          </p>
          <p className="mt-[10px] text-[10px] text-sp-muted">
            Compliance standard: Educational Prototype Build 1.0.4
          </p>
        </GlassCard>

        <GlassCard radius={14} className="min-h-[116px] px-4 pb-4 pt-[14px]">
          <MicroLabel>NOTIFICATIONS & SOUNDS</MicroLabel>
          <div className="mt-[6px] divide-y divide-sp-line">
            <ToggleRow label="Signal Generation Chime" on={chime} onToggle={() => setChime((value) => !value)} />
            <ToggleRow
              label="High-Impact Macro Bulletins"
              on={bulletins}
              onToggle={() => setBulletins((value) => !value)}
            />
          </div>
        </GlassCard>

        {saved && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            Preferences saved for this session (demo workspace).
          </p>
        )}
      </div>

      <div className="mt-auto px-5 pb-[38px] pt-3">
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setSaved(true)}
            className="flex h-12 w-[200px] items-center justify-center rounded-[12px] border border-sp-cyan bg-sp-glass text-[13px] font-extrabold text-sp-cyan transition-colors hover:bg-sp-cyan/10"
          >
            Save Preferences
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await signOut();
                navigate("/", { replace: true });
                return "Signed out";
              })
            }
            className="flex h-12 w-[140px] items-center justify-center rounded-[12px] border border-[#3D141C] bg-sp-glass text-[13px] font-bold text-sp-red transition-colors hover:border-sp-red disabled:opacity-60"
          >
            {action.busy ? "Signing out…" : "Sign Out"}
          </button>
        </div>
        {action.error && (
          <p role="alert" className="mt-2 text-[10.5px] text-sp-red">
            {action.error}
          </p>
        )}
      </div>
    </>
  );
}
