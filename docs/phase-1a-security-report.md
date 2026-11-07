# RepliQ Phase 1A security report

Local work only, on `security/phase-1a`. The initial working tree was clean. Baseline: `9f3eb32bd04a86064c53de88719022eac8643fbf`. No repository clone/fetch, deployment, merge, credential change, migration, or production service/data operation was performed. Changes are uncommitted for review.

## 1. Files inspected and actual flows

Inspected `api/webhook.js`, `api/conversation.js`, `api/dashboard.js`, `api/business-config.js`, `api/lead.js`, `api/orders.js`; all existing `api/admin/` endpoints (`login.js`, `conversations.js`, `messages.js`, `read.js`, `takeover.js`, `send.js`); `lib/whatsapp.js`, `lib/templates.js`, `lib/db.js`, `lib/supabase.js`, `lib/admin-auth.js`, `lib/window.js`, `lib/ai.js`, `lib/notify.js`, `lib/orders.js`; `admin.html`, `admin.js`, dashboard action call sites in `dashboard.html`, `package.json`, `supabase/schema.sql`, and all seven original test files. No `vercel.json` exists. Also examined the installed `@vercel/functions` waitUntil/request context implementation and upstream Vercel Node raw-body implementation. Credential files were not printed or modified.

Actual flows:

- `/api/webhook`: GET challenge; POST message/status extraction; immediate Meta acknowledgement with asynchronous processing retained via `waitUntil`. Inbound identity supports phone and BSUID; dedup precedes takeover check. Active takeover stores inbound history without AI/transcription/read receipt. Otherwise audio is downloaded/transcribed or text/interactive content extracted; inbound history is stored; explicit human requests trigger handoff; recent history and optional business config feed the existing AI; AI handoff or split text replies are stored and team notifications preserved.
- Supabase stores conversations by `wa_contact_phone`, messages by conversation UUID, and deduplicates `wa_message_id`. Redis mirrors history when configured. AI uses Supabase history when available, otherwise Redis. Identity merge preserves existing history and takeover semantics.
- `/api/conversation` is the existing Redis dashboard action endpoint and also contains an older inbound webhook implementation. Both inbound paths now require signed Meta requests. Its authenticated dashboard actions remain available at the existing URL.
- `dashboard.html` uses `/api/dashboard`, `/api/conversation`, and `/api/orders` with the shared dashboard secret. It already does **not** use `/api/webhook` for actions.
- `admin.html`/`admin.js` use login tokens and `/api/admin/*`, poll every five seconds, and send manual replies by conversation UUID through Supabase. The server selects the configured business number. Manual replies enforce the existing Meta customer-care window, enable takeover, and store success/failure. No browser Supabase client is used by this inbox.
- Delivery receipts update Supabase by wamid and Redis by customer/wamid, including failed/error states. Redis falls back to `msg:phone:<wamid>` when no recipient ID is available.
- Text, sequential text, template sends, read receipts, media lookup/download and Meta template listing previously used the same environment token directly. Public lead submission also sends through the text wrapper. All token-bearing WhatsApp operations now resolve credentials centrally.

## 2. Files modified or added

Behavior/security changes:

- Modified: `api/webhook.js`, `api/conversation.js`, `api/business-config.js`, `lib/whatsapp.js`, `lib/templates.js`, `lib/db.js`.
- Added: `lib/webhook-security.js`, `lib/whatsapp-credentials.js`, `lib/legacy-admin-action.js`, `api/admin/legacy.js`, `lib/tenant-keys.js`.
- Server logging only: `api/admin/conversations.js`, `api/admin/messages.js`, `api/admin/read.js`, `api/admin/send.js`, `api/admin/takeover.js`, `api/dashboard.js`, `api/lead.js`, `api/orders.js`, `lib/ai.js`, `lib/notify.js`, `lib/supabase.js`. Logging changes also occur in the behavior files above. AI prompts/provider/retry choices and notification contents were not changed.
- Test tooling: modified `package.json`; added `scripts/test.mjs`, `tests/no-network.js`, `tests/signed-request.js`, `tests/security-phase-1a.test.js`; updated signed/configured-number fixtures in `tests/bsuid-identity-and-merge.test.js`, `tests/bugfixes-pack-details-and-takeover.test.js`, `tests/human-takeover-and-readability.test.js`, `tests/send-endpoint.test.js`.
- Added this report. Frontend files and the SQL schema remain unchanged.

## 3. Changes implemented

### Meta authentication and raw bytes

POST `/api/webhook` verifies `X-Hub-Signature-256` using HMAC-SHA256 and `META_APP_SECRET`, then compares equal-length digest buffers with `timingSafeEqual`. Missing/malformed/mismatched signatures return 401; missing secret returns 503 in every environment; bad signed JSON returns 400; oversized bodies return 413. No development bypass exists. Parsed objects are never serialized to reconstruct a signature. GET verification remains available and requires a configured verify token.

Both ingress files export `config.api.bodyParser = false` for compatible frameworks. This project uses standalone Node functions, so correctness does **not** rely on Next.js configuration disabling the Vercel helpers. The actual standalone Vercel helper buffers the incoming body, restores its bytes through `data`/`end` events, and provides a lazy parsed `req.body`. The new reader consumes those restored events explicitly, before accessing parsed JSON on the Meta endpoint. It also handles ordinary Node streams. It deliberately does not use an async iterator over Vercel's already-consumed underlying stream. Only raw Buffers are accepted for direct handler fixtures; object-only Meta callers fail closed.

Sources: [Vercel Node runtime documentation](https://vercel.com/docs/functions/runtimes/node-js), [upstream helper raw-body restoration](https://raw.githubusercontent.com/vercel/vercel/main/packages/node/src/serverless-functions/helpers.ts), [upstream handler helper invocation](https://raw.githubusercontent.com/vercel/vercel/main/packages/node/src/serverless-functions/serverless-handler.mts). These are source inspections; the project's deployed builder version was not queried. A Vercel preview check remains required.

### Legacy dashboard migration

The historical actions embedded in `/api/webhook` were extracted unchanged in their business behavior to POST `/api/admin/legacy?key=<existing DASHBOARD_SECRET>`. They still support modes, replies, templates/listing and message/conversation deletion with their existing bodies and responses. Meta envelopes are rejected by that route. `/api/conversation` continues serving the existing dashboard actions at the same URL, with an explicit exclusion for Meta envelope shapes.

**Required compatibility migration:** any external/older client using unsigned POST `/api/webhook?key=...` for dashboard actions must change its URL to `/api/admin/legacy?key=...` before rollout. Unsigned actions at the Meta URL intentionally return 401, even with a valid dashboard secret. No deployed client configuration was inspected or changed; the checked-in dashboards require no edits.

### Credential boundary

`resolveWhatsAppCredentials` returns the existing server environment token only for `WHATSAPP_PHONE_NUMBER_ID || DEFAULT_PHONE_NUMBER_ID`. A caller cannot use a different requested number with that token. Media functions accept an optional number argument and default to the same configured business; both webhook implementations now pass their verified business context explicitly. Template listing resolves the same WABA/token pair, and configuration endpoints enforce the configured number. Manual Redis replies validate the number before owner-key backfill.

The abstraction preserves existing credential values. It intentionally has no token map or runtime multi-tenant mode. Admin authentication is still a single-business administrator; tenant memberships and encrypted tenant credentials are Phase 1B dependencies. If both number environment variables exist with different values, review that configuration before rollout: this phase permits the canonical `WHATSAPP_PHONE_NUMBER_ID` only. Unknown signed business events are acknowledged without processing, following existing handler error acknowledgement behavior.

### Takeover and logs

Redis pipeline command errors now throw even when the REST HTTP response is 200. Takeover lookup failures (including identity-map resolution or Supabase query errors) propagate unless a positive takeover state keeps the bot silent. This makes the existing caller fail-safe effective during backend outages. No new usage-limit takeover is active.

Server console calls now emit fixed event labels, without customer identifiers, messages, full provider responses, or exception payloads. Existing authenticated API error shapes and stored failure details are preserved. This does not change platform access-log configuration: existing query-string admin secrets remain a Phase 1B migration concern.

## 4. Tests and checks

Final local validation: `npm test` — **87 tests passed, 0 failed, across 8 test files**. `git diff --check` and syntax checks of project JavaScript/MJS also pass.

The existing Node 26 `node --test` invocation in this environment reported file-level successes without individual test counts. The replacement runner executes each test file directly in an isolated Node process, so actual node:test cases execute and their counts are visible. A preloaded fetch guard rejects unmocked external requests. No real WhatsApp messages, customer fixtures, database access, or notification sends were used.

Coverage includes exact-byte/Unicode/whitespace signatures; malformed/forged/missing signatures and secret; GET challenge; chunked streams and body limits; mixed Meta/admin payload rejection; raw-stream dashboard actions; AI reply and duplicate delivery; takeover persistence/silence and backend failures; manual replies and failed sends; audio download/transcription and unsupported media; templates outside the customer-care window; Redis history, owners and BSUID merge; sent/delivered/read/failed states; Supabase status updates; configured-number compatibility and foreign-number rejection; static log privacy; inactive, collision-safe future tenant keys.

An intermediate new test failed because the test helper tried to JSON-parse transcription FormData; the helper was corrected. No test failures remain. No hosted Vercel build, browser end-to-end run, or live integration check was performed.

## 5. Existing functionality preserved

Existing dashboard URLs, action bodies/responses, admin login/list/read/takeover/send APIs, current prompts/provider selection, WhatsApp response formatting, customer-care window behavior, phone/BSUID identity handling, Redis/Supabase schemas/history, human takeover and team notification behavior are preserved in mocked regression tests. The intentional security changes are signed Meta ingress, configured-number restrictions, silent bot behavior on uncertain takeover, private server logs, and the legacy webhook-action URL migration described above. Frontend layout and UI are untouched.

## 6. Phase 1B dependencies and Redis migration design

Do **not** onboard a second business into this deployment yet. Legacy storage cannot be safely migrated by changing only its key prefixes.

| Existing key family | Current scope/problem | Proposed v2 key kind |
| --- | --- | --- |
| `conv:<customer>` | History shared by customer ID | `conversation:<customer>` |
| `conv:index` | Global conversation listing | `conversation-index` |
| `conv:mode:<customer>`, `conv:takeover:<customer>` | Shared takeover/mode | `mode:<customer>`, `takeover:<customer>` |
| `conv:owner:<customer>` | One owner value can overwrite another business | `owner:<customer>` or derive from tenant context |
| `conv:meta:<customer>`, `conv:user_map:<bsuid>` | Metadata and identity merge lack tenant scope | `meta:<customer>`, `identity:<bsuid>` |
| `msg:phone:<wamid>` | Global receipt lookup, seven-day TTL | `message-owner:<wamid>` |
| `msgid:<wamid>` | Global ten-minute dedup claim | `inbound:<wamid>` with durable processing state |
| `business:<phoneNumberId>` | Already keyed by business number, but admin authorization global | `business-config` |
| `templates:approved` | Global custom template list | `approved-templates` |
| `order:<id>`, `orders:index`, `orders:business:<id>`, `orders:phone:<customer>` | Global listing/phone index; business index alone does not authorize access | `order:<id>`, `order-index`, `customer-orders:<customer>` |

`tenantKey(phoneNumberId, kind, ...identifiers)` defines the pure candidate format `rq:v2:{<encoded-business-phone-id>}:<kind>:<encoded-identifiers>`. Each segment is escaped separately; the Redis hash tag keeps one business's quota/claim keys in the same cluster slot. It is **unused** by every runtime reader/writer. No dual reads, backfill, key writes, expiry changes or data deletion were introduced.

Phase 1B must establish authenticated tenant memberships and immutable business IDs, bind each WhatsApp number/WABA to that tenant, store encrypted per-tenant tokens with restricted server access/rotation, and authorize every conversation/config/template/media/order operation. For multiple numbers per business, quota keys should use immutable business ID while conversation keys include both business and phone-number ID; verify this mapping server-side.

Supabase needs business ownership, composite business/customer uniqueness, scoped identity merges, scoped messages/status lookups, tenant-constrained service-role queries, and membership-based RLS. The checked-in schema grants unconditional SELECT to `anon` and `authenticated` on conversations/messages. This is a concrete source-level privacy risk; whether those policies exist in production was not queried. A separately approved database review/migration must remove unrestricted reads before SaaS onboarding.

A safe backfill needs a read-only ownership inventory and backup first. `conv:owner` is useful evidence but cannot prove ownership of a history already overwritten/mixed by two businesses. Quarantine ambiguous records for review; never copy a legacy history into multiple tenants. Migrate all readers, writers, status lookups, identity maps, admin listings and merge paths together. Use per-record migration versions and an explicit manifest; keep legacy keys intact during validation and retain rollback mappings. Never automatically fall back from an arbitrary tenant's v2 key to a global legacy key.

## 7. Usage limits and circuit-breaker design — inactive

No enforcement, counters, reservations, alerts or new billing behavior run in Phase 1A. No environment flag can accidentally enable them. The following is a design for an approved Phase 1B implementation, not an operational quota implementation.

- Commercial period: obtain explicit subscription period ID, start and end from a future billing source, stored server-side. Never infer a billing month from a browser date or a calendar-month key. Proposed business cap is 1,000 quota units per period.
- Metering policy needs product approval before activation. Proposed definition: each outbound message accepted by Meta consumes one business quota unit, tracked separately by `ai`, `human`, `template`, `handoff`/system origin. A split AI response is multiple outbound message units but one AI conversation turn. Record attempts and definite failures separately; delivery/read receipts update the original message and do not charge again. Do not automatically refund post-acceptance delivery failures; this is an explicit commercial policy choice. Meta costs/category billing remain a separate ledger.
- Per-customer AI cap: a rolling 24-hour window of 12 AI reply turns for an authorized business/number/customer conversation, rather than a calendar-day reset or Redis TTL started by the first reply. Use a timestamp-sorted set and remove entries older than 24 hours inside the same atomic reservation script. Tie all split messages to one AI-turn ID and reserve all expected outbound units before sending.
- Atomic reservation: one Lua/EVAL operation in the business hash slot checks a durable operation ID, billing-period counter plus outstanding reservations, rolling AI-turn reservations, and breaker state. If allowed, reserve units/turn and store a lease/operation result atomically; if denied, mutate no quota counters and return a machine-readable reason. Concurrent requests at 999 business units or 11 AI turns must never both reserve the final allowance. No GET-then-INCR sequence.
- Durable acceptance ledger/outbox: persist intent, origin, business, conversation, billing period, operation ID, reserved units, timestamps and status. After a Meta acceptance, atomically commit the reservation once and attach every returned wamid. Release only definite pre-acceptance failures. A timeout/crash after sending is `unknown`, not a free retry: hold its reservation for reconciliation, and avoid blindly resending. Redis and Meta are not one transaction; do not promise exactly-once delivery.
- Duplicate inbound events: a tenant-scoped SET NX claim with processing state/lease plus durable unique `(business, inbound-wamid)` record; queued/processing/complete/retryable-failure states survive instance restarts. Retain completion records through the provider retry horizon and reconciliation window, rather than assuming ten minutes is sufficient. A duplicate event must not call AI, reserve quota, notify or send twice. Cross-instance quota/claim failures must pause automation instead of falling back to an instance-local counter.
- Alerts: use atomic threshold crossing markers for 800/1,000 accepted business units (80%/100%) and an outbox notification per business/period/threshold. Track AI-window denials separately. Retries or out-of-order delivered/read receipts must not generate duplicate alerts. Keep alert payloads free of customer text and tokens.
- Limits reached: persist a scoped automation pause reason and durable human-takeover state before returning. Store inbound messages normally, skip AI/transcription/auto read/send as appropriate, and notify the authorized owner through the outbox. Human reply behavior at the business cap requires an approved policy; it must never silently bypass a cap if those replies count. Do not send a limit notice through an exhausted quota. Reserve any allowed notice in advance. Existing automatic takeover timeout must not release quota/breaker pauses.
- Circuit breaker: maintain tenant-scoped open/half-open/closed state for sustained provider/auth/quota-backend failures, bounded retry/backoff, one half-open probe and manual recovery. Preserve inbound capture and human access while automation is paused. Notifications deduplicate by breaker transition. Keep manual takeover separate from billing/breaker state.
- Before activation: shadow-meter against a durable ledger, reconcile split/partial sends and delayed receipts, test concurrent final-unit reservations and time-window boundaries, agree commercial counting/refund rules, and obtain explicit approval for production enforcement. Existing production traffic stays unlimited under this phase.

## 8. Required environment variables and deployment prerequisites

New required name: **`META_APP_SECRET`** — the Meta App Secret for the app that signs the subscribed webhook, not `VERIFY_TOKEN`, a WhatsApp access token, or a dashboard secret. Supply it through protected server-side environment settings as a separately authorized rollout step; this work did not set or rotate any credential. Do not put it in HTML, Redis business config, logs, URLs or client responses.

Existing names remain: `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and/or `DEFAULT_PHONE_NUMBER_ID`; optional existing WABA names are `WHATSAPP_WABA_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID`. Existing Supabase, Upstash, admin, AI and notification names are unchanged. No quota environment variable is introduced.

Prerequisites for a later authorized deployment:

1. Confirm exactly one intended business number, correct existing token/WABA association, and canonical number configuration. Resolve differing DEFAULT/WHATSAPP IDs by review, not automatic credential changes.
2. Configure the signing app's `META_APP_SECRET` in the intended server environment before activating this code. Without it inbound POSTs return 503 by design.
3. Inventory external legacy webhook-action clients and migrate them to `/api/admin/legacy`; keep `/api/conversation` callers unchanged. Keep the Meta subscription pointed at the signed webhook.
4. Run local tests/checks and an isolated Vercel preview using synthetic payloads and mocked services. Verify raw-body behavior against the actual builder/runtime: whitespace and Unicode signed bytes accepted; missing/tampered signatures rejected; GET challenge, existing dashboard actions and async processing work. No global `NODEJS_HELPERS=0` change is needed or recommended, because other routes use Node helpers.
5. Review the production RLS configuration through a separately authorized process and plan Phase 1B. Do not apply the checked-in schema as part of this change. Do not enable tenant onboarding or quotas.
6. Obtain deployment approval separately. No deployment was requested or executed here.

## 9. Rollback instructions

There are no database migrations or new active Redis key formats to reverse. Keep credentials and production data intact.

For a future reviewed/committed rollout, revert the Phase 1A code commit(s) in a new review branch and deploy the previously approved artifact only through the normal authorized release process. Restore any external legacy clients to their former route only if the corresponding old application is restored. The baseline above identifies the prior code; no branch reset or file deletion is needed. An environment variable may remain configured without affecting the old version.

A full rollback also restores unsigned webhook acceptance and older logging behavior, so prefer correcting the configured secret or raw-body integration while retaining fail-closed authentication. Never respond to a signature outage by adding an authentication bypass. No rollback operation was performed.

## 10. Unresolved risks and explicit limits

- This is single-business hardening and preparation, **not multi-tenant SaaS readiness**. Global admin secrets/tokens, global Redis indices, customer-only Supabase ownership and public-read schema policies need Phase 1B.
- Runtime raw-body behavior is backed by upstream source inspection and local Node stream tests, not a hosted test against this project's Vercel builder. Deployment prerequisites above are mandatory.
- Existing dedup retains a ten-minute Redis claim with instance-local fallback; Supabase offers additional message uniqueness but does not atomically cover AI calls/sends. Long delayed retries and cross-instance outages can still duplicate work. Durable inbox/outbox design is deferred.
- Existing handlers process the first entry/change/message/status only. Batched events are not expanded in this conservative phase. Add full event iteration with scoped idempotency in Phase 1B.
- Existing split replies return/store only the final wamid as a combined message; partial sends and intermediate status receipts cannot form a trustworthy billing ledger yet. Some handoff paths can persist a sent state even if a send failed. Do not use existing histories as authoritative quota accounting.
- Existing Redis status/message deletion paths rewrite lists with separate read/delete/write operations, so concurrent history updates can race. A production-safe atomic migration is deferred.
- Takeover uncertainty now intentionally pauses automatic processing, which may reduce availability during backend errors. Existing takeover-write sync is still best effort; there is no durable pause/notification outbox yet.
- Shared query-string dashboard secrets, browser token storage, lack of per-user tenant roles, and the public lead submission/send path require a broader auth/abuse review. Server log changes do not control platform access logs or browser console behavior.
- No live production schema, traffic, credentials or client inventory was inspected. Assertions about existing functionality are limited to local source tracing and mocked regression tests.
