import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { CheckRow, MetricTile, Panel, StateBadge, fmtTime } from "./shared";

export default function RiskPanel() {
  const data = useQuery(api.console.risk);
  const strategies = useQuery(api.console.strategies);
  const submitProposal = useMutation(api.workflows.submitTradeProposal);

  const [strategyVersionId, setStrategyVersionId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("0.1");
  const [referencePrice, setReferencePrice] = useState("62000");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ outcome: string; authorizationId: string | null; checks: { check: string; status: string; detail: string }[] } | null>(null);

  if (!data || !strategies) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading risk state…</div>;
  }

  const policy = data.policies[0];
  const limits = (policy?.limits ?? {}) as Record<string, number | null>;

  const handleSubmit = async () => {
    if (!strategyVersionId) return;
    setBusy(true);
    setResult(null);
    try {
      const selected = strategies.versions.find((v) => v.strategyVersionId === strategyVersionId);
      const marketId = (selected?.definition as { marketId?: string } | undefined)?.marketId ?? "";
      const res = await submitProposal({
        strategyVersionId,
        marketId,
        side,
        quantity: Number(quantity),
        referencePrice: Number(referencePrice),
        idempotencyKey: `ui-${Date.now()}`,
      });
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Kill switch / mode strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile label="System mode" value={data.systemState?.mode ?? "PAPER"} sub={`environment ${data.systemState?.environment ?? "PAPER"}`} />
        <MetricTile
          label="Kill switch"
          value={data.systemState?.killSwitchEngaged ? "ENGAGED" : "RELEASED"}
          sub={data.systemState?.killSwitchReason ?? "no reason recorded"}
          tone={data.systemState?.killSwitchEngaged ? "bad" : "ok"}
        />
        <MetricTile label="Risk policy" value={policy ? `${policy.policyId} v${policy.version}` : "MISSING"} sub={policy?.status ?? "UNKNOWN"} tone={policy?.status === "PROVISIONAL" ? "warn" : "neutral"} />
      </div>

      <Panel
        title="Deterministic risk engine + veto"
        description="Risk AI may recommend. The deterministic risk veto is the final authority. Any BLOCK or UNKNOWN critical state means NO TRADE. There is no admin force-trade path."
        action={<StateBadge state={policy?.status ?? "UNKNOWN"} label={`policy ${policy?.status ?? "UNKNOWN"}`} />}
      >
        <div className="rounded-xl border border-amber-600/25 bg-amber-600/5 px-4 py-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          {policy?.provenanceNote}
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(limits).map(([k, v]) => (
            <MetricTile key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()} value={v === null ? "NOT DECLARED" : v} tone={v === null ? "warn" : "neutral"} />
          ))}
        </div>
      </Panel>

      <Panel title="Submit a trade proposal" description="Proposal → deterministic risk evaluation → veto → authorization or block. Watch the checks — every one of them is computed, not asserted.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Strategy version
            <select
              value={strategyVersionId}
              onChange={(e) => setStrategyVersionId(e.target.value)}
              className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="">select…</option>
              {strategies.versions.map((v) => (
                <option key={v.strategyVersionId} value={v.strategyVersionId}>
                  {v.strategyVersionId} ({v.status})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Side
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
              className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Quantity
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Reference price
            <input
              value={referencePrice}
              onChange={(e) => setReferencePrice(e.target.value)}
              className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !strategyVersionId}
            className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Evaluate + veto
          </button>
        </div>

        {result && (
          <div className="mt-5">
            <div
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold ${
                result.outcome === "APPROVE"
                  ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
                  : result.outcome === "BLOCK"
                    ? "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300"
                    : "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {result.outcome === "APPROVE" ? (
                <ShieldCheck className="size-4" />
              ) : result.outcome === "BLOCK" ? (
                <ShieldAlert className="size-4" />
              ) : (
                <ShieldQuestion className="size-4" />
              )}
              Deterministic risk veto: {result.outcome}
              {result.authorizationId && (
                <span className="ml-1 font-mono text-[11px] font-normal">
                  · authorization {result.authorizationId} issued (scoped, expiring)
                </span>
              )}
            </div>
            <div className="mt-3">
              {result.checks.map((c) => (
                <CheckRow key={c.check} check={c.check} status={c.status} detail={c.detail} />
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Risk decision history" description="Every decision references its policy version. Historical decisions never change.">
        <div className="space-y-2.5">
          {data.decisions.length === 0 && (
            <p className="text-xs text-muted-foreground">No risk decisions recorded yet.</p>
          )}
          {data.decisions.map((d) => (
            <div key={d.riskDecisionId} className="rounded-xl border border-border/60 bg-background/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px]">{d.riskDecisionId}</span>
                <StateBadge state={d.outcome} />
                <span className="text-[11px] text-muted-foreground">
                  policy v{d.policyVersion} · mode {d.mode} · {fmtTime(d.createdAt)} · {d.actor}
                </span>
              </div>
              <div className="mt-2">
                {d.checks.map((c) => (
                  <CheckRow key={c.check} check={c.check} status={c.status} detail={c.detail} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
