import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AlertOctagon, CheckCircle2, ChevronDown, ChevronUp, Clock, HelpCircle, Info, Loader2, RefreshCw, Send, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { EmptyState, MetricTile, Panel, StateBadge, fmt, fmtTime } from "./shared";

export default function ExecutionPanel({ isSimple = false }: { isSimple?: boolean }) {
  const data = useQuery(api.console.execution);
  const riskData = useQuery(api.console.risk);
  const placeOrder = useMutation(api.workflows.placeOrder);
  const reconcile = useMutation(api.workflows.reconcile);
  const setKillSwitch = useMutation(api.workflows.setKillSwitch);
  const setProviderBehavior = useMutation(api.workflows.setSimulatedProviderBehavior);

  const [quantity, setQuantity] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  if (!data || !riskData) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading trading state…</div>;
  }

  const pendingAuth = data.authorizations.find((a) => a.state === "APPROVED");
  const unknownOrders = data.orders.filter((o) => o.state === "UNKNOWN");
  const openPositions = data.positions.filter((p) => p.quantity !== 0);

  const handleBehaviorChange = async (behavior: "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT") => {
    setBusy("behavior");
    setNotice(null);
    try {
      const res = await setProviderBehavior({
        behavior,
        reason: "Operator configured simulated provider behavior.",
      });
      setNotice(
        "ok" in res && res.ok
          ? `Exchange simulation response set to: ${behavior}`
          : `Configuration change refused: ${"reason" in res ? res.reason : "denied"}`,
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
          ? `Duplicate order prevented. Order is already in state: ${res.state}.`
          : `Trade placed successfully! Status: ${res.state}`,
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
        `Safety test: first order → ${first.state}; duplicate submit → ${second.deduped ? "prevented from double-charging (safe)" : "error"}.`,
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
          ? `Exchange sync complete. Status is healthy.`
          : `Attention: unresolved orders detected (${res.unresolved.join(", ")}). Trading remains paused for safety.`,
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
        reason: engaged ? "Operator paused trading" : "Operator resumed trading",
      });
      setNotice(res.ok ? `Trading ${engaged ? "PAUSED (Safety Halt Active)" : "RESUMED"}.` : `Action refused: ${res.reason}`);
    } finally {
      setBusy(null);
    }
  };

  if (isSimple) {
    return (
      <div className="space-y-6">
        {notice && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs leading-relaxed text-foreground">
            {notice}
          </div>
        )}

        {/* Friendly Trading Overview & Emergency Stop */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Execute Simulated Trades</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Submit trades backed by real-time risk verification. Every trade is checked against drawdown limits before reaching the market.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {riskData.systemState?.killSwitchEngaged ? (
                <button
                  type="button"
                  onClick={() => handleKill(false)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <ShieldCheck className="size-4 text-emerald-500" />
                  Resume Trading
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleKill(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-600/30 bg-red-600/10 px-4 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-600/15 transition-colors cursor-pointer"
                >
                  <AlertOctagon className="size-4" />
                  Emergency Stop
                </button>
              )}
            </div>
          </div>

          {/* Clean Order Action Card */}
          <div className="mt-6 rounded-xl border border-border/60 bg-background/50 p-5">
            {pendingAuth ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  <span>Approved Trade Proposal Ready: {pendingAuth.scope.side} {pendingAuth.scope.marketId.replace("MKT-", "").replace("-SIM", "")}</span>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Quantity
                    <input
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-32 rounded-lg border border-border/80 bg-card px-3 py-2 text-xs text-foreground"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handlePlace}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {busy === "place" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    Submit Order Now
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 text-xs text-muted-foreground">
                <Info className="size-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-foreground">No pending trade proposals right now.</span>
                  <p className="mt-0.5">
                    To place a trade, propose an order in the <strong>Risk Controls</strong> tab. Sentinel Prime's safety engine evaluates the risk and returns an approved authorization.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Open Positions List */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <h3 className="text-sm font-semibold tracking-tight">Open Positions ({openPositions.length})</h3>
          <div className="mt-4 space-y-2.5">
            {openPositions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active positions. You are currently flat.</p>
            ) : (
              openPositions.map((p) => (
                <div
                  key={p.positionId}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${p.side === "LONG" ? "text-emerald-500" : "text-amber-500"}`}>
                      {p.side}
                    </span>
                    <span className="text-foreground">{p.quantity} units</span>
                    <span className="text-muted-foreground">Entry: ${fmt(p.avgEntryPrice)}</span>
                  </div>

                  <div className="text-right">
                    <span className="text-muted-foreground">PnL: </span>
                    <span className={`font-bold ${(p.realizedPnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      ${fmt(p.realizedPnl)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Orders List */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight">Recent Orders</h3>
            <button
              type="button"
              onClick={handleReconcile}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
            >
              <RefreshCw className={`size-3 ${busy === "recon" ? "animate-spin" : ""}`} />
              <span>Sync with Exchange</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {data.orders.length === 0 ? (
              <p className="text-xs text-muted-foreground">No orders yet.</p>
            ) : (
              data.orders.slice(0, 6).map((o) => (
                <div
                  key={o.orderId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-foreground">{o.side}</span>
                    <span className="text-muted-foreground">{o.quantity} {o.symbol}</span>
                    <StateBadge state={o.state} />
                  </div>

                  <div className="text-right text-[11px] text-muted-foreground">
                    {o.fillPrice ? `Filled @ $${fmt(o.fillPrice)}` : "Market Order"} · {fmtTime(o.updatedAt)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Toggle for simulator tools */}
          <div className="mt-5 pt-4 border-t border-border/60">
            <button
              type="button"
              onClick={() => setShowAdvancedTools(!showAdvancedTools)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showAdvancedTools ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span>{showAdvancedTools ? "Hide simulation testing tools" : "Show simulation response tools"}</span>
            </button>

            {showAdvancedTools && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-4">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Simulated Exchange Behavior
                  <select
                    value={riskData.systemState?.simulatedProviderBehavior ?? "ACK"}
                    onChange={(e) =>
                      handleBehaviorChange(e.target.value as "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT")
                    }
                    className="rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground"
                  >
                    <option value="ACK">ACK (Order accepted)</option>
                    <option value="FILL">FILL (Immediate fill)</option>
                    <option value="PARTIAL">PARTIAL (Partial fill)</option>
                    <option value="REJECT">REJECT (Exchange rejection)</option>
                    <option value="TIMEOUT">TIMEOUT (Simulate network loss)</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={handleDuplicateSubmit}
                  disabled={busy !== null || !pendingAuth}
                  className="self-end rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                  Test Double-Submission Safety
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ADVANCED / PRO VIEW (Preserves all raw prechecks, authorizations, and full lifecycle steps)
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
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Provider behavior (server-side config · admin)
            <select
              value={riskData.systemState?.simulatedProviderBehavior ?? "ACK"}
              onChange={(e) =>
                handleBehaviorChange(e.target.value as "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT")
              }
              disabled={busy !== null}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="ACK">ACK → acknowledged</option>
              <option value="FILL">FILL → filled immediately</option>
              <option value="PARTIAL">PARTIAL → half-filled, remainder open</option>
              <option value="REJECT">REJECT → provider rejects</option>
              <option value="TIMEOUT">TIMEOUT → order becomes UNKNOWN</option>
            </select>
          </label>
          <label className="flex min-w-0 w-full flex-col gap-1 text-[11px] font-medium text-muted-foreground sm:w-auto">
            Quantity
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground sm:w-28"
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
            cannot exist without a scoped, unexpired authorization.
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
