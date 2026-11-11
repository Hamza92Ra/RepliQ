# Supabase-primary migration — Phase 1 (opt-in, NOT enabled)

## Implemented in this branch
- `REPLIQ_STORAGE_BACKEND=supabase` opts the legacy dashboard into Supabase primary reads, without the Redis-first behavior or a misleading degraded warning.
- The WhatsApp webhook checks `human_takeover` against Supabase before AI processing, fails closed on lookup errors, uses existing Supabase message-ID deduplication, stores message history in Supabase, and skips Redis mirroring in this mode.
- Admin Supabase takeover changes no longer attempt Redis synchronization in this mode.
- Added `public.orders` with RLS enabled and no client-role grants, plus a server-only Supabase orders adapter for create/read/list/update in primary mode. The new table starts empty; existing Redis orders are NOT migrated.
- Public RepliQ website leads use an atomic Supabase-only admission RPC under opt-in mode. The `public.lead_requests` table stores validated submissions and uses service-only RLS-restricted access; the transaction enforces per-business dedup and global/IP/phone/email quotas. No Redis dependency for forms in this mode. Auto-WhatsApp acknowledgment is deliberately disabled until ownership can be verified, but team notifications remain.
- The original legacy dashboard remains explicitly **read-only** during the cutover; Redis-dependent actions are not silently enabled, and the banner describes migration instead of a Redis outage. Legacy human/bot takeover is routed through Supabase, other legacy actions fail closed in primary mode.
- In absence of the opt-in flag, production behavior remains unchanged. No existing customer rows were deleted or secret rotations performed.

## DO NOT enable in Production yet
This is not a full Redis replacement. Before setting the flag:
1. Verify existing Supabase conversation/message contents and reconcile historical Redis-only records (cannot assume these exist in Supabase).
2. Confirm Supabase webhook duplicate-handling and takeover behavior with live, isolated credentials/number; unit tests mock storage.
3. Migrate legacy admin `/api/dashboard` interaction actions and `/api/orders` from Redis, and `/api/lead` public-lead writes. Some business config, message tracking and abuse controls also rely on Redis.
4. Verify default business prompt/config, external calls, per-tenant isolation, and rate-limiting equivalents. Restore or replace durable idempotent claims if concurrent inbound deliveries occur.
5. Run staged E2E tests, assess drift, then cut over with rollback plan. A rollback must avoid replaying stale state.

Never remove Redis credentials or delete the Redis database as part of Phase 1.

## Live Supabase schema validated 2026-11-11
- `public.conversations`: 1 row; `public.messages`: 19 rows (10 inbound, 9 outbound) at inspection time.
- `public.orders`: 0 rows after creation. `public.lead_requests`: 0 rows after creation.
- Both newly created tables have RLS on, no policies, and no anon/authenticated grants. `admit_repliq_lead` RPC has EXECUTE for service_role only; neither anon nor authenticated can invoke it.
- Database and GitHub changes are real; external integrations in CI are mocked. Do not infer complete historical Redis data migration.
