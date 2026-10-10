import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { DatabaseZap, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Panel, StateBadge } from "./shared";

export default function DatabricksPanel() {
  const checkWorkspace = useAction(api.databricks.checkWorkspace);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    status: string;
    note: string;
  } | null>(null);

  const runCheck = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkWorkspace({}));
    } catch {
      setResult({
        ok: false,
        status: "UNKNOWN",
        note: "The Databricks check could not be completed. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Databricks workspace"
        description="Check that this app can reach your Databricks workspace. The check only reads the current user and never places or changes trades."
        action={<DatabaseZap className="size-4 text-primary" />}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Set up the workspace host and access token in the Keys tab. The token stays on the server and is not shown here.
          </p>
          <button
            type="button"
            onClick={runCheck}
            disabled={busy}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {busy ? "Checking…" : "Check connection"}
          </button>
        </div>
      </Panel>

      {result && (
        <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {result.ok ? (
              <ShieldCheck className="size-4 text-emerald-500" />
            ) : (
              <ShieldX className="size-4 text-amber-500" />
            )}
            <StateBadge
              state={result.status}
              label={
                result.ok
                  ? "Connected"
                  : result.status === "NOT_CONFIGURED"
                    ? "Setup needed"
                    : "Could not confirm"
              }
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{result.note}</p>
        </div>
      )}
    </div>
  );
}
