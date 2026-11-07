# Review-only Phase 1B SQL

These drafts are intentionally **outside** `supabase/migrations`. No runner imports or applies them. Never copy the directory into an automatic migration path without a reviewed release plan. Never apply `supabase/schema.sql` to a live database.

Order: `001_expand.sql` → reviewed ownership inventory and provisioning → `002_assign_reviewed_ownership.sql` → coordinated auth/application/Redis release → `003_enforce_scope_and_rls.sql`. The application/auth/Redis release is NOT implemented or activated by the isolated JavaScript helpers.

Every file has a session approval guard that fails by default. A matching session setting is a rehearsal/deployment interlock, **not** authorization; it does not replace the user's explicit approval. No settings were set and no SQL was executed during this phase. `002` and its rollback additionally require a reviewed manifest batch UUID. `verify.sql` runs read-only after cutover; `rollback_002_before_cutover.sql` refuses post-cutover reversal. Leave additive expansion in place when rolling back preparation; do not drop new tables or delete registries/manifests/credentials.

Before SQL approval: inspect the actual schema/catalog/grants/policies, Postgres and Supabase versions, table sizes, extensions, views/functions/triggers/publications and PostgREST relation names in an approved environment. Only `conversations` and `messages` exist in the checked-in schema. No inference is made about remote schema drift. The drafts target this baseline, are intentionally one-shot, and abort on naming/shape conflicts. Index creation and validation may require a separately designed batched/concurrent migration for large tables. The 2-second lock timeout aborts rather than queueing a long production lock.

Provision business UUIDs, auth-backed user rows, memberships and verified number registry records through reviewed server tooling. Do not infer a default owner from environment variables, Redis owner keys, or customer phone numbers. No provisioner exists here. Operational ownership manifests belong in restricted storage, not Git.

While writers are paused, compute manifest fingerprints in UTC from the exact post-expansion snapshot:

- Conversation: `encode(sha256(convert_to((to_jsonb(c)-'business_id'-'whatsapp_number_id')::text,'UTF8')),'hex')`.
- Messages for that conversation: `encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(msg)-'business_id'-'whatsapp_number_id' ORDER BY msg.id),'[]'::jsonb)::text,'UTF8')),'hex')`.

The manifest must cover the complete history and corroborating ownership evidence. `002` rechecks both hashes under a write-blocking lock, refuses ownership conflicts, and only sets scope fields from reviewed `verified` rows in the selected batch. It never changes conversation UUIDs, message IDs, or `conversation_id`. Quarantine rows stay unassigned and block stage `003`; resolving them or archiving them with preserved relationships requires a separate reviewed plan. No automatic archive/delete or guessed default assignment is provided.

Stage `003` requires the original global constraints to exist under their baseline names and refuses unknown policies. It removes anonymous grants/known unconditional read policies, establishes membership reads, retains browser write denial, removes obsolete global uniqueness, and enforces scope FKs/non-null values. Multiple conversation-message FKs require explicit relation names in future embedded PostgREST queries; current production queries are not ready for this stage.

Membership policy helper is `SECURITY DEFINER`, pinned to an empty search path, owned by the privileged migration role `postgres`, uses qualified table names and derives `auth.uid()` internally. Only `authenticated` receives execute access; the private tables have no browser grants. Verify the owner has the intended bypass rights so membership evaluation cannot recurse. The helper conveys membership only; it is not an administrator or credential API. Service-role callers bypass RLS and MUST use server-verified scope plus per-operation role checks.

Required disposable Supabase/Postgres rehearsal (not run here; PostgreSQL tooling is unavailable locally):

1. Apply baseline and drafts to a disposable database, with synthetic Auth users A/B, two businesses, at least two numbers in one business, duplicate customers/wamids across scope, and an ambiguous legacy row. Exercise missing approval guards.
2. Verify snapshot changes and ownership conflicts abort `002`; ambiguous/null scope blocks `003`; verified assignment preserves all IDs, bodies and counts. Test pre-cutover rollback, backup restore and conflict refusal.
3. Test as `anon`: no tenant or message reads/writes; no private table/function access. Test as authenticated A/B with actual JWT `auth.uid()` settings: see only active own memberships/businesses/conversations/messages/settings/identities; no foreign reads, no direct writes to any scoped table, no self-promotion, no credential references.
4. Test revoked memberships, disabled users, suspended businesses, null auth UID, unknown policies, views/functions/publications, secret ACLs, foreign-number inserts, mismatched message-parent FK, same customer across businesses/numbers, same wamid across scopes, attempted tenant reparenting and number/business ID changes.
5. Test service-role application operations separately: filters must include business + number for every read/write and relationship lookup, including receipt, merge, cascade/delete and retry paths. RLS alone cannot catch an omitted service-role filter.
6. Run `verify.sql`, confirm the expected zero counts, constraints validated, only intended SELECT grants/policies, correct definer owner/ACL/search path, and compatibility with the future UI/API. Restore the rehearsal snapshot and demonstrate rollback boundaries before seeking production approval.

The Node tests statically check migration guards and selected security structure; they do **not** execute SQL or prove RLS, DDL syntax or performance. See `docs/phase-1b-foundation-report.md` for release/rollback details and outstanding implementation requirements.
