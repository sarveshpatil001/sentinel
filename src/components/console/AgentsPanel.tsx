import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, RecordDetails } from "./shared";

export default function AgentsPanel() {
  const data = useQuery(api.console.agents);
  if (data === undefined) return <p role="status">Loading agent registry…</p>;
  return (
    <Panel title="Agents" description="Registry status and scopes come from the backend. Unavailable agents are not simulated as working AI.">
      <RecordDetails title="Agent registry and deterministic components" value={data.agents} />
      <RecordDetails title="Learning events" value={data.learningEvents} />
    </Panel>
  );
}
