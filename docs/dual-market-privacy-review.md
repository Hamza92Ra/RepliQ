# Dual-market pricing & privacy pre-merge review

**Status: REVIEW ONLY — NOT APPROVED FOR PRODUCTION.** Branch: `feature/ma-us-market-privacy-review`, based on `60760728b5a58abc980215febc71995175270c82`. Do not merge this stacked branch without reviewing all upstream security/WhatsApp changes.

## Original Moroccan plans preserved

The original Morocco landing and registration pages from production `main` were copied into `maroc.html` and `formulaire-maroc.html` with internal links retargeted. They retain the legacy plan calculations and offers, including:

| Moroccan plan | Monthly | Setup |
| --- | --- | --- |
| Essentielle | 200 MAD/month | 400 MAD |
| Standard | 400 MAD/month | 600 MAD |
| Premium | 800 MAD/month | 1,000 MAD |

The original conditional three-month introductory promotion, annual calculations, payment summaries and relevant legacy content remain in the Morocco copies. The Moroccan form now waits for a successful `/api/lead` HTTP response and `ok: true` before displaying its acceptance receipt; failures display an actionable error, with no false confirmation. The existing US pages still advertise `RepliQ Pro` at **$99/month plus a $99 one-time setup**. No currency conversion, geo-specific billing charge or subscription automation is introduced. Original Moroccan server-side lead offers are unchanged.

## Market selection (candidate implementation)

- `GET /api/market` returns the user's country hint from Vercel's `x-vercel-ip-country` header, normalized to `ma` (MA only) or `us` (default). No IP address is stored by this code; the endpoint is not a geolocation guarantee.
- Only the unqualified homepage `/` uses `market-switch.js` to suggest the Moroccan page based on region or a saved override. Explicit `/index.html` and `/formulaire.html` always stay US, while `/maroc.html` and `/formulaire-maroc.html` always stay Morocco, regardless of IP, cookies, or previous preference.
- Each market has a visible manual link to the other; the override is stored under the `repliq-market` local-storage key and takes precedence. Users can always open the Moroccan pages directly.
- The new serverless endpoint raises the Node function count from **7 to 8** (Hobby budget noted by the repository: 12). Verify at build/runtime. No code changes to the WhatsApp webhook, admin dashboard, Redis bindings, plan quota logic, or AI bot.
- **Review requirement:** test actual Moroccan IP behavior and mobile/desktop language-independent manual switching on a new preview. If browser or network blocks the country hint, the manual market switch remains available. Do not represent geography inference as exact customer nationality.
- **Known limitation:** first request to US homepage may briefly display US content until the asynchronous market hint returns. Consider a server-side redirect strategy if this flicker is unacceptable; do not silently hide prices or remove the manual choice.

## Privacy drafts — current legal/operator status

The owner confirms RepliQ is currently operated in an individual capacity, without a registered company. The English and French drafts now state this provisional fact and describe the regional selection. **They remain `noindex` and unapproved.** The `RepliQ` brand name is not a legal identity.

Before publishing:
1. Owner must approve the **full legal name of the individual operator**, any necessary business/contact address and contact channel for privacy rights, and legal roles when a charter business uses RepliQ.
2. Confirm the actual **data retention/deletion policy** for Redis, Supabase, email, Meta, AI providers, logs and backups; implement any promises before publishing. Determine identity-verification and request response process.
3. Verify provider agreements, enabled vendors, international data transfers, analytics/cookies, notification practices and hosting regions. Avoid unverified statements about compliance or retention.
4. Verify whether Morocco's **Law 09-08 / CNDP** declaration, authorization or overseas data-transfer procedures apply, and perform required formalities before collecting live personal data. CNDP's guidance applies to websites operated by natural persons as well as companies.
5. Determine whether specific US state privacy obligations apply to RepliQ's actual users/data and scale; do not make blanket claims of exemption or compliance.
6. Approve both languages, effective date and appropriate public contact wording before removing draft banners or `noindex`.

Reference: https://www.cndp.ma/conformite-des-sites-web/ and https://www.cndp.ma/notifier-un-traitement/ (guidance, not legal advice).

## Production release gate

- [ ] Run `npm test`, `npm run check:functions`, `npm run test:vercel-runtime` on this branch (GitHub workflows not observed, Vercel READY is not evidence of executing test suite). Expected function count is 8; verify rather than assume.
- [x] Read-only hosted GET checks: Morocco & US landings and forms, regional API, both privacy drafts; GET statuses 200 on latest preview. Source and published form confirm the API-success guard.\n- [ ] Real browser/Moroccan-IP test of actual region hint, manual switch, mobile behavior, and failed-vs-successful form submission on branch-isolated Preview Redis.
- [ ] Confirm release behavior for `/maroc.html` and `/formulaire-maroc.html` with old inbound links.
- [ ] Configure and reconfirm dedicated isolated Redis for THIS feature branch (existing Redis credentials are scoped to `release/us-hosted-verification`, not this feature branch). Never copy or reveal production credentials. The prior 5/6 hosted lead checks were on the earlier release branch, not this deployment. Redis outage is still untested live.
- [ ] Approve privacy identity/retention/provider/legal facts before publishing.
- [ ] Review the **full stacked branch diff vs `main`**; avoid accidentally enabling inactive bot/tenant functionality.
- [ ] Explicit owner approval before Production merge or promotion. No automatic merge.
