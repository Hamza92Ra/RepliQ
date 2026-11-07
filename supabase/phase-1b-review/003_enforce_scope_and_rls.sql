-- REVIEW ONLY: coordinated application/auth/Redis cutover required.
-- Do not apply while any legacy writer or global admin endpoint is reachable.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_setting('repliq.phase1b_approved', true) IS DISTINCT FROM '003-cutover' THEN
    RAISE EXCEPTION 'Explicit approval required: 003-cutover';
  END IF;
END $$;
LOCK TABLE public.conversations,public.messages IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE business_id IS NULL OR whatsapp_number_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.messages WHERE business_id IS NULL OR whatsapp_number_id IS NULL) THEN
    RAISE EXCEPTION 'Unassigned/quarantined legacy records block cutover; do not invent ownership';
  END IF;
  -- Unreviewed permissive policies could OR with new policies. Abort instead of
  -- silently removing unknown production policies or leaving an access bypass.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND
      ((tablename='conversations' AND policyname <> 'Allow read conversations')
       OR (tablename='messages' AND policyname <> 'Allow read messages')
       OR tablename IN ('businesses','business_users','business_memberships','whatsapp_numbers','business_settings','customer_identities'))) THEN
    RAISE EXCEPTION 'Unknown policies require separate review';
  END IF;
END $$;
ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_scope_pair;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_scope_pair;
ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_owned_number_fk;
ALTER TABLE public.conversations ALTER COLUMN business_id SET NOT NULL, ALTER COLUMN whatsapp_number_id SET NOT NULL;
ALTER TABLE public.messages ALTER COLUMN business_id SET NOT NULL, ALTER COLUMN whatsapp_number_id SET NOT NULL;
ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_scope_fk
  FOREIGN KEY (conversation_id,business_id,whatsapp_number_id) REFERENCES public.conversations(id,business_id,whatsapp_number_id) ON DELETE CASCADE;
-- Retain the existing single-column FK so existing UUID relationships survive.
-- New application must explicitly name its PostgREST embedding relationship.
ALTER TABLE public.conversations DROP CONSTRAINT conversations_wa_contact_phone_key;
ALTER TABLE public.messages DROP CONSTRAINT messages_wa_message_id_key;

-- SECURITY DEFINER prevents recursive membership policies. Auth UID is derived
-- from the verified JWT; it is never supplied as a function parameter.
CREATE FUNCTION repliq_private.is_business_member(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.business_memberships m
      JOIN public.business_users u ON u.user_id=m.user_id
      JOIN public.businesses b ON b.id=m.business_id
    WHERE m.business_id=target AND m.user_id=auth.uid()
      AND m.status='active' AND u.status='active' AND b.status='active'
  );
$$;
ALTER FUNCTION repliq_private.is_business_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION repliq_private.is_business_member(uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA repliq_private TO authenticated;
GRANT EXECUTE ON FUNCTION repliq_private.is_business_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "Allow read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow read messages" ON public.messages;
REVOKE ALL ON public.conversations,public.messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.businesses,public.business_users,public.business_memberships,public.whatsapp_numbers,public.business_settings,public.customer_identities,public.conversations,public.messages TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conversations,public.messages TO service_role;
-- Writes intentionally remain server-only; API role checks are mandatory for
-- service-role writes, which bypass RLS. No browser CRUD of memberships/secrets.
CREATE POLICY business_users_self ON public.business_users FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY memberships_self ON public.business_memberships FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY businesses_member ON public.businesses FOR SELECT TO authenticated USING (repliq_private.is_business_member(id));
CREATE POLICY numbers_member ON public.whatsapp_numbers FOR SELECT TO authenticated USING (repliq_private.is_business_member(business_id));
CREATE POLICY settings_member ON public.business_settings FOR SELECT TO authenticated USING (repliq_private.is_business_member(business_id));
CREATE POLICY identities_member ON public.customer_identities FOR SELECT TO authenticated USING (repliq_private.is_business_member(business_id));
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_member ON public.conversations FOR SELECT TO authenticated USING (repliq_private.is_business_member(business_id));
CREATE POLICY messages_member ON public.messages FOR SELECT TO authenticated USING (repliq_private.is_business_member(business_id));
-- Prevent ordinary updates (including service role) from reparenting tenant data.
CREATE FUNCTION repliq_private.protect_row_scope() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.business_id,NEW.whatsapp_number_id) IS DISTINCT FROM (OLD.business_id,OLD.whatsapp_number_id) THEN
    RAISE EXCEPTION 'Tenant scope is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION repliq_private.protect_row_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER conversations_immutable_scope BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION repliq_private.protect_row_scope();
CREATE TRIGGER messages_immutable_scope BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION repliq_private.protect_row_scope();
COMMIT;
