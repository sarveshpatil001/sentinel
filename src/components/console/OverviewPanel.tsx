import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, RecordDetails } from "./shared";

export default function OverviewPanel() {
  const data = useQuery(api.console.overview);
  if (data === undefined) return <p role="status">Loading system state…</p>;
  return (
    <Panel title="System state" description="Read-only backend results. Missing values remain null; no metrics are invented.">
      <p>Mode: {data.systemState?.mode ?? "UNKNOWN"}. Kill switch: {data.systemState ? (data.systemState.killSwitchEngaged ? "ENGAGED" : "RELEASED") : "UNKNOWN"}.</p>
      <RecordDetails title="Overview records" value={data} />
    </Panel>
  );
}
