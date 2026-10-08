import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GitBranch, Loader2, Lock, Sparkles } from "lucide-react";
import { EmptyState, Panel, StateBadge, fmtTime } from "./shared";

export default function StrategiesPanel() {
  const data = useQuery(api.console.strategies);
  const proposeCandidate = useMutation(api.workflows.proposeCandidateVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading strategies…</div>;
  }

  const handlePropose = async (learningEventId: string) => {
    setBusy(learningEventId);
    setNotice(null);
    try {
      // Structured parameter deltas only — learning can never mutate a live version.
      const res = await proposeCandidate({
        learningEventId,
        params: { fast: 5, slow: 15, timeExitBars: 24 },
      });
      setNotice(
        res.ok
          ? `New immutable candidate ${res.strategyVersionId} created from parent ${res.parentVersionId}. It must pass validation before any trust exists.`
          : `Candidate creation refused: ${res.reason}`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-xs leading-relaxed text-foreground">
          {notice}
        </div>
      )}

      {data.strategies.map((strategy) => {
        const versions = data.versions
          .filter((v) => v.strategyId === strategy.strategyId)
          .sort((a, b) => a.version - b.version);
        return (
          <Panel
            key={strategy.strategyId}
            title={strategy.name}
            description={strategy.description}
            action={
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{strategy.strategyId}</span>
                <span>·</span>
                <span>{strategy.marketId.replace("MKT-", "").replace("-SIM", "")} · {strategy.timeframe}</span>
              </div>
            }
          >
            <div className="space-y-3">
              {versions.map((v) => {
                const def = v.definition as {
                  entry: { indicator: string; fast: number; slow: number };
                  exit: { stopLossPct: number | null; takeProfitPct: number | null; timeExitBars: number | null };
                  filters: { rsiMin: number | null; rsiMax: number | null };
                  sizing: { kind: string; fraction: number };
                };
                return (
                  <div
                    key={v.strategyVersionId}
                    className="rounded-xl border border-border/60 bg-background/60 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-semibold">v{v.version}</span>
                      <StateBadge state={v.status} />
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Lock className="size-3" /> immutable
                      </span>
                      {v.parentVersionId && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <GitBranch className="size-3" /> parent: <span className="font-mono">{v.parentVersionId}</span>
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {v.evidence && <StateBadge state={v.evidence.level} label={`evidence ${v.evidence.level}`} />}
                        {v.fitness && <StateBadge state={v.fitness.verdict} label={`fitness ${v.fitness.verdict}`} />}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="text-muted-foreground">entry</div>
                        <div className="mt-0.5 font-medium">
                          {def.entry.indicator}({def.entry.fast}/{def.entry.slow})
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="text-muted-foreground">exit</div>
                        <div className="mt-0.5 font-medium">
                          SL {def.exit.stopLossPct === null ? "N/A" : `${(def.exit.stopLossPct * 100).toFixed(1)}%`} · TP{" "}
                          {def.exit.takeProfitPct === null ? "N/A" : `${(def.exit.takeProfitPct * 100).toFixed(1)}%`} ·{" "}
                          {def.exit.timeExitBars ?? "N/A"} bars
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="text-muted-foreground">no-trade filter</div>
                        <div className="mt-0.5 font-medium">
                          RSI {def.filters.rsiMin ?? "N/A"} – {def.filters.rsiMax ?? "N/A"}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="text-muted-foreground">position sizing</div>
                        <div className="mt-0.5 font-medium">
                          {def.sizing.kind} · {fmtTime(v.provenance.createdAt)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-border/50 bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {v.provenance.authorType === "AI" ? `AI provenance (${v.provenance.authorRef})` : `Human provenance (${v.provenance.authorRef})`}
                      </span>{" "}
                      — {v.provenance.rationale} Model provider: {v.provenance.modelProvider ?? "N/A"} ·
                      prompt/config: {v.provenance.promptConfigVersion ?? "N/A"}. Structured definition only —
                      no executable trading code exists.
                    </div>

                    {v.evidence && (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium text-foreground">
                          Evidence rationale ({v.evidence.rubricVersion})
                        </div>
                        <ul className="mt-1 space-y-1">
                          {v.evidence.rationale.map((r: string, i: number) => (
                            <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                              · {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {v.fitness && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(v.fitness.dimensions as { dimension: string; segment: string; verdict: string }[]).map((d, i) => (
                          <span
                            key={i}
                            className="rounded-md border border-border/60 bg-card px-2 py-1 text-[10px] text-muted-foreground"
                          >
                            {d.dimension}/{d.segment}: <StateBadge state={d.verdict} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}

      <Panel
        title="Learning → candidate versions"
        description="Learning analyzes outcomes and proposes hypotheses. It can never modify a live or validated version — every change becomes a NEW version that must be revalidated."
      >
        {data.learningEvents.length === 0 ? (
          <EmptyState title="No learning events" body="Post-trade analysis events will appear here." />
        ) : (
          <div className="space-y-3">
            {data.learningEvents.map((le) => (
              <div key={le.learningEventId} className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge state={le.failureClass} label={le.failureClass} />
                  <span className="font-mono text-[11px] text-muted-foreground">{le.learningEventId}</span>
                  <span className="text-[11px] text-muted-foreground">{fmtTime(le.createdAt)}</span>
                  <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    live mutation attempt: {le.liveMutationAttempted ? "YES (violation)" : "none"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{le.analysis}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground">
                  <Sparkles className="mr-1 inline size-3 text-primary" />
                  Hypothesis: {le.hypothesis}
                </p>
                {le.candidateStrategyVersionId ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Candidate version created: <span className="font-mono">{le.candidateStrategyVersionId}</span> —
                    awaiting validation.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePropose(le.learningEventId)}
                    disabled={busy !== null}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {busy === le.learningEventId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <GitBranch className="size-3.5" />
                    )}
                    Propose candidate version (new immutable version)
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
