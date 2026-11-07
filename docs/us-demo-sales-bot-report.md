# US demo / sales bot preparation

**NO-GO for activation.** The implementation is committed for review only and defaults to the original behavior. No real demo number, current Redis configuration, account ownership, deployed environment or storage isolation has been verified. Do not enable it on the existing production deployment without a separate explicit approval and the checks below. No production values/settings/data were accessed or changed; no push, merge, deploy, SQL or tenant migration occurred.

## Scope and exact existing behavior

Isolated worktree `/tmp/repliq-us-demo-sales-bot`, branch `feature/us-demo-sales-bot`, based on `release/us-launch-readiness` commit `93d39329f6f1fa0f3e8081ba2b9d50569dd62102`. Original branches/worktrees and uncommitted Phase 1B files are preserved.

Inspected `lib/ai.js`, both incoming handlers, raw-body HMAC authentication, `api/business-config.js`, Redis configuration/history/owner/identity/takeover helpers, WhatsApp credential resolver, reviewed US draft, Phase 1B isolation tests, admin service fixtures and real-runtime test runner. This was a source-code audit, not an inventory of production Redis values.

Before this change:

- Both handlers authenticate Meta POSTs using the original bytes and app secret, then check a supplied receiving `metadata.phone_number_id` against the existing single-business credential resolver.
- `/api/webhook` derives its processing number from signed metadata, or falls back to configured `WHATSAPP_PHONE_NUMBER_ID` / `DEFAULT_PHONE_NUMBER_ID`. `/api/conversation` expects the receiving metadata number directly. This legacy difference remains when the feature is inactive.
- Both read `GET business:<phoneNumberId>` through `getBusinessConfig()`. A truthy `systemPrompt` takes precedence, with notes appended exactly as `\n\nNotes / idées spécifiques du projet :\n...`. Otherwise they pass `undefined` to `generateReply()`, whose `systemPrompt || DEFAULT_SYSTEM_PROMPT` selects the legacy Moroccan offer. A failed business configuration read also uses that default.
- The shared-secret authenticated configuration API can save a complete business config for the configured canonical number. It is not tenant membership or proof that a number is RepliQ's own US sales number. It is unchanged here.
- Redis history, owner and takeover keys are customer-scoped. `getConversationOwner()` can fall back to `DEFAULT_PHONE_NUMBER_ID`; history/BSUID mappings can likewise use legacy unscoped storage. These are not safe ownership proofs for activating a second tenant.

## Implementation and modified files

- `lib/business-prompt.js` (new): shared selector and enabled-only inbound scope guard. Both use only server environment and exact post-HMAC number metadata. There is no public selection API or browser-controlled activation input.
- `api/webhook.js`, `api/conversation.js`: pass the authenticated receiving-number field separately from any legacy default; invoke the same scope guard before dedup/takeover/voice/history/persistence and the same prompt selector at the former config lookup point.
- `lib/us-sales-prompt.js` (new): shared server offer-text builder and version `repliq-pro-us-sales-v1`. Text is extracted from the reviewed draft, without changing its terms. Public constants supply $99/month + $99 one-time setup USD, English/Spanish/French, intended 1,000 outbound replies/billing period and 12 AI replies/customer/rolling 24 hours, explicitly not enforced. It identifies RepliQ software sales, not a charter operator's guest receptionist, and prohibits invented checkout, appointments, charter confirmations, payment links or live inventory.
- `lib/foundation/us-sales-prompt-draft.js`: offline draft wrapper now references that shared text. Its unapproved status remains false; production does not import foundation code. Phase 1B auth/storage/credential helpers remain unreachable.
- `tests/us-demo-sales-bot.test.js` (new): enabled/inactive behavior through both signed ingress handlers and direct boundary tests.
- `tests/admin-service-fixtures.js`, `tests/vercel-runtime-mocks.js`, `scripts/verify-vercel-runtime.mjs`: extend synthetic fixtures with EXISTS, actual runtime enabled-path probes and a mocked AI reply. Probe IPC reports booleans only; no prompt, identifier or credential is emitted.
- `docs/us-demo-sales-bot-report.md`: this report.

No changes to `lib/ai.js`, provider/fallback logic, raw-body signature implementation, WhatsApp credential resolver, actual Redis/Supabase helpers or schema, configuration/admin endpoints, dashboard, public website/pricing, dependency files or Vercel rewrites. No quotas or Phase 1B runtime paths activated.

## Activation control and prompt precedence

New environment variable **names**, neither set in any real environment by this task:

1. `REPLIQ_US_DEMO_SALES_ENABLED`: absent, empty or exact `false` means inactive. Only exact `true` permits consideration. Other nonempty values stop the requested path rather than silently enabling or guessing.
2. `REPLIQ_US_DEMO_SALES_BINDING`: server-controlled JSON review binding. It must contain exact `purpose: repliq-us-demo-sales`, a canonical numeric `phoneNumberId` string, `promptVersion: repliq-pro-us-sales-v1`, nonempty bounded `ownershipReview` and `isolationReview` references, and exact `storageMode: isolated-redis-only`.

A review reference is an operator attestation backed by an external reviewed inventory, **not a runtime proof of Meta ownership**. It must never be populated from a form, customer message, language, country code, webhook display name or admin-supplied number. Configuration access itself must be controlled by the deployment owner. The binding has no credentials and is never returned by an API.

When requested, the exact signed receiving ID must equal the binding ID, processing ID, and existing single-business credential resolver's canonical number. Missing metadata cannot inherit the configured default. Wrong/missing binding, unsupported version/purpose/storage, unknown number or configuration problems stop automatic processing with a sanitized log. The webhook can still ACK an authenticated event with HTTP 200 before background processing is stopped; an ACK is not proof of an AI response.

The enabled guard refuses any nonempty `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`: existing Supabase histories are not tenant-scoped. It also requires available Redis and inspects only exact owner/mapping keys and key existence for the customer's canonical phone/BSUID identities. It does not call the legacy default-owner helper or read history as a fallback. Foreign owner, unowned existing history/takeover/metadata, or an alias pointing outside the verified identity set stops processing before legacy writers can replace ownership or fetch that history. A fresh identity with no existing keys can proceed; a known identity must have matching ownership. This is a defense for a verified isolated store, **not a full migration, concurrent cross-tenant lock or substitute for Phase 1B**.

After those checks, a stored business prompt plus its notes **always wins**, unchanged. The US prompt is selected only after a successful config lookup returning `null`. Notes-only/empty/malformed existing config is not silently overridden. Config read failure while enabled stops, rather than guessing the default or US offer. While inactive, the exact old business-prompt/notes/default/error-fallback behavior is retained, without the new owner/EXISTS lookups.

The selector does not rewrite, clear or migrate previous conversation messages. Approved own-number history still supplies context; historical offers may exist there. Tests prove which system instruction reaches the mocked provider, not that a probabilistic real model can never hallucinate. Human takeover, existing AI-failure handoff, voice transcription, message splitting and provider fallback remain the existing implementation. Some operational/handoff messages remain French; this change does not translate customer-specific behavior.

## Ownership and compatibility verification required before any activation

Authorized owner review must establish, without disclosing tokens:

1. The exact WhatsApp **phone-number ID** in the appropriate Meta account belongs to RepliQ and is exclusively assigned to its sales/demo purpose; it is not a charter customer's number. Confirm the existing app/webhook and configured canonical sender agree. HMAC authenticity alone does not establish that purpose.
2. Inventory the actual `business:<id>` config, owner/mapping/history/takeover records and all data readers/writers through a separately approved read-only process. Preserve private backups and a review manifest. This task did not read them. Do not infer ownership from phone prefix, prospect language or the public form's offer.
3. Confirm no existing Moroccan customer's service or existing contract depends on this number's default behavior. An active US default could change what a returning Moroccan prospect hears even though old history is retained. If purposes/customers are mixed, do not activate on that number. Retain existing prompts/contracts and use a separately approved isolated sales channel or finish the tenant/offer routing design.
4. Verify a dedicated Redis-only storage boundary and administrator/notification recipient ownership. Known explicit owner values can themselves be stale from legacy writes; review references do not repair that. No concurrent legacy deployment may write another business into the store. Do not clear existing keys, manufacture ownership, or disable production Supabase to satisfy a flag. If existing dashboard/storage depends on Supabase or any shared tenant data, activation remains blocked pending a separate coordinated solution.
5. A business-specific prompt deliberately prevents US substitution. Do not delete or overwrite it to force activation. If it is RepliQ's own reviewed sales config and should change, propose a separately approved versioned per-account migration with a backup; never change another customer's config.
6. Approve pricing, platform-fee explanations, privacy/contact details and escalation handling; re-use the existing lead form for demo/setup inquiries without claiming a calendar/payment integration. Changing the commercial offer requires a new prompt-version review.

**Safe current alternative:** leave the feature unset and have RepliQ's team explain the public USD offer through the existing inquiry follow-up flow. This implementation alone is not authorization to reuse the number, move its webhook, provision another deployment with its credentials, or onboard another tenant.

## Safe isolated Preview test plan

No hosted Preview was accessed or deployed during this task. Use an explicitly approved Preview with service mocks and synthetic-only IDs/secrets/stores, never production Redis/Supabase/Meta/Resend. Preserve Preview protection; if blocked, report it rather than bypassing it. Do not subscribe Meta, use real phones or send real WhatsApp messages.

- Start with both new variables absent. Run legacy regression tests and confirm Moroccan defaults/custom prompts and exact seven admin rewrite paths remain intact.
- In test worker configuration only, use synthetic canonical number `1001` and a binding with matching synthetic ownership/isolation review references, exact version/purpose/storage mode, exact enable value `true`, isolated mock Redis and no Supabase configuration. Local runtime script does this without inheriting real credentials. Any future hosted equivalent needs external service adapters/mocks under explicit review; never expose the local fixture preload as a public endpoint.
- POST correctly signed synthetic raw bytes to both `/api/webhook` and `/api/conversation`; assert identical exact US system text, mocked reply and sender scope. Include Unicode/whitespace and voice transcription fixtures. Inspect sanitized test probes, not customer payload logs.
- Repeat with a stored custom legacy prompt/notes; verify that exact configuration wins, existing messages remain and no business-config SET occurs. Test absent config, notes-only config, storage/config failure, unknown number, missing metadata, forged signature, forged browser/locale hints, unowned/foreign history and BSUID aliases. Blocked cases must not call AI or send, and foreign history must not be read or rewritten.
- Verify human takeover suppresses AI/transcription/replies, provider failure triggers existing human handoff, Gemini fallback receives the same US prompt, and GET challenge/signature/admin security tests still pass. Never interpret HTTP 200 ACK as successful background processing.
- Use a real model only later in an approved isolated evaluation with synthetic inputs and a mocked message sender; evaluate multilingual pricing, old-price/history injection and hallucinations before approving a sales activation. No real model was called here.

## Executed validation

- `npm test`: **176 passed, 0 failed, 0 skipped**, all **13/13 files**. Includes all 145 release-baseline tests plus 31 new US demo cases. Existing Phase 1A signatures/GET/auth/manual/template/media/status regressions and inactive Phase 1B tenant tests pass. New cases cover both handlers, exact USD prompt, custom precedence/history preservation, inactive Moroccan default and config-error behavior, signed-number binding/missing metadata, browser hints, takeover, voice, Gemini fallback, AI-failure handoff, foreign/unowned history, BSUID mapping and unavailable storage. External fetch is mocked and unexpected requests are rejected.
- `npm run check:functions`: **7 before / 7 after**, unchanged `admin`, `business-config`, `conversation`, `dashboard`, `lead`, `orders`, `webhook` entry points and existing admin rewrites; below Hobby maximum 12.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **45 real-runtime HTTP response checks passed**, using local `@vercel/node` 30.0.0 and routing-utils 6.6.1. The existing 41 checks remain; four added HTTP checks exercise unsigned rejection and valid signed enabled input for both handlers. Boolean probes additionally confirm exact US system prompt and canonical mocked sender through each actual Node handler. Worker environments use explicit synthetic fixtures, with no inherited real service credentials.
- `node --check`: **61 JavaScript/MJS files passed**. `git diff --check` passed. Protected AI/provider/security/credentials/stores/configuration/admin/dashboard/public/dependency/Vercel/SQL paths remain unchanged against `93d3932`; the two ingress integration changes are listed above. Shared prompt text was checked against the baseline draft.
- Preservation check: all **five source-worktree HEADs and 26 inventoried uncommitted files** remain unchanged; Phase 1B source work stays intact. No merge/conflict introduced.

No failing tests remain. No browser or hosted Preview checks were run in this backend-only task; the release-readiness report's prior UI evidence is historical. No real model evaluation, WhatsApp delivery, Meta ownership verification or production database/configuration inventory was performed. Mocked model output is not proof of deterministic real-model behavior.

## Rollback

Activation was not performed, so no configuration or data rollback is required now. Before any future approval, record the old deployment artifact and exact server settings privately. To stop a future US selection, remove the new enable variable or set exact `false` through an approved release; ensure old instances drain before claiming rollback. This restores stored-prompt precedence and legacy default behavior; it does not change history or the number's credentials.

For a code regression, redeploy the previously recorded approved artifact or prepare a reviewed revert of this branch's commit; code baseline is `93d3932`, not a claim that it is the current production artifact. Both versions have seven functions and retain HMAC authentication. Do not disable signature verification, clear Redis, restore over customer conversations, remove business prompts, rotate credentials, execute SQL or change Meta configuration as a shortcut. The extracted draft text remains unchanged and inactive in the baseline.

**GO for local review / explicitly approved isolated testing only. NO-GO for activation or production release** until ownership, existing-customer compatibility, storage isolation, actual config precedence, evaluation and rollout/rollback approval are independently established. No incomplete multi-tenancy or quota mechanism is enabled by this work.
