import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AlertTriangle, CheckCircle2, Link2, ShieldCheck, Unplug } from "lucide-react";
import { MetricTile, Panel, StateBadge, fmtPct, fmtTime } from "./shared";

export default function OverviewPanel() {
  const data = useQuery(api.console.overview);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading deterministic state…</div>;
  }

  const s = data.systemState;

  return (
    <div className="space-y-5">
      {/* Mode banner */}
      <div className="rounded-2xl border border-primary/25 bg-accent/50 px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="size-5 text-primary" />
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              System mode: <StateBadge state={s?.mode ?? "PAPER"} />
              <StateBadge state={s?.killSwitchEngaged ? "ENGAGED" : "RELEASED"} label={s?.killSwitchEngaged ? "KILL SWITCH ENGAGED" : "kill switch released"} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Environment <span className="font-medium text-foreground">{s?.environment ?? "PAPER"}</span>.
              Controlled live is disabled and there is no automatic live activation or resume —
              readiness review and explicit approval are separate required steps.
              {s?.liveAutoResume === false && " Automatic resume: disabled."}
            </p>
          </div>
        </div>
      </div>

      {/* Key tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Markets tracked" value={data.marketCount} sub="crypto + forex (synthetic feeds)" />
        <MetricTile
          label="Data quality"
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
          sub={`${data.orderCounts.filled} filled · ${data.orderCounts.unknown} unknown`}
          tone={data.orderCounts.unknown > 0 ? "warn" : "neutral"}
        />
        <MetricTile
          label="Agent registry"
          value={`${data.agentCounts.total} components`}
          sub={`${data.agentCounts.deterministic} deterministic · ${data.agentCounts.unavailable} AI-unavailable`}
        />
      </div>

      {/* Latest validations */}
      <Panel
        title="Latest deterministic validations"
        description="Backtest result ≠ valid strategy ≠ trustworthy strategy ≠ currently fit ≠ authorized trade."
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
                <span>net return: <span className="font-medium text-foreground">{fmtPct(v.netReturn)}</span></span>
                <span>max DD: <span className="font-medium text-foreground">{fmtPct(v.maxDrawdown)}</span></span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Audit + controls */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Audit chain integrity"
          description="Append-only hash-chained log. Tamper-evident, never rewritten."
          action={
            data.auditChain.valid ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <Link2 className="size-3" />{" "}
                {/* verifiedCount = records actually verified (linkage+hash),
                    not the visible list below. */}
                {data.auditChain.scope === "FULL_CHAIN"
                  ? `full chain verified from genesis (${data.auditChain.verifiedCount} records verified)`
                  : data.auditChain.scope === "WINDOW"
                    ? `window verified (${data.auditChain.verifiedCount} records verified) — earlier history NOT verified`
                    : "no records — nothing verified"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-red-600/25 bg-red-600/10 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
                <AlertTriangle className="size-3" /> chain broken
              </span>
            )
          }
        >
          <div className="space-y-2">
            {data.recentAudit.map((e) => (
              <div key={e.sequence} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">#{e.sequence}</span>
                <div>
                  <div className="font-medium text-foreground">{e.action}</div>
                  <div className="text-muted-foreground">{e.detail}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {fmtTime(e.at)} · {e.actor}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Controlled-live readiness gates" description="Section 30 gate checklist. Readiness ≠ activation.">
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
