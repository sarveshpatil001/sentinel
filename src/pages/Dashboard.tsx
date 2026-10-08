import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  Activity,
  BadgeCheck,
  DatabaseZap,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router";
import logo from "@/assets/logo.svg";
import OverviewPanel from "@/components/console/OverviewPanel";
import DataPanel from "@/components/console/DataPanel";
import StrategiesPanel from "@/components/console/StrategiesPanel";
import ValidationPanel from "@/components/console/ValidationPanel";
import RiskPanel from "@/components/console/RiskPanel";
import ExecutionPanel from "@/components/console/ExecutionPanel";
import ConnectionsPanel from "@/components/console/ConnectionsPanel";
import AgentsPanel from "@/components/console/AgentsPanel";
import AuditPanel from "@/components/console/AuditPanel";
import ConstitutionPanel from "@/components/console/ConstitutionPanel";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "data", label: "Market data", icon: DatabaseZap },
  { id: "strategies", label: "Strategies", icon: BadgeCheck },
  { id: "validation", label: "Validation", icon: FlaskConical },
  { id: "risk", label: "Risk & veto", icon: ShieldCheck },
  { id: "execution", label: "Execution", icon: Activity },
  { id: "connections", label: "Broker & API keys", icon: KeyRound },
  { id: "agents", label: "Agents & learning", icon: Users },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "constitution", label: "Constitution & reports", icon: TerminalSquare },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");
  const seed = useMutation(api.seed.seed);

  // Idempotent bootstrap: seeds deterministic state exactly once.
  useEffect(() => {
    let cancelled = false;
    seed({})
      .then(() => {
        if (!cancelled) return;
      })
      .catch((err) => console.warn("[seed] bootstrap skipped:", err?.message ?? err));
    return () => {
      cancelled = true;
    };
  }, [seed]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="text-[11px] text-muted-foreground">Control console · paper mode</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary sm:inline-flex">
              <Activity className="size-3" />
              deterministic authority chain active
            </div>
            <div className="text-right leading-tight">
              <div className="text-xs font-medium">{user?.name ?? user?.email ?? "Operator"}</div>
              <div className="text-[10px] text-muted-foreground">authenticated session</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              onClick={handleSignOut}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto w-full max-w-7xl px-6">
          <nav className="flex gap-1 overflow-x-auto pb-2">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        {tab === "overview" && <OverviewPanel />}
        {tab === "data" && <DataPanel />}
        {tab === "strategies" && <StrategiesPanel />}
        {tab === "validation" && <ValidationPanel />}
        {tab === "risk" && <RiskPanel />}
        {tab === "execution" && <ExecutionPanel />}
        {tab === "connections" && <ConnectionsPanel />}
        {tab === "agents" && <AgentsPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "constitution" && <ConstitutionPanel />}
      </div>

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-6 text-[11px] text-muted-foreground">
          <span>Sentinel Prime · synthetic seeded data · paper execution</span>
          <span>·</span>
          <span>UNKNOWN stays UNKNOWN until verified</span>
          <span>·</span>
          <span>FAILED stays FAILED until recovered and validated</span>
          <span>·</span>
          <span>validated strategies remain immutable</span>
        </div>
      </footer>
    </main>
  );
}
