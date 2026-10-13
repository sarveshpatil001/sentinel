# Sentinel Prime UI reset audit

## Acceptance criteria

Remove the old active UI on every application surface, not build a new design. Keep the React/Vite/Convex provider hierarchy, authentication and return-path routing, reactive subscriptions, existing backend APIs and business tests. Keep the application runnable with neutral native markup and reachable protected screens. No live trading, fabricated metrics, weakened risk checks, schema changes, secret changes, or production data mutations.

## Pre-edit inventory

- Repository file tree, all source-module imports/exports/API consumers, public assets, application CSS, HTML entry, package scripts, lockfiles, project configuration, tests, README, and architectural documentation were inspected. Backend modules were classified by exports and dependency graph; no backend rewrite is in scope.
- Active routes in `src/main.tsx`: `/` (`Landing`), `/auth` (`AuthPage`), protected `/dashboard` (`Dashboard`), wildcard (`NotFound`). There were **not six separate existing routes** for Dashboard, Trading, Charts, Analysis, History, Settings.
- `/dashboard` mounted ten tabs: Overview, Trading, Strategies, Safety, Price Feeds, Test History, AI Helpers, Activity Log, Exchanges, Workspace. Dashboard/Trading exist as tabs; Charts maps to DataPanel; Analysis maps to StrategiesPanel/RiskPanel/AgentsPanel; History maps to ValidationPanel/AuditPanel; Settings maps to ConnectionsPanel/DatabricksPanel. The reset will expose all six requested names as protected neutral routes without deleting the old API capabilities.
- `src/pages/Landing.tsx`: marketing hero, CTA, feature sections, footer, decorative icons and gradients. The previous claimed reset still left this active design.
- `src/pages/Dashboard.tsx`: sticky header, tab navigation, branding, Simple/Pro controls, theme toggle, footer, automatic seed call.
- `src/pages/Auth.tsx`: email OTP and anonymous sign-in logic mixed with logo, card composition, styled OTP input and icon buttons.
- `src/pages/NotFound.tsx`: animated styled 404.
- `src/components/RequireAuth.tsx`: working route guard/returnTo handling mixed with styled card/loading/error presentation.
- `src/components/LogoDropdown.tsx`: unused brand dropdown, home/sign-out handlers already available elsewhere.
- `src/components/ThemeToggle.tsx`, `src/lib/theme.ts`: old light/dark selection, `sp-theme` storage; `index.html` applies dark before mount.
- `src/components/console/ViewModeToggle.tsx`, `src/lib/viewMode.ts`: obsolete Simple/Advanced/Pro mode and `sp-view-mode` storage.
- Console consumers: OverviewPanel (`console.overview`); ExecutionPanel (`console.execution`, `console.risk`, `placeOrder`, `reconcile`, `setKillSwitch`, `setSimulatedProviderBehavior`); StrategiesPanel (`console.strategies`, `proposeCandidateVersion`); RiskPanel (`console.risk`, `console.strategies`, `submitTradeProposal`); DataPanel (`console.data`, Recharts); ValidationPanel (`console.validation`, `console.strategies`, `runValidation`); AgentsPanel (`console.agents`); AuditPanel (`console.audit`); ConnectionsPanel (`connections.catalog/list/register/verify/revoke`); DatabricksPanel (`databricks.checkWorkspace`). All are to be refactored to neutral controls/readouts, not blindly deleted.
- `src/components/console/ConstitutionPanel.tsx`: orphan static specification-gap/governance report; not an active route. No business authority. Remove the component, retain existing architecture documentation and recoverable baseline.
- `src/components/console/shared.tsx`: custom badge tones, friendly enum translations, styled panels/metric cards/empty states plus honest numeric formatters. Preserve honest values/raw states; remove visual tone system.
- Every module under `src/components/ui/` was inventoried: generic shadcn primitives, menus, dialogs, drawers, charts, forms, sidebar, carousel, loading/empty components, registry, toaster. These predate the product design and are also used by platform instrumentation. Retain as inactive infrastructure, not active product UI.
- `src/instrumentation.tsx`: platform runtime reporting/error dialog uses generic UI primitives. Not Sentinel product design. Preserve diagnostics.
- `vly-toolbar-readonly.tsx`: explicitly read-only platform editing/preview toolbar, motion/icons/snapshot dependencies. Preserve unchanged.
- `src/index.css`: Tailwind v4 imports, animation import, utility-token mapping, Poppins/Roboto Mono typography, colored light palette, blue dark palette, chart/sidebar tokens, base styles. Preserve required framework token names; replace old palette and typography with neutral foundation and native-control accessibility.
- `index.html`, `public/manifest.webmanifest`, `public/logo.svg`, `src/assets/logo.svg`: old favicon/logo/font links, dark bootstrap, platform-branded PWA metadata. Remove old logo assets/references/fonts/bootstrap; keep product name as plain identity, not a visual brand.
- UI tests: five `TEST-THEME-*` checks mixed into `src/tests/engine-verification.ts`. Replace only obsolete theme assertions with reset invariants; preserve all risk/execution/data/validation/audit/security/fuzz assertions. No visual snapshots, Figma files, UI mock fixtures or frontend browser suite were found. Synthetic data in seed/business tests is required backend simulation data, not disposable UI mockups.
- Configuration: `components.json`, `postcss.config.cjs`, TypeScript configs, `convex.json`, `vite.config.ts`, eslint config, package manifest and both lockfiles retained. Vite explicitly references motion/charts/forms/Radix chunks; platform toolbar uses motion/icons; package pruning is not safe without modifying unrelated framework configuration. No dependency removal planned.

## Baseline verification

Before edits: `bun run typecheck` passed; `bun run lint` passed with 21 existing warnings; `bun run test` passed (102 engine, 71 database, 16 Databricks assertions).

## Preservation scope

All `src/convex/**` source and generated files, `src/hooks/use-auth.ts`, integration clients, backend tests/fixtures, security documents, schemas, auth providers and data remain unchanged. Frontend mutations remain explicit controls; seed initialization stays admin-gated and becomes explicit rather than running on page mount. No mutation is executed during verification against the live deployment.

## Tool/access limits

Git commands are blocked by this host; version control is managed by the platform. No resets/checkouts/commits are attempted. An exact-file baseline archive was created at `/tmp/sentinel-prime-ui-reset-baseline.tar.gz` before editing (155 archive entries), but the host did not retain it across subsequent terminal calls. Its later absence was confirmed; local baseline recovery and byte-identical comparisons therefore cannot be claimed. Platform-managed version history is outside the available tools. No Figma inspection/edit/delete tool or authenticated Figma file access is available; no external design is claimed deleted. No browser tool/agent is available (only researcher-web); no installed browser or Playwright/Puppeteer package was found. Managed preview processes will not be started/stopped from the terminal. Secrets and env files are outside scope and will not be read or modified.

## Deletion scope

Delete only `src/components/LogoDropdown.tsx`, `src/components/ThemeToggle.tsx`, `src/components/console/ViewModeToggle.tsx`, `src/components/console/ConstitutionPanel.tsx`, `src/lib/theme.ts`, `src/lib/viewMode.ts`, `src/assets/logo.svg`, and `public/logo.svg`, after removing their consumers. Rewrite all active pages, guard, console readouts/actions, global theme values and HTML/PWA metadata. Preserve generic UI kit and platform infrastructure, without mounting it in the neutral product.
