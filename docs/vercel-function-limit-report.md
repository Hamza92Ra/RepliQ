# Vercel Hobby function-limit fix

Prepared locally in `/tmp/repliq-function-limit`, branch `fix/vercel-hobby-functions`, based on committed Phase 1A `a90a804`. The original workspace remains on `security/phase-1b`, with its uncommitted files unchanged. This fix is uncommitted in the isolated worktree. No deployment, push, merge, production setting/credential change, remote SQL or production data access occurred.

## Function count and cause

**Before: 13 Node Serverless Function entry points. After: 7. Hobby budget: 12; remaining headroom: 5.**

The project is static HTML/JS with standalone Node functions, without local SSR or middleware functions. Vercel builds each supported source file under `api/` as a function. The extra Phase 1A `/api/admin/legacy` handler brought the local total to 13; the Phase 1B preparation adds no API entry points.

| Existing public URL | Before entry point | After entry point |
| --- | --- | --- |
| `/api/admin/login` | `api/admin/login.js` | shared `api/admin.js` |
| `/api/admin/conversations` | `api/admin/conversations.js` | shared `api/admin.js` |
| `/api/admin/messages` | `api/admin/messages.js` | shared `api/admin.js` |
| `/api/admin/read` | `api/admin/read.js` | shared `api/admin.js` |
| `/api/admin/takeover` | `api/admin/takeover.js` | shared `api/admin.js` |
| `/api/admin/send` | `api/admin/send.js` | shared `api/admin.js` |
| `/api/admin/legacy` | `api/admin/legacy.js` | shared `api/admin.js` |
| `/api/business-config` | `api/business-config.js` | unchanged |
| `/api/conversation` | `api/conversation.js` | unchanged |
| `/api/dashboard` | `api/dashboard.js` | unchanged |
| `/api/lead` | `api/lead.js` | unchanged |
| `/api/orders` | `api/orders.js` | unchanged |
| `/api/webhook` | `api/webhook.js` | unchanged |

These are exact local source-entry counts, not a claim that a hosted build/deployment was executed. Remote framework/settings overrides were not queried. `npm run check:functions` lists the seven entry points and fails if the Node API count exceeds 12.

## Chosen design and runtime compatibility

Move the seven admin implementations outside `api/`, into `lib/admin-handlers/`, and route seven exact URL rewrites to one ordinary Node `(req, res)` function at `api/admin.js`. Merely importing the old files while leaving them under `api/` would not reduce the count; the old deployable files are actually moved.

The router dispatches from the original request pathname using a fixed Map. It does not route from a query selector, body, cookie or forwarded header. It passes the original request/response objects to the existing handler and does not parse JSON or replace authentication/method checks. Unknown paths and direct `/api/admin` access return 404. No wildcard rewrite intercepts the other API functions or frontend.

The handlers are byte-equivalent to their Phase 1A bodies after adjusting `../../lib/` imports to `../`; this equivalence was checked for all seven files, including dynamic imports. They retain existing login/session cookies, bearer/query authentication, legacy dashboard-key behavior, GET/POST handling, validation errors, provider sends, storage and takeover synchronization. Existing UI callers need no URL or JavaScript change.

A minimal two-handler consolidation could bring the total to exactly 12, but would leave no room for another endpoint. Consolidating all API routes would leave one function but would also require the shared wrapper to manage webhook raw-body behavior. The selected admin-only consolidation leaves seven functions and keeps both signed inbound paths standalone and byte-for-byte unchanged.

Compatibility was checked **before implementation** using current official documentation, upstream runtime source, and a local probe against the public `@vercel/node` **30.0.0** runtime. The actual runtime probe verified a default Node handler, original supplied URL, method, repeated query arrays and JSON helpers. After implementation, `@vercel/routing-utils` **6.6.1** validated the exact rewrites, and the actual Node runtime served all consolidated handlers over loopback HTTP using its real request/response helpers. No Express dependency, Fetch/Node adapter, global helper opt-out or custom body parser was added.

Sources: [Vercel Node runtime and shared entry points](https://vercel.com/docs/functions/runtimes/node-js), [rewrites](https://vercel.com/docs/routing/rewrites), [vercel.json rewrite configuration](https://vercel.com/docs/project-configuration/vercel-json), [upstream Node helper/body restoration](https://raw.githubusercontent.com/vercel/vercel/main/packages/node/src/serverless-functions/helpers.ts), [upstream Node handler](https://raw.githubusercontent.com/vercel/vercel/main/packages/node/src/serverless-functions/serverless-handler.mts). The published packages used for the local checks were installed only under `/tmp/repliq-vercel-tools`, not added to the project's dependencies or lockfile. No Vercel CLI login, account API, project linking, `vercel pull`, build or deploy was used.

## Changes

- Moved `api/admin/{conversations,legacy,login,messages,read,send,takeover}.js` to the corresponding paths under `lib/admin-handlers/`; adjusted relative imports only.
- Added `api/admin.js`, the fixed-path Node dispatcher.
- Added `vercel.json` with seven exact rewrites to `/api/admin`.
- Updated `tests/admin-inbox.test.js` and `tests/security-phase-1a.test.js` imports through `tests/admin-router-request.js`, so their existing assertions exercise the new router.
- Added `tests/admin-router.test.js` (24 regression cases), `tests/admin-service-fixtures.js` and `tests/vercel-runtime-mocks.js` (synthetic service fixtures).
- Added `scripts/check-function-count.mjs` and `scripts/verify-vercel-runtime.mjs`; added `check:functions` and `test:vercel-runtime` package scripts. Existing test runner/dependencies remain unchanged.
- Added this report.

No changes to the six other API functions, webhook signature helper, WhatsApp/auth implementation, frontend, package lock, production settings or credentials. All 13 Phase 1B preparation files were copied unchanged into this worktree so their tests could run; SHA256 checks confirmed both copies and originals match the initial snapshots. They are not part of this fix and should not be accidentally staged with it.

## Tests and checks

- **`npm test`: 129 passed, 0 failed, 10 files.** This includes all 105 existing Phase 1A/1B tests plus 24 new router tests. Existing assertions were preserved; moved handler imports now enter through the router.
- New regressions cover successful login/session, conversation/message reads, cookie/bearer/query-token compatibility, unread reset, takeover/Redis sync, manual send/storage, legacy key/actions; unauthorized access for every protected consolidated endpoint; method rejection for all seven; query/header/body route-spoofing resistance; request/query identity and no pre-parsing; unknown paths; exact rewrites and count budget.
- **Actual `@vercel/node` runtime: 38 HTTP response checks passed**, plus body/cookie/message assertions. All seven admin endpoints ran using real Vercel helpers and mocked Supabase/Redis/Meta. Both unchanged inbound functions ran GET verification and exact-byte Unicode/whitespace signed bodies, missing/tampered signatures, malformed signed JSON, and legacy dashboard-action routing/security.
- `@vercel/routing-utils` accepted the config and matched each of the seven original paths to exactly one destination. This validates configuration compilation; it does not replace a hosted edge-routing check.
- JavaScript syntax checks and `git diff --check` pass. The seven moved handler bodies were compared against Phase 1A after import-path normalization. Standalone APIs, raw-body helper, auth/WhatsApp implementation, UI and lockfile were checked unchanged.
- External services are mocked or blocked in all tests. The runtime worker receives only explicitly specified synthetic environment values, not inherited production credentials. Loopback HTTP requires an execution permission outside this environment's socket sandbox; it does not access a hosted service.

An initial integration-harness request used HTTP chunked transfer encoding. The Node 26 Vercel dev proxy/undici combination rejected the forwarded `transfer-encoding` header before reaching the app. The harness now sends Content-Length and splits writes while preserving the exact UTF-8 bytes. This was a harness-framing correction; application and webhook code were not changed. No test failures remain.

To rerun from this isolated worktree:

```sh
npm test
npm run check:functions
npm run test:vercel-runtime -- /tmp/repliq-vercel-tools
```

The optional runtime command expects an external tooling directory containing `@vercel/node@30.0.0` and `@vercel/routing-utils@6.6.1`; it does not install tools automatically or change project dependencies. The 129 normal tests and count check require no external tooling installation.

## Remaining deployment risks and later verification

1. No hosted preview/build was performed. Before a later authorized preview, verify the actual deployment emits exactly seven functions and the edge rewrites preserve the original request paths/queries for all seven public URLs. Local tests exercise the published Node runtime and rewrite compiler, not Vercel's hosted edge layer or account-specific configuration.
2. The failed deployment's exact builder/runtime version and project/framework overrides were not inspected remotely. This fix uses the standard standalone Node interface; an unexpected remote framework/root/routing override could change discovery/routing and must be reviewed during an authorized preview.
3. The shared admin bundle initializes the combined handlers/dependencies, which can affect cold-start time or shared-function concurrency. No business logic, credentials or per-request authorization is changed; hosted performance is not measured here.
4. Phase 1A prerequisites still apply: `META_APP_SECRET` must already be configured correctly before signed webhook traffic is enabled. No variable was set/rotated here. Its external legacy-action URL migration remains `/api/admin/legacy`, now served through the shared function.
5. Phase 1B remains inactive preparation; none of its authentication, database or Redis designs are activated by this fix. The existing single-business/multi-tenant limitations remain as documented.
6. This worktree is under `/tmp`; retain/review the change before normal temporary-directory cleanup. The original Phase 1B workspace remains intact. Do not copy or commit its operational/experimental files as an accidental part of this routing fix.

No rollout or rollback was executed. For later code rollback, restore the original seven admin entry-point files, remove the shared router/rewrites and restore test imports through a reviewed change; doing so also returns to **13 functions** and the original Hobby failure. Prefer retaining the consolidated layout while correcting routing if a later preview uncovers an account-specific issue. No database/Redis rollback is needed because none was changed.
