import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { CheckRow, MetricTile, Panel, StateBadge, fmt, fmtPct, fmtTime } from "./shared";

interface MetricsShape {
  startingEquity: number | null;
  endingEquity: number | null;
  netReturn: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  peakEquity: number | null;
  sharpe: number | null;
  sortino: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  tradeCount: number;
  averageTrade: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  exposure: number | null;
  turnover: number | null;
  fees: number | null;
  slippage: number | null;
}

export default function ValidationPanel() {
  const data = useQuery(api.console.validation);
  const strategies = useQuery(api.console.strategies);
  const runValidation = useMutation(api.workflows.runValidation);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!data || !strategies) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading validation state…</div>;
  }

  const handleRun = async (strategyVersionId: string) => {
    setBusy(strategyVersionId);
    setNotice(null);
    try {
      const res = await runValidation({ strategyVersionId });
      setNotice(
        res.ok
          ? `${res.validationId}: ${res.state} · evidence ${res.evidenceLevel} · fitness ${res.fitnessVerdict}`
          : res.reason,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-xs leading-relaxed">
          {notice}
        </div>
      )}

      <Panel
        title="Run deterministic validation"
        description="Data quality gate → simulation → integrity → cost/friction → performance → leakage → robustness → OOS → evidence → fitness. AI plays no part in the arithmetic."
      >
        <div className="flex flex-wrap gap-2">
          {strategies.versions.map((v) => (
            <button
              key={v.strategyVersionId}
              type="button"
              onClick={() => handleRun(v.strategyVersionId)}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card px-3.5 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === v.strategyVersionId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5 text-primary" />
              )}
              Validate <span className="font-mono">{v.strategyVersionId}</span>
            </button>
          ))}
        </div>
      </Panel>

      {data.runs.map((run) => {
        const m = run.metrics as MetricsShape | null;
        const stress = (run.stress ?? []) as { scenario: string; metrics: MetricsShape }[];
        const oos = run.oos as {
          inSample: MetricsShape | null;
          oos: MetricsShape | null;
          oosState: string;
          oosNote: string;
        } | null;

        return (
          <Panel
            key={run.validationId}
            title={`Validation run · ${run.strategyVersionId}`}
            description={`${run.validationId} · snapshot ${run.dataSnapshotId} · config ${run.validationConfigVersion} · engine ${run.engineVersion} · features ${run.featureVersion} · costs ${run.costModelVersion} · execution ${run.executionModelVersion}`}
            action={<StateBadge state={run.state} label={`STATE: ${run.state}`} />}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge state={run.leakageState} label={`leakage: ${run.leakageState}`} />
              <span className="text-[11px] text-muted-foreground">completed {fmtTime(run.completedAt ?? run.createdAt)}</span>
            </div>

            {m ? (
              <>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricTile label="Net return" value={fmtPct(m.netReturn)} tone={(m.netReturn ?? 0) > 0 ? "ok" : "bad"} />
                  <MetricTile label="Max drawdown" value={fmtPct(m.maxDrawdown)} tone="neutral" />
                  <MetricTile label="Sharpe" value={fmt(m.sharpe)} />
                  <MetricTile label="Sortino" value={fmt(m.sortino)} />
                  <MetricTile label="Profit factor" value={fmt(m.profitFactor)} />
                  <MetricTile label="Win rate" value={fmtPct(m.winRate)} />
                  <MetricTile label="Expectancy" value={fmt(m.expectancy)} />
                  <MetricTile label="Trade count" value={m.tradeCount} sub={m.tradeCount === 0 ? "no trades — N/A, not zero" : undefined} />
                  <MetricTile label="Avg trade" value={fmt(m.averageTrade)} />
                  <MetricTile label="Avg win / loss" value={`${fmt(m.averageWin)} / ${fmt(m.averageLoss)}`} />
                  <MetricTile label="Starting equity" value={fmt(m.startingEquity)} />
                  <MetricTile label="Ending equity" value={fmt(m.endingEquity)} />
                  <MetricTile label="Peak equity" value={fmt(m.peakEquity)} />
                  <MetricTile label="CAGR" value={fmtPct(m.cagr)} />
                  <MetricTile label="Exposure" value={fmtPct(m.exposure)} />
                  <MetricTile label="Turnover" value={fmt(m.turnover)} />
                  <MetricTile label="Fees" value={fmt(m.fees)} />
                  <MetricTile label="Slippage" value={fmt(m.slippage)} />
                </div>

                {/* Stress */}
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                    <FlaskConical className="size-3.5 text-primary" />
                    Stress scenarios (re-simulated, not scaled)
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border/60">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Scenario</th>
                          <th className="px-3 py-2 font-medium">Net return</th>
                          <th className="px-3 py-2 font-medium">Max DD</th>
                          <th className="px-3 py-2 font-medium">Trades</th>
                          <th className="px-3 py-2 font-medium">Fees</th>
                          <th className="px-3 py-2 font-medium">Slippage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stress.map((s) => (
                          <tr key={s.scenario} className="border-t border-border/50">
                            <td className="px-3 py-2 font-medium">{s.scenario}</td>
                            <td className="px-3 py-2">{fmtPct(s.metrics.netReturn)}</td>
                            <td className="px-3 py-2">{fmtPct(s.metrics.maxDrawdown)}</td>
                            <td className="px-3 py-2">{s.metrics.tradeCount}</td>
                            <td className="px-3 py-2">{fmt(s.metrics.fees)}</td>
                            <td className="px-3 py-2">{fmt(s.metrics.slippage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* OOS */}
                {oos && (
                  <div className="mt-5 rounded-xl border border-border/60 bg-background/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold">Train / out-of-sample</span>
                      <StateBadge state={oos.oosState === "ASSESSED" ? "PASS" : "NOT_ASSESSABLE"} label={`OOS ${oos.oosState}`} />
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{oos.oosNote}</p>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      <MetricTile
                        label="In-sample net return"
                        value={fmtPct(oos.inSample?.netReturn ?? null)}
                        sub={`${oos.inSample?.tradeCount ?? 0} trades`}
                      />
                      <MetricTile
                        label="OOS net return"
                        value={fmtPct(oos.oos?.netReturn ?? null)}
                        sub={oos.oos ? `${oos.oos.tradeCount} trades` : "not assessable"}
                        tone={oos.oos && (oos.oos.netReturn ?? 0) > 0 ? "ok" : "neutral"}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-600/25 bg-amber-600/5 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                No metrics computed for this run — the data quality gate blocked simulation. Nothing is
                fabricated: blocked remains blocked (metrics are N/A, not zero).
              </div>
            )}

            {/* Integrity + leakage */}
            <div className="mt-5">
              <div className="mb-1 text-xs font-semibold">Integrity, look-ahead & leakage checks</div>
              <div>
                {run.integrity.map((c) => (
                  <CheckRow key={c.check} check={c.check} status={c.status} detail={c.detail} />
                ))}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
