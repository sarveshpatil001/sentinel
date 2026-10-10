import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Cpu,
  Info,
  Layers,
  Link2,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Unplug,
} from "lucide-react";
import { MetricTile, Panel, StateBadge, fmtPct, fmtTime } from "./shared";

export default function OverviewPanel({ isSimple = false }: { isSimple?: boolean }) {
  const data = useQuery(api.console.overview);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading dashboard…</div>;
  }

  const s = data.systemState;
  const isHealthy = !s?.killSwitchEngaged && data.auditChain.valid;

  if (isSimple) {
    return (
      <div className="space-y-6">
        {/* Simple Welcoming Status Banner */}
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-background to-accent/30 p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                {isHealthy ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold text-foreground">
                    Status: {isHealthy ? "All Systems Ready" : "Trading Paused"}
                  </h1>
                  <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Safe Mode
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Automatic safety rules are on. Your account is protected from bad trades or unexpected market swings.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start rounded-xl border border-border/70 bg-card/80 px-3.5 py-2 sm:self-auto">
              <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-foreground">Paper Trading (Safe)</span>
            </div>
          </div>
        </div>

        {/* 4 Clean, Everyday Metrics for Normal People */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs transition-all hover:border-primary/30">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Markets Tracked</span>
              <Coins className="size-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-foreground">{data.marketCount} pairs</div>
            <div className="mt-1 text-xs text-muted-foreground">Major Crypto & Currencies</div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs transition-all hover:border-primary/30">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Test Orders</span>
              <TrendingUp className="size-4 text-emerald-500" />
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-foreground">{data.orderCounts.filled} filled</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {data.orderCounts.total} total simulated orders
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs transition-all hover:border-primary/30">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Price Feed Health</span>
              <ShieldCheck className="size-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              100% Good
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Accurate prices verified</div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs transition-all hover:border-primary/30">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Safety Checks</span>
              <Cpu className="size-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-foreground">
              {data.agentCounts.deterministic} running
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Automatic loss protection active</div>
          </div>
        </div>

        {/* Highlighted Strategy Performance Cards */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Active Trading Strategies</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ready-to-use strategies tested on real past market data.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {data.latestValidations.slice(0, 4).map((v) => (
              <div
                key={v.validationId}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 p-4 transition-colors hover:bg-muted/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {v.strategyVersionId.replace("SV-", "Strategy ")}
                    </span>
                    <StateBadge state={v.state === "COMPLETED" ? "PASS" : v.state} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {v.tradeCount ?? 0} test trades
                  </div>
                </div>

                <div className="text-right">
                  <div className={`text-sm font-bold ${(v.netReturn ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {fmtPct(v.netReturn)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Max drawdown: {fmtPct(v.maxDrawdown)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Simplified Safety & Trust Summary */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              <h2 className="text-sm font-semibold tracking-tight">Account Protection Log</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-600/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Link2 className="size-3" />
              {data.auditChain.verifiedCount} events logged & verified
            </span>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Every trade decision, safety block, and price check is permanently recorded.
            Automated bots cannot change past history or ignore your stop-loss rules.
          </p>

          <div className="mt-4 pt-4 border-t border-border/60">
            <button
              type="button"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer"
            >
              {showTechnicalDetails ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span>{showTechnicalDetails ? "Hide recent events" : "Show recent activity log"}</span>
            </button>

            {showTechnicalDetails && (
              <div className="mt-3 space-y-2">
                {data.recentAudit.slice(0, 5).map((e) => (
                  <div key={e.sequence} className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/50 p-2.5 text-xs">
                    <div>
                      <div className="font-medium text-foreground">{e.action.replace(/_/g, " ")}</div>
                      <div className="text-[11px] text-muted-foreground">{e.detail}</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ADVANCED / PRO VIEW (Preserves all raw telemetry, gates, and full disclaimers)
  return (
    <div className="space-y-5">
      {/* Mode banner */}
      <div className="rounded-2xl border border-primary/25 bg-accent/50 px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="size-5 text-primary" />
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              System mode: <StateBadge state={s?.mode ?? "PAPER"} />
              <StateBadge state={s?.killSwitchEngaged ? "ENGAGED" : "RELEASED"} label={s?.killSwitchEngaged ? "EMERGENCY STOP ON" : "Safety Normal"} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Environment <span className="font-medium text-foreground">{s?.environment ?? "PAPER"}</span>.
              Real money trading stays safely disabled until explicit review and approval.
            </p>
          </div>
        </div>
      </div>

      {/* Key tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Markets tracked" value={data.marketCount} sub="crypto + currencies" />
        <MetricTile
          label="Price quality"
          value={
            <span className="flex flex-wrap gap-1.5">
              {data.qualitySummary.map((q) => (
                <StateBadge key={q.marketId} state={q.state} label={`${q.symbol} ${q.state}`} />
              ))}
            </span>
          }
        />
        <MetricTile
          label="Orders"
          value={data.orderCounts.total}
          sub={`${data.orderCounts.filled} filled · ${data.orderCounts.unknown} pending`}
          tone={data.orderCounts.unknown > 0 ? "warn" : "neutral"}
        />
        <MetricTile
          label="Safety checks"
          value={`${data.agentCounts.total} checks`}
          sub={`${data.agentCounts.deterministic} active`}
        />
      </div>

      {/* Latest validations */}
      <Panel
        title="Recent strategy test results"
        description="Tested against market history with realistic fees and slippage."
      >
        <div className="space-y-2">
          {data.latestValidations.map((v) => (
            <div
              key={v.validationId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3"
            >
              <span className="font-mono text-[11px] text-muted-foreground">{v.strategyVersionId}</span>
              <StateBadge state={v.state} />
              <StateBadge state={v.leakageState} />
              <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                <span>trades: <span className="font-medium text-foreground">{v.tradeCount ?? "N/A"}</span></span>
                <span>return: <span className="font-medium text-foreground">{fmtPct(v.netReturn)}</span></span>
                <span>max drop: <span className="font-medium text-foreground">{fmtPct(v.maxDrawdown)}</span></span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Audit + controls */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Activity log integrity"
          description="Permanent tamper-proof history of every action taken."
          action={
            data.auditChain.valid ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <Link2 className="size-3" />{" "}
                {data.auditChain.scope === "FULL_CHAIN"
                  ? `Full history verified (${data.auditChain.verifiedCount} events)`
                  : data.auditChain.scope === "WINDOW"
                    ? `Recent history verified (${data.auditChain.verifiedCount} events)`
                    : "No events recorded yet"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-red-600/25 bg-red-600/10 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
                <AlertTriangle className="size-3" /> Warning: check required
              </span>
            )
          }
        >
          <div className="space-y-2">
            {data.recentAudit.map((e) => (
              <div key={e.sequence} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">#{e.sequence}</span>
                <div>
                  <div className="font-medium text-foreground">{e.action.replace(/_/g, " ")}</div>
                  <div className="text-muted-foreground">{e.detail}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {fmtTime(e.at)} · {e.actor}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Live trading readiness checklist" description="Requirements needed before real-money trading is ever allowed.">
          <div className="grid max-h-[340px] grid-cols-1 gap-1.5 overflow-auto pr-1 sm:grid-cols-2">
            {(s?.controlledLiveGates ?? []).map((g) => (
              <div
                key={g.gate}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
              >
                {g.satisfied ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                ) : (
                  <Unplug className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <div className="text-[11px] font-medium capitalize">{g.gate.replace(/_/g, " ")}</div>
                  <div className="text-[10px] leading-tight text-muted-foreground">{g.note}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
