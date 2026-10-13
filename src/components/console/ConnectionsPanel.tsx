import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConsoleAction } from "@/hooks/use-console-action";
import { ActionStatus, Panel, RecordDetails } from "./shared";

const READ_DEFAULTS = ["READ_ACCOUNT", "READ_BALANCES", "READ_POSITIONS", "READ_ORDERS"];

export default function ConnectionsPanel() {
  const catalog = useQuery(api.connections.catalog);
  const connections = useQuery(api.connections.list);
  const register = useMutation(api.connections.register);
  const verify = useMutation(api.connections.verify);
  const revoke = useMutation(api.connections.revoke);
  const action = useConsoleAction();
  const [provider, setProvider] = useState("SIM-CRYPTO-PROVIDER");
  const [environment, setEnvironment] = useState("PAPER");
  const [label, setLabel] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [permissions, setPermissions] = useState<string[]>(READ_DEFAULTS);
  if (catalog === undefined || connections === undefined) return <p role="status">Loading connections…</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run(() => register({ provider, environment, label, accountRef, apiKey, apiSecret: apiSecret || undefined, permissions }));
    setApiKey("");
    setApiSecret("");
    if (result?.ok) { setLabel(""); setAccountRef(""); }
  }

  return (
    <Panel title="Broker connections" description="Existing adapters and environments only. Registration keeps a fingerprint and masked suffix, not raw secrets or a production credential vault.">
      <RecordDetails title="Provider catalog and security policy" value={catalog} />
      <form onSubmit={submit} autoComplete="off">
        <fieldset disabled={action.busy}>
          <legend>Register a paper/demo credential</legend>
          <label>Provider <select value={provider} onChange={(e) => setProvider(e.target.value)}>{catalog.providers.map((p) => <option key={p.provider} value={p.provider}>{p.provider} ({p.adapter})</option>)}</select></label>
          <label>Environment <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>{catalog.environments.map((value) => <option key={value} value={value}>{value}</option>)}{catalog.disabledEnvironments.map((value) => <option key={value} value={value} disabled>{value} (disabled)</option>)}</select></label>
          <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} minLength={3} maxLength={64} required /></label>
          <label>Account reference (not secret) <input value={accountRef} onChange={(e) => setAccountRef(e.target.value)} maxLength={128} required /></label>
          <label>API key <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} minLength={16} maxLength={256} required autoComplete="off" spellCheck={false} /></label>
          <label>API secret (optional) <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} maxLength={256} autoComplete="off" spellCheck={false} /></label>
          <fieldset>
            <legend>Permissions (execution is opt-in)</legend>
            {catalog.permissions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(e) => setPermissions((current) => e.target.checked ? [...current, permission] : current.filter((p) => p !== permission))} />{permission}</label>)}
          </fieldset>
          <button type="submit">Register connection</button>
        </fieldset>
      </form>
      <ActionStatus {...action} />
      {connections.length === 0 && <p>No registered connections.</p>}
      {connections.map((connection) => (
        <section key={connection.connectionId}>
          <h3>{connection.label}: {connection.status}</h3>
          <RecordDetails title="Connection metadata (no raw credentials)" value={connection} />
          <button type="button" disabled={action.busy} onClick={() => action.run(() => verify({ connectionId: connection.connectionId }))}>Verify</button>
          <button type="button" disabled={action.busy || connection.status === "REVOKED"} onClick={() => action.run(() => revoke({ connectionId: connection.connectionId, reason: "Removed by user" }))}>Revoke</button>
        </section>
      ))}
    </Panel>
  );
}
