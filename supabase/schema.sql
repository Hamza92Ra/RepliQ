-- Migration: RepliQ WhatsApp Admin Inbox Schema
-- Creates tables for conversations and messages with Realtime and RLS enabled.

-- 1. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_contact_phone TEXT UNIQUE NOT NULL,
    contact_name TEXT,
    human_takeover BOOLEAN DEFAULT FALSE NOT NULL,
    last_message_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    unread_count INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    wa_message_id TEXT UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender TEXT NOT NULL CHECK (sender IN ('customer', 'bot', 'human')),
    type TEXT DEFAULT 'text',
    body TEXT,
    status TEXT CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_messages_convo_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(wa_contact_phone);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Server-side writes run with SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- Allow SELECT for anon / authenticated so browser can subscribe to Supabase Realtime safely.
CREATE POLICY "Allow read conversations" ON conversations
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Allow read messages" ON messages
    FOR SELECT TO anon, authenticated
    USING (true);

-- 5. Enable Supabase Realtime
-- Adds tables to the realtime publication so live changes are broadcast to subscribed clients.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    EXCEPTION WHEN duplicate_object THEN
      -- Table already in publication
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    EXCEPTION WHEN duplicate_object THEN
      -- Table already in publication
    END;
  END IF;
END $$;
