import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel } from "./shared";

export default function DatabricksPanel() {
  const checkWorkspace = useAction(api.databricks.checkWorkspace);
  const action = useConsoleAction();
  return (
    <Panel title="Databricks connection" description="Read-only workspace check. Keys are managed through the platform Keys tab and remain server-side.">
      <button type="button" disabled={action.busy} onClick={() => action.run(() => checkWorkspace({}))}>Check connection</button>
      <ActionStatus {...action} />
    </Panel>
  );
}
