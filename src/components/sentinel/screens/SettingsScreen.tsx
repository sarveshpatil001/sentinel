import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
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

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-[10px]">
      <span className="text-[13px] font-semibold text-sp-text">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[6px] border border-sp-line bg-transparent px-2 py-1 text-[13px] tabular-nums text-sp-muted-2"
      >
        {options.length === 0 && <option value="">—</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const HORIZON_LABELS: Record<string, string> = {
  SHORT: "Short (≤ 1 day)",
  MEDIUM: "Medium (≤ 1 week)",
  LONG: "Long (> 1 week)",
};

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const action = useConsoleAction();
  // Persisted, server-validated preferences. Missing or invalid stored
  // settings come back as `saved: null` with safe defaults — never a crash.
  const prefsResult = useQuery(api.preferences.get, {});
  const instruments = useQuery(api.marketData.instruments, {});
  const savePreferences = useMutation(api.preferences.save);

  const loaded = prefsResult?.saved ?? prefsResult?.defaults ?? null;
  // Loaded settings are the source of truth until the user edits — derived
  // state, so missing/invalid rows fall back to safe defaults without an
  // effect round-trip.
  const base = {
    marketId: loaded?.marketId ?? "",
    timeframe: loaded?.timeframe ?? "1h",
    horizon: loaded?.horizon ?? "SHORT",
    chime: loaded?.notifications.analysisComplete ?? true,
    bulletins: loaded?.notifications.highImpactNews ?? false,
  };
  const [draft, setDraft] = useState<typeof base | null>(null);
  const [saved, setSaved] = useState(false);
  const current = draft ?? base;

  const marketOptions = Array.isArray(instruments)
    ? instruments.map((m: { marketId: string; symbol: string }) => ({
        value: m.marketId,
        label: m.symbol,
      }))
    : [];
  const notificationDefaults = loaded?.notifications ?? {
    analysisComplete: true,
    riskBlocked: true,
    providerFailure: true,
    highImpactNews: false,
  };

  return (
    <>
      <PageHeading title="Preferences" sub="Workspace settings & execution safety boundaries" />

      <div className="mt-3 space-y-3 px-5">
        <GlassCard radius={16} className="min-h-[136px] px-4 pb-2 pt-[14px]">
          <MicroLabel>WORKSTATION DEFAULTS</MicroLabel>
          <div className="mt-[6px] divide-y divide-sp-line">
            <SelectRow
              label="Default Currency Pair"
              value={current.marketId}
              options={marketOptions}
              onChange={(value) => {
                setDraft({ ...current, marketId: value });
                setSaved(false);
              }}
            />
            <SelectRow
              label="Timeframe Anchor"
              value={current.timeframe}
              options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
              onChange={(value) => {
                setDraft({ ...current, timeframe: value });
                setSaved(false);
              }}
            />
            <SelectRow
              label="Analysis Forecast Horizon"
              value={current.horizon}
              options={Object.entries(HORIZON_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => {
                setDraft({ ...current, horizon: value });
                setSaved(false);
              }}
            />
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
            <ToggleRow
              label="Signal Generation Chime"
              on={current.chime}
              onToggle={() => setDraft({ ...current, chime: !current.chime })}
            />
            <ToggleRow
              label="High-Impact Macro Bulletins"
              on={current.bulletins}
              onToggle={() => setDraft({ ...current, bulletins: !current.bulletins })}
            />
          </div>
          <p className="mt-[8px] text-[10px] text-sp-muted">
            Preferences are stored on your account. Notification delivery channels are not part of this build.
          </p>
        </GlassCard>

        {saved && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            Preferences saved to your account.
          </p>
        )}
      </div>

      <div className="mt-auto px-5 pb-[38px] pt-3">
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={action.busy || current.marketId === ""}
            onClick={() =>
              action.run(async () => {
                await savePreferences({
                  marketId: current.marketId,
                  timeframe: current.timeframe,
                  horizon: current.horizon,
                  notifications: {
                    analysisComplete: current.chime,
                    riskBlocked: notificationDefaults.riskBlocked,
                    providerFailure: notificationDefaults.providerFailure,
                    highImpactNews: current.bulletins,
                  },
                });
                setSaved(true);
                return "Preferences saved";
              })
            }
            className="flex h-12 w-[200px] items-center justify-center rounded-[12px] border border-sp-cyan bg-sp-glass text-[13px] font-extrabold text-sp-cyan transition-colors hover:bg-sp-cyan/10 disabled:opacity-60"
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
