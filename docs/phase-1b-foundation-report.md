# RepliQ Phase 1B — safe multi-tenant foundation

Prepared locally on `security/phase-1b`, based on committed Phase 1A `a90a804` (`security: complete phase 1a`). At the start, `git status --short`, `git diff --stat`, and `git diff` were empty. Phase 1A's report still says “uncommitted”; Git confirms it was committed before this work. No existing changes were overwritten and no additional commit was made.

**Migration boundary:** production APIs, authentication, schemas, credentials, Redis key formats, AI prompts and frontend are unchanged. The new modules are isolated preparation and are not imported by production code. No migration, remote SQL, production data access, deployment, merge, environment change, credential rotation, clone or repository fetch occurred. Quotas remain inactive.

## 1. Files inspected and modified

Inspected the Phase 1A report; `supabase/schema.sql`; all existing `api/` endpoints, including all seven `api/admin/` endpoints; `lib/supabase.js`, `lib/db.js`, `lib/orders.js`, `lib/templates.js`, `lib/whatsapp.js`, `lib/whatsapp-credentials.js`, `lib/webhook-security.js`, `lib/tenant-keys.js`, `lib/admin-auth.js`, `lib/legacy-admin-action.js`, `lib/notify.js`; webhook AI/handoff/media call sites; admin browser authentication/API calls in `admin.js`; legacy dashboard action calls; package/test runner and the existing eight test files. The checked-in database contains only `conversations` and `messages`; no live schema was inspected.

Only new files were added:

| Files | Purpose |
| --- | --- |
| `lib/foundation/authorization.js` | Dependency-injected membership/number authorization, role capabilities, immutable contexts with unforgeable in-process provenance |
| `lib/foundation/supabase-store.js` | Limited scoped repository examples: conversation/history reads, receipt lookup, takeover and accepted human-message persistence |
| `lib/foundation/redis-plans.js` | Pure v2 key/command plans using the existing `tenantKey`; no transport, fallback or migration execution |
| `lib/foundation/credentials.js` | Server-only owned-number/active-version secret-manager boundary; no environment-token fallback |
| `supabase/phase-1b-review/001_expand.sql` | Additive ownership, membership, session and credential-reference schema draft |
| `supabase/phase-1b-review/002_assign_reviewed_ownership.sql` | Explicitly reviewed, fingerprint-checked assignment draft |
| `supabase/phase-1b-review/003_enforce_scope_and_rls.sql` | Coordinated constraint/RLS cutover draft |
| `supabase/phase-1b-review/verify.sql` | Read-only post-cutover checks for later approval |
| `supabase/phase-1b-review/rollback_002_before_cutover.sql` | Narrow pre-cutover assignment reversal draft |
| `supabase/phase-1b-review/README.md` | Approval guards, ownership fingerprints, SQL assumptions and required database rehearsal |
| `tests/tenant-foundation.test.js` | Mocked isolation/auth/ownership and migration-boundary tests |
| `docs/phase-1b-redis-manifest.schema.json` | Review-only metadata manifest schema, including quarantine/expiry; no production records |
| This report | Audit, design, compatibility, rollout and rollback |

No existing source or test file was modified, including `lib/tenant-keys.js`, `supabase/schema.sql`, frontend files and package configuration. Draft SQL is outside `supabase/migrations` so a normal Supabase migration runner will not discover it automatically.

## 2. Security findings ranked by severity

These are source findings and multi-tenant blockers. They do not assert that the existing single-business application is malfunctioning, that remote policies match the source, or that an exploit occurred.

| Severity | Surface | Finding and necessary boundary |
| --- | --- | --- |
| Critical | `supabase/schema.sql` | `Allow read conversations/messages` grants anonymous/authenticated SELECT with `USING (true)`. If installed with Data API access, customer data can be read without tenant membership. Remove unrestricted grants/policies through reviewed stage 003. Production installation was not queried. |
| Critical for multiple businesses | `lib/supabase.js`, direct queries in `api/admin/send.js` | Service-role access bypasses RLS. Lists, phone/UUID lookups, unread updates, takeover, AI history, message persistence and wamid status updates lack business scope. Every branch, retry and relationship query must constrain business and owned number. UUID secrecy is not authorization. |
| Critical for multiple businesses | `lib/db.js` | Customer-only histories, modes, takeover, owner/meta, global index and BSUID map collide when a customer contacts two businesses. Owner overwrites cannot prove historical ownership. Inbound save, AI memory, manual sends, delete, receipt update and merge must migrate together. |
| Critical for multiple businesses | `lib/admin-auth.js`, all admin/dashboard APIs | Shared secrets/passwords and signed global `admin` tokens carry no verified user membership. An authenticated holder can list/read/mutate every global record. Never promote this token into a multi-tenant session. |
| High | `upsertInboundConversation`, `mergeRedisConversation` | Phone/BSUID merges and message reparenting are global and not a tenant-scoped transaction. They can join the wrong histories or copy takeover/ownership between businesses. Future merges need registry scope, alias provenance, same-scope FKs and atomicity. |
| High | Both webhook implementations | Meta HMAC now works, but processing only the first entry/change/message/status is insufficient for a multi-business event batch. Current default-number behavior must not become tenant routing. Verify the signing app, iterate the full envelope, map each number through the server registry, and reject/quarantine missing/unregistered scope. |
| High | Receipts in webhooks, `updateMessageStatusByWamid`, Redis `msg:phone` | Global wamid/customer resolution and list rewriting permit incorrect scope or lost concurrent updates after multi-tenant adoption. A signed app event still needs a registered business/number and an existing scoped message association. |
| High | `lib/orders.js`, `/api/orders` | Global order/phone indices and order-ID status writes lack membership checks. A business index alone is not authorization. Scope both index traversal and the fetched order; validate stored ownership before modifications. |
| High | `/api/lead` | Public submissions persist to global histories and can trigger outgoing messages/notifications. Browser `business` is a label, not verified ownership. No source-level abuse/consent/rate-limit boundary is present. Preserve existing single-business behavior now; future forms need server-bound tenant routing, isolation and verified sending policy. |
| High | `lib/notify.js` | One environment recipient receives customer content from every notification. A future second business must never inherit this recipient. Use verified per-business destinations and scoped outbox operations. |
| High | `admin.js`, admin login/auth | Seven-day bearer token in localStorage, cookie without HttpOnly, raw-password fallback and query token support enlarge token theft/replay exposure. Logout currently clears local state rather than revoking a server session/clearing its cookie. Migrate transport and revocation together; do not silently activate a partial replacement. |
| High | Legacy dashboard/config/order routes | Query-string secrets can enter platform/access/referrer logs and browser history. `business-config` accepts a header too, but still shares a global authority. Replace shared authority with authenticated sessions and membership, preserving action payloads where safe. |
| High | `lib/templates.js` | Custom `templates:approved` cache is global; canned templates are local defaults, not proof of current WABA approval. Future fetch/cache/send must bind business/number/WABA, verify approved status and scope variables/preview history. |
| Medium | Media helpers | Existing callers use signed inbound media, but helper signatures accept any media ID/URL and only the deployment's shared token. Before reuse in tenant APIs, require a scoped stored attachment, owned credentials, HTTPS and vetted provider URL/redirect handling; never accept a browser URL for token-authenticated fetch. |
| Medium | Credential resolution | Phase 1A safely restricts to one configured number. It has no tenant vault/rotation support. Loosening that check before authorization/storage cutover would reintroduce a credential-selection risk. Keep it unchanged until the complete release is ready. |
| Medium | Dedup, partial sends and state sync | Ten-minute claims, in-memory fallback, combined reply history/final wamid, and best-effort takeover sync cannot support durable cross-instance isolation/accounting. Durable inbox/outbox, per-message receipts, and reconciliation remain implementation requirements. |

No new live exposure is introduced or corrected by inactive preparation. The existing single-business paths continue operating under Phase 1A.

## 3. Proposed ownership model and database migrations

### Stable identities

`businesses.id` is an immutable UUID, not a browser label or WhatsApp number. `business_users.user_id` references the verified Auth identity; membership is a server-loaded `(business_id,user_id)` row with active/revoked status and role. Disabled users and suspended businesses cannot authorize a new context.

`whatsapp_numbers.id` is an immutable registration UUID with globally unique Meta `phone_number_id`, immutable business/WABA/app ownership and enabled status. Number transfer/reuse is a separate proof/review process, never an UPDATE from the browser. A business may have multiple registrations; conversations are separated by business **and** number. This prevents BSUID collisions across number registrations as well as across businesses.

Conversation UUIDs remain unchanged. New scope is `(business_id,whatsapp_number_id)`; uniqueness becomes `(business_id,whatsapp_number_id,wa_contact_phone)`. Messages retain their IDs and parent UUIDs, carry the same scope, and use a composite foreign key to the parent's `(id,business_id,whatsapp_number_id)`. Wamid uniqueness becomes `(business_id,whatsapp_number_id,wa_message_id)`. Null wamids remain valid for failed attempts; accepted-message records require actual provider IDs in the new repository example. Identity aliases are unique within the same scope and point to a scoped conversation; no cross-business alias merge is allowed.

### Stages, all unexecuted

1. **001 expand:** adds businesses/users/memberships, number registry, business settings, private hashed admin-session records, private versioned vault references and private ownership manifest; adds nullable scope columns, paired-null checks, composite unique constraints and scope/time indexes. Existing global uniqueness stays temporarily. No business/user/number/ownership row is guessed or seeded. New tables have RLS and no browser grants. IDs/number ownership/credential-version bindings are immutable. Original permissive policies are unchanged until stage 003, so expansion alone does not fix them.
2. **Ownership inventory/provisioning:** after separately approved backup and schema review, register the real existing business/users/numbers from verified evidence. Identify SQL/Redis source snapshots and review whole histories; private manifest rows record reviewer, batch, evidence reference and SHA256 fingerprints of both conversation metadata and all ordered messages. A single current Redis owner or environment default is insufficient evidence. Ambiguous records receive `quarantine` with no business/number assignment.
3. **002 assign:** with writers stopped and both stores frozen, rechecks fingerprints under locks, refuses scope conflicts, assigns only verified manifest rows in the selected batch, and derives message scope from their existing parent. No UUID, body or parent pointer changes. Quarantined rows remain untouched. This stage is not an online backfill runner; large datasets require a reviewed batched plan.
4. **003 enforce and RLS:** refuses any unresolved/null scope and unknown policies. Sets non-null ownership, validates number/parent constraints, installs composite message-parent FK, drops obsolete global customer/wamid uniqueness, removes known unrestricted reads and anonymous grants, grants membership-based SELECT, keeps direct browser writes denied, and prevents ordinary tenant reparenting. All role-checked writes remain server-side. Member evaluation uses a qualified, pinned-search-path security-definer helper deriving `auth.uid()` internally; its owner/execute ACL must be verified in rehearsal.
5. **verify:** read-only count/catalog checks for missing ownership, mismatches, duplicates, grants, policies, validated constraints and function ACLs. A separate Auth/RLS scenario rehearsal is required; catalog queries alone cannot prove isolation.

The nullable expansion preserves old writes, but changes catalog relationships. The new composite message-parent FK is deliberately deferred to cutover because additional foreign keys can make legacy PostgREST `messages (...)` embedding ambiguous. Future queries must name the intended relationship explicitly. Large unique indexes are ordinary transactional builds in the draft; do not assume acceptable lock time/performance for an unknown production database.

Stage 003 blocks if quarantine remains. There is no automatic deletion, default-owner assignment or archive of ambiguous records. A later separately reviewed archive/resolution plan must preserve original IDs, messages and audit evidence. A second business cannot be enabled while this decision is unresolved.

Service-role RLS bypass requires explicit query isolation even after these migrations. The new repository demonstrates business+number predicates, parent ownership checks, whitelist-only inserts and generic foreign/missing responses, but it does not replace all current database helpers. The complete runtime repository, transactional merges, ingest/dispatch and scoped status worker still need implementation/review before activation.

PostgreSQL combines permissive policies with OR, so leaving an unrestricted policy alongside a new membership policy is unsafe; stage 003 refuses unknown policies and removes the known unrestricted ones. Service-role keys bypass RLS. References: [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase function security](https://supabase.com/docs/guides/database/functions).

### Credentials and rotation

Store only a reference to an exact secret version in `repliq_private.whatsapp_credential_versions`; the actual token belongs in an approved external secret manager/KMS with encryption at rest, access audit, restricted server identity and context binding to business/number/version. Never put it in public business JSON, browser responses, Redis history or logs. WABA/app/number ownership must be verified during provisioning, not asserted by the submitting owner. The draft prevents editing a version's binding/reference and allows only one active version per owned number.

Rotation design: owner-authorized operation with step-up identity verification → provision pending immutable vault version → verify token/number/WABA association in a separately approved check → atomically retire the old active row and activate the new one in a transaction with number-row lock → invalidate only that business/number credential cache → monitor/reconcile in-flight operations → revoke old provider credentials after an approved grace period. A rollback may reactivate a still-valid previous version; never reactivate revoked/compromised credentials. Nothing here rotates or provisions secrets.

The inactive helper verifies scope, phone, WABA, status and version before consulting the injected vault, and has no global-token fallback. Its adapters and callback must stay trusted/server-side; it is not an HTTP credential endpoint or a cryptographic vault implementation. Provider ACL/encryption-context verification, provisioning, rotation and audit tooling remain deployment dependencies.

## 4. Admin authorization design

Future request order: secure session verification → active user check → requested business membership lookup → owned-number registry lookup → operation capability check → scoped resource lookup/query → operation → scoped audit/outbox. A browser may select a candidate business/number, but those inputs never grant authority. Resource identifiers are looked up under verified scope; foreign and missing resources return the same result. Payload-supplied scope/sender/user fields are ignored or rejected, not spread into writes.

Roles: viewer reads; agent adds send, takeover and mark-read; manager adds deletion, template/configuration changes and order updates; owner adds membership and credential management. The inactive authorization helper rejects old global `admin` roles, expired sessions, revoked membership, disabled principals/businesses/numbers, forged contexts and prototype-based role values. It requires injected trusted identity/membership/number loaders; there is no working login integration or browser-facing activation flag.

| Existing API | Future authentication/authorization and scope |
| --- | --- |
| `/api/admin/login` GET/POST | Auth-backed identity verification, rate-limited login, new session creation/lookup/revocation; never mint authority from the old shared password |
| `/api/admin/conversations` GET | `read`, business and authorized number predicates on lists/embedded messages |
| `/api/admin/messages` GET | `read`, verify conversation ownership before history query; scoped parent FK |
| `/api/admin/read` POST | `mark_read`, scoped conversation update; current unread-reset response retained |
| `/api/admin/takeover` POST | `takeover`, strict boolean, scoped SQL and Redis state/outbox; avoid global phone lookup |
| `/api/admin/send` POST | `send`, owned conversation + current Meta window + owned credentials, scoped dispatch and message storage; keep current JSON body/results where possible |
| `/api/admin/legacy` and `/api/conversation` actions | Replace query-secret auth with the same session/capabilities: `human/bot/completed`→takeover; `reply`→send; template send→send plus approved scoped template; template listing→read; delete/delete_message→delete |
| `/api/dashboard` GET | `read`, scoped conversation/index traversal and SQL fallback only within the same verified scope |
| `/api/business-config` GET/POST | read / config capability; verified number/business, configuration whitelist; secrets prohibited |
| `/api/orders` GET/POST | read / orders capability; scoped index, recheck order payload ownership and allowed status transition |
| Future media/admin template routes | read or send as appropriate; scoped stored attachment/template, owned WABA credentials; no arbitrary media URL/number supplied by browser |
| Public `/api/lead` | Server-bound public form/domain mapping, isolated lead store, abuse controls/consent; no tenant authority from browser labels and no unverified send routing |
| `/api/webhook` and inbound `/api/conversation` | HMAC bound to registered Meta app, full batch iteration, per-number registry routing and signed-worker context; no user admin token or default tenant fallback |

Membership/credential/config management must be server-only, owner/manager constrained, whitelisted and audited; ordinary members cannot insert their own memberships. Prevent removal of the final active owner in the future provisioning/membership service with an explicit transaction/lock. That service is not implemented by these examples.

Session migration design: use Auth-backed login and a high-entropy opaque BFF session in a `Secure; HttpOnly; SameSite=Lax; Path=/` cookie, ideally a host-only `__Host-` cookie; store only its hash, principal, expiry, CSRF hash and revocation state server-side. Verify identity provider tokens server-side rather than decoding unverified JWT claims. Load current user/membership/role for each request; do not trust embedded browser roles. Short expiry, renewal, logout/revoke-all and explicit cookie deletion need implementation. Mutations require validated Origin plus a session-bound CSRF mechanism; cookie authentication alone is insufficient.

Preserve layout and action bodies while updating browser transport together: remove localStorage persistence, bearer/password fallback, query `key`/`token` secrets and login responses containing session tokens. Existing `admin.js` expects a returned token, so returning only a cookie before changing that client would break login. Both clients and all routes must switch together in a reviewed release. Legacy clients must reauthenticate using the new identity system; do not exchange the old shared secret alone for a tenant-owner session. Once multiple tenants are active, globally authenticated legacy routes cannot remain exposed as a fallback.

The existing single-business admin/auth paths are left untouched until this coordinated release exists. There is no partially enabled tenant auth here.

## 5. Complete Redis migration design

Use `tenantKey(businessId, 'number', whatsappNumberRegistrationId, kind, ...identifiers)` → `rq:v2:{<business-UUID>}:number:<number-registration-UUID>:...`. Unlike the Phase 1A candidate, the hash tag now uses immutable business UUID; the number registration is a further segment. All keys for one business share a cluster slot, permitting scoped Lua/MULTI operations. Normalized customer identifiers preserve BSUIDs and validated phone normalization; the same phone/BSUID in another business or number receives different keys. Kind/segment encoding comes from the existing helper. The new plans are pure and never read/write Redis.

| Legacy keys/readers-writers | Target kind and full migration requirement |
| --- | --- |
| `conv:<customer>` (`saveMessage/getHistory/getConversation/listConversations/deleteMessage/deleteConversation`) | `history:<customer>`; preserve message IDs, ordering, content, sender/type/status/time and all wamids. Migrate every reader/write/delete together. |
| `conv:index` | `conversation-index`, per owned number; no global list/fallback |
| `conv:owner:<customer>` | `owner:<customer>`/registry-derived scope; validate, never use legacy owner alone to grant authority |
| `conv:meta:<customer>` | `meta:<customer>`; scope identity/profile fields |
| `conv:mode`, `conv:takeover` | `mode/takeover:<customer>`; atomically write both, preserve timestamp/remaining TTL; preserve completed state and human-silence semantics |
| `conv:user_map:<bsuid>` and `mergeRedisConversation` | `identity:<bsuid>`; map only to an owned scoped conversation; transactional same-scope merge and alias redirect; forbid cross-number/business merges |
| `msg:phone:<wamid>` and status writer | `receipt:<wamid>` per number; resolve only existing owned message/attachment. No global or recipient-only fallback; atomically update status without rewriting a concurrently changing history list. |
| `msgid:<wamid>` / local Set | `dedup:<wamid>` plus durable scoped inbox processing state/lease; coordinate expiry and retry horizon, do not reset completed dedup during migration |
| `business:<phoneNumberId>` | `config` under registered business/number or verified business-level settings; preserve prompts/notes exactly; credential fields prohibited |
| `templates:approved` | `templates`, verified WABA approval and versions; mixed/unknown custom catalogs quarantine, never copy global catalog to every tenant |
| `order:<id>`, `orders:index`, `orders:business:<phoneNumberId>`, `orders:phone:<customer>` | `order:<id>`, `order-index`, `customer-orders:<customer>`; preserve IDs/status/timestamps, validate owned order payload on every index read/write |
| Signed inbound media IDs / temporary URLs | `media:<id>` ownership record with scoped message provenance; re-resolve expired URLs with owned credentials, not another business's cache |
| Notification and provider work | Durable business/number-scoped inbox/outbox IDs and delivery records; notification recipient selected from verified business settings |

Required operational sequence, not executed:

1. Approve ownership sources, provider-supported backup/export capability and a restore exercise in an isolated Redis instance. Preserve every Redis type/value/order and remaining TTL, SQL snapshot, source generation/time and checksums. Store exports encrypted with limited access, not in Git or logs. Use cursor-based inventory, not a blocking global `KEYS` scan. No scanner or migrator runs in this phase.
2. Freeze writers/async sends under the release plan; buffer authenticated webhooks durably. Pausing only the UI is insufficient: both webhook implementations, public leads, admin/manual sends, merge/status jobs and notifications can write. Do not acknowledge-and-discard events. A durable buffer/replay worker does not yet exist and must be completed before rollout.
3. Inventory all listed key families and SQL relationships. Explicitly identify source keys already mixing multiple businesses. A single current owner, matching phone, last message, or WABA label does not prove full-history ownership. Never split mixed content by guessing.
4. Review a manifest matching `phase-1b-redis-manifest.schema.json`: batch, backup hash, freeze/review info; each source key/type/hash/observed TTL; evidence reference; explicit approved business/number; target key/hash and copy decision. Quarantine entries contain no destination/assigned owner. Manifest creation does not itself authorize copying. Operational manifests can include customer identifiers and must stay outside the repository. JSON Schema checks shape only; future tooling must also verify registry ownership, key derivation, source/target hashes, unique destinations, coverage and reviewer authorization.
5. Copy into an empty staged v2 namespace via a separately reviewed idempotent migrator. Verify source checksums at copy time and use conditional creation/transaction checks so retries cannot overwrite existing targets. Retain all legacy keys. Recompute TTL from absolute expiry rather than resetting its lifetime; permanent keys stay permanent. Expired source keys are recorded as expired rather than recreated. Index membership and receipt/map targets must all agree with approved rows. Quarantine remains accessible only to restricted operators.
6. Validate source/target counts, complete index coverage, hashes, message ordering, identity targets, takeover timestamps/TTL, order IDs, template ownership, receipt provenance and retry/dedup retention. Reconcile SQL↔Redis differences explicitly, never use a global history as a tenant fallback. Block cutover on missing/mixed/unassigned records or inconsistent manifests.
7. Switch all scoped readers and writers together only with auth and database readiness; resume buffered events through idempotent scoped workers and monitor. Keep legacy backups read-only for rollback retention. New foundation command plans are **not** a production Redis adapter: multi-key takeover plans require atomic execution, receipt/status mutation, identity merges, delete, order/template writes, full index traversal and durable workers still need implementation and concurrency tests.

No cross-version dual-read fallback is allowed. During preparation, old production remains wholly legacy/single-business. After cutover, missing v2 data is missing/quarantined, never permission to query a customer-only legacy key. Future business-wide keys (for example billing quota) may use the same business tag without the number segment; the 1,000/12 limits remain a separate approved phase.

## 6. Compatibility risks

- Stage 003 breaks all unscoped writers by design; this is a coordinated schema/auth/application release, not a standalone SQL patch. Current handlers do not supply scope fields or tenant predicates.
- PostgREST relation ambiguity and changed unique-conflict targets require new explicit relationships/upsert targets. Preserve existing UUID-based API bodies and response fields, but update backend queries atomically.
- Public/browser login contract changes need coordinated JavaScript transport updates while preserving layout. Old query secrets/global tokens cannot retain multi-business access for compatibility.
- Public lead, templates, orders, voice/media, notifications, takeover TTL, completed state and message receipt flows must all participate. A release that migrates only inbox reads is unsafe.
- Quarantined histories block cutover until an explicit preservation/resolution plan is approved. No assumption that all legacy data belongs to the environment's default number is acceptable.
- Membership changes must be checked per request; an issued in-process context is only for one request and is not reusable across requests or serializable. Never cache it beyond that request. Webhook workers need a separate signed event provenance flow, not fabricated user contexts.
- Existing Phase 1A remains the only active compatibility layer. Changing branch or adding inactive helpers does not make the application multi-tenant-ready.

## 7. Tests and actual results

`npm test`: **105 passed, 0 failed, 9 files**. This includes all **87 Phase 1A tests** and **18 new foundation tests**. All external service access is mocked; the existing preloaded fetch guard rejects unmocked calls. No real customer records, tokens, messages, DB operations or provider sends were used.

New tests cover authentication failure/expiry; revoked memberships/disabled principals; forged/prototype contexts and role escalation; foreign business/number selection; scoped service-role lists/history/takeover/inserts/receipt lookups; identical customer/BSUID/wamid/order IDs across scope; number scope within one business; no legacy-history fallback; scoped Redis takeover/template/order/identity/receipt plans; credential scope/version checks before vault access; legacy single-business credential behavior; production import boundary; and SQL approval guards/security structure.

An intermediate static test rejected the valid `BEGIN READ ONLY` form in the verification draft; its transaction check was corrected. No test failures remain.

New SQL/manifest validation is static. No PostgreSQL, `psql`, or Docker tooling is available locally; **no SQL was executed and no database-level RLS/FK/DDL test is claimed**. Node tests of injected loaders/mock queries cannot prove real RLS or live service-role behavior. The SQL README lists required disposable Supabase tests, including real-role A/B/anon access, constraint/immutability failures, snapshots, policy ACLs, PostgREST relations and rollback. Those are unresolved rollout gates.

JavaScript syntax checks and `git diff --check` pass. Existing runtime/frontend files have no diff from Phase 1A; no production import reaches `lib/foundation`. The manifest schema parses as JSON; it is a design artifact, with no migration executor or operational manifest attached.

## 8. Exact future production rollout order

Every production action below requires separate explicit approval. This list is a plan, not work performed or authorization inferred from this task.

1. Finish/review the complete scoped runtime adapters, identity/session login and revocation, frontend transport, CSRF/abuse controls, webhook batch routing with app-bound signatures, durable inbox/outbox/replay, tenant credentials and notification routing. Current isolated examples cannot be enabled as substitutes. Finalize counting/quotas separately; keep them off.
2. Obtain approval for a restricted production **read-only** schema/policy/key/ownership inventory and backup/export, plus exact provisioned business/user/number evidence. Compare actual catalog/schema to drafts and review any drift. Verify restored SQL/Redis backups in a disposable environment.
3. Rehearse the full migration and auth release against synthetic data with the real database engine and provider mocks. Validate all required RLS/FK/ownership, API/UI/media/template/order/lead/notification tests and rollback boundaries. Plan lock/index/batch timing using measured sizes.
4. Review/approve the final migration files, provisioning and ownership manifests, secret-manager setup, session/CSRF transport, complete application release and rollback runbook. Do not change deployment/production environment until that approval explicitly covers it.
5. Apply approved additive 001 only, after backup and schema check; provision verified business/Auth user/membership/number records and pending credential references via approved server tooling. Keep original business production paths intact and second-business onboarding disabled. Test the effect of added catalog relationships before continuing.
6. Stage the complete future release behind routing controls that cannot expose half-migrated paths. This staging/deployment itself requires authorization. Keep old paths active only for the original single business; do not accept a second tenant yet.
7. Start the approved maintenance window: pause every writer/provider-dispatch job, durably buffer signed webhooks, restrict public lead mutation appropriately, drain in-flight sends and refresh frozen SQL/Redis backups and fingerprints. Do not blindly retry unknown provider sends.
8. Review final inventory/manifests. Apply 002 only to proven ownership; copy Redis via the reviewed idempotent migrator. Quarantine ambiguity without assignment. Compare all data, IDs, counts/hashes/TTL/indices and ownership links. Abort/resume legacy safely if any record is unresolved; do not proceed to 003.
9. Apply approved 003 in the cutover window while writes remain paused. Run database verification and actual-role tests. Activate all scoped API/auth/Redis/credential/notification paths as one release, including browser transport and legacy route authorization; old global-secret routes must become unreachable. Do not enable production on the basis of these prototype modules alone.
10. Validate the original business end-to-end through mocks/rehearsal and approved production smoke procedures, then replay buffered events once under scoped idempotency and resume writers. Monitor denial rates, silence/takeover, data ownership and receipt/outbox reconciliation. No smoke sends or customer-data access are authorized by this preparation task.
11. Only after the original business is stable and rollback evidence is accepted, explicitly approve a synthetic second-business canary/onboarding. Keep data isolation checks in place. Retain legacy backups read-only for the approved retention period; cleanup/deletion or old credential revocation is separately approved. Commercial quotas remain off until independently reviewed/approved.

## 9. Rollback procedure

**Preparation only (current state):** no deployed behavior or data changed; no SQL/Redis rollback is needed. Keep Phase 1A commit/branch intact. Review or discard the new preparation files only by a deliberate local change; no automatic cleanup is performed here.

**After 001, before cutover:** original code still runs against the original columns/constraints. Leave additive tables/columns, registries, credentials and manifests intact; do not drop them to restore old behavior. Stop preparation, preserve audit records and resume original single-business operations after consistency checks. If 002 assignments must be reversed, use the reviewed batch-specific rollback draft only while writers are paused and the original snapshots/scopes are verified. It refuses post-003 use; it nulls assignment columns only and never deletes customer rows or changes UUIDs/parents. It is not an automatic backup restore.

**Redis copy before activation:** legacy keys remain untouched. Resume the old single-business writer only after cancelling the staged cutover and reconciling/draining buffered/in-flight work. Leave staged v2 data quarantined/read-only for review; do not delete/reset either store. A future retry must reconcile destinations, not overwrite them.

**After 003 / scoped writes:** prefer forward repair or the last known-good **scoped** application version. Do not restore the old globally authorized runtime, public-read policies, global Redis fallback, or global uniqueness. Two tenants can now validly share customer/wamid values, so an automatic schema down-migration is unsafe. Keep all writers paused, preserve both snapshots and event/send journal, and reconcile owned data before replay. If a full restore is necessary, restore reviewed paired SQL/Redis snapshots plus registry/manifests/session state to an isolated recovery environment, reconcile post-snapshot events and unknown sends, and obtain a new recovery approval. Do not replay a message that may already have been accepted by Meta.

Maintain the stricter RLS/credential/session boundaries through recovery. Session invalidation, changing credential pointers or provider revocation needs an explicitly approved security recovery operation. No such action was performed.

## 10. Changes requiring explicit approval and outstanding work

Required approvals: any production inventory/data access; applying any draft SQL or provisioning manifest; ownership assignment/quarantine disposition; Redis export/copy/restore; identity/auth/frontend-transport cutover; secret-manager provisioning/token changes; deployments/routing/environment changes; production smoke sends; second-business onboarding; backup/data cleanup; and quota activation. No approval is currently pending for the isolated preparation requested here.

Outstanding before activation: database engine rehearsal and schema drift review; complete scoped runtime replacement for **every** audited path; real session/Auth provider adapters and CSRF; owner/membership management and last-owner protection; verified secret-manager/context-binding/rotation service; webhook app routing and full batch iteration; scoped atomic identity merges, takeover and receipt/order/template writes; durable inbox/outbox/replay and fail-closed recovery; public lead abuse/consent routing; per-business notification destinations; proof of manifest completeness and coordinated rollback under production-like concurrency. No activation switch or partially migrated authentication was added.

The new code is a testable foundation and design boundary, not a claim of operational multi-tenant readiness. Existing functionality remains on the committed Phase 1A implementation until the coordinated migration and application rollout are separately reviewed and approved.
