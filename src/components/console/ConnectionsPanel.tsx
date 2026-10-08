import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Check,
  KeyRound,
  Link2,
  Loader2,
  Lock,
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

export default function ConnectionsPanel() {
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
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState("");
  const [rotateSecret, setRotateSecret] = useState("");

  if (!catalog || !connections) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading connections…</div>;
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
        label,
        environment,
        accountRef,
        apiKey,
        apiSecret: apiSecret.length > 0 ? apiSecret : undefined,
        permissions,
      });
      // Secret state is cleared immediately — the UI never retains key material.
      setApiKey("");
      setApiSecret("");
      setLabel("");
      setAccountRef("");
      setNotice(
        res.ok
          ? { tone: "ok", text: `Connection ${res.connectionId} registered. Key ${res.keyMasked} fingerprinted (${res.fingerprintAlgo}); raw key material was dropped and never stored.` }
          : { tone: "bad", text: `Rejected: ${res.errors.join(" ")}` },
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
      setNotice({ tone: res.ok ? "ok" : "bad", text: `${res.note} (status: ${res.status ?? "n/a"})` });
    } finally {
      setBusy(null);
    }
  };

  const handleRotate = async (connectionId: string) => {
    setBusy(`rotate-${connectionId}`);
    setNotice(null);
    try {
      const res = await rotate({
        connectionId,
        apiKey: rotateKey,
        apiSecret: rotateSecret.length > 0 ? rotateSecret : undefined,
      });
      setRotateKey("");
      setRotateSecret("");
      setRotatingId(null);
      setNotice({ tone: res.ok ? "ok" : "bad", text: res.note });
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (connectionId: string) => {
    setBusy(`revoke-${connectionId}`);
    setNotice(null);
    try {
      const res = await revoke({ connectionId, reason: "Revoked by operator from the console" });
      setNotice({ tone: res.ok ? "ok" : "bad", text: res.note });
    } finally {
      setBusy(null);
    }
  };

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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
                className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
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
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Execution permissions (amber) are never exposed to AI agents, the risk engine or the
              browser after saving — they are consumed only by the execution subsystem.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "register" ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              Connect securely
            </button>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Lock className="size-3" /> password fields · never echoed after saving · never logged
            </span>
          </div>
        </form>
      </Panel>

      {/* Connections list */}
      <Panel
        title="Your connections"
        description="Masked keys only. Verification is honest: a simulated adapter reports VERIFIED_SIMULATED — never a claim of real connectivity. Providers without adapters stay pending."
      >
        {connections.length === 0 ? (
          <EmptyState
            title="No connections yet"
            body="Register a broker or platform credential above. Raw key material is never stored — only a one-way fingerprint and the masked suffix."
          />
        ) : (
          <div className="space-y-3">
            {connections.map((c) => (
              <div key={c.connectionId} className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link2 className="size-4 text-primary" />
                  <span className="text-sm font-semibold">{c.label}</span>
                  <StateBadge state={c.status} />
                  <StateBadge state={c.adapter === "SIMULATED" ? "VERIFIED_SIMULATED" : "PENDING_VERIFICATION"} label={`adapter: ${c.adapter === "SIMULATED" ? "simulated" : "not configured"}`} />
                  <span className="text-[11px] text-muted-foreground">
                    {c.provider} · {c.providerKind} · {c.environment} · account {c.accountRef}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{c.keyMasked}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <span>id: {c.connectionId}</span>
                  <span>fingerprint: {c.keyFingerprint.slice(0, 16)}… ({c.fingerprintAlgo})</span>
                  <span>created {fmtTime(c.createdAt)}</span>
                  {c.rotatedAt && <span>rotated {fmtTime(c.rotatedAt)}</span>}
                  {c.revokedAt && <span>revoked {fmtTime(c.revokedAt)}</span>}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.permissions.map((p) => (
                    <span
                      key={p}
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                        p === "SUBMIT_ORDERS" || p === "CANCEL_ORDERS"
                          ? "border-amber-600/35 bg-amber-600/10 text-amber-700 dark:text-amber-300"
                          : "border-border/70 bg-card text-muted-foreground"
                      }`}
                    >
                      {p}
                    </span>
                  ))}
                </div>

                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{c.verificationNote}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleVerify(c.connectionId)}
                    disabled={busy !== null || c.status === "REVOKED"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {busy === `verify-${c.connectionId}` ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRotatingId(rotatingId === c.connectionId ? null : c.connectionId);
                      setRotateKey("");
                      setRotateSecret("");
                    }}
                    disabled={busy !== null || c.status === "REVOKED"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw className="size-3" />
                    Rotate key
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(c.connectionId)}
                    disabled={busy !== null || c.status === "REVOKED"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/30 bg-red-600/10 px-3 py-1.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-600/15 disabled:opacity-50 dark:text-red-300"
                  >
                    <Unplug className="size-3" />
                    Revoke
                  </button>
                </div>

                {rotatingId === c.connectionId && (
                  <div className="mt-3 rounded-lg border border-border/70 bg-card p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        type="password"
                        value={rotateKey}
                        onChange={(e) => setRotateKey(e.target.value)}
                        placeholder="new API key"
                        minLength={16}
                        maxLength={256}
                        autoComplete="off"
                        spellCheck={false}
                        className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                      />
                      <input
                        type="password"
                        value={rotateSecret}
                        onChange={(e) => setRotateSecret(e.target.value)}
                        placeholder="new API secret (optional)"
                        maxLength={256}
                        autoComplete="off"
                        spellCheck={false}
                        className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRotate(c.connectionId)}
                      disabled={busy !== null || rotateKey.length < 16}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === `rotate-${c.connectionId}` ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                      Save rotated credential
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
