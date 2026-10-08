import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, StateBadge, CheckRow, fmtTime, EmptyState } from "./shared";

export default function DataPanel() {
  const data = useQuery(api.console.data);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading market data…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {data.series.map((s) => (
          <Panel
            key={s.marketId}
            title={s.symbol}
            description={`${s.points.length} most recent closed 1h candles · synthetic deterministic source`}
          >
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    minTickGap={28}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--popover)",
                      color: "var(--popover-foreground)",
                    }}
                    labelFormatter={(t) => fmtTime(t as number)}
                    formatter={(v: number) => [v.toFixed(4), "close"]}
                  />
                  <Line type="monotone" dataKey="close" stroke="var(--chart-1)" dot={false} strokeWidth={1.6} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        ))}
      </div>

      {data.quality.map((q) => (
        <Panel
          key={q.marketId}
          title={`Data quality — ${q.symbol} (${q.timeframe})`}
          description="FAILED ≠ EMPTY · MISSING ≠ ZERO · UNKNOWN ≠ FALSE. Defective data is classified, never repaired, never fabricated."
          action={<StateBadge state={q.state} label={`QUALITY: ${q.state}`} />}
        >
          <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md border border-border/70 bg-background/60 px-2 py-1">
              candles: {q.counts.candles}
            </span>
            <span className="rounded-md border border-border/70 bg-background/60 px-2 py-1">
              gaps: {q.counts.gaps}
            </span>
            <span className="rounded-md border border-border/70 bg-background/60 px-2 py-1">
              duplicates: {q.counts.duplicates}
            </span>
            <span className="rounded-md border border-border/70 bg-background/60 px-2 py-1">
              OHLC violations: {q.counts.ohlcViolations}
            </span>
            <span className="rounded-md border border-border/70 bg-background/60 px-2 py-1">
              invalid values: {q.counts.invalidValues}
            </span>
          </div>
          <div>
            {q.checks.map((c) => (
              <CheckRow key={c.check} check={c.check} status={c.status} detail={c.detail} />
            ))}
          </div>
        </Panel>
      ))}

      <Panel
        title="Data snapshots"
        description="Long-running workflows are pinned to reproducible snapshots. Historical results stay tied to the original snapshot — never to 'what is knowable now'."
      >
        {data.snapshots.length === 0 ? (
          <EmptyState title="No snapshots" body="Snapshots appear once the seed workflow has run." />
        ) : (
          <div className="space-y-2">
            {data.snapshots.map((snap) => (
              <div
                key={snap.snapshotId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-xs"
              >
                <span className="font-mono text-[11px] font-medium">{snap.snapshotId}</span>
                <span className="text-muted-foreground">v{snap.dataVersion} · rev {snap.revision}</span>
                <span className="text-muted-foreground">
                  {new Date(snap.rangeStart).toLocaleDateString()} → {new Date(snap.rangeEnd).toLocaleDateString()} · {snap.timeframe}
                </span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {snap.qualitySummary.map((qs) => (
                    <StateBadge key={qs.marketId} state={qs.state} label={qs.marketId.replace("MKT-", "").replace("-SIM", "")} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
