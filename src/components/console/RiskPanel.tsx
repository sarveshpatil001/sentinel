import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel, RecordDetails } from "./shared";

export default function RiskPanel() {
  const data = useQuery(api.console.risk);
  const strategies = useQuery(api.console.strategies);
  const submitProposal = useMutation(api.workflows.submitTradeProposal);
  const action = useConsoleAction();
  const [strategyVersionId, setStrategyVersionId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  if (data === undefined || strategies === undefined) return <p role="status">Loading risk state…</p>;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = strategies?.versions.find((v) => v.strategyVersionId === strategyVersionId);
    if (!selected) return;
    const marketId = (selected.definition as { marketId?: string }).marketId ?? "";
    void action.run(() => submitProposal({ strategyVersionId, marketId, side, quantity: Number(quantity), referencePrice: Number(referencePrice), idempotencyKey: `ui-proposal-${crypto.randomUUID()}` }));
  }

  return (
    <Panel title="Risk controls" description="BLOCK or UNKNOWN means no trade. Policy approval, limits, ownership, and veto decisions are enforced by the existing backend.">
      <RecordDetails title="System state and configured risk policies" value={{ systemState: data.systemState, policies: data.policies }} />
      <form onSubmit={submit}>
        <fieldset disabled={action.busy}>
          <legend>Submit a trade proposal</legend>
          <label>Strategy version <select required value={strategyVersionId} onChange={(e) => setStrategyVersionId(e.target.value)}><option value="">Select a version</option>{strategies.versions.map((v) => <option key={v.strategyVersionId} value={v.strategyVersionId}>{v.strategyVersionId} ({v.status})</option>)}</select></label>
          <label>Side <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label>
          <label>Quantity <input type="number" min="0" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>Reference price <input type="number" min="0" step="any" required value={referencePrice} onChange={(e) => setReferencePrice(e.target.value)} /></label>
          <button type="submit" disabled={!strategyVersionId}>Evaluate proposal</button>
        </fieldset>
      </form>
      <ActionStatus {...action} />
      <RecordDetails title="Risk decisions and veto checks" value={data.decisions} />
    </Panel>
  );
}
