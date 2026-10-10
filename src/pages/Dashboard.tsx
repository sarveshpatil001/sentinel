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
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router";
import logo from "@/assets/logo.svg";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ViewModeToggle, useViewMode } from "@/components/console/ViewModeToggle";
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

const ALL_TABS = [
  { id: "overview", label: "Overview", simpleLabel: "Dashboard", icon: LayoutDashboard, proOnly: false },
  { id: "execution", label: "Trading & Orders", simpleLabel: "Trading", icon: Activity, proOnly: false },
  { id: "strategies", label: "Strategies", simpleLabel: "Strategies", icon: BadgeCheck, proOnly: false },
  { id: "connections", label: "Exchanges", simpleLabel: "Exchanges", icon: KeyRound, proOnly: false },
  { id: "risk", label: "Safety Controls", simpleLabel: "Safety Controls", icon: ShieldCheck, proOnly: false },
  { id: "data", label: "Price Feeds", simpleLabel: "Price Feeds", icon: DatabaseZap, proOnly: true },
  { id: "validation", label: "Test History", simpleLabel: "Test History", icon: FlaskConical, proOnly: true },
  { id: "agents", label: "AI Helpers", simpleLabel: "AI Helpers", icon: Users, proOnly: true },
  { id: "audit", label: "Activity Log", simpleLabel: "Activity Log", icon: ScrollText, proOnly: true },
  { id: "constitution", label: "System Rules", simpleLabel: "System Rules", icon: TerminalSquare, proOnly: true },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");
  const [viewMode, setViewMode] = useViewMode();
  const seed = useMutation(api.seed.seed);

  // Filter tabs according to viewMode
  const visibleTabs = ALL_TABS.filter((t) => viewMode === "advanced" || !t.proOnly);

  // If the active tab gets hidden when switching to simple mode, smoothly switch back to overview
  useEffect(() => {
    const isVisible = visibleTabs.some((t) => t.id === tab);
    if (!isVisible) {
      setTab("overview");
    }
  }, [viewMode, tab, visibleTabs]);

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

  const isSimple = viewMode === "simple";

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="text-[11px] text-muted-foreground">
                {isSimple ? "Automated Trading" : "Advanced Console"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* View Mode Toggle: Simple vs Pro */}
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />

            <div className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary md:inline-flex">
              <Zap className="size-3 text-primary" />
              <span>Simulation Mode (Safe)</span>
            </div>

            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-medium">{user?.name ?? user?.email ?? "Trader"}</div>
              <div className="text-[10px] text-muted-foreground">
                {isSimple ? "Logged In" : "Authenticated session"}
              </div>
            </div>

            <ThemeToggle />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              onClick={handleSignOut}
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <nav className="flex gap-1 overflow-x-auto pb-2">
              {visibleTabs.map((t) => {
                const active = tab === t.id;
                const label = isSimple ? t.simpleLabel : t.label;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                      active
                        ? "bg-primary/10 text-primary font-semibold shadow-xs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <t.icon className="size-3.5" />
                    {label}
                  </button>
                );
              })}
            </nav>

            {isSimple && (
              <button
                type="button"
                onClick={() => setViewMode("advanced")}
                className="hidden text-[11px] text-muted-foreground hover:text-primary transition-colors pb-2 lg:inline-flex items-center gap-1"
                title="Switch to Pro view to see full quant metrics, audit logs, and technical specs"
              >
                <span>Advanced tabs hidden</span>
                <span className="underline">Show Pro mode</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {tab === "overview" && <OverviewPanel isSimple={isSimple} />}
        {tab === "execution" && <ExecutionPanel isSimple={isSimple} />}
        {tab === "strategies" && <StrategiesPanel isSimple={isSimple} />}
        {tab === "connections" && <ConnectionsPanel isSimple={isSimple} />}
        {tab === "risk" && <RiskPanel isSimple={isSimple} />}
        {tab === "data" && <DataPanel />}
        {tab === "validation" && <ValidationPanel />}
        {tab === "agents" && <AgentsPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "constitution" && <ConstitutionPanel />}
      </div>

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-y-2 px-4 text-[11px] text-muted-foreground sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Sentinel Prime · Easy & safe automated trading</span>
            <span>·</span>
            <span>Demo simulation mode</span>
            <span>·</span>
            <span>No real money at risk</span>
          </div>

          <div className="flex items-center gap-2">
            <span>View:</span>
            <span className="font-semibold text-foreground capitalize">{viewMode}</span>
            <button
              type="button"
              onClick={() => setViewMode(isSimple ? "advanced" : "simple")}
              className="text-primary hover:underline ml-1"
            >
              (Switch to {isSimple ? "Pro" : "Simple"})
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
