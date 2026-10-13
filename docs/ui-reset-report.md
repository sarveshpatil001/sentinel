# Sentinel Prime — UI reset results

Replacement UI design has not started. The active product now uses neutral native links, forms, status text, and expandable backend records.

## A. Files and components removed

- `src/components/LogoDropdown.tsx` — obsolete branded dropdown.
- `src/components/ThemeToggle.tsx` — obsolete visual theme control.
- `src/components/console/ViewModeToggle.tsx` — `ViewModeToggle` and `useViewMode`.
- `src/components/console/ConstitutionPanel.tsx` — orphan static governance/specification presentation (architecture documentation retained).
- `src/lib/theme.ts` — product theme resolution/storage constants.
- `src/lib/viewMode.ts` — Simple/Advanced mode resolution/storage constants.
- `src/assets/logo.svg` — old application logo.
- `public/logo.svg` — old favicon/PWA logo.

Deleted old implementations inside retained files: marketing compositions, dashboard shell/header/footer/tabs, visual mode branches, cards, badge colors/friendly enum mappings, metric tiles, Recharts presentation, icon/motion decorations, branded auth card, animated 404, styled auth guard/loading/error surfaces. No old product design remains mounted in those audited files.

## B. Files modified or added

Modified:
- `src/pages/Landing.tsx` — neutral entry notice with auth/workspace links.
- `src/pages/Dashboard.tsx` — neutral six-screen navigation and existing functionality; automatic seed mutation replaced with an explicit admin-gated Settings control.
- `src/pages/Auth.tsx` — native email OTP/guest forms; original auth providers and returnTo preserved; rejects backslash/external and auth-loop return targets.
- `src/pages/NotFound.tsx` — native 404 with home/workspace recovery links.
- `src/components/RequireAuth.tsx` — same guard interface and preserved full return path, neutral loading/blocked states; all workspace routes use its immediate redirect option.
- `src/main.tsx` — providers, toolbar, error boundaries, route-sync preserved; native loading/error output; unmounted product toaster; protected `/dashboard`, `/trading`, `/charts`, `/analysis`, `/history`, `/settings` routes.
- `src/components/console/OverviewPanel.tsx` — read-only overview and honest system state.
- `src/components/console/ExecutionPanel.tsx` — native approved-authorization submission, duplicate-submission test, reconciliation, kill switch, simulated-provider controls, complete execution records. No live execution path added.
- `src/components/console/StrategiesPanel.tsx` — native candidate-version controls and full strategy/provenance/evidence/fitness/learning records.
- `src/components/console/RiskPanel.tsx` — native proposals and configured policies/decisions; reference price no longer hardcoded; server veto remains authority.
- `src/components/console/DataPanel.tsx` — chart design removed; original market series/provenance/quality/snapshots remain accessible as records.
- `src/components/console/ValidationPanel.tsx` — existing validation mutations and complete run/evidence/fitness records.
- `src/components/console/AgentsPanel.tsx` — complete registry/scopes and learning records, no invented AI availability.
- `src/components/console/AuditPanel.tsx` — all event data and scope-honest chain verification retained, no styled badges.
- `src/components/console/ConnectionsPanel.tsx` — native registration, permissions, verify/revoke and redacted metadata; secret inputs cleared after attempts.
- `src/components/console/DatabricksPanel.tsx` — existing read-only check and visible results/errors.
- `src/components/console/shared.tsx` — obsolete visual helpers replaced with native Panel, RecordDetails, ActionStatus; raw enum/null values preserved.
- `src/index.css` — original colors/fonts removed; required Tailwind v4 imports/token names retained with neutral compatibility values and native readability/focus rules.
- `index.html` — old fonts/favicon/dark bootstrap removed, app entry retained.
- `public/manifest.webmanifest` — old icons/palette/platform brand metadata removed.
- `src/tests/engine-verification.ts` — removed ONLY five obsolete theme-only checks and their module import; all 97 business/security/fuzz checks unchanged.
- `package.json` — appends the UI-reset test to existing test script; final dependency/devDependency sets unchanged.
- `bun.lock` — package-manager-managed refresh during attempted test typings installation/removal; frozen install verified; neither `@types/bun` nor `bun-types` remains. No manual lock edits. `package-lock.json` untouched.
- `README.md` — reset status/routes and precedence over historical starter styling guidance.
- `docs/ui-reset-audit.md` — audit and scope/tool limitations recorded before application changes, updated for the baseline archive limitation.

Added:
- `src/hooks/use-console-action.ts` — per-surface concurrency guard, busy/result/error state, no design or financial authority.
- `src/tests/ui-reset.test.mjs` — reset invariant and React-render tests using isolated fixtures; no live deployment mutations.
- `docs/ui-reset-report.md` — this report.

## C. Old design inventory

See `docs/ui-reset-audit.md` for pre-edit inventory. Reviewed four original router entries, ten active dashboard tabs, every console panel and shared helper, logo/theme/view-mode modules, every generic UI-kit module's imports/exports and styling footprint, platform instrumentation/toolbar, native loading/empty/error states, CSS/HTML/PWA assets, configuration/dependency references, all existing test categories and repository documentation. There were not six separate original screens; the requested six names now have protected neutral entry routes.

No Figma source files, connected design file IDs, visual snapshots, or product-only UI mock fixtures were found. Backend synthetic seed data and business-test fixtures were retained.

## D. Preserved functionality

No `src/convex/**` source or generated file was edited. Auth providers, user hook, schemas, stored data, RBAC/ownership checks, deterministic quant/backtest/validation/evidence/fitness, AI registry/pipeline behavior, risk policy/status/limits/veto, scoped authorization, idempotency/atomic consumption, UNKNOWN-order reconciliation, positions/account accounting, credential fingerprinting/redaction, audit logs, and Databricks integration remain in place. No production data was changed or live trading enabled.

Repository scan confirmed all 22 original frontend query/mutation/action entry points remain present. Seed now requires explicit action instead of executing when a page renders. Existing business tests verify server-side protections. Generic platform integrations and diagnostics remain unchanged.

## E. Verification results

Baseline: typecheck passed; tests passed (102 engine including 5 obsolete theme checks, 71 database, 16 Databricks); lint passed with 21 warnings.

Final:
- `bun install --frozen-lockfile`: PASS, 391 installs/465 packages checked, no changes.
- `bun run typecheck`: PASS.
- `bun run test`: PASS, 97 engine + 71 database + 16 Databricks assertions and the then-current 9 UI-reset tests.
- After adding populated-record/error-state coverage, `bun test ./src/tests/ui-reset.test.mjs`: PASS, final **11 tests / 123 expectations**, 0 failures. Only the test file changed; previously passing application typecheck/build and business tests were not rerun unnecessarily.
- `bun run lint`: PASS, 0 errors; 17 pre-existing generic UI/generated/platform Fast Refresh and unused-directive warnings remain (down from 21). No rules suppressed.
- `bun run build`: PASS, Vite transformed 2344 modules and completed in 7.88 seconds; existing config reports an empty `convex-vendor` chunk. No performance speedup claimed.
- Final artifact inspection: `dist/logo.svg` absent; old font links absent; Landing/Auth/Dashboard/NotFound product chunks contain none of the tested old logo/theme/branding markers. All final edited application files re-read.
- Native React rendering: all six screens plus entry/auth/404, protected content/return path, loading/empty/populated records, raw UNKNOWN/null, literal denied results and visible errors verified. Rendering invoked zero backend mutations. These fixtures test presentation, not deployed auth/network behavior.
- Managed preview HTTP: `/`, `/auth`, all six workspace paths and an unknown path return HTTP 200 with the Vite entry. Unknown path 200 is expected SPA fallback; React provides the 404. HTTP availability alone is NOT visual/runtime proof.
- Browser visual/interactivity, real OTP delivery/guest redirect, and live Databricks credentials: NOT VERIFIED. No browser tool/runtime package was available, and no external credentials/production mutations were used. No server was launched/restarted/killed.
- Intermediate failures were repaired: obsolete deleted-theme import; attempted Bun typings polluted global fetch types, so the dependency was removed and the isolated runtime test uses `.mjs`; Bun required a `.test` filename. No backend tests were weakened. Final listed checks passed.
- Git status/diff inaccessible: host blocks Git, platform manages history. A baseline `/tmp` archive was created before edits but did not persist across terminal calls; it cannot be used to claim byte-identical preservation or guaranteed recovery.

## F. Remaining relevant references

- `src/tests/ui-reset.test.mjs`: old file names, colors/fonts and mode strings occur only as **negative assertions** preventing reintroduction.
- `docs/ui-reset-audit.md`, `docs/ui-reset-report.md`: historical audit/deletion record.
- `README.md`: generic starter styling/toast/dialog instructions remain documentation, explicitly superseded during reset. Not active UI.
- `src/components/ui/**`, `src/hooks/use-mobile.ts`, `src/lib/utils.ts`, `components.json`: generic pre-product framework primitives/configuration, not mounted in neutral product surfaces. Dialog/drawer/sidebar/chart styles remain inactive reusable infrastructure, not old product layouts.
- `src/instrumentation.tsx`: platform runtime reporting/error-dialog infrastructure, retained to avoid breaking diagnostics; not Sentinel product UI.
- `vly-toolbar-readonly.tsx`: active read-only platform preview/editor controls; not Sentinel product design and explicitly outside deletion scope.
- `src/index.css`: required compatibility token names/dark variant retained but old values removed; no product theme switch/bootstrap. Browser-stored old preferences are inert and no longer read.
- `vite.config.ts`, `package.json`, `bun.lock`, `package-lock.json`: generic UI/dependency references retained because Vite chunks and platform tooling reference them. No unsafe dependency/config pruning.
- `src/convex/**`, existing business tests and `docs/execution-architecture-decisions.md`: Sentinel Prime identity, PAPER/DEMO/simulation data, engineering terms and historical console references are required domain/security material, not visual branding. Plain product name remains in title/entry/manifest only as identity.

Searches and inspection found no active product references to deleted logo/theme/mode components, old palette/fonts, old layouts, icons, gradients, shadows or decorative classes. Generic infrastructure above is deliberately retained, not represented as deleted.

## G. Figma status

No Figma inspection/edit/delete capability or authenticated workspace access was available. **Nothing was deleted in Figma.** No file/page/library/variable state could be verified. Unrelated work was untouched.

## H. Final status

**PARTIAL — some routes/assets could not be verified.**

The audited repository's active product UI has been reset and automated checks pass. Figma assets and actual browser visual/interactive behavior could not be inspected, so end-to-end 100% completion is not claimed. No replacement design has been created.
