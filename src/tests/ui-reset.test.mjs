import { expect, mock, test } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const removed = [
  "src/components/LogoDropdown.tsx", "src/components/ThemeToggle.tsx",
  "src/components/console/ViewModeToggle.tsx", "src/components/console/ConstitutionPanel.tsx",
  "src/lib/theme.ts", "src/lib/viewMode.ts", "src/assets/logo.svg", "public/logo.svg",
];

let authenticated = true;
let loadingAuth = false;
let loadingData = false;
let mutationCalls = 0;
const state = { mode: "PAPER", killSwitchEngaged: true, simulatedProviderBehavior: "ACK" };
const fixture = {
  systemState: state,
  marketCount: 0, qualitySummary: [], strategyVersionCount: 0,
  latestValidations: [], recentAudit: [], orderCounts: { total: 0, filled: 0, unknown: 0 },
  agentCounts: { total: 0, deterministic: 0, unavailable: 0 },
  auditChain: { scope: "EMPTY", valid: true, verifiedCount: 0 },
  markets: [], quality: [], snapshots: [], series: [],
  strategies: [], versions: [], learningEvents: [],
  policies: [], decisions: [], runs: [], evidence: [], fitness: [],
  authorizations: [], orders: [], positions: [], monitoring: [], agents: [], events: [],
  chain: { scope: "EMPTY", valid: true, verifiedCount: 0 },
};
const apiFixture = {
  console: Object.fromEntries(["overview", "data", "strategies", "validation", "risk", "execution", "agents", "audit"].map((name) => [name, `console.${name}`])),
  seed: { seed: "seed.seed" },
  workflows: Object.fromEntries(["placeOrder", "reconcile", "setKillSwitch", "setSimulatedProviderBehavior", "proposeCandidateVersion", "submitTradeProposal", "runValidation"].map((name) => [name, `workflows.${name}`])),
  connections: Object.fromEntries(["catalog", "list", "register", "verify", "revoke"].map((name) => [name, `connections.${name}`])),
  databricks: { checkWorkspace: "databricks.checkWorkspace" },
};
mock.module("@/convex/_generated/api", () => ({ api: apiFixture }));
mock.module("@/hooks/use-auth", () => ({ useAuth: () => ({ isLoading: loadingAuth, isAuthenticated: authenticated, user: { email: "test@example.invalid" }, signIn: async () => {}, signOut: async () => {} }) }));
mock.module("convex/react", () => ({
  useQuery: (ref) => {
    if (loadingData) return undefined;
    if (ref === "connections.list") return [];
    if (ref === "connections.catalog") return { providers: [{ provider: "SIM-CRYPTO-PROVIDER", adapter: "SIMULATED" }], permissions: ["READ_ACCOUNT"], environments: ["PAPER", "DEMO"], disabledEnvironments: ["CONTROLLED_LIVE"] };
    return fixture;
  },
  useMutation: () => async () => { mutationCalls++; return { ok: true }; },
  useAction: () => async () => { mutationCalls++; return { ok: true }; },
}));

const { default: Dashboard } = await import("../pages/Dashboard");
const { default: Landing } = await import("../pages/Landing");
const { default: Auth } = await import("../pages/Auth");
const { default: NotFound } = await import("../pages/NotFound");
const { RequireAuth } = await import("../components/RequireAuth");
const { RecordDetails, ActionStatus } = await import("../components/console/shared");

function render(Component, path = "/") {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Component, {})));
}

test("obsolete exclusive modules and logos are deleted", () => {
  for (const path of removed) expect(existsSync(resolve(root, path))).toBe(false);
});

test("every product entry and console panel is neutral and has no old imports/modes", () => {
  const paths = ["src/main.tsx", "src/components/RequireAuth.tsx", ...readdirSync(resolve(root, "src/pages")).map((file) => `src/pages/${file}`), ...readdirSync(resolve(root, "src/components/console")).map((file) => `src/components/console/${file}`)];
  for (const path of paths) {
    expect(read(path)).not.toMatch(/className=|style=|lucide-react|framer-motion|ThemeToggle|ViewMode|isSimple|proOnly|sp-theme|sp-view-mode|assets\/logo|components\/ui\//);
  }
});

test("entry retains global CSS, providers, protected six-screen routes, and auth fallback", () => {
  const main = read("src/main.tsx");
  expect(main).toContain('import "./index.css"');
  expect(main).toContain("<ConvexAuthProvider client={convex}>");
  expect(main).toContain("<RequireAuth redirectImmediately><Dashboard /></RequireAuth>");
  expect(main).toContain('redirectAfterAuth="/dashboard"');
  for (const route of ["/dashboard", "/trading", "/charts", "/analysis", "/history", "/settings"]) expect(main).toContain(`"${route}"`);
});

test("old palette/fonts/bootstrap/manifest icons are gone; framework foundation remains", () => {
  const html = read("index.html");
  expect(html).not.toMatch(/logo\.svg|fonts\.google|sp-theme|classList/);
  const css = read("src/index.css");
  expect(css).toContain('@import "tailwindcss"');
  expect(css).toContain("--color-background: var(--background)");
  expect(css).not.toMatch(/Poppins|Roboto|#ffc0cb|#87ceeb|#ffff00|#3b82f6|gradient|box-shadow/);
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  expect(manifest.icons).toBeUndefined();
  expect(manifest.theme_color).toBeUndefined();
});

test("every neutral screen renders its native controls and existing data interface", () => {
  for (const [path, title, content] of [
    ["/dashboard", "Dashboard", "System state"], ["/trading", "Trading", "Submit an authorized order"],
    ["/charts", "Charts", "Reproducible snapshots"], ["/analysis", "Analysis", "Create candidate"],
    ["/history", "History", "Audit history"], ["/settings", "Settings", "Register connection"],
  ]) {
    const html = render(Dashboard, path);
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).toContain(content);
    expect(html).not.toMatch(/class=|style=|<svg/);
    for (const route of ["/dashboard", "/trading", "/charts", "/analysis", "/history", "/settings"]) expect(html).toContain(`href="${route}"`);
  }
  expect(mutationCalls).toBe(0);
});

test("router-accepted trailing slash and mixed-case URLs show the requested screen", () => {
  for (const [path, route, title] of [
    ["/charts/", "/charts", "Charts"], ["/CHARTS", "/charts", "Charts"],
    ["/trading/", "/trading", "Trading"], ["/Settings/", "/settings", "Settings"],
  ]) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(Routes, {}, createElement(Route, { path: route, element: createElement(RequireAuth, { children: createElement(Dashboard) }) }))));
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*href="${route}"`));
  }
});

test("populated records retain blocked/unknown states, provenance, and unavailable integrations", () => {
  fixture.versions = [{ strategyVersionId: "SV-TEST", status: "VALIDATION", definition: { marketId: "MKT-TEST" }, provenance: { rationale: "TEST PROVENANCE" }, evidence: null, fitness: null }];
  fixture.learningEvents = [{ learningEventId: "LE-TEST", candidateStrategyVersionId: null, analysis: "TEST ANALYSIS" }];
  fixture.series = [{ marketId: "MKT-TEST", symbol: "TEST/SIM", points: [{ t: 0, close: 123 }] }];
  fixture.runs = [{ validationId: "VAL-TEST", state: "BLOCKED", metrics: null }];
  fixture.orders = [{ orderId: "ORD-TEST", state: "UNKNOWN" }];
  fixture.agents = [{ agentName: "TEST AGENT", state: "UNAVAILABLE" }];
  fixture.events = [{ sequence: 1, action: "TEST_EVENT", outcome: "DENIED" }];
  expect(render(Dashboard, "/analysis")).toContain("TEST PROVENANCE");
  expect(render(Dashboard, "/analysis")).toContain("UNAVAILABLE");
  expect(render(Dashboard, "/charts")).toContain("TEST/SIM");
  expect(render(Dashboard, "/history")).toContain("BLOCKED");
  expect(render(Dashboard, "/history")).toContain("DENIED");
  expect(render(Dashboard, "/trading")).toContain("UNKNOWN");
  fixture.versions = []; fixture.learningEvents = []; fixture.series = []; fixture.runs = []; fixture.orders = []; fixture.agents = []; fixture.events = [];
});

test("action errors remain visible and successful/denied results remain literal", () => {
  const errorHtml = renderToStaticMarkup(createElement(ActionStatus, { busy: false, error: "DENIED", result: undefined }));
  expect(errorHtml).toContain('role="alert"');
  expect(errorHtml).toContain("DENIED");
  const resultHtml = renderToStaticMarkup(createElement(ActionStatus, { busy: false, error: null, result: { ok: false, reason: "Policy is provisional" } }));
  expect(resultHtml).toContain("false");
  expect(resultHtml).toContain("Policy is provisional");
});

test("public/auth/404 pages render without product design or lost entry links", () => {
  expect(render(Landing)).toContain('href="/auth?returnTo=%2Fdashboard"');
  expect(render(Auth)).toContain('name="email"');
  expect(render(Auth)).toContain("Continue as guest");
  expect(render(NotFound)).toContain("Page not found");
});

test("signed-out route guard preserves full intended path; authenticated children render", () => {
  authenticated = false;
  const blocked = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/history?filter=mine"] }, createElement(RequireAuth, { children: createElement("p", null, "Private records") })));
  expect(blocked).not.toContain("Private records");
  expect(blocked).toContain('/auth?returnTo=%2Fhistory%3Ffilter%3Dmine');
  authenticated = true;
  const allowed = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(RequireAuth, { children: createElement("p", null, "Private records") })));
  expect(allowed).toContain("Private records");
});

test("loading states render real text, not blank product surfaces", () => {
  loadingData = true;
  for (const path of ["/dashboard", "/trading", "/charts", "/analysis", "/history", "/settings"]) expect(render(Dashboard, path)).toContain('role="status"');
  loadingData = false;
  loadingAuth = true;
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(RequireAuth, { children: createElement("p", null, "Private") })));
  expect(html).toContain("Checking session");
  loadingAuth = false;
});

test("neutral records preserve null and UNKNOWN without false green/friendly translations", () => {
  const html = renderToStaticMarkup(createElement(RecordDetails, { title: "Result", value: { state: "UNKNOWN", netReturn: null, quantity: 0 } }));
  expect(html).toContain("UNKNOWN");
  expect(html).toContain("null");
  expect(html).toContain("0");
});
