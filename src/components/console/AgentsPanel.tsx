import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bot, Cpu, ShieldQuestion } from "lucide-react";
import { Panel, StateBadge, fmtTime } from "./shared";

export default function AgentsPanel() {
  const data = useQuery(api.console.agents);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading agent registry…</div>;
  }

  const aiAgents = data.agents.filter((a) => !a.isDeterministic);
  const deterministic = data.agents.filter((a) => a.isDeterministic);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-primary/25 bg-accent/50 px-6 py-5">
        <div className="flex items-start gap-3">
          <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-semibold">Deny-by-default agent access</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Agents are specialized intelligence with scoped tools and data. There is no giant
              unrestricted autonomous AI. No agent holds execution credentials, unrestricted
              database access, shell access, or the ability to approve itself. In this
              environment the AI Gateway is not configured, so AI agents honestly report
              <span className="font-medium text-foreground"> UNAVAILABLE</span> rather than
              fabricating outputs.
            </p>
          </div>
        </div>
      </div>

      <Panel
        title={`AI agents (${aiAgents.length})`}
        description="Canonical registry: market intelligence, strategy, trust/validation, trading control and learning agents."
      >
        <div className="grid gap-2.5 lg:grid-cols-2">
          {aiAgents.map((a) => (
            <div key={a.agentKey} className="rounded-xl border border-border/60 bg-background/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="size-4 text-primary" />
                <span className="text-sm font-semibold">{a.agentName}</span>
                <StateBadge state={a.state} />
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{a.agentKey}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{a.description}</p>
              <div className="mt-2 grid grid-cols-1 gap-1.5 text-[10px] sm:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-card px-2.5 py-1.5">
                  <div className="text-muted-foreground">allowed tools</div>
                  <div className="mt-0.5 font-medium">{a.allowedTools.join(", ")}</div>
                </div>
                <div className="rounded-lg border border-border/50 bg-card px-2.5 py-1.5">
                  <div className="text-muted-foreground">allowed data</div>
                  <div className="mt-0.5 font-medium">{a.allowedData.join(", ")}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">forbidden:</span> {a.forbiddenActions.join(", ")}
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                owner: {a.ownerDomain} · contract {a.contractVersion} · v{a.agentVersion} · model policy: {a.modelPolicy}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={`Deterministic components (${deterministic.length})`}
        description="NOT AI agents. These hold the deterministic authority: quant, risk, veto, execution, reconciliation."
      >
        <div className="grid gap-2.5 lg:grid-cols-2">
          {deterministic.map((a) => (
            <div key={a.agentKey} className="rounded-xl border border-primary/20 bg-accent/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Cpu className="size-4 text-primary" />
                <span className="text-sm font-semibold">{a.agentName}</span>
                <StateBadge state={a.state} />
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{a.agentKey}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{a.description}</p>
              <div className="mt-2 text-[10px] text-muted-foreground">
                tools: {a.allowedTools.join(", ")} · data: {a.allowedData.join(", ")}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Learning events"
        description="Learning may analyze outcomes, classify failures and propose hypotheses. Learning may NOT modify live strategies, validated versions, risk limits, credentials, authorizations, monitoring or audit history."
      >
        <div className="space-y-2.5">
          {data.learningEvents.map((le) => (
            <div key={le.learningEventId} className="rounded-xl border border-border/60 bg-background/60 p-4 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state="INFO" label={le.failureClass} />
                <span className="font-mono text-muted-foreground">{le.learningEventId}</span>
                <span className="text-muted-foreground">{fmtTime(le.createdAt)}</span>
                <span className="ml-auto rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  live-mutation attempts: {le.liveMutationAttempted ? "YES" : "none"}
                </span>
              </div>
              <p className="mt-1.5 leading-relaxed text-muted-foreground">{le.analysis}</p>
              <p className="mt-1 leading-relaxed text-foreground">Hypothesis: {le.hypothesis}</p>
              {le.candidateStrategyVersionId && (
                <p className="mt-1 text-muted-foreground">
                  Candidate: <span className="font-mono">{le.candidateStrategyVersionId}</span> (new immutable version, must be revalidated)
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
