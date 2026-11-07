import { requireAdminAuth } from "../admin-auth.js";
import { listAdminConversations } from "../supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
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

  try {
    const conversations = await listAdminConversations();
    return res.status(200).json({
      ok: true,
      conversations,
      serverTime: Date.now(),
    });
  } catch (err) {
    console.error("conversations.js: GET /api/admin/conversations error:");
    return res.status(500).json({ error: "Failed to list conversations", details: err.message });
  }
}
