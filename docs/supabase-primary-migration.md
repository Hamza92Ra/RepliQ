# Supabase-primary migration — Phase 1 (opt-in, NOT enabled)

## Implemented in this branch
- `REPLIQ_STORAGE_BACKEND=supabase` opts the legacy dashboard into Supabase primary reads, without the Redis-first behavior or a misleading degraded warning.
- The WhatsApp webhook checks `human_takeover` against Supabase before AI processing, fails closed on lookup errors, uses existing Supabase message-ID deduplication, stores message history in Supabase, and skips Redis mirroring in this mode.
- Admin Supabase takeover changes no longer attempt Redis synchronization in this mode.
- In absence of the opt-in flag, production behavior remains unchanged. No schema changes, deletions, or secret rotations.

## DO NOT enable in Production yet
This is not a full Redis replacement. Before setting the flag:
1. Verify existing Supabase conversation/message contents and reconcile historical Redis-only records (cannot assume these exist in Supabase).
2. Confirm Supabase webhook duplicate-handling and takeover behavior with live, isolated credentials/number; unit tests mock storage.
3. Migrate legacy admin `/api/dashboard` interaction actions and `/api/orders` from Redis, and `/api/lead` public-lead writes. Some business config, message tracking and abuse controls also rely on Redis.
4. Verify default business prompt/config, external calls, per-tenant isolation, and rate-limiting equivalents. Restore or replace durable idempotent claims if concurrent inbound deliveries occur.
5. Run staged E2E tests, assess drift, then cut over with rollback plan. A rollback must avoid replaying stale state.

Never remove Redis credentials or delete the Redis database as part of Phase 1.
