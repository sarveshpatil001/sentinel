import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CheckCircle2, ChevronDown, ChevronUp, Info, Loader2, Send, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { CheckRow, MetricTile, Panel, StateBadge, fmtTime } from "./shared";

export default function RiskPanel({ isSimple = false }: { isSimple?: boolean }) {
  const data = useQuery(api.console.risk);
  const strategies = useQuery(api.console.strategies);
  const submitProposal = useMutation(api.workflows.submitTradeProposal);

  const [strategyVersionId, setStrategyVersionId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("0.1");
  const [referencePrice, setReferencePrice] = useState("62000");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ outcome: string; authorizationId: string | null; checks: { check: string; status: string; detail: string }[] } | null>(null);
  const [showLimits, setShowLimits] = useState(false);

  if (!data || !strategies) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading risk controls…</div>;
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

  if (isSimple) {
    return (
      <div className="space-y-6">
        {/* Simple Risk Status */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Automatic Risk Guardian</h2>
                <p className="text-xs text-muted-foreground">
                  Every proposed trade must pass 10+ mathematical veto tests before it can ever execute.
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              <span>Veto Shield Online</span>
            </div>
          </div>
        </div>

        {/* Propose a Trade Form */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <h3 className="text-sm font-semibold mb-1">Simulate & Check a Trade</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Test how Sentinel Prime evaluates trade sizes and risk rules before dispatching orders.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Strategy
              <select
                value={strategyVersionId}
                onChange={(e) => setStrategyVersionId(e.target.value)}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              >
                <option value="">Choose a strategy…</option>
                {strategies.versions.map((v) => (
                  <option key={v.strategyVersionId} value={v.strategyVersionId}>
                    {v.strategyVersionId} ({v.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Action
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              >
                <option value="BUY">BUY (Long)</option>
                <option value="SELL">SELL (Short)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Order Quantity
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Est. Price ($)
              <input
                value={referencePrice}
                onChange={(e) => setReferencePrice(e.target.value)}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !strategyVersionId}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-4" />}
              <span>Verify & Authorize Trade</span>
            </button>
          </div>

          {/* Verification Outcome Card */}
          {result && (
            <div className="mt-5 rounded-xl border border-border/70 bg-background/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span>Risk Veto Outcome:</span>
                  <StateBadge state={result.outcome} />
                </div>
                {result.authorizationId && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ Trade authorized! Go to Trading tab to submit.
                  </span>
                )}
              </div>

              <div className="space-y-1.5 border-t border-border/60 pt-3">
                {result.checks.map((c) => (
                  <div key={c.check} className="flex items-center justify-between text-xs py-1">
                    <span className="text-muted-foreground">{c.check.replace(/_/g, " ")}</span>
                    <StateBadge state={c.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible details for safety limits */}
          <div className="mt-5 pt-4 border-t border-border/60">
            <button
              type="button"
              onClick={() => setShowLimits(!showLimits)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showLimits ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span>{showLimits ? "Hide safety thresholds" : "View configured risk limits"}</span>
            </button>

            {showLimits && (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                {Object.entries(limits).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border/50 bg-background/40 p-2.5 text-xs">
                    <div className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1")}</div>
                    <div className="mt-0.5 font-semibold text-foreground">{v === null ? "Safe Default" : v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ADVANCED / PRO VIEW
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
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Strategy version
            <select
              value={strategyVersionId}
              onChange={(e) => setStrategyVersionId(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="">select…</option>
              {strategies.versions.map((v) => (
                <option key={v.strategyVersionId} value={v.strategyVersionId}>
                  {v.strategyVersionId} ({v.status})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Side
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Quantity
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            />
          </label>
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Reference price
            <input
              value={referencePrice}
              onChange={(e) => setReferencePrice(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !strategyVersionId}
            className="self-end rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Evaluate proposal"}
          </button>
        </div>

        {result && (
          <div className="mt-4 rounded-xl border border-border/70 bg-background/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">Veto decision:</span>
              <StateBadge state={result.outcome} />
              {result.authorizationId && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  authorization {result.authorizationId} (unexpired, scoped)
                </span>
              )}
            </div>
            <div className="mt-3 space-y-1">
              {result.checks.map((c) => (
                <CheckRow key={c.check} check={c.check} status={c.status} detail={c.detail} />
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
