# Preview admin fail-closed correction

Branch `fix/preview-admin-fail-closed`, isolated worktree `/tmp/repliq-preview-admin-fail-closed`, based on `release/us-final-cleanup` commit `174df808de97aae16c4e8771052569d0803076d7`.

## Reported Preview issue and cause

The owner reported successful static-page GETs, invalid webhook verification returning 403, and unauthenticated `/api/admin/login` and `/api/admin/conversations` returning 500 with `Missing DASHBOARD_SECRET`. The login handler and `requireAdminAuth()` explicitly generated those responses. `DASHBOARD_SECRET` and `META_APP_SECRET` targeting Production only is owner-supplied context; this task did not query, pull, copy, set or alter deployed environment values.

## Error policy and implementation

- Supported admin requests that cannot authenticate, including missing auth configuration, return **401** without configuration names or values. The shared denial is `{ "error": "Unauthorized" }`. Configured login GET retains its existing `{ "authenticated": false }` session-failure contract and configured wrong-password POST retains its existing message; both remain 401.
- After successful authentication, the five modern data handlers' explicit missing Supabase/sender prerequisites return **503** with `{ "error": "Service unavailable" }`. Backend availability is not disclosed to unauthenticated callers.
- Unexpected modern admin failures return generic **500** without `err.message` or exception details. Legacy admin/orders/action catches retain their established status/envelope but omit raw exception text. Recognized Meta-window errors, successful message contracts and validation behavior remain intact.
- Method rejections remain **405**, unknown router paths remain **404**. Login still checks password configuration before dispatch, so an unconfigured login returns 401 even for an unsupported method. Legacy POST authentication now occurs before envelope validation; unauthenticated malformed legacy POSTs return 401 rather than their former 400. Authenticated envelope validation remains 400.
- Cookie decoding rejects malformed percent encoding instead of throwing a URI error into the runtime. Valid header/cookie/query token precedence remains unchanged.

Files changed:

1. `lib/admin-errors.js` (new): shared generic 401/503/500 responses.
2. `lib/admin-auth.js`: missing/invalid auth uses safe 401, malformed cookies fail closed; no signing, expiry, key-selection or direct-password fallback changes.
3. `lib/admin-handlers/login.js`: replace missing-password-secret disclosure with safe denial.
4. `lib/admin-handlers/conversations.js`, `messages.js`, `read.js`, `takeover.js`, `send.js`: generic authenticated prerequisite failures and generic unexpected failures.
5. `lib/admin-handlers/legacy.js`: verify the existing dashboard key before reading/validating the action envelope.
6. `lib/legacy-admin-action.js`: sanitize its unexpected action error body.
7. `api/orders.js`: sanitize unexpected errors.
8. `api/conversation.js`: in the legacy admin-action section only, replace missing-sender setup instructions with generic 503 and raw template/general exception text with generic details. No webhook/authentication/AI/takeover logic changed.
9. `tests/admin-fail-closed.test.js` (new): missing/configured auth matrix, partial config/fallbacks, service availability, malformed cookies and exception sanitization.
10. `tests/admin-inbox.test.js`: update four prior tests that explicitly expected the old leaked configuration messages/statuses.
11. `scripts/verify-vercel-runtime.mjs`: actual Node HTTP tests for Preview-like workers without secrets and authenticated workers missing service prerequisites.
12. `docs/preview-admin-fail-closed-report.md`: this report.

## Complete route audit

| Routes | Missing-auth behavior after correction | Configured behavior |
| --- | --- | --- |
| `/api/admin/login` GET/POST | 401 generic; no cookie or session creation | Password source remains `DASHBOARD_SECRET || ADMIN_PASSWORD`; successful POST token/cookie and GET session contracts unchanged |
| `/api/admin/conversations`, `/api/admin/messages` GET | 401 before data/service checks | Valid bearer/cookie/query tokens accepted; missing required backend config 503 |
| `/api/admin/read`, `/api/admin/takeover`, `/api/admin/send` POST | 401 before validation/data/send | Existing actions/auth semantics intact; missing explicit backend prerequisites 503 |
| `/api/admin/legacy` POST | 401 for absent/incorrect `DASHBOARD_SECRET` key; bearer-only does not substitute | Same dashboard-key actions and mixed Meta/admin-envelope rejection |
| `/api/dashboard`, `/api/business-config`, `/api/orders`, legacy `/api/conversation` action POST | Already deny missing/incorrect dashboard secret with 401 before effects; retained | Same shared-secret authority; no JWT substitution or new tenant access |
| `/api/webhook`, `/api/conversation` Meta POST | Existing missing-app-secret 503 behavior retained | Raw-body HMAC still required; valid existing signed flows unchanged |
| Both Meta GET verification endpoints | Invalid verification input remains 403 | Existing challenge verification unchanged |

Signing-secret priority remains `ADMIN_JWT_SECRET || DASHBOARD_SECRET || ADMIN_PASSWORD`. `ADMIN_PASSWORD` direct-token compatibility remains. JWT-only configuration still permits correctly signed data requests while password-login remains denied without a password source; it does not gain a new login bypass. No default/development secret was introduced. Existing client-side token storage/query-secret migration work remains a separate review.

`signAdminToken()` can still throw an internal configuration error when used without any signing configuration, but both public login and auth routes guard before it; internal exceptions are no longer exposed in these error responses. Existing generic route logs remain server-side without added credentials, customer text or provider bodies.

## Executed verification

- `npm test`: **258 passed, 0 failed, 0 skipped**, **15/15 files**. Retains all 215 base tests (four expectations deliberately corrected) and adds **43** regression cases. Tests prove missing/old/forged credentials cannot reach mocked services, no cookie is issued, all modern prerequisites fail safely, each supported secret source still works, password/signing precedence and legacy key auth remain intact, malformed cookies fail closed and service exceptions do not echo internal text. Existing US/Moroccan pricing, contacts/privacy, HMAC, voice/media, takeover, manual/template sends, receipts and inactive tenant isolation tests pass.
- `npm run check:functions`: **7 functions before and after**; seven exact admin rewrites and router selection unchanged. No endpoint was added.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **78 real-runtime HTTP response checks passed** using local `@vercel/node` 30.0.0 and routing-utils 6.6.1. Preserves 49 prior checks and adds 29: 16 missing-auth requests, three malformed-cookie requests, six missing-backend checks and four missing-Meta/invalid-verification checks. Both reported unauthenticated GETs now produce exact generic 401 bodies in the actual local Node runtime.
- `node --check`: **64 JavaScript/MJS files passed**; `git diff --check` passed. Runtime workers use explicit synthetic environments and all external services are mocked. No live WhatsApp/email/API action or real customer data was used.
- Preservation checks: **eight original worktree HEADs/statuses and 26 uncommitted files** remain unchanged. Main remote was observed at `9f3eb32bd04a86064c53de88719022eac8643fbf` before push. No merge/conflicts or original-worktree edits occurred.
- No public website/dashboard UI, AI/contact/pricing prompt, credentials resolver, business config, store helpers, Phase 1B files/SQL, Meta HMAC implementation, dependencies or Vercel rewrites changed. No browser test was needed for this backend error-handling change; the existing browser suite was not rerun here.

Initial new-test fixture issues were corrected: the negative login fixture had supplied the valid password, and simulated failures used an intentionally successful existing takeover fallback. Those were test setup mistakes, not reasons to change the configured application behavior. Final tests above all passed.

## Push and hosted verification boundary

The requested local commit and branch push are performed after this report and code review; the final response records the resulting SHA and live remote comparison. Use the existing authenticated Git credential helper; never print/read authentication tokens or copy environment secrets. Pushing may trigger the existing Git-integrated Preview, but no production deployment or promotion is performed.

The owner's original hosted observations are input evidence, not a new hosted test by this task. Local runtime tests demonstrate the correction with missing secrets. A post-push Vercel build result is not a substitute for an authenticated protected-Preview smoke test. Do not bypass Preview protection. On an authorized read-only retest, verify the new Preview is built from the reported commit, then expect the two reported GETs to return 401 without configuration details. Supported other admin routes should deny similarly; unsupported methods remain 405. Static assets and invalid webhook GET should retain their previous behavior. Do not submit lead forms or perform authenticated live mutations.

## Remaining blockers, rollback and recommendation

- Preview admin login cannot succeed without its approved authentication configuration; safe rejection is intentional. If authenticated Preview testing is required later, provision a separately approved synthetic auth/data/sender setup. Do not copy Production secrets or enable real service traffic to get a successful response.
- With no Preview `META_APP_SECRET`, authenticated Meta POST testing remains unavailable by design (503). Keep production HMAC validation unchanged; use synthetic local/isolated tests. No Meta subscription or environment scope change is authorized here.
- Privacy approvals, actual demo-number receiving-ID/storage ownership and Supabase/Redis tenant-isolation prerequisites, inactive Phase 1B and unenforced quota/billing definitions remain launch blockers. The US demo bot remains inactive.
- Rollback is a reviewed code revert or the previously approved artifact; base `174df80` is not a claim about live Production. Retain the safe auth denial where possible: blindly restoring the base reintroduces the disclosure. No data rollback, SQL, credential rotation, environment change or security bypass is needed.

**GO for reviewing this fix and authorized read-only protected-Preview verification after push. NO-GO for Production release, US demo activation, or claiming authenticated Preview workflows are functional without an isolated setup.**
