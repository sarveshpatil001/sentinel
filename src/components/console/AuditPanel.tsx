import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link2, ShieldAlert } from "lucide-react";
import { Panel, StateBadge, fmtTime } from "./shared";

export default function AuditPanel() {
  const data = useQuery(api.console.audit);

  if (!data) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading audit chain…</div>;
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Audit chain"
        description="Append-oriented and tamper-evident: each record hashes its content and the previous record's hash. Audit records are never updated or deleted. Note: this build uses a deterministic FNV-1a chain — cryptographic anchoring (SHA-256 + external log) is specified for production and recorded as a spec gap."
        action={
          data.chain.valid ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <Link2 className="size-3" />{" "}
              {data.chain.scope === "FULL_CHAIN"
                ? `full chain verified (${data.events.length} records)`
                : data.chain.scope === "WINDOW"
                  ? `window verified (${data.events.length} records) — earlier history NOT verified`
                  : "no records — nothing verified"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-600/25 bg-red-600/10 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
              <ShieldAlert className="size-3" /> chain broken at #{data.chain.brokenAt}: {data.chain.reason}
            </span>
          )
        }
      >
        <div className="space-y-2">
          {data.events.map((e) => (
            <div key={e.sequence} className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">#{e.sequence}</span>
                <span className="text-xs font-semibold">{e.action}</span>
                <StateBadge state={e.outcome} />
                <span className="ml-auto text-[10px] text-muted-foreground">{fmtTime(e.at)}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{e.detail}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 break-all font-mono text-[9px] text-muted-foreground/70">
                <span>actor: {e.actor} ({e.actorType})</span>
                <span>resource: {e.resourceType}/{e.resourceId}</span>
                <span>correlation: {e.correlationId}</span>
                <span>prev: {e.prevHash.slice(0, 12)}…</span>
                <span>hash: {e.hash.slice(0, 12)}…</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
