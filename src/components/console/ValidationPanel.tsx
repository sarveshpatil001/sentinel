import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel, RecordDetails } from "./shared";

export default function ValidationPanel() {
  const data = useQuery(api.console.validation);
  const strategies = useQuery(api.console.strategies);
  const runValidation = useMutation(api.workflows.runValidation);
  const action = useConsoleAction();
  if (data === undefined || strategies === undefined) return <p role="status">Loading validation records…</p>;
  return (
    <Panel title="Validation history" description="Existing deterministic validation remains unchanged. Blocked runs retain absent metrics rather than zero values.">
      {strategies.versions.map((version) => <p key={version.strategyVersionId}><button type="button" disabled={action.busy} onClick={() => action.run(() => runValidation({ strategyVersionId: version.strategyVersionId }))}>Validate {version.strategyVersionId}</button></p>)}
      <ActionStatus {...action} />
      {data.runs.length === 0 && <p>No validation runs are available.</p>}
      {data.runs.map((run) => <RecordDetails key={run.validationId} title={`${run.validationId}: ${run.state}`} value={run} />)}
      <RecordDetails title="Evidence records" value={data.evidence} />
      <RecordDetails title="Fitness records" value={data.fitness} />
    </Panel>
  );
}
