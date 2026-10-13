import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel, RecordDetails } from "./shared";

type Behavior = "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT";

export default function ExecutionPanel() {
  const data = useQuery(api.console.execution);
  const risk = useQuery(api.console.risk);
  const placeOrder = useMutation(api.workflows.placeOrder);
  const reconcile = useMutation(api.workflows.reconcile);
  const setKillSwitch = useMutation(api.workflows.setKillSwitch);
  const setProviderBehavior = useMutation(api.workflows.setSimulatedProviderBehavior);
  const action = useConsoleAction();
  const [authorizationId, setAuthorizationId] = useState("");
  const [quantity, setQuantity] = useState("");
  if (data === undefined || risk === undefined) return <p role="status">Loading execution state…</p>;
  const authorization = data.authorizations.find((a) => a.authorizationId === authorizationId && a.state === "APPROVED");

  function orderArgs(idempotencyKey: string) {
    if (!authorization) throw new Error("Select an approved authorization.");
    if (authorization.scope.mode !== "PAPER" && authorization.scope.mode !== "DEMO") throw new Error("Only PAPER/DEMO orders are available.");
    return {
      authorizationId: authorization.authorizationId,
      strategyVersionId: authorization.scope.strategyVersionId,
      marketId: authorization.scope.marketId,
      side: authorization.scope.side as "BUY" | "SELL",
      quantity: Number(quantity),
      orderType: authorization.scope.orderType,
      timeInForce: authorization.scope.timeInForce,
      idempotencyKey,
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void action.run(() => placeOrder(orderArgs(`ui-order-${crypto.randomUUID()}`)));
  }

  return (
    <Panel title="Execution controls" description="Only existing PAPER/DEMO authorization paths are exposed. UNKNOWN orders require reconciliation, never blind retries. Backend checks remain authoritative.">
      <p>Mode: {risk.systemState?.mode ?? "UNKNOWN"}. Kill switch: {risk.systemState ? (risk.systemState.killSwitchEngaged ? "ENGAGED" : "RELEASED") : "UNKNOWN"}.</p>
      <form onSubmit={submit}>
        <fieldset disabled={action.busy}>
          <legend>Submit an authorized order</legend>
          <label>Authorization <select required value={authorizationId} onChange={(e) => { const id = e.target.value; setAuthorizationId(id); const selected = data.authorizations.find((a) => a.authorizationId === id); setQuantity(selected ? String(selected.scope.quantity) : ""); }}><option value="">Select an authorization</option>{data.authorizations.filter((a) => a.state === "APPROVED" && (a.scope.mode === "PAPER" || a.scope.mode === "DEMO")).map((a) => <option key={a.authorizationId} value={a.authorizationId}>{a.authorizationId} ({a.scope.side} {a.scope.marketId})</option>)}</select></label>
          <label>Quantity <input type="number" min="0" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <button type="submit" disabled={!authorization}>Submit order</button>
          <button type="button" disabled={!authorization || !quantity} onClick={() => action.run(async () => { const args = orderArgs(`ui-duplicate-${crypto.randomUUID()}`); const first = await placeOrder(args); const second = await placeOrder(args); return { first, second }; })}>Test duplicate submission (submits one paper/demo order)</button>
        </fieldset>
      </form>
      <p><button type="button" disabled={action.busy} onClick={() => action.run(() => reconcile({}))}>Run reconciliation</button></p>
      <fieldset disabled={action.busy || !risk.systemState}>
        <legend>Safety and simulation</legend>
        <button type="button" disabled={risk.systemState?.killSwitchEngaged === true} onClick={() => action.run(() => setKillSwitch({ engaged: true, reason: "Operator paused trading" }))}>Engage kill switch</button>
        <button type="button" disabled={risk.systemState?.killSwitchEngaged !== true} onClick={() => action.run(() => setKillSwitch({ engaged: false, reason: "Operator requested release" }))}>Request release (admin; unresolved orders block release)</button>
        <label>Simulated provider response (admin) <select value={risk.systemState?.simulatedProviderBehavior ?? "ACK"} onChange={(e) => { const behavior = e.target.value as Behavior; void action.run(() => setProviderBehavior({ behavior, reason: "Operator configured simulated provider behavior." })); }}>{["ACK", "FILL", "PARTIAL", "REJECT", "TIMEOUT"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </fieldset>
      <ActionStatus {...action} />
      <RecordDetails title="Authorizations and scopes" value={data.authorizations} />
      <RecordDetails title="Orders and lifecycle history" value={data.orders} />
      <RecordDetails title="Positions" value={data.positions} />
      <RecordDetails title="Monitoring" value={data.monitoring} />
    </Panel>
  );
}
