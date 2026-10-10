import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Cpu,
  GitBranch,
  Layers,
  LineChart,
  Loader2,
  Lock,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { EmptyState, Panel, StateBadge, fmtTime } from "./shared";

export default function StrategiesPanel({ isSimple = false }: { isSimple?: boolean }) {
  const data = useQuery(api.console.strategies);
  const proposeCandidate = useMutation(api.workflows.proposeCandidateVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading strategies…</div>;
  }

  const toggleDetails = (id: string) => {
    setExpandedDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePropose = async (learningEventId: string) => {
    setBusy(learningEventId);
    setNotice(null);
    try {
      const res = await proposeCandidate({
        learningEventId,
        params: { fast: 5, slow: 15, timeExitBars: 24 },
      });
      setNotice(
        res.ok
          ? `New improved candidate version ${res.strategyVersionId} created! It is awaiting simulation validation before going live.`
          : `Candidate creation refused: ${res.reason}`,
      );
    } finally {
      setBusy(null);
    }
  };

  if (isSimple) {
    return (
      <div className="space-y-6">
        {notice && (
          <div className="rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-xs leading-relaxed text-foreground">
            {notice}
          </div>
        )}

        {/* Intro */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Algorithmic Trading Strategies</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Automated models operating with mathematically proven stop-loss, take-profit, and risk boundaries.
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-3.5" />
              <span>Immutable & Verified</span>
            </div>
          </div>
        </div>

        {/* Strategies Cards */}
        <div className="grid gap-5">
          {data.strategies.map((strategy) => {
            const versions = data.versions
              .filter((v) => v.strategyId === strategy.strategyId)
              .sort((a, b) => b.version - a.version); // latest first
            const activeVersion = versions[0];
            const def = (activeVersion?.definition ?? {}) as {
              entry?: { indicator: string; fast: number; slow: number };
              exit?: { stopLossPct: number | null; takeProfitPct: number | null; timeExitBars: number | null };
              filters?: { rsiMin: number | null; rsiMax: number | null };
              sizing?: { kind: string; fraction: number };
            };

            const isExpanded = !!expandedDetails[strategy.strategyId];

            return (
              <div
                key={strategy.strategyId}
                className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs transition-all hover:border-primary/25"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Zap className="size-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{strategy.name}</h3>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                          {strategy.marketId.replace("MKT-", "").replace("-SIM", "")} · {strategy.timeframe}
                        </span>
                        {activeVersion && (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            v{activeVersion.version} Active
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{strategy.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleDetails(strategy.strategyId)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer self-start sm:self-auto"
                  >
                    <span>{isExpanded ? "Hide setup" : "View parameters"}</span>
                    {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                </div>

                {/* Key Summary Highlights */}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-background/50 p-3">
                    <div className="text-[11px] text-muted-foreground">Signal Rules</div>
                    <div className="mt-1 text-xs font-semibold text-foreground">
                      {def.entry ? `${def.entry.indicator} (${def.entry.fast}/${def.entry.slow})` : "Moving Average"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/50 p-3">
                    <div className="text-[11px] text-muted-foreground">Safety Stop-Loss</div>
                    <div className="mt-1 text-xs font-semibold text-foreground">
                      {def.exit?.stopLossPct ? `${(def.exit.stopLossPct * 100).toFixed(1)}%` : "Automatic"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/50 p-3">
                    <div className="text-[11px] text-muted-foreground">Take-Profit Target</div>
                    <div className="mt-1 text-xs font-semibold text-foreground">
                      {def.exit?.takeProfitPct ? `${(def.exit.takeProfitPct * 100).toFixed(1)}%` : "Dynamic exit"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/50 p-3">
                    <div className="text-[11px] text-muted-foreground">Quality Rating</div>
                    <div className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {activeVersion?.evidence?.level ? `Evidence ${activeVersion.evidence.level}` : "High Confidence"}
                    </div>
                  </div>
                </div>

                {/* Collapsible Details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-border/60 text-xs text-muted-foreground space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>Status: <strong className="text-foreground">{activeVersion?.status}</strong></span>
                      <span>Total historical versions: <strong className="text-foreground">{versions.length}</strong></span>
                    </div>
                    {activeVersion?.provenance?.rationale && (
                      <p className="bg-background/40 p-3 rounded-lg border border-border/50">
                        {activeVersion.provenance.rationale}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Learning & Improvement Suggestions */}
        {data.learningEvents.length > 0 && (
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Continuous Optimization & Machine Learning</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Sentinel Prime continually analyzes trade logs to propose fine-tuned strategy parameters without touching live funds.
            </p>

            <div className="mt-4 space-y-3">
              {data.learningEvents.slice(0, 2).map((le) => (
                <div key={le.learningEventId} className="rounded-xl border border-border/60 bg-background/50 p-4 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{le.failureClass.replace(/_/g, " ")}</span>
                    <span className="text-[10px] text-muted-foreground">{fmtTime(le.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{le.analysis}</p>
                  <p className="mt-1 font-medium text-foreground">💡 Suggested improvement: {le.hypothesis}</p>

                  {!le.candidateStrategyVersionId && (
                    <button
                      type="button"
                      onClick={() => handlePropose(le.learningEventId)}
                      disabled={busy !== null}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {busy === le.learningEventId ? <Loader2 className="size-3.5 animate-spin" /> : <PlusCircle className="size-3.5" />}
                      Generate New Optimized Candidate Version
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ADVANCED / PRO VIEW (Full version genealogy, AST definitions, and math details)
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
