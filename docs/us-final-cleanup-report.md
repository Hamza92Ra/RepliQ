# US final cleanup

Local review branch `release/us-final-cleanup`, worktree `/tmp/repliq-us-final-cleanup`, based on `feature/us-demo-isolation` commit `730159d7557632a25a338d0424667c3ba9da4076`.

**Contact cleanup complete; NO-GO for production launch or US bot activation.** The owner-confirmed public contacts are **7amzaraddi@gmail.com** and **+212712614398** (WhatsApp AI bot). The owner's personal number is not an official public business/bot contact. Correcting that public fact does not prove the deployment's Meta receiving-number ID, datastore ownership, or privacy procedures.

No clone/fetch, push, merge, deployment, main modification, SQL execution, real service/data access, credential/settings change or bot/quota activation occurred. Existing branches/worktrees and uncommitted Phase 1B files are preserved. All test services and submissions are synthetic and intercepted/mocked.

## Audit and modifications

Audited public HTML and JavaScript, landing/form CTA and WhatsApp follow-up links, email links, default AI contact interpolation, shared USD sales prompt/draft, both privacy notices, signup summary/PDF behavior, notification routing, existing tests, function-count and runtime/browser checks. Read the prior isolation/activation boundaries; no production business settings were queried.

Files changed:

| File | Change |
| --- | --- |
| `index.html` | Add the official email to footer contact links and explicitly label the English privacy link as a draft. Existing official WhatsApp links and US pricing unchanged. |
| `formulaire.html` | Same official email and privacy-draft footer label. Existing supported contact/demo/setup/follow-up flows retained. |
| `lib/ai.js` | Replace only the legacy default's advertised personal phone with the official bot number. Email was already correct. No other AI text, pricing, tier, promotion, provider or retry logic changes. |
| `privacy-en.html` | Replace the obsolete email with the verified official email; add official bot link; distinguish confirmed contact facts from pending privacy-request procedures. Link the French revision with an accurate pending-review label. Retain visible unapproved draft, no effective date and `noindex`. |
| `privacy.html` | Retain French language and URL; prepare a clearly labelled, noindex French revision pending approval, with the same verified contacts and factual flow coverage as English. Remove unsupported unconditional privacy/security/retention promises and automatic appointment implications. |
| `styles.css` | Wrap public footer links to prevent mobile overflow after adding the email. Scoped to `.public-site`; dashboard styles unchanged. |
| `tests/public-contacts.test.js` | Five regression cases covering official contact links, absence of personal contact advertising, legacy MAD pricing/contact substitution, unchanged USD offer/draft status and both privacy review boundaries. |
| `scripts/verify-us-website.mjs` | Add official-contact, follow-up recipient, noindex and French review/layout assertions. Artifacts use a new task-specific directory. |
| `docs/us-final-cleanup-report.md` | This report. |

Existing public WhatsApp links already pointed to the official bot and remain unchanged, including the dynamic inquiry follow-up in `signup.js`. No new checkout, booking, phone number, office, legal entity or address was introduced. `lib/us-sales-prompt.js` is **byte-identical** to the base and remains inactive; its USD offer still says $99/month + $99 one-time setup, English/Spanish/French and intended, unenforced 1,000 outbound replies/billing period and 12 AI replies/customer/rolling 24 hours. The only change in `lib/ai.js` is the verified official phone substitution; all legacy Moroccan prices and promotions remain intact.

No stored custom prompt, credential or internal email/notification destination was rewritten. Historical audit documents are retained as historical evidence; their old contact findings are superseded by this report, not current contact instructions. The personal number can still occur in internal source comments as a phone-format example and negative test fixtures, not as an advertised contact. These are not credentials or live settings and were not globally replaced.

## Privacy review boundaries

The French text previously listed the wrong email, implied automatic order/appointment confirmation, described secure Redis storage without qualification, promised necessary-duration retention/deletion on request, omitted several application providers/flows and stated no-sale/no-advertising practices that source code alone cannot establish. The revised draft removes those categorical claims and describes supported behavior conditionally:

- Public form fields/contact consent, inquiry storage, optional WhatsApp acknowledgement/email notification, browser-generated PDF; no payment, appointment or subscription confirmation.
- WhatsApp identifiers/text/status, voice/media/transcription, history/context, dashboard replies and human takeover; existing optional order data.
- Meta, Vercel, Upstash Redis and configured Supabase, Groq, Gemini and Resend; public Google Fonts/cdnjs resource requests and outbound links.
- Administrator cookie/localStorage; no assertion that hosting analytics/logging are disabled.
- No fixed global retention period. Redis history limits/technical expirations do not establish deletion across databases, emails, providers or backups. A deletion request does not guarantee automatic erasure everywhere.

Both URLs remain reachable for review and explicitly link to each other. The English notice remains **unpublished/unapproved, noindex**, and the corrected French revision is also visibly pending approval. Noindex is not access control or proof of non-publication; neither file should be presented as an approved policy by deploying this branch without review. The old French effective-date assertion was removed rather than inventing a new publication date. Preserve prior approved policy records privately and reconcile the revisions before a future publication.

Still requiring owner/legal/operational approval: legal identity and any required address/controller/operator disclosures, actual provider agreements/settings and processing locations, analytics/logging/cookie practices, retention scope, request identification and response handling, deletion coverage including backups/provider copies, and applicable notice/rights wording. The email and bot number are confirmed; privacy service levels/procedures are **not** confirmed by the contact correction. No certification, legal-compliance guarantee, retention duration or data-deletion guarantee is claimed.

## Actual verification results

- `npm test`: **215 passed, 0 failed, 0 skipped**, **14/14 files**. All 210 base tests retained plus five contact/privacy regressions. Coverage includes legacy Moroccan and USD offer behavior, both webhooks, raw-byte HMAC/GET verification, admin authorization/manual sends, takeover, voice/media, receipts, two-business collision blocking, inactive Phase 1B, form/acknowledgement/summary/PDF logic.
- `npm run check:functions`: **7 before / 7 after**, existing `admin`, `business-config`, `conversation`, `dashboard`, `lead`, `orders`, `webhook`; Vercel rewrites unchanged.
- `npm run test:vercel-runtime -- /tmp/repliq-vercel-tools`: **49 real-runtime HTTP response checks passed**, local `@vercel/node` 30.0.0 / routing-utils 6.6.1, including canonical sender/prompt/receipt probes. Explicit synthetic worker environments and mocked services; no hosted Vercel account accessed.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/repliq-browsers node scripts/verify-us-website.mjs /tmp/repliq-ui-tools`: **PASS** at desktop 1440×1000 and mobile 390×844. Official email/bot and dynamic follow-up links, both privacy languages/review state, noindex English, no horizontal overflow, reduced-motion example, keyboard FAQ, both CTAs, consent/international phone validation, escaped summary, failed-request UI and actual jsPDF 2.5.1 downloads passed; zero page errors. Lead submissions and all remote requests intercepted. Mobile French notice and form/footer screenshots visually reviewed. Artifacts: `/tmp/repliq-us-final-cleanup-review/`.
- The first browser run found a real mobile footer overflow introduced by adding the email; public footer wrapping fixes it. Final browser run passed. No failed checks remain.
- `node --check`: **62 JavaScript/MJS files passed**. `git diff --check` passed. Exact baseline comparison verified the sole legacy AI phone substitution and unchanged US sales prompt. APIs/HMAC/activation guards/storage/credentials/admin/dashboard/notifications/templates/orders, signup/pricing constants, dependencies, Vercel config and SQL are unchanged.
- All **seven original worktree HEADs/statuses and 26 inventoried uncommitted files** were preserved. Release work is isolated; no conflicts introduced.

No hosted Preview, real AI evaluation, WhatsApp delivery, real email handling or production store/configuration inspection was performed. Browser resource interception checks fallback rendering, not external CDN availability. A mock response does not prove real-model adherence or live ownership.

## Remaining launch blockers and safe next steps

1. **US demo activation remains blocked with Supabase + Redis.** Official public number confirmation is useful business evidence but does not establish its exact signed Meta phone-number ID, canonical credential binding, exclusive data/writer ownership, or a safe two-business schema/admin/notification scope. Retain the fail-closed Supabase restriction and receipt guard. Follow `docs/us-demo-isolation-activation-report.md`; do not remove Supabase or change a flag to bypass it. Phase 1B and commercial quotas remain inactive.
2. **Approve both privacy revisions before publication.** The accurate contact facts do not approve the remaining practices or legal wording. Resolve the review items above; assign an effective date only through the approved publication process.
3. **Review actual RepliQ-owned custom configurations separately, if authorized.** Stored business prompts/notes may override the corrected default or contain older contact references. Their contents are unknown here; never overwrite client contacts/offers globally or infer ownership from language/phone prefix. Historical conversations may legitimately include older prices/contacts and must not be rewritten.
4. **Approved isolated hosted Preview remains necessary.** Use synthetic service adapters/data only; preserve Preview protection and report access blockers. Check both policy URLs/static assets, CTA/form flows and protected API rejection. Never submit synthetic phones to a production-connected lead endpoint, since it stores inquiries and may send WhatsApp/email. Do not modify Meta subscriptions or real delivery settings.
5. **Commercial/operational readiness remains separate.** Confirm reply-count definitions, platform fees, lead abuse controls and support procedures before promoting the offer. No billing/checkout/enforcement was added. Existing official +212 contact is retained; no US office/number or calendar availability is implied. Official website/Instagram account details were not newly verified or invented in this cleanup.

## Deployment and rollback boundary

Commit locally only; obtain explicit approval before any deployment or activation. Review the exact release diff and isolate any later hosted smoke tests. No environment changes are required for these contact/copy fixes.

If a future deployment needs rollback, restore the previously recorded approved artifact or prepare a reviewed revert, retaining seven functions, HMAC and unchanged store settings. Baseline is `730159d`, not a claim about the current production deployment. **A blind revert of the contact change would reintroduce the personal phone/outdated policy email**: preserve the verified contact correction in a reviewed rollback artifact. Likewise, do not restore unsupported privacy claims as approved text. Do not roll back customer history/configuration, delete/reset stores, rotate credentials, execute SQL or weaken authentication. Since this task changed no live data/settings, no data rollback is required now.

**GO for local review and explicitly approved isolated Preview testing. NO-GO for production launch, policy publication or US assistant activation until the outstanding reviews are complete.**
