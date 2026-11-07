-- REVIEW ONLY. Outside supabase/migrations; never run automatically.
-- Requires separately approved privileged Supabase migration session.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_setting('repliq.phase1b_approved', true) IS DISTINCT FROM '001-expand' THEN
    RAISE EXCEPTION 'Explicit approval and rehearsal required: 001-expand';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS repliq_private;
REVOKE ALL ON SCHEMA repliq_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA repliq_private TO service_role;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.business_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.business_memberships (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.business_users(user_id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner','manager','agent','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  PRIMARY KEY (business_id,user_id)
);
CREATE INDEX business_memberships_user_scope ON public.business_memberships(user_id,business_id) WHERE status='active';
CREATE TABLE public.whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  phone_number_id text NOT NULL UNIQUE,
  waba_id text NOT NULL,
  meta_app_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  UNIQUE (id,business_id)
);
CREATE INDEX whatsapp_numbers_business ON public.whatsapp_numbers(business_id,id);
CREATE TABLE public.business_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE RESTRICT,
  configuration jsonb NOT NULL DEFAULT '{}', -- no tokens/secrets
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Future BFF opaque sessions: only hashes are stored; no browser database grants.
CREATE TABLE repliq_private.admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.business_users(user_id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_expiry ON repliq_private.admin_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE TABLE repliq_private.whatsapp_credential_versions (
  business_id uuid NOT NULL,
  whatsapp_number_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  secret_ref text NOT NULL CHECK (length(secret_ref)>0), -- exact external vault version; NO token
  status text NOT NULL CHECK (status IN ('pending','active','retired','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,whatsapp_number_id,version),
  FOREIGN KEY (whatsapp_number_id,business_id) REFERENCES public.whatsapp_numbers(id,business_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX whatsapp_credentials_one_active ON repliq_private.whatsapp_credential_versions(business_id,whatsapp_number_id) WHERE status='active';

-- Nullable expansion preserves all existing UUIDs and permits old writes until cutover.
ALTER TABLE public.conversations ADD COLUMN business_id uuid, ADD COLUMN whatsapp_number_id uuid;
ALTER TABLE public.messages ADD COLUMN business_id uuid, ADD COLUMN whatsapp_number_id uuid;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_scope_pair CHECK ((business_id IS NULL) = (whatsapp_number_id IS NULL)) NOT VALID;
ALTER TABLE public.messages ADD CONSTRAINT messages_scope_pair CHECK ((business_id IS NULL) = (whatsapp_number_id IS NULL)) NOT VALID;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_owned_number_fk FOREIGN KEY (whatsapp_number_id,business_id) REFERENCES public.whatsapp_numbers(id,business_id) NOT VALID;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_id_scope_key UNIQUE (id,business_id,whatsapp_number_id);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_scoped_customer_key UNIQUE (business_id,whatsapp_number_id,wa_contact_phone);
ALTER TABLE public.messages ADD CONSTRAINT messages_scoped_wamid_key UNIQUE (business_id,whatsapp_number_id,wa_message_id);
CREATE INDEX conversations_scope_recent ON public.conversations(business_id,whatsapp_number_id,last_message_at DESC);
CREATE INDEX messages_scope_recent ON public.messages(business_id,whatsapp_number_id,conversation_id,created_at);
-- Composite message->conversation FK deferred to 003: adding it now can make
-- the legacy PostgREST embedded messages relationship ambiguous.
CREATE TABLE public.customer_identities (
  business_id uuid NOT NULL,
  whatsapp_number_id uuid NOT NULL,
  identity text NOT NULL,
  conversation_id uuid NOT NULL,
  PRIMARY KEY (business_id,whatsapp_number_id,identity),
  FOREIGN KEY (conversation_id,business_id,whatsapp_number_id) REFERENCES public.conversations(id,business_id,whatsapp_number_id) ON DELETE RESTRICT
);
CREATE TABLE repliq_private.legacy_ownership_manifest (
  batch_id uuid NOT NULL,
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE RESTRICT,
  business_id uuid,
  whatsapp_number_id uuid,
  disposition text NOT NULL CHECK (disposition IN ('verified','quarantine')),
  evidence_ref text NOT NULL CHECK (length(evidence_ref)>0),
  conversation_fingerprint text NOT NULL CHECK (conversation_fingerprint ~ '^[a-f0-9]{64}$'),
  messages_fingerprint text NOT NULL CHECK (messages_fingerprint ~ '^[a-f0-9]{64}$'),
  reviewed_by uuid NOT NULL REFERENCES public.business_users(user_id),
  reviewed_at timestamptz NOT NULL,
  CHECK ((disposition='verified' AND business_id IS NOT NULL AND whatsapp_number_id IS NOT NULL)
      OR (disposition='quarantine' AND business_id IS NULL AND whatsapp_number_id IS NULL)),
  FOREIGN KEY (whatsapp_number_id,business_id) REFERENCES public.whatsapp_numbers(id,business_id)
);
-- No business, user, membership, number, credential, or ownership rows are seeded.

-- Immutable identifiers/ownership: transfer requires separate reviewed procedure.
CREATE FUNCTION repliq_private.protect_business_id() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Business ID is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER businesses_immutable_id BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION repliq_private.protect_business_id();
CREATE FUNCTION repliq_private.protect_number_ownership() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.id,NEW.business_id,NEW.phone_number_id,NEW.waba_id,NEW.meta_app_id)
    IS DISTINCT FROM (OLD.id,OLD.business_id,OLD.phone_number_id,OLD.waba_id,OLD.meta_app_id)
    THEN RAISE EXCEPTION 'WhatsApp ownership is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER whatsapp_numbers_immutable_owner BEFORE UPDATE ON public.whatsapp_numbers FOR EACH ROW EXECUTE FUNCTION repliq_private.protect_number_ownership();
REVOKE ALL ON FUNCTION repliq_private.protect_business_id(), repliq_private.protect_number_ownership() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION repliq_private.protect_credential_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.business_id,NEW.whatsapp_number_id,NEW.version,NEW.secret_ref)
    IS DISTINCT FROM (OLD.business_id,OLD.whatsapp_number_id,OLD.version,OLD.secret_ref)
    THEN RAISE EXCEPTION 'Credential versions are immutable; create a new version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credential_version_immutable BEFORE UPDATE ON repliq_private.whatsapp_credential_versions FOR EACH ROW EXECUTE FUNCTION repliq_private.protect_credential_version();
REVOKE ALL ON FUNCTION repliq_private.protect_credential_version() FROM PUBLIC,anon,authenticated;

-- Newly created tables deny browser access until the separately approved RLS stage.
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE repliq_private.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repliq_private.whatsapp_credential_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repliq_private.legacy_ownership_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.businesses,public.business_users,public.business_memberships,public.whatsapp_numbers,public.business_settings,public.customer_identities FROM PUBLIC,anon,authenticated;
REVOKE ALL ON repliq_private.admin_sessions,repliq_private.whatsapp_credential_versions,repliq_private.legacy_ownership_manifest FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.businesses,public.business_users,public.business_memberships,public.whatsapp_numbers,public.business_settings,public.customer_identities TO service_role;
GRANT ALL ON repliq_private.admin_sessions,repliq_private.whatsapp_credential_versions,repliq_private.legacy_ownership_manifest TO service_role;
COMMIT;
