import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { EmptyState, Panel, StateBadge, fmtTime } from "./shared";

interface CatalogShape {
  providers: { provider: string; kind: string; adapter: string; note: string }[];
  permissions: readonly string[];
  executionPermissions: string[];
  environments: string[];
  disabledEnvironments: string[];
  policy: { storage: string; transport: string; isolation: string; production: string };
}

const READ_DEFAULTS = ["READ_ACCOUNT", "READ_BALANCES", "READ_POSITIONS", "READ_ORDERS"];

export default function ConnectionsPanel({ isSimple = false }: { isSimple?: boolean }) {
  const catalog = useQuery(api.connections.catalog) as CatalogShape | undefined;
  const connections = useQuery(api.connections.list);
  const register = useMutation(api.connections.register);
  const verify = useMutation(api.connections.verify);
  const rotate = useMutation(api.connections.rotate);
  const revoke = useMutation(api.connections.revoke);

  const [provider, setProvider] = useState("SIM-CRYPTO-PROVIDER");
  const [environment, setEnvironment] = useState("PAPER");
  const [label, setLabel] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [permissions, setPermissions] = useState<string[]>(READ_DEFAULTS);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  if (!catalog || !connections) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading broker connections…</div>;
  }

  const togglePermission = (p: string) => {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("register");
    setNotice(null);
    try {
      const res = await register({
        provider,
        label: label || `${provider} Connection`,
        environment,
        accountRef: accountRef || "demo-account",
        apiKey,
        apiSecret: apiSecret.length > 0 ? apiSecret : undefined,
        permissions,
      });
      setApiKey("");
      setApiSecret("");
      setLabel("");
      setAccountRef("");
      setShowAddForm(false);
      setNotice(
        res.ok
          ? { tone: "ok", text: `Connection registered securely! Only masked suffix (${res.keyMasked}) is kept; raw keys are never stored.` }
          : { tone: "bad", text: `Registration error: ${res.errors.join(" ")}` },
      );
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async (connectionId: string) => {
    setBusy(`verify-${connectionId}`);
    setNotice(null);
    try {
      const res = await verify({ connectionId });
      setNotice({ tone: res.ok ? "ok" : "bad", text: res.note });
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (connectionId: string) => {
    setBusy(`revoke-${connectionId}`);
    setNotice(null);
    try {
      const res = await revoke({ connectionId, reason: "Removed by user" });
      setNotice({ tone: res.ok ? "ok" : "bad", text: "Connection disconnected." });
    } finally {
      setBusy(null);
    }
  };

  if (isSimple) {
    return (
      <div className="space-y-6">
        {notice && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
              notice.tone === "ok"
                ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300"
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Friendly Overview Banner */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Exchanges & Broker Connections</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect your paper trading or demo exchange accounts. Your secret keys are protected with one-way hashing and never stored in plain text.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer self-start sm:self-auto"
            >
              <Plus className="size-4" />
              <span>{showAddForm ? "Close Form" : "Connect Exchange"}</span>
            </button>
          </div>
        </div>

        {/* Clean Add Connection Form */}
        {showAddForm && (
          <div className="rounded-2xl border border-primary/30 bg-card p-6 shadow-sm">
            <h3 className="text-sm font-semibold mb-4">Add Exchange API Key</h3>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Exchange / Provider
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                  >
                    {catalog.providers.map((p) => (
                      <option key={p.provider} value={p.provider}>
                        {p.provider} ({p.kind})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Account Label
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. My Paper Account"
                    required
                    minLength={3}
                    className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  API Key
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter at least 16 characters"
                    required
                    minLength={16}
                    className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  API Secret (Optional)
                  <input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Optional secret"
                    className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-lg border border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "register" ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
                  <span>Save Protected Credential</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Active Connections List */}
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <h3 className="text-sm font-semibold mb-3">Connected Accounts ({connections.length})</h3>

          <div className="space-y-3">
            {connections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No external exchanges registered yet. Sentinel is operating with the simulated demo provider.
              </p>
            ) : (
              connections.map((c) => (
                <div
                  key={c.connectionId}
                  className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between text-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
                      <Building2 className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{c.label}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {c.provider}
                        </span>
                        <StateBadge state={c.status} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Key: <span className="font-mono">{c.keyMasked}</span> · Mode: {c.environment}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleVerify(c.connectionId)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      {busy === `verify-${c.connectionId}` ? <Loader2 className="size-3 animate-spin inline" /> : "Verify"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(c.connectionId)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ADVANCED / PRO VIEW (Full KMS policy, full fingerprint algo, key rotation form)
  return (
    <div className="space-y-5">
      {/* Security posture */}
      <div className="rounded-2xl border border-primary/25 bg-accent/50 px-6 py-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-semibold">How credentials are protected</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>· <span className="font-medium text-foreground">Never stored:</span> {catalog.policy.storage}</li>
              <li>· <span className="font-medium text-foreground">Transit once:</span> {catalog.policy.transport}</li>
              <li>· <span className="font-medium text-foreground">Isolated:</span> {catalog.policy.isolation}</li>
              <li>· <span className="font-medium text-foreground">Production:</span> {catalog.policy.production}</li>
            </ul>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
            notice.tone === "ok"
              ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Register form */}
      <Panel
        title="Connect a broker or platform"
        description="Register an API credential. The key is fingerprinted server-side and dropped — you will only ever see the masked suffix after saving. Read permissions are the default; execution permissions are opt-in and stay isolated to the execution subsystem."
      >
        <form onSubmit={handleRegister} className="space-y-4" autoComplete="off">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              >
                {catalog.providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider} · {p.adapter === "SIMULATED" ? "simulated adapter" : "no adapter"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Environment
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              >
                {catalog.environments.map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
                {catalog.disabledEnvironments.map((env) => (
                  <option key={env} value={env} disabled>
                    {env} — disabled until readiness review
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Connection label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Main demo account"
                minLength={3}
                maxLength={64}
                required
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Account reference (not secret)
              <input
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                placeholder="acct-123456"
                maxLength={128}
                required
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              API key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••••••"
                minLength={16}
                maxLength={256}
                required
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              API secret (optional)
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="••••••••••••••••"
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
              />
            </label>
          </div>

          <div>
            <div className="text-[11px] font-medium text-muted-foreground">Permissions</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {catalog.permissions.map((p) => {
                const isExecution = catalog.executionPermissions.includes(p);
                const checked = permissions.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePermission(p)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      checked
                        ? isExecution
                          ? "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-300"
                          : "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 bg-card text-muted-foreground"
                    }`}
                  >
                    {checked ? <Check className="size-3" /> : <Lock className="size-3" />}
                    {p}
                    {isExecution && <ShieldAlert className="size-3" />}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "register" ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            Register connection (stores fingerprint + masked suffix only)
          </button>
        </form>
      </Panel>

      {/* Connection list */}
      <Panel
        title="Registered broker / platform connections"
        description="Masked suffix, one-way fingerprint and status only. Raw secret material is never stored, never returned and never accessible to the frontend or agents."
      >
        {connections.length === 0 ? (
          <EmptyState
            title="No connections registered"
            body="Register a paper or demo connection to configure broker credentials."
          />
        ) : (
          <div className="space-y-3">
            {connections.map((c) => (
              <div key={c.connectionId} className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{c.connectionId}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs">{c.provider} ({c.providerKind})</span>
                  <StateBadge state={c.status} />
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    account: <span className="font-mono">{c.accountRef}</span> · {c.environment}
                  </span>
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground">{c.verificationNote}</div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.permissions.map((p: string) => (
                    <span
                      key={p}
                      className="rounded-md border border-border/60 bg-card px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-[11px]">
                  <span className="font-mono text-muted-foreground">key: {c.keyMasked}</span>
                  <span className="font-mono text-muted-foreground">
                    print: {c.keyFingerprint.slice(0, 16)}… ({c.fingerprintAlgo})
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleVerify(c.connectionId)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border/80 bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(c.connectionId)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border/80 bg-card px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-muted"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
