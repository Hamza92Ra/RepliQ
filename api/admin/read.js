import { requireAdminAuth } from "../../lib/admin-auth.js";
import { resetConversationUnread } from "../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!requireAdminAuth(req, res)) {
    return;
  }

  if (!process.env.SUPABASE_URL) {
    return res.status(500).json({ error: "Missing SUPABASE_URL" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { conversationId } = req.body || {};

  if (!conversationId) {
    return res.status(400).json({ error: "Missing conversationId parameter" });
  }

  try {
    const updated = await resetConversationUnread(conversationId);
    return res.status(200).json({
      ok: true,
      conversationId,
      unread_count: 0,
    });
  } catch (err) {
    console.error("POST /api/admin/read error:", err);
    return res.status(500).json({ error: "Failed to reset unread count", details: err.message });
  }
}
