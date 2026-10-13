import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Activity, BadgeCheck, DatabaseZap, FlaskConical, LayoutDashboard, LogOut, ScrollText, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import logo from "@/assets/logo.svg";
import { ThemeToggle } from "@/components/ThemeToggle";
import OverviewPanel from "@/components/console/OverviewPanel";
import ExecutionPanel from "@/components/console/ExecutionPanel";
import StrategiesPanel from "@/components/console/StrategiesPanel";
import RiskPanel from "@/components/console/RiskPanel";
import DataPanel from "@/components/console/DataPanel";
import ValidationPanel from "@/components/console/ValidationPanel";
import AgentsPanel from "@/components/console/AgentsPanel";
import AuditPanel from "@/components/console/AuditPanel";
import ConnectionsPanel from "@/components/console/ConnectionsPanel";
import DatabricksPanel from "@/components/console/DatabricksPanel";

const TABS = [
  { id: "overview", label: "Overview", simpleLabel: "Dashboard", icon: LayoutDashboard, proOnly: false },
  { id: "execution", label: "Trading", simpleLabel: "Trading", icon: Activity, proOnly: false },
  { id: "strategies", label: "Strategies", simpleLabel: "Strategies", icon: BadgeCheck, proOnly: false },
  { id: "risk", label: "Safety", simpleLabel: "Safety", icon: ShieldCheck, proOnly: false },
  { id: "data", label: "Price Feeds", simpleLabel: "Price Feeds", icon: DatabaseZap, proOnly: true },
  { id: "validation", label: "Test History", simpleLabel: "Test History", icon: FlaskConical, proOnly: true },
  { id: "agents", label: "AI Helpers", simpleLabel: "AI Helpers", icon: Activity, proOnly: true },
  { id: "audit", label: "Activity Log", simpleLabel: "Activity Log", icon: ScrollText, proOnly: true },
  { id: "connections", label: "Exchanges", simpleLabel: "Exchanges", icon: Activity, proOnly: false },
  { id: "databricks", label: "Workspace", simpleLabel: "Workspace", icon: DatabaseZap, proOnly: true },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [viewMode, setViewMode] = useState<"simple" | "advanced">("simple");
  const seed = useMutation(api.seed.seed);

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
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Sentinel Prime" className="size-8 rounded-lg" />
            <div>
              <div className="text-sm font-semibold tracking-tight">Sentinel Prime</div>
              <div className="text-[11px] text-muted-foreground">Safe automated trading</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("simple")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
                  isSimple
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ShieldCheck className="size-3.5" />
                <span>Simple</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("advanced")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
                  !isSimple
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutDashboard className="size-3.5" />
                <span>Pro</span>
              </button>
            </div>

            <div className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary md:inline-flex">
              <Activity className="size-3 text-primary" />
              <span>Paper Mode (Safe)</span>
            </div>

            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-medium">{user?.name ?? user?.email ?? "Trader"}</div>
              <div className="text-[10px] text-muted-foreground">{isSimple ? "Logged in" : "Authenticated session"}</div>
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

        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <nav className="flex gap-1 overflow-x-auto pb-2">
              {TABS.map((t) => {
                const active = activeTab === t.id;
                const label = isSimple ? t.simpleLabel : t.label;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
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
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors pb-2"
              >
                <span className="mr-1">Switch to Pro</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {activeTab === "overview" && <OverviewPanel isSimple={isSimple} />}
        {activeTab === "execution" && <ExecutionPanel isSimple={isSimple} />}
        {activeTab === "strategies" && <StrategiesPanel isSimple={isSimple} />}
        {activeTab === "risk" && <RiskPanel isSimple={isSimple} />}
        {activeTab === "data" && <DataPanel />}
        {activeTab === "validation" && <ValidationPanel />}
        {activeTab === "agents" && <AgentsPanel />}
        {activeTab === "audit" && <AuditPanel />}
        {activeTab === "connections" && <ConnectionsPanel isSimple={isSimple} />}
        {activeTab === "databricks" && <DatabricksPanel />}
      </div>

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 text-[11px] text-muted-foreground sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Sentinel Prime · Safe automated trading</span>
            <span>·</span>
            <span>Paper mode · No real money at risk</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">View:</span>
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
