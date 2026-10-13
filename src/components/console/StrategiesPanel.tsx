import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel, RecordDetails } from "./shared";

export default function StrategiesPanel() {
  const data = useQuery(api.console.strategies);
  const proposeCandidate = useMutation(api.workflows.proposeCandidateVersion);
  const action = useConsoleAction();
  const [learningEventId, setLearningEventId] = useState("");
  const [fast, setFast] = useState("5");
  const [slow, setSlow] = useState("15");
  const [timeExitBars, setTimeExitBars] = useState("24");
  if (data === undefined) return <p role="status">Loading strategies…</p>;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!learningEventId) return;
    void action.run(() => proposeCandidate({ learningEventId, params: { fast: Number(fast), slow: Number(slow), timeExitBars: Number(timeExitBars) } }));
  }

  return (
    <Panel title="Strategies" description="Existing versions are immutable. Candidate changes create new versions and require revalidation; they do not mutate live strategies.">
      <RecordDetails title="Strategies" value={data.strategies} />
      <RecordDetails title="Versions, definitions, provenance, evidence, and fitness" value={data.versions} />
      <RecordDetails title="Learning events" value={data.learningEvents} />
      <form onSubmit={submit}>
        <fieldset disabled={action.busy}>
          <legend>Propose a candidate version</legend>
          <label>Learning event <select value={learningEventId} onChange={(e) => setLearningEventId(e.target.value)} required><option value="">Select an event</option>{data.learningEvents.filter((e) => !e.candidateStrategyVersionId).map((e) => <option key={e.learningEventId} value={e.learningEventId}>{e.learningEventId}</option>)}</select></label>
          <label>Fast period <input type="number" min="1" step="1" value={fast} onChange={(e) => setFast(e.target.value)} required /></label>
          <label>Slow period <input type="number" min="1" step="1" value={slow} onChange={(e) => setSlow(e.target.value)} required /></label>
          <label>Time exit bars <input type="number" min="1" step="1" value={timeExitBars} onChange={(e) => setTimeExitBars(e.target.value)} required /></label>
          <button type="submit" disabled={!learningEventId}>Create candidate</button>
        </fieldset>
      </form>
      <ActionStatus {...action} />
    </Panel>
  );
}
