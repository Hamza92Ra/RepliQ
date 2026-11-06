import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "./whatsapp.js";

let supabaseAdminInstance = null;

/**
 * Returns a Supabase client using the service role key (server-side only).
 * Bypasses Row Level Security for admin backend tasks.
 * Fails with a clear error if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL");
  }
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseAdminInstance;
}

/**
 * Check whether Supabase credentials are configured.
 */
export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Upsert a conversation upon receiving an inbound WhatsApp message.
 * Updates last_message_at, last_inbound_at, and increments unread_count.
 */
export async function upsertInboundConversation(phone, contactName, messageTimestamp) {
  const supabase = getSupabaseAdmin();
  const normalizedPhone = normalizePhone(phone);
  const ts = messageTimestamp
    ? new Date(typeof messageTimestamp === "number" ? messageTimestamp : Number(messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();

  // Check for existing conversation
  const { data: existing, error: selectErr } = await supabase
    .from("conversations")
    .select("*")
    .eq("wa_contact_phone", normalizedPhone)
    .maybeSingle();

  if (selectErr) {
    console.error("Error looking up conversation:", selectErr);
    throw selectErr;
  }

  if (existing) {
    const updates = {
      last_message_at: ts,
      last_inbound_at: ts,
      unread_count: (existing.unread_count || 0) + 1,
    };
    if (contactName && !existing.contact_name) {
      updates.contact_name = contactName;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("conversations")
      .update(updates)
      .eq("id", existing.id)
      .select()
      .single();

    if (updateErr) {
      console.error("Error updating conversation:", updateErr);
      throw updateErr;
    }
    return updated;
  }

  // Insert new conversation
  const newConvo = {
    wa_contact_phone: normalizedPhone,
    contact_name: contactName || null,
    human_takeover: false,
    last_message_at: ts,
    last_inbound_at: ts,
    unread_count: 1,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("conversations")
    .insert(newConvo)
    .select()
    .single();

  if (insertErr) {
    // Handle concurrent insertion race condition gracefully
    if (insertErr.code === "23505") {
      const { data: retry } = await supabase
        .from("conversations")
        .select("*")
        .eq("wa_contact_phone", phone)
        .single();
      if (retry) {
        const { data: updated } = await supabase
          .from("conversations")
          .update({
            last_message_at: ts,
            last_inbound_at: ts,
            unread_count: (retry.unread_count || 0) + 1,
          })
          .eq("id", retry.id)
          .select()
          .single();
        return updated;
      }
    }
    console.error("Error creating conversation:", insertErr);
    throw insertErr;
  }

  return inserted;
}

/**
 * Store an inbound message from a customer.
 * Deduplicates by wa_message_id. Returns { duplicate: true } if already stored.
 */
export async function storeInboundMessage({ conversationId, waMessageId, type, body, createdAt }) {
  const supabase = getSupabaseAdmin();

  if (waMessageId) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();

    if (existing) {
      return { duplicate: true, message: existing };
    }
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      wa_message_id: waMessageId || null,
      direction: "inbound",
      sender: "customer",
      type: type || "text",
      body: body || "",
      status: null,
      error: null,
      created_at: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { duplicate: true };
    }
    console.error("Error storing inbound message:", error);
    throw error;
  }

  return { duplicate: false, message: data };
}

/**
 * Store an outbound message (from bot or human agent).
 */
export async function storeOutboundMessage({
  conversationId,
  waMessageId,
  sender, // 'bot' | 'human'
  type = "text",
  body,
  status = "sent",
  error = null,
  createdAt,
}) {
  const supabase = getSupabaseAdmin();
  const ts = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();

  const { data, error: insertErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      wa_message_id: waMessageId || null,
      direction: "outbound",
      sender,
      type,
      body,
      status,
      error,
      created_at: ts,
    })
    .select()
    .single();

  if (insertErr) {
    console.error("Error storing outbound message:", insertErr);
    throw insertErr;
  }

  // Update conversation's last_message_at
  try {
    await supabase
      .from("conversations")
      .update({ last_message_at: ts })
      .eq("id", conversationId);
  } catch (err) {
    console.error("Error updating conversation last_message_at:", err);
  }

  return data;
}

/**
 * Handle delivery status update from WhatsApp Webhook.
 * Status: 'sent' | 'delivered' | 'read' | 'failed'
 */
export async function updateMessageStatusByWamid(waMessageId, status, errorInfo = null) {
  if (!waMessageId) return null;
  const supabase = getSupabaseAdmin();

  const updateFields = { status };
  if (errorInfo) {
    updateFields.error = errorInfo;
  }

  const { data, error } = await supabase
    .from("messages")
    .update(updateFields)
    .eq("wa_message_id", waMessageId)
    .select();

  if (error) {
    console.error("Error updating message status:", error);
    return null;
  }

  return data;
}

/**
 * Retrieve the most recent ~10 messages for a conversation,
 * returned in chronological order (oldest to newest) for AI history context.
 */
export async function getConversationHistoryForAI(conversationId, limit = 10) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("messages")
    .select("sender, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching message history for AI:", error);
    return [];
  }

  // Reverse to get chronological order (oldest first)
  const ordered = (data || []).reverse();

  return ordered.map((m) => ({
    role: m.sender === "customer" ? "user" : "assistant",
    content: m.body || "",
  }));
}

/**
 * List all conversations sorted with newest active first.
 * Attaches the last message snippet and computes 24h window status.
 */
export async function listAdminConversations() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("conversations")
    .select(`
      *,
      messages (
        id,
        body,
        sender,
        status,
        created_at
      )
    `)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("Error listing admin conversations:", error);
    throw error;
  }

  const now = Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  return (data || []).map((convo) => {
    // Sort messages to find the most recent one
    const msgs = convo.messages || [];
    msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const lastMessage = msgs[0] || null;

    // Calculate 24h window
    let isWindowOpen = false;
    let windowExpiresAt = null;
    let windowRemainingMs = 0;

    if (convo.last_inbound_at) {
      const lastInboundTs = new Date(convo.last_inbound_at).getTime();
      if (!Number.isNaN(lastInboundTs)) {
        windowExpiresAt = lastInboundTs + TWENTY_FOUR_HOURS_MS;
        windowRemainingMs = Math.max(0, windowExpiresAt - now);
        isWindowOpen = windowRemainingMs > 0;
      }
    }

    const { messages: _discard, ...convoData } = convo;

    return {
      ...convoData,
      last_message: lastMessage,
      is_window_open: isWindowOpen,
      window_expires_at: windowExpiresAt ? new Date(windowExpiresAt).toISOString() : null,
      window_remaining_ms: windowRemainingMs,
    };
  });
}

/**
 * Get all messages for a conversation, sorted chronologically.
 */
export async function getConversationMessages(conversationId) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages for conversation:", error);
    throw error;
  }

  return data || [];
}

/**
 * Toggle human takeover for a conversation (accepts UUID id or phone number).
 */
export async function setConversationTakeover(conversationId, enabled, { syncRedis = true } = {}) {
  const supabase = getSupabaseAdmin();
  const idOrPhone = String(conversationId);

  const query = supabase
    .from("conversations")
    .update({ human_takeover: Boolean(enabled) });

  if (idOrPhone.includes("-") && idOrPhone.length > 20) {
    query.eq("id", idOrPhone);
  } else {
    query.eq("wa_contact_phone", normalizePhone(idOrPhone));
  }

  const { data, error } = await query.select();

  if (error) {
    console.error("Error setting human takeover:", error);
    throw error;
  }

  const updated = data?.[0] || null;
  if (syncRedis && updated?.wa_contact_phone && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const { setTakeoverStatus } = await import("./db.js");
      await setTakeoverStatus(updated.wa_contact_phone, Boolean(enabled));
    } catch {}
  }

  return updated;
}

/**
 * Reset unread_count to 0 for a conversation.
 */
export async function resetConversationUnread(conversationId) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId)
    .select()
    .single();

  if (error) {
    console.error("Error resetting unread count:", error);
    throw error;
  }

  return data;
}
