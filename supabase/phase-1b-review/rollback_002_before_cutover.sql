-- REVIEW ONLY. Narrow reversal of reviewed assignments BEFORE stage 003 only.
-- Keep expansion, registries, vault references, manifest and all customer rows.
-- Writers must be paused and original snapshot validated first.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_setting('repliq.phase1b_approved', true) IS DISTINCT FROM 'rollback-002' THEN
    RAISE EXCEPTION 'Explicit rollback approval required';
  END IF;
  IF nullif(current_setting('repliq.manifest_batch', true),'') IS NULL THEN
    RAISE EXCEPTION 'Reviewed batch required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.conversations'::regclass AND tgname='conversations_immutable_scope')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.conversations'::regclass AND conname='conversations_wa_contact_phone_key') THEN
    RAISE EXCEPTION 'Cutover already happened: forward recovery required';
  END IF;
END $$;
LOCK TABLE public.conversations,public.messages IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations c JOIN repliq_private.legacy_ownership_manifest m ON m.conversation_id=c.id
    WHERE m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified'
      AND c.business_id IS NOT NULL AND (c.business_id,c.whatsapp_number_id) IS DISTINCT FROM (m.business_id,m.whatsapp_number_id)) THEN
    RAISE EXCEPTION 'Scope conflict; rollback refused';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversations c JOIN repliq_private.legacy_ownership_manifest m ON m.conversation_id=c.id
    WHERE m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified' AND
      (m.conversation_fingerprint IS DISTINCT FROM encode(sha256(convert_to((to_jsonb(c)-'business_id'-'whatsapp_number_id')::text,'UTF8')),'hex')
       OR m.messages_fingerprint IS DISTINCT FROM (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(msg)-'business_id'-'whatsapp_number_id' ORDER BY msg.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.messages msg WHERE msg.conversation_id=c.id))
  ) THEN RAISE EXCEPTION 'Data changed since reviewed snapshot; rollback refused'; END IF;
END $$;
UPDATE public.messages msg SET business_id=NULL,whatsapp_number_id=NULL
FROM repliq_private.legacy_ownership_manifest m
WHERE msg.conversation_id=m.conversation_id AND m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified'
  AND (msg.business_id,msg.whatsapp_number_id)=(m.business_id,m.whatsapp_number_id);
UPDATE public.conversations c SET business_id=NULL,whatsapp_number_id=NULL
FROM repliq_private.legacy_ownership_manifest m
WHERE c.id=m.conversation_id AND m.batch_id=current_setting('repliq.manifest_batch')::uuid AND m.disposition='verified'
  AND (c.business_id,c.whatsapp_number_id)=(m.business_id,m.whatsapp_number_id);
COMMIT;
