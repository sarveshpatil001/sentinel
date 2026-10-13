import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, RecordDetails } from "./shared";

export default function AuditPanel() {
  const data = useQuery(api.console.audit);
  if (data === undefined) return <p role="status">Loading audit records…</p>;
  return (
    <Panel title="Audit history" description="Tamper-evident, not tamper-proof. A verified WINDOW does not verify earlier history; EMPTY verifies nothing.">
      <p>Scope: {data.chain.scope}. Valid: {String(data.chain.valid)}. Records verified: {data.chain.verifiedCount}.</p>
      <RecordDetails title="Verification details" value={data.chain} />
      {data.events.length === 0 && <p>No visible audit events.</p>}
      {data.events.map((event) => <RecordDetails key={event.sequence} title={`#${event.sequence} ${event.action} (${event.outcome})`} value={event} />)}
    </Panel>
  );
}
