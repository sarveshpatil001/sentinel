# Sentinel Prime — UI reset results

Replacement UI design has not started. The active product now uses neutral native links, forms, status text, and expandable backend records.

**Latest independent post-reset audit (2026-10-13): BLOCKED for full functional/production readiness.** See section I below. The five supported commands pass, but an additional real-handler approved-proposal-to-order probe fails because the backend produces a policy reference its execution validator rejects. Browser, deployed auth, and Figma remain unverified. Sections A–H preserve the earlier reset report and are not current end-to-end proof.

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

## I. Independent post-reset verification — 2026-10-13

### Acceptance criteria and verdict

Independently inspect current code rather than inherit the earlier claims; classify leftovers; preserve business logic, safeguards, integrations, and reusable infrastructure; keep six protected neutral screens usable; run the exact five requested Bun commands; report failures and access limits. No new design, Figma deletion, deployment, server restart, real credentials, or live database writes.

**Final classification: BLOCKED for a genuinely functional, production-ready baseline.** Repository UI cleanup is complete within the inspected active surfaces, but a confirmed pre-existing backend contract defect prevents the approved proposal-to-order path. Remaining browser/auth/integration/Figma evidence is unavailable. This is not a claim that the entire application is broken or that its fail-closed protections failed.

### Exact additional changes

Modified in this independent audit:
1. `src/pages/Dashboard.tsx`: screen selection now uses React Router's existing `matchPath`, matching the router's trailing-slash and case-insensitive behavior. Previously `/charts/`, `/CHARTS`, `/trading/`, and `/Settings/` mounted the workspace but incorrectly displayed Dashboard.
2. `src/tests/ui-reset.test.mjs`: added router-backed regression coverage for those accepted URL variants. Existing assertions retained.
3. `src/tests/db-verification.ts`: added real `connections`/`databricks` modules to the existing convex-test harness and 32 assertions for signed-out query/action denial, declared public catalog, broker registration/list/verify/revoke ownership and raw-secret redaction, rejected live credential ingestion, honest unimplemented/simulated adapters, owner-bound candidate creation/parent immutability, stored candle fidelity, empty AI registry, and current-user semantics. Existing 71 assertions retained.
4. `docs/ui-reset-report.md`: this independent result and superseding verdict.

No files removed. No package, dependency, lockfile, CSS, Vite config, auth provider, schema, backend source, or generated source edited. `bun run build` regenerated `dist/**` as expected. All test writes used isolated in-memory convex-test databases; only explicit dummy test credentials were used.

### Functional findings

- **Fixed reset UI regression:** exact-string screen selection disagreed with the existing router. The new regression test failed before repair (exit 1, 11 pass/1 fail), then passed after using `matchPath` (12 pass/0 fail).
- All 22 current frontend query/mutation/action references resolve through supported typechecking and bundling. They remain present; presence does NOT establish that all paths work end to end.
- All six routes and navigation links remain present and protected through `RequireAuth`; signed-out content is withheld and pathname/query return paths are preserved. `/auth` still uses `email-otp` and `anonymous`, validates its local return target, and defaults to `/dashboard`. Deployed OTP delivery, guest login, session persistence, sign-out, redirect effects, and real authorization tokens are **unverified**.
- Loading, empty, populated, literal denied-result, UNKNOWN/null record, and visible action-error presentation pass server-rendered React tests. Source trace confirms native forms invoke the existing mutations/actions with supplied values; mutation concurrency is guarded by `useConsoleAction`. DOM events, native constraint validation, busy-state re-renders, and button interaction have **not** been browser-tested. Query errors reach the root error boundary by source inspection, not a live runtime exercise.
- Existing risk and execution denial tests pass: provisional/missing policy denial, role and owner checks, atomic consumption, duplicate protection, expired/mismatched scopes, kill-switch restrictions, unresolved UNKNOWN blocking/reconciliation, bounded-scan fail-closed behavior, snapshot binding, and no live execution path. Backend bytes were identical at start and end of this audit: aggregate SHA-256 `b0138f4c2a0f769d9565afeb5db2f93634e7cdaf01c070c99433716299f4b008` over sorted `src/convex/**` file paths and contents. This proves preservation during THIS audit only, not a comparison to the inaccessible pre-reset baseline.
- API market series matched stored test candle timestamps and prices. UI readouts render queried records directly. Existing backend deterministic PAPER/DEMO simulation, declared spreads/costs, and synthetic seed data were not replaced or portrayed as live feeds.
- Broker handler lifecycle is verified in-memory, including ownership and redaction. SIMULATED verification is explicitly not real connectivity; NOT_CONFIGURED adapters stay pending. Databricks's signed-out action denies access and its helper passes 16 mocked-network assertions. No real broker or Databricks connection is claimed working.

#### Confirmed pre-existing blocker: risk-policy reference contract mismatch

`src/convex/lib/risk.ts` returns a display reference such as `RISK-POLICY-CORE@v1 (APPROVED)`. `src/convex/workflows.ts` writes that exact value into `executionAuthorizations.scope.riskPolicyRef`. `src/convex/lib/execution.ts` validates the field using `TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.:@/-]*$/`, which rejects its spaces/parentheses. Thus a valid approved proposal's authorization cannot pass the order input validation.

Two extra probes both exited **1**:
- Pure engine probe: a valid PAPER proposal under an isolated APPROVED fixture produced `outcome: APPROVE`; passing its literal `policyRef` to `validateAuthorizationScope` produced `ok: false`, `input_validity: BLOCK`, with `auth.scope.riskPolicyRef must be a non-empty identifier token`.
- Real-handler probe through convex-test: isolated fresh PAPER workspace, released kill switch, fresh VALID candle/quality data, shared strategy, COMPLETED validation, MODERATE evidence, MIXED fitness, and a test-only APPROVED policy with the existing declared limits. `submitTradeProposal` returned APPROVE and an authorization; `placeOrder` returned REJECTED and `Precheck/authorization failed (input_validity:BLOCK). FAIL CLOSED — nothing submitted.` The command asserted ACKNOWLEDGED, hence exit 1. This approved policy existed only in a throwaway in-memory test database, never in the deployment.

The prior database suite uses directly inserted, token-formatted authorization fixtures, so its passing order tests do not cover this producer/consumer mismatch. The added passing tests deliberately retain that existing fixture strategy for denial/lifecycle coverage; they do NOT establish a working approved-proposal happy path. No checks were skipped, assertions weakened, or failure concealed.

This defect is already present in the unedited backend and is not a neutral-UI regression. No backend contract or risk validator was changed in this preservation-only audit. A focused business-logic repair must separate canonical policy identity from display status (or define an equally strict compatible schema), then test the actual approved proposal-to-order chain without bypassing validation. Until that is repaired, “every action works” and full production readiness cannot be claimed.

### Current supported checks — actual outcomes

| Exact command | Exit | Outcome |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | Checked 391 installs/465 packages, no changes |
| `bun run typecheck` | 0 | `tsc -b --noEmit` passed |
| `bun run test` | 0 | 97 engine + 103 database + 16 Databricks assertions; 12 UI tests/131 expectations; zero suite failures |
| `bun run lint` | 0 | 0 errors, 17 warnings |
| `bun run build` | 0 | 2344 modules, Vite completed in 7.93s; existing empty `convex-vendor` chunk warning |
| Additional approved-scope probe | 1 | Confirmed policy-reference incompatibility |
| Additional real-handler approved-flow probe | 1 | APPROVE → REJECTED, fail-closed; full happy path failed |
| Current localhost preview HTTP probe | 1 | Connection refused on `http://localhost:5173/`; route loop could not run |

Commands captured the tested process exit code explicitly; no output pipeline masked failures. The 17 lint warnings are in unchanged generic primitives, generated Convex files, main entry, and the read-only toolbar, matching the previous report; no newly introduced warnings were observed. The empty chunk warning is likewise from unchanged Vite configuration. Supported checks passed after all application/test repairs; later changes were documentation only. The passing production build is not proof of deployability or runtime authentication.

Generated artifact inspection passed before the HTTP probe: `dist/logo.svg` absent, no old fonts/theme/logo bootstrap in built HTML, all linked entry assets exist, and Landing/Auth/Dashboard/NotFound chunks contain none of the tested old component/logo/mode/font markers. Final active-source scan passed. Styles in platform/vendor chunks and generic CSS utilities are retained infrastructure, not removed product-design claims. No performance improvement claimed.

### Remaining references — classified

- **Active obsolete product UI:** none found in the current entry, route pages, guard, console panels/shared helpers, HTML, or manifest. No product gradient/shadow/motion/icon classes or old theme/view-mode imports remain there.
- **Active identity/domain, retained:** plain “Sentinel Prime” in `src/pages/Landing.tsx`, `index.html`, and `public/manifest.webmanifest`. This is product identity, not the deleted visual brand.
- **Backend/domain, retained:** `src/convex/**` and engine/database tests contain domain headers, enum/simulation terminology, declared policy/cost versions, and legacy ARISE notes in `src/convex/lib/credentials.ts` for METAAPI/METATRADER_5. Those notes are visible through the catalog as honest adapter provenance, not logo/layout branding.
- **Required reusable infrastructure, retained:** `src/components/ui/**` animations, shadows, chart/sidebar layouts and `next-themes` use in `sonner.tsx`; none is imported by current product routes/panels. Global Tailwind v4/animation import and neutral chart/sidebar/dark compatibility tokens in `src/index.css` support that kit. No mounted product theme provider or old preference reader was found.
- **Active platform infrastructure, retained:** `src/instrumentation.tsx` diagnostics (generic dialogs/buttons); `vly-toolbar-readonly.tsx` icons/motion/colors/highlight/editor overlay. Toolbar explicitly read-only. No platform function deleted to make the repository appear empty.
- **Infrastructure config/dependencies, retained:** `package.json`, `bun.lock`, `package-lock.json`, `vite.config.ts`, `components.json`. Motion is used by the toolbar, charts/themes/forms by reusable primitives, and Vite explicitly declares vendor chunks. No unsafe dependency pruning. Existing Vite HMR configuration was inspected but not changed; an unrelated platform-setting normalization would require separate scope.
- **Harmless documentation/test history, retained:** `README.md`, `docs/ui-reset-audit.md`, prior sections of this report, `docs/execution-architecture-decisions.md`, and negative assertions in `src/tests/ui-reset.test.mjs`. Documentation examples of old styling do not mount UI.

### Exact files inspected in this independent audit

Content reviewed (whole files or relevant windows for long files):

```text
docs/ui-reset-audit.md
docs/ui-reset-report.md
README.md
src/main.tsx
src/index.css
src/pages/Auth.tsx
src/pages/Dashboard.tsx
src/pages/Landing.tsx
src/pages/NotFound.tsx
src/components/RequireAuth.tsx
src/components/console/AgentsPanel.tsx
src/components/console/AuditPanel.tsx
src/components/console/ConnectionsPanel.tsx
src/components/console/DataPanel.tsx
src/components/console/DatabricksPanel.tsx
src/components/console/ExecutionPanel.tsx
src/components/console/OverviewPanel.tsx
src/components/console/RiskPanel.tsx
src/components/console/StrategiesPanel.tsx
src/components/console/ValidationPanel.tsx
src/components/console/shared.tsx
src/hooks/use-auth.ts
src/hooks/use-console-action.ts
src/hooks/use-mobile.ts
src/lib/utils.ts
src/lib/vly-integrations.ts
src/instrumentation.tsx
vly-toolbar-readonly.tsx
src/components/ui/index.ts
src/components/ui/chart.tsx
src/components/ui/sonner.tsx
src/tests/ui-reset.test.mjs
src/tests/db-verification.ts
src/tests/engine-verification.ts
src/tests/databricks-verification.ts
src/convex/auth.ts
src/convex/auth.config.ts
src/convex/auth/emailOtp.ts
src/convex/users.ts
src/convex/http.ts
src/convex/connections.ts
src/convex/console.ts
src/convex/databricks.ts
src/convex/workflows.ts
src/convex/schema.ts
src/convex/seed.ts (initialization guard window)
src/convex/lib/authz.ts
src/convex/lib/credentials.ts
src/convex/lib/databricks.ts
src/convex/lib/execution.ts
src/convex/lib/risk.ts
index.html
public/manifest.webmanifest
package.json
vite.config.ts
eslint.config.js
components.json
postcss.config.cjs
convex.json
tsconfig.json
tsconfig.app.json
tsconfig.node.json
main.ts
```

Additional generic UI files inspected by source search and import/dependency scan (not claimed fully behavior-tested):

```text
src/components/ui/accordion.tsx
src/components/ui/alert-dialog.tsx
src/components/ui/alert.tsx
src/components/ui/aspect-ratio.tsx
src/components/ui/avatar.tsx
src/components/ui/badge.tsx
src/components/ui/breadcrumb.tsx
src/components/ui/button-group.tsx
src/components/ui/button.tsx
src/components/ui/calendar.tsx
src/components/ui/card.tsx
src/components/ui/carousel.tsx
src/components/ui/checkbox.tsx
src/components/ui/collapsible.tsx
src/components/ui/command.tsx
src/components/ui/context-menu.tsx
src/components/ui/dialog.tsx
src/components/ui/drawer.tsx
src/components/ui/dropdown-menu.tsx
src/components/ui/empty.tsx
src/components/ui/field.tsx
src/components/ui/form.tsx
src/components/ui/hover-card.tsx
src/components/ui/input-group.tsx
src/components/ui/input-otp.tsx
src/components/ui/input.tsx
src/components/ui/item.tsx
src/components/ui/kbd.tsx
src/components/ui/label.tsx
src/components/ui/menubar.tsx
src/components/ui/navigation-menu.tsx
src/components/ui/pagination.tsx
src/components/ui/popover.tsx
src/components/ui/progress.tsx
src/components/ui/radio-group.tsx
src/components/ui/resizable.tsx
src/components/ui/scroll-area.tsx
src/components/ui/select.tsx
src/components/ui/separator.tsx
src/components/ui/sheet.tsx
src/components/ui/sidebar.tsx
src/components/ui/skeleton.tsx
src/components/ui/slider.tsx
src/components/ui/spinner.tsx
src/components/ui/switch.tsx
src/components/ui/table.tsx
src/components/ui/tabs.tsx
src/components/ui/textarea.tsx
src/components/ui/toggle-group.tsx
src/components/ui/toggle.tsx
src/components/ui/tooltip.tsx
```

Backend-wide source search/hash also covered `src/convex/lib/audit.ts`, `backtest.ts`, `dataQuality.ts`, `evidence.ts`, `fitness.ts`, `pipeline.ts`, `positions.ts`, `quant.ts`, `store.ts` and generated files; these were not exhaustively reread. `docs/execution-architecture-decisions.md` was searched for preserved domain/architecture references. `bun.lock` and `package-lock.json` dependency references were searched; frozen Bun install verifies the supported lockfile, not npm parity. Local file/import inspection was corroborated by TypeScript and the build; the naive regex import scan also matched test strings and generated `.js` type references, which are not broken runtime imports.

Built artifacts inspected: `dist/index.html`, `dist/manifest.webmanifest` presence, `dist/assets/Landing-Bu_MK1M0.js`, `Auth-CEcUnbkO.js`, `Dashboard-CnJKg4V8.js`, `NotFound-C74y5sY8.js`, and existence of entry-linked `index-CGKMQdyt.js`, `react-vendor-B-iSdf49.js`, `framer-motion-DWv3H6rC.js`, `index-D09i9K2p.css`. No old logo asset found.

### Browser, Git, and Figma status

- **Browser: UNVERIFIED.** Available agent is researcher-web, not browser automation. No installed browser executable, Playwright/Puppeteer, jsdom/happy-dom, or React test renderer was found. React SSR tests do not execute effects or user gestures. Current localhost HTTP access failed with connection refused; no server was started/stopped/restarted. The earlier HTTP 200 claims were not reused as current verification. No visual preview inspected; mobile layout, actual runtime, auth/forms/buttons, and production SPA delivery remain unverified.
- **Git: UNAVAILABLE.** Current diff/status request was refused by the host (`Git and GitHub commands are blocked; Vly manages version control`). No bypass attempted. Cannot independently attribute all pre-reset modifications or establish historical byte equality.
- **Figma: UNVERIFIED / UNTOUCHED.** No authenticated Figma inspection/edit capability or workspace provided. No Figma reset or deletion claimed.

Verification/cleanup stopped here. No replacement design introduced.

