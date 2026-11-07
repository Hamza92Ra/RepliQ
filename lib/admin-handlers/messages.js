import { adminUnavailable, adminFailure } from "../admin-errors.js";
import { requireAdminAuth } from "../admin-auth.js";
import { getConversationMessages } from "../supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
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

  const { conversationId } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: "Missing conversationId parameter" });
  }

  try {
    const messages = await getConversationMessages(conversationId);
    return res.status(200).json({
      ok: true,
      conversationId,
      messages,
    });
  } catch (err) {
    console.error("messages.js: GET /api/admin/messages error:");
    return adminFailure(res);
  }
}
