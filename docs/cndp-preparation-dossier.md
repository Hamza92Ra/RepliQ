# RepliQ — CNDP preparation dossier (not submitted)

**Status: INTERNAL DRAFT.** Prepared from the connected repository and operator-confirmed details on 9 November 2026. This is not a legal opinion, a CNDP filing, or proof of registration.

## Known facts for a prospective notice

| Field | Current information |
|---|---|
| Responsible person / operator | **HAMZA RADDI**, acting in an individual capacity; not a registered company |
| Service | RepliQ AI WhatsApp receptionist for yacht/boat charters, and Moroccan business leads |
| Contact for privacy inquiries | 7amzaraddi@gmail.com |
| Principal use of data | Website/demo/signup lead intake; WhatsApp message receipt and replies; human takeover; dashboard/history; optional inquiries/orders; abuse prevention |
| Relevant categories | Contact name, business name, phone, email, messages, WhatsApp profile/IDs/statuses, times, optional audio/transcripts, order/request details, technical anti-abuse identifiers |
| Intended conversation/contact-request period | **90 days**; requires separate technical implementation and validation before claiming enforcement |
| Known processors/services in code | Meta/WhatsApp, Vercel hosting, Upstash Redis; Supabase, Groq, Google Gemini, Resend when configured; Google Fonts and jsPDF CDN on public pages |
| Regional pricing selection | Vercel country header for an initial market hint on root URL; localStorage for visitor's explicit market choice; no geolocation service added |
| Payment data | Current public forms do not request payment card numbers; requests do not activate subscriptions or confirm bookings |

## Unconfirmed: DO NOT INVENT OR REPRESENT AS COMPLETE

- Individual's legally required address/contact particulars; confirm whether a public correspondence address and other identifiers are necessary.
- Who is controller vs processor for charter customers and WhatsApp guest data; charter operators may act as controllers.
- Geographic storage/processing and actual subprocessors for **each enabled** vendor. Confirm contracts, privacy terms, consent or other lawful basis, and international-transfer mechanisms.
- Applicable CNDP declaration/authorization requirement and any exemptions; a commercial activity by a natural person is **not** the personal/household exemption.
- Any required CNDP overseas transfer formalities: country list, legal basis, applicable authorization, and timing.
- Actual expiry/deletion for Redis, Supabase, notifications, Meta, AI providers, logs, backups, and legal-hold/financial records. The 90-day policy is not yet enforced universally.
- Security/access/rights workflows, identity verification, request handling and breach procedures; verify operational practices rather than writing a guarantee.
- Additional United States privacy laws as applicable by state and actual RepliQ processing scale.

## Official CNDP starting points (verify applicability before filing)

1. **Law 09-08, scope**: https://www.cndp.ma/textes-et-lois/
2. **Notify processing**, ordinary/simplified declaration paths (F211/F214): https://www.cndp.ma/notifier-un-traitement/
3. **Documentation/process requirements**: https://www.cndp.ma/procedures-de-notification-process/
4. **Transfers of personal data abroad**, F118 and conditions: https://www.cndp.ma/transfert-de-donnees-a-letranger/

The CNDP's F211 form explicitly includes a **Personne Physique** category, with identification/address fields; a company registration number must never be invented. Whether the chosen declaration is appropriate and whether additional authorization is needed must be confirmed based on actual processing and jurisdiction.

## Release hold points

- Do not remove `noindex`/DRAFT from EN and FR privacy pages while the above facts are unverified.
- Do not enable 90-day deletion or claim it is automatic until a safe audited backup/hold-aware implementation is tested for **all** active stores and accepted by the owner.
- Do not use production Redis credentials on feature preview, or send actual prospects/WhatsApp messages during verification.
- Do not merge or promote until full release review and explicit owner consent.

Prepared solely to make the next verification concrete; **no CNDP submission has been made**.
