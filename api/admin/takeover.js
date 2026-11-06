import { requireAdminAuth } from "../../lib/admin-auth.js";
import { setConversationTakeover } from "../../lib/supabase.js";

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

  const { conversationId, enabled } = req.body || {};

  if (!conversationId) {
    return res.status(400).json({ error: "Missing conversationId parameter" });
  }

  try {
    const updated = await setConversationTakeover(conversationId, enabled);
    return res.status(200).json({
      ok: true,
      conversationId,
      human_takeover: updated.human_takeover,
    });
  } catch (err) {
    console.error("POST /api/admin/takeover error:", err);
    return res.status(500).json({ error: "Failed to update takeover state", details: err.message });
  }
}
