# US launch release readiness

Recommendation: **NO-GO for production US launch.** Local code is ready for review and an explicitly approved, isolated Preview. Sales-number ownership and data isolation are unverified; the English privacy notice is an unapproved draft; no hosted smoke test was performed. These are release gates, not reasons to change existing Moroccan customer behavior.

## Scope and preservation

Branch `release/us-launch-readiness`, isolated worktree `/tmp/repliq-us-launch-readiness`, parent `feature/us-website-pricing` commit `3f739253dd9f36a2127e884df397aabf6e91f90d`. Existing worktrees and uncommitted Phase 1B files are preserved; their initial HEADs and untracked-file hashes were inventoried separately for verification. No clone/fetch, production access, SQL execution, deployment, push, main merge, credential change or Redis update occurred.

Inspected public landing/form/JS/styles, acknowledgement and PDF generation, privacy policy, `lib/ai.js`, both webhook handlers, business-configuration reader/writer/API, Redis and Supabase helpers/schema, WhatsApp credential resolver, notifications/orders, dashboards/admin handlers, Phase 1A/1B reports and foundation, Vercel routing/count checks, runtime/browser scripts and all test files. Current Redis-backed configuration **code paths** were inspected; actual stored configurations and production provider settings were not accessed and remain unknown.

Files modified/added:

- `index.html`: link the English draft privacy notice; pricing/CTA behavior retained.
- `formulaire.html`: USD offer metadata, consent privacy link and accurate notification feature wording.
- `public-offer.js`: replace “booking-intent notifications” with “team notifications”, matching the implemented capability without claiming universal booking-intent detection. Canonical prices and intended limits unchanged; acknowledgement and PDF consume these constants.
- `privacy-en.html`: separate English, noindex, visibly unapproved draft. French `privacy.html` remains byte-identical and accessible.
- `lib/foundation/us-sales-prompt-draft.js`: canonical, frozen, explicitly unapproved US sales prompt artifact; not imported by any production path.
- `tests/us-launch-readiness.test.js`: draft terms/status, explicit prompt selection and legacy Redis configuration/default compatibility, privacy/metadata checks.
- `scripts/verify-us-website.mjs`: English/French privacy checks, keyboard FAQ, new artifact directory, explicit navigation wait.
- `docs/us-launch-release-checklist.md`: this review and release gates.

## Sales pricing audit and safe separation

Before and after: the live default prompt in `lib/ai.js` retains Moroccan tiers (200/400/800 MAD monthly; 400/600/1,000 MAD setup), legacy promotional/loyalty rules and customer compatibility. Custom `business:<phoneNumberId>` system prompts/notes still take precedence in both ingress handlers. No existing configuration, AI provider, dashboard currency or prompt was rewritten. Historical order displays still use MAD; relabeling these would misstate existing values.

The offline US draft covers RepliQ Pro $99/month plus $99 one-time setup (USD), English/Spanish/French, intended 1,000 outbound replies/billing period and 12 AI replies/customer/rolling 24 hours, explicitly **not enforced**. It distinguishes RepliQ software sales from an operator's charter guest assistant, prohibits invented checkout/calendar/payment/charter confirmations, and leaves message counting/platform fees for confirmation. Tests verify prompt inputs, not a real model's adherence.

**Do not activate this draft** by global default replacement, browser offer/locale, or a user-selected number. Existing number settings cannot establish exclusive RepliQ US sales ownership. Legacy Redis conversation/owner/takeover keys can collide by customer; shared admin authentication and notification recipients are not tenant membership authorization. Returning US prospects could also encounter the legacy prompt via the existing shared contact number. A new prompt alone does not solve this.

Safe interim path: use the existing form for a clearly labelled demo/setup inquiry and have the team explain the approved USD offer manually after verifying the recipient/account. A form submission already attempts an acknowledgement through the existing configured number; do not treat it as an isolated sales channel or activate it on a production-backed Preview for testing. Do not claim end-to-end US bot consistency yet.

Before a live US assistant: manually verify ownership and exclusive purpose of a dedicated RepliQ sales WhatsApp number, approved recipient and business identity; inventory settings without guessing ownership; obtain approval for either a separate deployment with dedicated credentials/data stores/admin boundary, or completed and reviewed tenant isolation/authentication. Then use an immutable server-owned purpose/number/offer binding, versioned approved prompt, no foreign credential/history fallback, synthetic regression and a reversible controlled activation. Back up affected configuration and define exact per-account rollback first. Phase 1B remains inactive. No new runtime feature flag or environment variable is introduced here.

## English privacy factual review

The draft describes supported flows, conditionally rather than claiming production settings:

| Claim | Code evidence / limits |
| --- | --- |
| Form name, business/type, WhatsApp, email, consent, optional volume/message, reference/intent | `formulaire.html`, `signup.js`, `lib/public-pro-lead.js`; stored as inquiry history, not a subscription/payment |
| WhatsApp identifiers/text/status, voice transcription, history/context, manual takeover | `api/webhook.js`, `api/conversation.js`, `lib/db.js`, `lib/whatsapp.js`, `lib/ai.js`; nontext events can be descriptions rather than retained media |
| Redis history/settings, optional Supabase conversation/message state | `lib/db.js`, `lib/supabase.js`; deployed settings unverified |
| Meta, Vercel, Upstash; optional Supabase/Groq/Gemini/Resend | messaging, storage, AI and notification helpers; email notifications can include contact and conversation text |
| Fonts/CDN/PDF, links, admin storage | public HTML, `signup.js`, `admin.js`; Google Fonts/cdnjs requests, browser-generated jsPDF, external WhatsApp/Instagram; admin cookie and localStorage token |
| No known global retention duration or universal automatic deletion | recent Redis history is trimmed to 30 messages and some technical keys expire; this is not a full retention policy. `deleteConversation` is not erasure across all stores/providers/email/backups |
| Privacy contact | existing French policy lists `hamzaraddi92@gmail.com`; owner must confirm monitoring and scope |

Owner/legal review is required **before publication**: legal business/controller identity and operator responsibilities; monitored contact; actual enabled providers, recipients, account agreements/settings and any international processing; retention/deletion procedure and identity verification; applicable notices/rights, resource/cookie/analytics disclosure and commercial/consent wording. No office, jurisdiction compliance certification, provider training/retention guarantee, data region or retention duration was invented. Source code cannot establish those facts. The French policy's security/no-sale/no-advertising/deletion claims also require business verification; preserving it is not an endorsement of those claims. No analytics initialization was found in the inspected public code, but that does not prove hosting analytics/logging are disabled.

The English page is explicitly an unapproved draft with no effective publication date and `noindex`; that is **not** a publication approval or access restriction. Footer/consent links are prepared for review; remove the draft label only after approval of the actual text and release. Keep the French URL available and reconcile both versions through an approved policy revision.

## Verification results

- `npm test`: **145 tests passed, 0 failed, 0 skipped**, all **12/12 files**. Includes legacy MAD pricing, US canonical offer, lead consent/validation/acknowledgement/receipt/PDF logic, raw HMAC signatures, GET verification, authorization, manual/template sends, voice/media, statuses, takeover fail-safe, legacy admin behavior and inactive tenant ownership/history/receipt/template/order isolation. Three new release cases added to 142 existing tests. External services mocked; unmocked fetch blocked.
- `npm run check:functions`: **7 → 7** Node functions: `admin`, `business-config`, `conversation`, `dashboard`, `lead`, `orders`, `webhook`. `vercel.json` and all seven existing admin rewrite paths unchanged; budget 12.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **41 real-runtime HTTP response checks passed**, actual local `@vercel/node` 30.0.0 and routing-utils 6.6.1, synthetic worker environment, external services mocked. Includes admin rewrites/authentication/methods, raw signature ingress and lead validation. No hosted runtime claim.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/repliq-browsers node scripts/verify-us-website.mjs /tmp/repliq-ui-tools`: **PASS** at desktop 1440×1000 and mobile 390×844. Both CTA intents, keyboard FAQ, English/French privacy, no horizontal overflow, reduced-motion demo, consent/international phone validation, intercepted successful/failed submissions, escaped summary and actual jsPDF 2.5.1 downloads passed with zero page errors. Mobile privacy/form screenshots were visually reviewed. All remote resource requests were intercepted; artifacts: `/tmp/repliq-us-launch-review/`.
- `node --check`: **58 JavaScript/MJS files passed**. `git diff --check` passed. Protected API/AI/store/security/dashboard/French policy/dependency/SQL paths are unchanged against `3f73925`. All four existing source-worktree HEADs and all 26 inventoried uncommitted files passed SHA256 preservation checks. No conflict markers or merge operation introduced.

The first browser run failed in the test harness because it inspected form DOM before navigation completed. The harness now waits for the form URL and null-checks readiness. This did not require changing the application flow. No real WhatsApp delivery, external CDN availability, hosted deployment or real AI generation was tested.

## Hosted Preview smoke test (not executed)

Only after approval, use a Preview whose service connections are **synthetic and isolated**. Do not reuse production Redis/Supabase/Meta/Resend keys or customer identifiers. If Preview protection blocks access, report it; do not bypass it. A normal lead submission stores history and may send WhatsApp/email, so never submit a fake phone to a production-connected Preview. Browser-intercept `/api/lead` for UI-only tests, or configure approved service mocks in a separate isolated environment.

1. Record release commit, Preview protection and build logs. Confirm exactly seven functions and the seven admin rewrites. Read logs only with authorization and redact message bodies/identifiers/secrets.
2. GET `/`, `/formulaire.html`, `/privacy-en.html`, `/privacy.html`, `/styles.css`, `/signup.js`, `/marketing.js`, `/public-offer.js`; expect 200 and intended content/MIME. Check desktop/mobile, keyboard focus/FAQ, reduced motion, links, $99/$99 copy, all intended/unforced-limit disclaimers and draft status. French policy remains reachable.
3. GET existing `/api/admin/login`, `/api/admin/conversations`, `/api/admin/messages` unauthenticated: expect 401. GET `/api/admin/read`, `/api/admin/send`, `/api/admin/takeover`, `/api/admin/legacy`: expect 405; unauthenticated supported POST requests should return 401 before services. Do not attempt login with real credentials or perform authenticated live mutations. Unknown admin routes should reject; changing query selectors must not select another handler.
4. GET `/api/webhook?hub.mode=subscribe&hub.verify_token=synthetic-invalid&hub.challenge=release-fixture` expects 403; missing/invalid verification input must not succeed. Verify a positive challenge only in an isolated environment with a synthetic verification token. Never read/change the production token or Meta configuration. Unsigned POST ingress must reject; positive signature/media/status/takeover checks belong in mocked runtime tests or approved isolated service fixtures, never real customer traffic.
5. With browser interception, use `Fixture Charter`/`fixture@example.invalid` and non-deliverable synthetic phone fixtures; verify both CTAs' demo/setup intent, required consent, international format validation, rejection of old price/query overrides, escaped summary, $99/month/$99 setup PDF and failed-request UI. Confirm no calendar/payment/subscription claim. Do not mistake HTTP acknowledgement for message delivery.
6. Exercise mock-backed legacy Moroccan and US prompt scenarios, authorization, takeover and status updates; verify no tenant changes/quotas enabled. Check errors sanitized. Record evidence and stop on any regression before requesting production approval.

## Production prerequisites and outstanding risks

- Verified sales-number purpose/ownership, recipient ownership and data isolation; approved sales routing design. Existing +212 public contact links remain unchanged; no US number or office invented.
- Owner/legal approval of English/French policies and contact/retention/deletion/provider facts; approved pricing scope, platform fees, contact consent and intended commercial usage definitions. Limits remain off; no overage billing or counter-based takeover promise.
- Approved isolated hosted Preview smoke tests and deployment build confirmation. Local runtime package versions are test tools, not proof of the deployed runtime/build configuration.
- Existing public lead endpoint has no new anti-abuse/rate controls; contact consent is not authentication, and shared legacy storage can collide. Review abuse protection before promoting US acquisition volume. Do not fix this by secretly enforcing the commercial quotas.
- Phase 1B service-role/RLS/auth/Redis/credential rollout remains a separate coordinated approval; source schema alone cannot prove current database policies. Do not onboard a second tenant on the inactive foundation. Existing browser dashboard token storage/query-secret migration issues remain documented Phase 1B work.
- Existing environment **names only**, maintained unchanged by this task: `META_APP_SECRET`, `VERIFY_TOKEN`, `DASHBOARD_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `DEFAULT_PHONE_NUMBER_ID`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; optional `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `PRIMARY_AI_PROVIDER`, `GEMINI_API_KEY`, `GROQ_FALLBACK_MODEL`, `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `NOTIFY_EMAIL_TO`, template settings. Deployment owner must verify existing required configuration and configured-number consistency without exposing values. No new variables required. Do not copy production values into Preview or rotate them for this change.

## Deployment / rollback checklist — explicit approval still required

1. Resolve release gates above; review this branch and exact diff against `3f73925`. Obtain explicit production release approval. Do not execute review SQL or activate foundation/quota code as part of this website release.
2. Preserve current deployment identifier/artifact, settings and privately controlled rollback/configuration backups through the owner's approved process. Verify previous artifact also has seven functions and required signature security. Keep existing WhatsApp URLs/tokens/number configuration unchanged.
3. Complete and record the isolated hosted Preview checks. Approve final privacy text and reconcile the French version before publishing. Keep the US prompt inactive unless its separate ownership/isolation rollout is approved and tested.
4. Deploy only the specifically approved website artifact through the owner's normal release procedure. Perform read-only page/auth/webhook-negative smoke tests and review sanitized runtime health. Stop on errors; never disable HMAC or authentication to get a green check.
5. For regression, redeploy the previously recorded known-good artifact; `3f73925` is this branch's code baseline, not a claim that it is the current production deployment. Alternatively prepare a reviewed revert of this release commit. Do not reset/delete Redis or Supabase, rewrite existing prompts, revert customer records, rotate credentials or run SQL rollback. Both code versions retain seven functions. Reconcile privacy links/text with the approved rollback artifact and retain the French URL.
6. Recheck protected endpoints, GET verification, signatures, existing Moroccan prompt compatibility, dashboard/takeover and static assets. Any future per-account prompt activation needs its own versioned configuration rollback; this branch performs none.

No production release is authorized or performed by completing this checklist.
