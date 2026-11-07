# US website and RepliQ Pro pricing

Branch: `feature/us-website-pricing`, based on `integration/phase-1b-hobby` commit `1688ab2`. Worktree: `/tmp/repliq-us-website-pricing`.

Inspected the current landing page, signup/receipt/PDF flow, styles, lead endpoint, AI pricing/default prompt, current and legacy dashboards, integration/security/foundation files, regression tests and all local branches/worktrees. Existing uncommitted Phase 1B files were inventoried and SHA256-checked; their original worktrees remain untouched. The feature work uses a new worktree and no repository was cloned or fetched.

## Public changes

- English landing page for yacht and boat charter operators in South Florida and Puerto Rico, including Miami, Fort Lauderdale, the Florida Keys and San Juan.
- One public offer: **RepliQ Pro — $99/month + $99 one-time setup fee, USD**. Old public tiers, free-month promotion, annual billing and loyalty-discount presentation are removed from the landing page and public form.
- English, Spanish and French AI WhatsApp receptionist offer, approved charter information, voice handling, conversation history, human takeover and team notifications. Illustrations are explicitly labeled examples, not real guests or confirmed bookings.
- Intended allowance: **up to 1,000 outbound replies per billing period** and **up to 12 AI replies per customer per rolling 24 hours**. Both pages, request summaries and new-offer acknowledgements explicitly state that caps are not enforced yet. No counters, quota flags, billing activation or migrations are connected to this copy.
- Book a Demo and Get Started both lead to the existing `formulaire.html` → POST `/api/lead` flow, with demo/setup intent. A demo request is not an instantly booked calendar slot. The form takes no payment and activates no subscription. No checkout, booking engine, calendar endpoint or live charter inventory was invented.
- Existing emerald/mint palette, typography sources, section/card system, phone illustration, navigation, WhatsApp contact links and responsive structure are retained. The single-plan layout replaces the old carousel/toggle. Mobile hero copy/CTA comes first; reduced-motion users can read the full phone example. FAQ buttons expose expanded state and offline font fallbacks remain readable.

## Signup and acquisition compatibility

`public-offer.js` defines public commercial constants only; it is not the live bot or tenant billing configuration. The new form always submits RepliQ Pro/monthly/USD pricing, even if an old bookmark requests another offer or annual billing. Such a request is an inquiry, not acceptance or alteration of an existing account's contract.

`signup.js` uses the existing lead endpoint, requires contact consent and an international WhatsApp number, retains the request-summary/PDF/follow-up flow, and reports success only after the API confirms storage. Failed requests show an error rather than a false received summary. Request fields are rendered as text in the summary, avoiding HTML injection. PDFs use the existing jsPDF 2.5.1 library with wrapping and pagination, and identify themselves as request summaries rather than invoices/payment receipts.

The existing `/api/lead` has one additional dispatch branch for the exact `RepliQ Pro` offer. That branch uses server-defined offer prices instead of trusting posted amounts, records English inquiry copy without a legacy 12-month commitment, and uses the existing best-effort WhatsApp acknowledgement/team-notification flow. It does not create a tenant, register a WhatsApp number, update business prompts, charge a payment, apply quotas or activate a subscription. Server credentials still come only from the existing configured single-business resolver; browser number/tenant fields grant no authority.

All other offer values use the original lead-handler body unchanged. A mocked regression verifies legacy Standard acknowledgement/features, original local-phone normalization and response behavior. Current customers and old bot/configuration paths have not been migrated.

## Files changed

Modified:

- `index.html`: English charter copy, one offer, CTAs and pricing FAQs.
- `formulaire.html`: English single-plan inquiry form and request-summary markup.
- `styles.css`: scoped public offer/mobile/accessibility styling.
- `api/lead.js`: explicit new-offer acquisition dispatch; legacy body retained.
- `scripts/verify-vercel-runtime.mjs`: three additional local lead-route checks.

Added:

- `public-offer.js`: public USD offer constants and intended-limit disclosure.
- `marketing.js`: existing navigation behavior and accessible FAQ interaction, without obsolete pricing toggles.
- `signup.js`: public form, canonical payload, error handling and PDF summary.
- `lib/public-pro-lead.js`: new-offer acknowledgement/storage boundary.
- `tests/public-us-pricing.test.js`: 13 focused public pricing/form/lead regressions.
- `scripts/verify-us-website.mjs`: optional local desktop/mobile browser regression with all remote requests intercepted.
- This report.

The AI implementation/default prompt, both admin/dashboard implementations, webhook and conversation handlers, auth/credential helpers, Phase 1B code/SQL drafts, Vercel rewrites, dependencies and package lock remain unchanged. No new deployable API file was introduced.

## AI and dashboard pricing audit

The following references remain intentionally unchanged:

- `lib/ai.js`: three Moroccan plans (200/400/800 MAD monthly; 400/600/1,000 MAD setup), free-month/annual/loyalty rules, legacy industries and a RepliQ sales-assistant default prompt. It describes RepliQ subscription sales rather than a charter operator's guest-facing receptionist. It also names legacy language/context instructions. Existing pricing/prompt tests remain intact and passing.
- Redis `business:<phoneNumberId>` configuration may contain customer-specific prompts/notes; it was not read or written. Existing tenant configurations must not be replaced from public marketing copy.
- `api/lead.js`: legacy offer highlights, French acknowledgement and historical commitment copy remain for non-Pro submissions. New Pro submissions avoid those branches.
- `dashboard.html`: three order-item/total display sites append `MAD`. These are historical commerce amounts, not necessarily RepliQ subscription prices. Numeric amounts cannot safely be relabeled USD.
- `admin.html`/`admin.js`: no hardcoded Moroccan commercial plan prices found; existing French UI remains unchanged. Stored message content can still include historical prices and is not rewritten.
- Legacy tests explicitly cover old prices. Their continued success is intentional compatibility evidence, not a reason to change the default bot silently.

**Material rollout inconsistency:** a prospect following up through the existing shared WhatsApp number can still encounter the old sales prompt and Moroccan prices. The new-offer acknowledgement itself is consistent, but this change does not replace that default prompt or force takeover for existing contacts. Resolve the approved sales-bot offer context before marketing the shared bot as a US sales demo. Do not globally replace the prompt just to remove this inconsistency.

## Proposed tenant-specific offer migration — inactive

1. Inventory and snapshot approved business configurations, existing offers/contracts and record currencies through a separately authorized process. No ownership or currency should be inferred from a public form field, IP location, phone country code or current environment default.
2. Create immutable versioned offer definitions: retain the legacy Moroccan offer versions for existing accounts; prepare `repliq-pro-us-v1` with USD 99/month, USD 99 one-time setup, approved language/feature scope and a draft usage-policy version. Store billing-period definitions and agreements separately from marketing strings. Never convert old amounts or remove discounts automatically.
3. Bind an offer version to an immutable business through the future server-verified membership/number ownership model. Only an authorized operator should confirm adoption and effective date. The public `offer` field is acquisition intent only, not permission to select tenant credentials, change a plan or update a prompt.
4. Separate prompt roles. The **RepliQ prospect sales bot** may discuss the approved SaaS offer. A **charter tenant's guest receptionist** must discuss that operator's approved trip options/rates/policies, not advertise RepliQ's $99 subscription. Prepare language-reviewed English/Spanish/French templates and guard against invented charter availability, prices, weather decisions or payment links.
5. Resolve prompt/offer/context only from an authenticated tenant or registered signed webhook number, with versioned settings and no global cross-tenant fallback. Preserve legacy prompts until the relevant business explicitly opts in. Test the same guest across two businesses, legacy pricing versus US pricing, human takeover and notification destinations before activation.
6. Add explicit ISO currency to future order/price records and API responses through a separately reviewed schema/application rollout. Render the stored record's currency; do not change historical `MAD` to `USD` without real evidence and an approved conversion policy. Retain original amounts and invoice/offer versions. Unknown currencies require review, not a guessed dollar sign.
7. Keep usage policies separate from price/prompt activation. Before quotas: agree AI/human/template/split-message counting and failure rules, implement durable atomic accounting and alerts, shadow-meter, rehearse takeover and rollback, then seek explicit enforcement approval. No quota enforcement is enabled by this branch.
8. Roll out an approved per-business offer/prompt version with synthetic tests and a controlled canary. Rollback restores that business's prior version; it must not overwrite other businesses' settings or historical receipts. The existing Phase 1B migration/auth/runtime prerequisites still gate this rollout.

This is a proposal only. No business offer table, production migration, credential rotation or runtime tenant switch was activated.

## Validation

- `npm test`: **142 passed, 0 failed**, across 11 files, including all 129 existing tests and 13 new cases.
- `npm run check:functions`: **7 functions**, within the Hobby maximum of 12.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **41 local HTTP response checks passed**, including existing admin/raw-body signature regressions and the new offer's lead storage/consent path. Actual Vercel Node helpers and mocked external services were used; no hosted deployment was tested.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/repliq-browsers node scripts/verify-us-website.mjs /tmp/repliq-ui-tools`: desktop (1440×1000) and mobile (390×844) passed. Checked primary CTA destinations, single offer, no horizontal overflow, visible/unclipped reduced-motion phone demo, above-fold mobile CTA, FAQ interaction, both inquiry intents, phone/consent handling, no false success on API failure, escaped receipt fields and actual PDF downloads. No JavaScript page errors. Screenshots were visually reviewed.
- Browser lead submissions and remote requests were intercepted. The actual jsPDF 2.5.1 bundle was served from temporary local test tools. External font/CDN availability was not exercised; fallback fonts were checked. Temporary tools were not added as project dependencies.
- `git diff --check`, JavaScript syntax and protected-file/hash checks passed. No SQL was executed.

The first new test found that language details on the form depended only on JavaScript; the form now includes a readable static summary as well. Visual review also found the inherited reduced-motion animation ended with hidden demo bubbles; scoped styling now keeps that example visible. All final checks pass.

Review artifacts: `/tmp/repliq-us-website-review/` (desktop/mobile screenshots and synthetic demo/setup PDF summaries). These contain synthetic input only and are not production data.

## Remaining inconsistencies and release boundaries

- The legacy default sales prompt and dashboard order-currency labels remain as audited above. Tenant-specific adoption needs the approved migration plan, not global replacement.
- The existing WhatsApp contact number remains the established +212 number; no US phone number, local office, customer testimonial or calendar availability was invented.
- `privacy.html` remains the existing French policy and is labeled as French in the new footer links. It needs a separate factual/privacy review and English version before a full US launch; this task did not rewrite legal commitments or claim compliance.
- Existing team-notification infrastructure can still use French email subjects; Pro inquiry content/acknowledgements are English. The public form still uses the existing single-business lead store and configured number. Broader tenant isolation, lead abuse/rate controls, notifications and billing dependencies remain Phase 1B work.
- No hosted preview or real delivery check was performed. Existing Meta customer-care-window/account restrictions can prevent a best-effort acknowledgement; a saved lead remains available in the dashboard, and the form does not claim WhatsApp delivery or payment success.
- Final commercial usage definitions, platform fees and activation terms need operator approval. The intended limits are displayed, not enforced. No checkout or subscription billing service is added.

No production data/configuration/credentials changed. No migration, push, merge into main, deployment or unfinished multi-tenant activation occurred. Reviewed changes are committed only on the feature branch; the original worktrees remain intact.
