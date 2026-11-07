# US lead form security

Branch `feature/us-lead-form-security`, worktree `/tmp/repliq-us-lead-form-security`, base `68f942dd4ffefaf0614de6445d520ed9e4a09487`. Scope was frozen at the owner's request; final work is committed locally only. No production/customer data, real provider traffic, environment settings, credentials, SQL, deployment or bot activation were used or changed. No clone/fetch occurred.

## Findings and minimum implementation

The public endpoint dispatched between US and legacy offers, accepted several weakly checked fields, lacked body limits/rate controls/idempotency and returned optional acknowledgement diagnostics. It appended inquiry data to customer-keyed Redis histories; the AI history mapper treated lead rows as assistant context. Email notifications already used fixed server-configured recipients and plaintext bodies, and UI receipt/dashboard rendering already escaped text.

Implemented:

- Disable Vercel's default parser for this endpoint and read at most **16 KiB** before JSON decoding. Check actual streamed bytes and declared length; reject malformed JSON/UTF-8, unsupported content types/encoding and non-object bodies. Other webhook parsers remain unchanged.
- Validate all accepted fields and reject unknown fields, including browser-supplied tenant/number selectors. Bound text lengths, types, email syntax/control characters, selected activity/offer/mode/intent, integer volume and optional numeric metadata. Reject HTML tags and control/header injection. Keep ordinary Unicode names, apostrophes, ampersands and multiline plain inquiry text. US prices come from existing canonical constants, never posted amounts.
- Preserve international phone formatting/normalization, including + country codes and backend 00-prefix inputs, plus legacy Moroccan local-number normalization. Accept bounded 7–15 digit international syntax without inventing country ownership. Format validation does not establish that a line exists or belongs to the submitter.
- Add a hidden, non-focusable honeypot; visible fields, layout, CTAs and the existing lead/receipt/PDF flows remain. Same-origin browser requests work; mismatched Origin is rejected. Omitted Origin remains supported for existing direct callers.
- Use parameterized Redis Lua admission for atomic counters and duplicate reservations. Limits per configured business number: **100 requests/10 minutes globally, 10 requests/10 minutes per IP, 3 distinct inquiries/hour per phone, 5/hour per email**. General request counters also cover duplicate retries. These are public-endpoint abuse budgets, not the commercial outbound/AI quotas.
- Derive pseudonymous limiter/dedup keys with HMAC using the existing server Redis credential; no additional secret/environment variable is required. Use Vercel's forwarded IP only in its server environment; outside Vercel use the socket address. Invalid/missing addresses share a restrictive bucket. All limiter keys are in a separate `repliq:lead:v1:{configured-number}:...` namespace with technical expirations.
- Reserve identical normalized content for **15 minutes**, independent of retry reference IDs and posted US prices. Concurrent in-flight duplicates get 409; completed duplicates return success with the original reference and no repeated persistence/delivery. A nonce protects completion. Storage/completion failures never trigger notifications or a false confirmed response; uncertain reservations expire instead of being blindly retried.
- Fail closed with generic **503** on unavailable/malformed limiter/storage replies; no process-local limiter or Supabase fallback. Return generic 400/403/409/413/415/429 errors as appropriate; rate denials have Retry-After. Use no-store responses and bounded 3-second Redis / 4-second optional provider waits.
- Before persistence, reject foreign or ambiguous existing Redis ownership and apply backpressure at 98 existing conversation rows. Do not use default-owner/BSUID-history fallback to authorize an inquiry. Public writes do not trim existing history. Respect active/closed takeover state by suppressing automatic acknowledgements while retaining the inquiry for team review.
- Mark new inquiry and acknowledgement rows `source: public-lead`; exclude these and legacy lead-role rows from AI context while retaining dashboard visibility. Normal authenticated message handling/retention remains unchanged. No business config, takeover flag, tenant membership, credential or quota is created by a submission.
- Keep recipient/from/subject configuration server-controlled and notifications plaintext. Submitted email is not an envelope/header field. Safe optional-delivery errors contain no configuration or provider details. Successful persistence still succeeds if optional delivery fails.
- The client uses the confirmed server reference in its receipt/PDF/WhatsApp follow-up. Both unpublished privacy drafts now describe the technical abuse processing, without adding retention/compliance guarantees.

Atomic Lua execution and Vercel header behavior were checked against the [Redis scripting documentation](https://redis.io/docs/latest/develop/programmability/eval-intro/) and [Vercel request-header documentation](https://vercel.com/docs/headers/request-headers). No further documentation investigation was performed after the stop-expansion request.

## Changed files

- Endpoint/services: `api/lead.js`, new `lib/lead-validation.js`, new `lib/lead-abuse.js`, `lib/public-pro-lead.js`.
- Shared helpers: `lib/db.js` (public-source/history handling and optional abort signal), `lib/whatsapp.js`, `lib/notify.js` (optional signals; existing callers retain their behavior).
- Public form: `formulaire.html`, `signup.js`; privacy disclosures: `privacy-en.html`, `privacy.html` (both remain pending/noindex).
- Tests/fixtures: new `tests/lead-form-security.test.js`, new `tests/lead-service-fixtures.js`, `tests/public-us-pricing.test.js`, `tests/admin-service-fixtures.js`.
- Local verification: `scripts/verify-vercel-runtime.mjs`, `scripts/verify-us-website.mjs`, new optional `scripts/verify-lead-lua.mjs`.
- Report: `docs/us-lead-form-security-report.md`.

No package/dependency, Vercel rewrite, SQL/foundation, admin auth, HMAC or AI pricing/prompt changes. US $99/month + $99 setup and intended unenforced plan limits remain. Moroccan offers, official email `7amzaraddi@gmail.com` and bot `+212712614398` remain. Legacy lead consent/email/activity optionality and known offer copy are preserved for compatibility; legacy submitted price text remains an unverified inquiry value, not billing authority. All offer variants pass the same abuse gate.

## Final validation

- `npm test`: **336 passed, 0 failed, 0 skipped**, **16/16 files** (258 existing tests plus 78 lead-security cases). Includes malformed/missing/oversized requests, honeypot/HTML/header injection, concurrency/dedup/reference reuse, limiter exhaustion/expiry/unavailability, storage/completion outages, independent Supabase failure, international phones, legacy Moroccan requests, customer-history/takeover preservation, and existing auth/HMAC/voice/template/receipt regressions.
- `npm run check:functions`: **7 before / 7 after**.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **94 real-runtime HTTP response checks passed**, local Vercel Node 30.0.0/routing-utils 6.6.1, synthetic services only. Includes raw body caps, same-origin/proxy handling, duplicate references, rate exhaustion, malformed fields, missing Redis, legacy requests and all prior admin/webhook checks.
- `node scripts/verify-lead-lua.mjs /tmp/repliq-lead-lua-tools`: **12 offline Lua-source checks passed**. Fengari 0.1.5/Lua 5.3 runs the actual script with in-memory Redis command stubs; checks counters/TTLs, nonce completion, duplicate references, exhaustion, expiry and corrupt keys. Free optional tools live outside the project; no runtime/paid dependency added. This does not claim a live Upstash/Lua 5.1 integration test.
- Optional local browser script: **PASS** desktop/mobile, both CTAs, unchanged layout, hidden honeypot, canonical contacts/pricing, server-confirmed references, phone/consent handling, error UI, escaped receipt and actual PDF download. All remote requests/submissions intercepted; zero page errors. Artifacts: `/tmp/repliq-us-lead-security-review/`.
- `node --check`: **69 JavaScript/MJS files passed**; `git diff --check` passed. All **nine original worktree HEADs/statuses and 27 inventoried uncommitted files** remain unchanged. Protected webhook/admin/HMAC/AI/pricing/foundation/dependency/SQL paths match the base.

Initial fixture issues and a duplicated old phone-length check were corrected. The same-origin runtime fixture was aligned with the runtime's forwarded-host behavior; origin validation was not loosened. No failing checks remain in the final run. No hosted lead POST or real email/WhatsApp/Redis/Supabase operation was executed.

## Unresolved risks and deployment prerequisites

- Before any approved production release, rehearse against a **dedicated synthetic** Upstash-compatible store to confirm EVAL permissions, actual Lua/runtime behavior, outage handling and expected capacity. The implementation refuses service if unavailable; do not disable the limiter to obtain a success. Existing Redis credentials and canonical number are required; do not copy live credentials to Preview.
- Honeypots and request budgets reduce abuse but do not prove identity/consent or stop all distributed denial-of-service. Shared NAT/global budgets can reject legitimate traffic under attack. Phone/email ownership remains unverified; no new CAPTCHA/OTP provider was introduced. Provider cost/availability cannot be guaranteed.
- Duplicate protection is bounded to its window and separates persistence from best-effort delivery; it is not a transactional outbox or exactly-once provider guarantee. A crash after completion can leave a stored inquiry without notification. A timed-out/partially written request can remain pending until expiry and needs reconciliation, not automatic resend. Redis script errors do not provide transaction-style rollback of previous commands. Token rotation changes HMAC namespaces; coordinate any separately approved future rotation.
- Customer-keyed legacy storage is still single-business. Ownership checks are preflight defense, not atomic cross-tenant isolation or proof of Supabase ownership. Do not share this deployment/store with future tenants until Phase 1B is approved/completed. Existing unowned or large conversation histories are rejected for manual review rather than rewritten. Supabase is not used for inquiry writes or as an outage fallback.
- Old assistant acknowledgements without provenance cannot be retroactively identified safely; no historical data was rewritten. New public rows are excluded from AI context. The existing normal-message retention policy still applies when genuine conversations resume.
- Privacy drafts, actual retention/deletion/provider practices, tenant isolation and US demo activation retain their prior approval blockers. Commercial quotas/billing remain inactive. Authenticated Preview setup and any live functional verification need separate approval and isolated resources.

## Deployment / rollback

Latest instruction is local completion: no push, hosted submission or deployment is performed in this final step. No new environment settings or SQL migration are required by the code, but an approved isolated integration rehearsal and owner review are prerequisites for deployment. Preserve exact previous artifact/settings, verify seven functions, use synthetic adapters, and obtain explicit release approval. Never submit test leads to a Preview backed by production services.

For rollback, prepare a reviewed artifact/revert; base `68f942d` is not a statement about the current production artifact. Keep the public-source AI filter and safe errors when reverting other changes: blindly restoring the base would re-enable untrusted lead context and remove abuse protections. Do not clear/reset customer data, rewrite old messages/configs, disable security, or execute SQL. New temporary limiter keys expire naturally; do not delete existing Redis namespaces to reset limits.

**GO for local review and approved isolated testing only. NO-GO for claiming a production launch or verified live anti-abuse integration.**

## Final local re-verification

Repeated checks against implementation commit `c425f22e0145d9aab3d5dc69e30dff5a7997eb2f`: **336/336 tests across 16 files**, **94 local runtime HTTP checks**, **12 offline Lua-source checks**, and **7 functions**. Zero failures, cancellations or skipped tests. The branch was clean before this documentation-only update; no implementation changes or additional investigation were made. Browser and syntax evidence above remains from the unchanged implementation's prior run. No push, hosted submission or Production changes were performed.
