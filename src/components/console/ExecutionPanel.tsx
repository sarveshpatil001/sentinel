import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AlertOctagon, Loader2, RefreshCw, Send, ShieldOff } from "lucide-react";
import { EmptyState, MetricTile, Panel, StateBadge, fmt, fmtTime } from "./shared";

export default function ExecutionPanel() {
  const data = useQuery(api.console.execution);
  const riskData = useQuery(api.console.risk);
  const placeOrder = useMutation(api.workflows.placeOrder);
  const reconcile = useMutation(api.workflows.reconcile);
  const setKillSwitch = useMutation(api.workflows.setKillSwitch);
  const setProviderBehavior = useMutation(api.workflows.setSimulatedProviderBehavior);

  const [quantity, setQuantity] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!data || !riskData) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading execution state…</div>;
  }

  const pendingAuth = data.authorizations.find((a) => a.state === "APPROVED");
  const unknownOrders = data.orders.filter((o) => o.state === "UNKNOWN");

  const handleBehaviorChange = async (behavior: "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT") => {
    setBusy("behavior");
    setNotice(null);
    try {
      const res = await setProviderBehavior({
        behavior,
        reason: "Operator configured the simulated provider adapter from the console (test/demo configuration).",
      });
      setNotice(
        "ok" in res && res.ok
          ? `Simulated provider behavior set to ${behavior} (server-side config).`
          : `Simulation config change refused: ${"reason" in res ? res.reason : "denied"}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handlePlace = async () => {
    if (!pendingAuth) return;
    setBusy("place");
    setNotice(null);
    try {
      const key = `ui-order-${Date.now()}`;
      const res = await placeOrder({
        authorizationId: pendingAuth.authorizationId,
        strategyVersionId: pendingAuth.scope.strategyVersionId,
        marketId: pendingAuth.scope.marketId,
        side: pendingAuth.scope.side as "BUY" | "SELL",
        quantity: Number(quantity),
        orderType: "MARKET",
        timeInForce: "GTC",
        idempotencyKey: key,
      });
      setNotice(
        res.deduped
          ? `Duplicate idempotency key — no new external mutation. Existing order ${res.orderId} is ${res.state}.`
          : `Order ${res.orderId}: ${res.state} — ${res.note}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handleDuplicateSubmit = async () => {
    if (!pendingAuth) return;
    setBusy("dup");
    setNotice(null);
    try {
      const key = `ui-dup-${Date.now()}`;
      const first = await placeOrder({
        authorizationId: pendingAuth.authorizationId,
        strategyVersionId: pendingAuth.scope.strategyVersionId,
        marketId: pendingAuth.scope.marketId,
        side: pendingAuth.scope.side as "BUY" | "SELL",
        quantity: Number(quantity),
        orderType: "MARKET",
        timeInForce: "GTC",
        idempotencyKey: key,
      });
      const second = await placeOrder({
        authorizationId: pendingAuth.authorizationId,
        strategyVersionId: pendingAuth.scope.strategyVersionId,
        marketId: pendingAuth.scope.marketId,
        side: pendingAuth.scope.side as "BUY" | "SELL",
        quantity: Number(quantity),
        orderType: "MARKET",
        timeInForce: "GTC",
        idempotencyKey: key,
      });
      setNotice(
        `Idempotency test: first submit → ${first.state}; identical resubmit → ${second.deduped ? `deduplicated (${second.state}) — duplicate order prevented` : "NOT DEDUPLICATED (violation)"}.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handleReconcile = async () => {
    setBusy("recon");
    setNotice(null);
    try {
      const res = await reconcile();
      setNotice(
        res.healthy
          ? `Reconciliation HEALTHY. Resolved: ${res.resolved.map((r) => `${r.orderId} ${r.from}→${r.to}`).join(", ") || "no pending states"}.`
          : `Reconciliation MISMATCH — unresolved orders: ${res.unresolved.join(", ")}. New exposure stays blocked.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handleKill = async (engaged: boolean) => {
    setBusy("kill");
    setNotice(null);
    try {
      const res = await setKillSwitch({
        engaged,
        reason: engaged ? "Operator engaged kill switch from console" : "Operator released kill switch after verification",
      });
      setNotice(res.ok ? `Kill switch ${engaged ? "ENGAGED" : "RELEASED"}.` : `Release refused: ${res.reason}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-xs leading-relaxed">{notice}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Authorizations approved"
          value={data.authorizations.filter((a) => a.state === "APPROVED").length}
          sub={`${data.authorizations.length} total · scoped + expiring`}
        />
        <MetricTile
          label="Orders in UNKNOWN"
          value={unknownOrders.length}
          sub="reconcile before any retry or release"
          tone={unknownOrders.length > 0 ? "warn" : "ok"}
        />
        <MetricTile label="Open positions" value={data.positions.filter((p) => p.quantity !== 0).length} sub="paper ledger" />
      </div>

      {/* Controls */}
      <Panel
        title="Execution controls (PAPER — simulated provider)"
        description="Execution carries out already-authorized actions. Choose how the simulated external provider responds. A TIMEOUT after a possible submission produces ORDER = UNKNOWN: never assumed failed, never blindly retried — reconciled first."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Provider behavior (server-side config · admin)
            <select
              value={riskData.systemState?.simulatedProviderBehavior ?? "ACK"}
              onChange={(e) =>
                handleBehaviorChange(e.target.value as "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT")
              }
              disabled={busy !== null}
              className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="ACK">ACK → acknowledged</option>
              <option value="FILL">FILL → filled immediately</option>
              <option value="PARTIAL">PARTIAL → half-filled, remainder open</option>
              <option value="REJECT">REJECT → provider rejects</option>
              <option value="TIMEOUT">TIMEOUT → order becomes UNKNOWN</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Quantity
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-28 rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={handlePlace}
            disabled={busy !== null || !pendingAuth}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "place" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Submit authorized order
          </button>
          <button
            type="button"
            onClick={handleDuplicateSubmit}
            disabled={busy !== null || !pendingAuth}
            className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Test idempotency (double submit)
          </button>
          <button
            type="button"
            onClick={handleReconcile}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {busy === "recon" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Run reconciliation
          </button>
        </div>

        {!pendingAuth && (
          <p className="mt-3 rounded-lg border border-amber-600/25 bg-amber-600/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            No approved authorization is available. Submit a trade proposal in the Risk panel first — orders
            cannot exist without a scoped, unexpired authorization. That is the whole point.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <span className="text-[11px] font-medium text-muted-foreground">Kill switch (global halt on new execution):</span>
          <button
            type="button"
            onClick={() => handleKill(true)}
            disabled={busy !== null || riskData.systemState?.killSwitchEngaged === true}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/30 bg-red-600/10 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-600/15 disabled:opacity-50 dark:text-red-300"
          >
            <AlertOctagon className="size-3.5" /> Engage
          </button>
          <button
            type="button"
            onClick={() => handleKill(false)}
            disabled={busy !== null || riskData.systemState?.killSwitchEngaged !== true}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <ShieldOff className="size-3.5" /> Release (blocked while orders are UNKNOWN)
          </button>
        </div>
      </Panel>

      {/* Orders */}
      <Panel title="Order lifecycle" description="ORDER INTENT ≠ EXTERNAL ORDER ≠ POSITION STATE. UNKNOWN is a first-class state.">
        {data.orders.length === 0 ? (
          <EmptyState title="No orders" body="Authorized orders appear here with their full state history." />
        ) : (
          <div className="space-y-3">
            {data.orders.map((o) => (
              <div key={o.orderId} className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-medium">{o.orderId}</span>
                  <StateBadge state={o.state} />
                  <span className="text-[11px] text-muted-foreground">
                    {o.side} {o.quantity} {o.symbol} · {o.orderType}/{o.timeInForce} · {o.mode}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    provider: {o.providerOrderId ?? "—"} · truth: {o.providerTruth ?? "NONE"} · key: {o.idempotencyKey}
                  </span>
                </div>
                {o.fillPrice !== undefined && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    fill {fmt(o.fillPrice, { digits: 2 })} × {fmt(o.fillQuantity)} · fees {fmt(o.fees)} · slippage {fmt(o.slippage)}
                  </div>
                )}
                <div className="mt-3 space-y-1 border-l border-border/70 pl-3">
                  {o.history.map((h, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <StateBadge state={h.state} />
                      <span className="text-muted-foreground">{h.note}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/70">{fmtTime(h.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Authorizations */}
      <Panel title="Execution authorizations" description="Scope: account · strategy version · market · side · quantity · order type · time-in-force · risk policy · mode · expiration. States: APPROVED → CONSUMED / EXPIRED / REVOKED.">
        {data.authorizations.length === 0 ? (
          <EmptyState title="No authorizations" body="Authorizations are only issued when the deterministic risk veto returns APPROVE." />
        ) : (
          <div className="space-y-2">
            {data.authorizations.map((a) => (
              <div key={a.authorizationId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-[11px]">
                <span className="font-mono font-medium">{a.authorizationId}</span>
                <StateBadge state={a.state} />
                <span className="text-muted-foreground">
                  {a.scope.side} {a.scope.quantity} @ {a.scope.marketId.replace("MKT-", "").replace("-SIM", "")} · {a.scope.orderType}/{a.scope.timeInForce} · {a.scope.mode}
                </span>
                <span className="text-muted-foreground">
                  policy {a.scope.riskPolicyRef} · expires {fmtTime(a.scope.expiresAt)}
                </span>
                {a.consumedByOrderId && (
                  <span className="ml-auto text-muted-foreground">consumed by {a.consumedByOrderId}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Positions + monitoring */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Positions (paper ledger)" description="Order state ≠ position state. Reconciliation is authoritative for external state.">
          <div className="space-y-2">
            {data.positions.length === 0 && <p className="text-xs text-muted-foreground">Flat — no positions.</p>}
            {data.positions.map((p) => (
              <div key={p.positionId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-[11px]">
                <span className="font-mono">{p.positionId}</span>
                <StateBadge state={p.side === "FLAT" ? "CANCELLED" : "FILLED"} label={p.side} />
                <span className="text-muted-foreground">
                  {p.quantity} @ {fmt(p.avgEntryPrice)} · realized PnL {fmt(p.realizedPnl)}
                </span>
                <span className="ml-auto text-muted-foreground">{p.account}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Monitoring" description="Monitoring is part of the safety system, not merely UI. Monitoring agents may recommend; they cannot execute arbitrary actions.">
          <div className="space-y-2">
            {data.monitoring.length === 0 && <p className="text-xs text-muted-foreground">No monitoring events.</p>}
            {data.monitoring.map((m) => (
              <div key={m.monitorId} className="rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge state={m.state} />
                  <span className="font-mono text-muted-foreground">{m.scope}:{m.scopeId}</span>
                  <span className="ml-auto text-muted-foreground">{fmtTime(m.createdAt)}</span>
                </div>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{m.observation}</p>
                {m.recommendation && (
                  <p className="mt-1 leading-relaxed text-foreground">Recommendation: {m.recommendation}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
