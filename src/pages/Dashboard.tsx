import { matchPath, useLocation } from "react-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useConsoleAction } from "@/hooks/use-console-action";
import { AppFrame } from "@/components/sentinel/chrome";
import DashboardScreen from "@/components/sentinel/screens/DashboardScreen";
import TradingScreen from "@/components/sentinel/screens/TradingScreen";
import ChartsScreen from "@/components/sentinel/screens/ChartsScreen";
import SignalsScreen from "@/components/sentinel/screens/SignalsScreen";
import HistoryScreen from "@/components/sentinel/screens/HistoryScreen";
import SettingsScreen from "@/components/sentinel/screens/SettingsScreen";
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
import { ActionStatus } from "@/components/console/shared";

const screens = [
  { path: "/dashboard", Screen: DashboardScreen },
  { path: "/trading", Screen: TradingScreen },
  { path: "/charts", Screen: ChartsScreen },
  { path: "/analysis", Screen: SignalsScreen },
  { path: "/history", Screen: HistoryScreen },
  { path: "/settings", Screen: SettingsScreen },
];

export default function Dashboard() {
  const location = useLocation();
  const { user } = useAuth();
  const seed = useMutation(api.seed.seed);
  const action = useConsoleAction();
  const screen = screens.find((item) => matchPath(item.path, location.pathname)) ?? screens[0];
  const ActiveScreen = screen.Screen;

  return (
    <main className="flex min-h-dvh w-full flex-col items-center bg-sp-canvas">
      <AppFrame activePath={screen.path}>
        <ActiveScreen />
      </AppFrame>

      <section className="sp-console w-full max-w-[390px] px-5 pb-12">
        <details>
          <summary>
            Backend data console (engineering) · {user?.name ?? user?.email ?? "Authenticated user"}
          </summary>
          {screen.path === "/dashboard" && <OverviewPanel />}
          {screen.path === "/trading" && (
            <>
              <RiskPanel />
              <ExecutionPanel />
            </>
          )}
          {screen.path === "/charts" && <DataPanel />}
          {screen.path === "/analysis" && (
            <>
              <StrategiesPanel />
              <AgentsPanel />
            </>
          )}
          {screen.path === "/history" && (
            <>
              <ValidationPanel />
              <AuditPanel />
            </>
          )}
          {screen.path === "/settings" && (
            <>
              <section>
                <h2>Initialization</h2>
                <p>
                  Backend initialization is explicit and admin-gated. It seeds only the existing
                  deterministic simulation and never resets existing state.
                </p>
                <button type="button" disabled={action.busy} onClick={() => action.run(() => seed({}))}>
                  Initialize simulation (admin)
                </button>
              </section>
              <ConnectionsPanel />
              <DatabricksPanel />
              <RiskPanel />
            </>
          )}
          <ActionStatus {...action} />
        </details>
      </section>
    </main>
  );
}
