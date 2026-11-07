-- REVIEW ONLY. Writers/AI jobs must be paused, inbox buffered, and backup verified.
-- Operator populates reviewed manifest in a separately approved operation.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_setting('repliq.phase1b_approved', true) IS DISTINCT FROM '002-ownership' THEN
    RAISE EXCEPTION 'Explicit approval required: 002-ownership';
  END IF;
  IF nullif(current_setting('repliq.manifest_batch', true),'') IS NULL THEN
    RAISE EXCEPTION 'Reviewed manifest batch required';
  END IF;
END $$;
LOCK TABLE public.conversations,public.messages IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM repliq_private.legacy_ownership_manifest WHERE batch_id=current_setting('repliq.manifest_batch')::uuid AND disposition='verified') THEN
    RAISE EXCEPTION 'No verified ownership in selected batch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversations c JOIN repliq_private.legacy_ownership_manifest m ON m.conversation_id=c.id
    WHERE m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified' AND
      (m.conversation_fingerprint IS DISTINCT FROM encode(sha256(convert_to((to_jsonb(c)-'business_id'-'whatsapp_number_id')::text,'UTF8')),'hex')
       OR m.messages_fingerprint IS DISTINCT FROM (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(msg)-'business_id'-'whatsapp_number_id' ORDER BY msg.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.messages msg WHERE msg.conversation_id=c.id)
       OR (c.business_id IS NOT NULL AND (c.business_id,c.whatsapp_number_id) IS DISTINCT FROM (m.business_id,m.whatsapp_number_id)))
  ) THEN RAISE EXCEPTION 'Snapshot changed or ownership conflicts; re-inventory'; END IF;
END $$;
UPDATE public.conversations c SET business_id=m.business_id,whatsapp_number_id=m.whatsapp_number_id
FROM repliq_private.legacy_ownership_manifest m
WHERE c.id=m.conversation_id AND m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified' AND c.business_id IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE m.business_id IS NOT NULL AND (m.business_id,m.whatsapp_number_id) IS DISTINCT FROM (c.business_id,c.whatsapp_number_id)) THEN
    RAISE EXCEPTION 'Message ownership conflicts; do not overwrite';
  END IF;
END $$;
UPDATE public.messages m SET business_id=c.business_id,whatsapp_number_id=c.whatsapp_number_id
FROM public.conversations c JOIN repliq_private.legacy_ownership_manifest approved ON approved.conversation_id=c.id
WHERE m.conversation_id=c.id AND m.business_id IS NULL AND approved.batch_id=current_setting('repliq.manifest_batch')::uuid AND approved.disposition='verified';
-- Quarantine rows are untouched, not assigned to the default business.
-- Existing conversation UUIDs and message conversation_id values never change.
COMMIT;
