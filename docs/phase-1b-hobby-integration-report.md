# Phase 1B and Vercel Hobby integration

Branch: `integration/phase-1b-hobby`.
Worktree: `/tmp/repliq-integration`.
Parent: `001e73c` (`fix: consolidate admin functions for Vercel Hobby`), which includes Phase 1A `a90a804`.

## Integrated changes

Added the 13 uncommitted Phase 1B foundation files from `security/phase-1b` to the committed function-limit fix:

- Four inactive modules under `lib/foundation/`: authorization, scoped Supabase repository examples, scoped Redis plans and owned-credential secret-manager boundary.
- Six review-only files under `supabase/phase-1b-review/`: three versioned migration drafts, read-only verification, guarded pre-cutover rollback and rehearsal documentation.
- `tests/tenant-foundation.test.js` with 18 foundation regressions.
- `docs/phase-1b-foundation-report.md` and `docs/phase-1b-redis-manifest.schema.json`.
- This integration report.

No runtime code, deployment configuration, dependencies, frontend, or existing tests from `001e73c` were changed. Existing admin URLs remain routed through the seven exact rewrites and unchanged `lib/admin-handlers/` implementations. The older Phase 1B audit refers to the original admin handler locations; their implementations now live under `lib/admin-handlers/` as documented by the function-limit report.

No tracked-path collisions or merge conflicts were found. Twelve foundation files were copied byte-for-byte from the original worktree. The report copy had a stray leading `q` removed from its Markdown heading, matching the existing clean copy in the function-fix worktree. Neither original worktree was edited; SHA256 snapshots verified all 13 source files in each worktree remained unchanged.

## Validation

- `npm test`: **129 passed, 0 failed**, across 10 test files (Phase 1A, foundation and router regressions).
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **38 HTTP response checks passed**, plus body/cookie assertions, using actual `@vercel/node` 30.0.0 and `@vercel/routing-utils` 6.6.1, synthetic credentials, mocked services and loopback-only requests.
- `npm run check:functions`: **7 functions**, below the Hobby maximum of 12.
- Syntax checks: **50 JavaScript/MJS files passed**.
- `git diff --check`, unmerged-index and conflict-marker checks passed.
- All tracked files inherited from `001e73c` were compared against that commit and remained byte-identical.
- The foundation import-boundary test confirms production modules do not import the unfinished tenant helpers. SQL remains outside the automatic migration directory, with explicit approval guards. No SQL was executed.

The seven deployed-source entry points remain `api/admin.js`, `api/business-config.js`, `api/conversation.js`, `api/dashboard.js`, `api/lead.js`, `api/orders.js` and `api/webhook.js`. Foundation files add no deployable functions.

## Remaining work and boundaries

The tenant foundation remains inactive. Before any tenant activation: complete the authenticated session/membership adapters, scoped runtime repositories and workers, durable inbox/outbox and retry handling, credential provisioning/rotation, public-lead abuse controls, per-business notifications and the coordinated browser authentication transition. Review ownership inventory/manifests, rehearse SQL/RLS/constraints and rollback in a disposable environment, and obtain explicit migration/cutover approval. Existing reports describe these dependencies in detail.

Local runtime tests do not verify a hosted integration deployment. No deployment or preview access was attempted for this integration. Earlier preview inspection was blocked by Vercel protection; hosted rewrites/auth/webhook verification still needs an authorized accessible preview check before a future release.

No push, merge into main, deployment, production data access, SQL execution, environment/credential change, quota enforcement or tenant activation was performed. This commit preserves the current single-business runtime behavior while recording the foundation in Git. Both original worktrees retain their original uncommitted Phase 1B files.
