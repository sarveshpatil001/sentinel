import { Link, matchPath, useLocation, useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useConsoleAction } from "@/hooks/use-console-action";
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
  { path: "/dashboard", title: "Dashboard" },
  { path: "/trading", title: "Trading" },
  { path: "/charts", title: "Charts" },
  { path: "/analysis", title: "Analysis" },
  { path: "/history", title: "History" },
  { path: "/settings", title: "Settings" },
];

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const seed = useMutation(api.seed.seed);
  const action = useConsoleAction();
  const screen = screens.find((item) => matchPath(item.path, location.pathname)) ?? screens[0];

  return (
    <main>
      <h1>{screen.title}</h1>
      <p>Temporary interface. The previous design has been removed; replacement design has not started.</p>
      <nav aria-label="Workspace screens"><ul>{screens.map((item) => <li key={item.path}><Link to={item.path} aria-current={screen.path === item.path ? "page" : undefined}>{item.title}</Link></li>)}</ul></nav>
      <p>Session: {user?.name ?? user?.email ?? "Authenticated user"}.</p>
      <p><Link to="/">Home</Link> · <button type="button" disabled={action.busy} onClick={() => action.run(async () => { await signOut(); navigate("/", { replace: true }); return "Signed out"; })}>Sign out</button></p>
      <ActionStatus {...action} />
      {screen.path === "/dashboard" && <OverviewPanel />}
      {screen.path === "/trading" && <><RiskPanel /><ExecutionPanel /></>}
      {screen.path === "/charts" && <DataPanel />}
      {screen.path === "/analysis" && <><StrategiesPanel /><AgentsPanel /></>}
      {screen.path === "/history" && <><ValidationPanel /><AuditPanel /></>}
      {screen.path === "/settings" && (
        <>
          <section>
            <h2>Initialization</h2>
            <p>Backend initialization is explicit and admin-gated. It seeds only the existing deterministic simulation and never resets existing state.</p>
            <button type="button" disabled={action.busy} onClick={() => action.run(() => seed({}))}>Initialize simulation (admin)</button>
          </section>
          <ConnectionsPanel />
          <DatabricksPanel />
          <RiskPanel />
        </>
      )}
    </main>
  );
}
