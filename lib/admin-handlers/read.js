import { adminUnavailable, adminFailure } from "../admin-errors.js";
import { requireAdminAuth } from "../admin-auth.js";
import { resetConversationUnread } from "../supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!requireAdminAuth(req, res)) {
    return;
  }

  if (!process.env.SUPABASE_URL) {
    return adminUnavailable(res);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return adminUnavailable(res);
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
    console.error("read.js: POST /api/admin/read error:");
    return adminFailure(res);
  }
}
