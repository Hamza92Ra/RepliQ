-- REVIEW ONLY, read-only post-cutover catalog/count checks. Never executed here.
BEGIN READ ONLY;
DO $$ BEGIN
  IF current_setting('repliq.phase1b_approved', true) IS DISTINCT FROM 'verify' THEN
    RAISE EXCEPTION 'Explicit read-only verification approval required';
  END IF;
END $$;
-- Counts only; never print customer rows or credential references/tokens.
SELECT count(*) AS unassigned_conversations FROM public.conversations WHERE business_id IS NULL OR whatsapp_number_id IS NULL;
SELECT count(*) AS unassigned_messages FROM public.messages WHERE business_id IS NULL OR whatsapp_number_id IS NULL;
SELECT count(*) AS mismatched_messages FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
WHERE (m.business_id,m.whatsapp_number_id) IS DISTINCT FROM (c.business_id,c.whatsapp_number_id);
SELECT count(*) AS invalid_numbers FROM public.conversations c LEFT JOIN public.whatsapp_numbers n
ON (n.id,n.business_id)=(c.whatsapp_number_id,c.business_id) WHERE n.id IS NULL;
SELECT count(*) AS duplicate_customers FROM (
  SELECT business_id,whatsapp_number_id,wa_contact_phone FROM public.conversations GROUP BY 1,2,3 HAVING count(*)>1
) duplicate_scopes;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname IN ('public','repliq_private') AND tablename IN ('businesses','business_users','business_memberships','whatsapp_numbers','business_settings','customer_identities','conversations','messages','whatsapp_credential_versions','legacy_ownership_manifest','admin_sessions');
SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('public.conversations'::regclass,'public.messages'::regclass);
SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.table_privileges
WHERE table_name IN ('conversations','messages','whatsapp_credential_versions','legacy_ownership_manifest','admin_sessions')
AND grantee IN ('PUBLIC','anon','authenticated');
SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='repliq_private';
COMMIT;
