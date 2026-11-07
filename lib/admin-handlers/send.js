import { adminUnavailable, adminFailure } from "../admin-errors.js";
import { requireAdminAuth } from "../admin-auth.js";
import { getSupabaseAdmin, storeOutboundMessage } from "../supabase.js";
import { sendWhatsAppText, normalizeRecipient } from "../whatsapp.js";
import { isWindowExpiredError, formatFriendlyError, TWENTY_FOUR_HOURS_MS } from "../window.js";

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
  if (!process.env.WHATSAPP_TOKEN) {
    return adminUnavailable(res);
  }

  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.DEFAULT_PHONE_NUMBER_ID;

  if (!phoneNumberId) {
    return adminUnavailable(res);
  }

  const { conversationId, text } = req.body || {};

  if (!conversationId) {
    return res.status(400).json({ error: "Paramètre conversationId manquant." });
  }

  const trimmedText = (text || "").trim();
  if (!trimmedText) {
    return res.status(400).json({ error: "Le texte du message ne peut pas être vide." });
  }

  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch conversation details to inspect 24h customer care window
    const { data: conversation, error: fetchErr } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();

    if (fetchErr || !conversation) {
      return res.status(404).json({ error: "Conversation introuvable." });
    }

    // 2. IMPORTANT: Enforce Meta 24-hour window strictly before calling Meta
    const lastInboundTs = conversation.last_inbound_at
      ? new Date(conversation.last_inbound_at).getTime()
      : null;

    const now = Date.now();
    const isWindowOpen =
      lastInboundTs !== null &&
      !Number.isNaN(lastInboundTs) &&
      now - lastInboundTs <= TWENTY_FOUR_HOURS_MS;

    if (!isWindowOpen) {
      return res.status(409).json({
        ok: false,
        code: "WINDOW_EXPIRED",
        error: "WINDOW_EXPIRED",
        message:
          "La fenêtre de 24h Meta a expiré. Un modèle WhatsApp approuvé est requis pour relancer ce contact (les messages libres sont bloqués par Meta).",
      });
    }

    const recipient = normalizeRecipient(conversation.wa_contact_phone);

    // 3. Send message via WhatsApp Cloud API
    let providerResponse;
    try {
      providerResponse = await sendWhatsAppText(phoneNumberId, recipient, trimmedText);
    } catch (sendErr) {
      console.error("send.js: WhatsApp send failed for human admin:");
      const is131047 = isWindowExpiredError(sendErr?.message, sendErr?.code);
      const friendlyErr = formatFriendlyError(sendErr?.message, sendErr?.code);

      // Store failed message in database so it appears in history
      const failedMsg = await storeOutboundMessage({
        conversationId,
        waMessageId: null,
        sender: "human",
        type: "text",
        body: trimmedText,
        status: "failed",
        error: friendlyErr,
      }).catch((e) => console.error("send.js: Failed to store failed human message:"));

      const status = is131047 ? 409 : 502;
      return res.status(status).json({
        ok: false,
        code: is131047 ? "WINDOW_EXPIRED" : "SEND_FAILED",
        error: friendlyErr,
        message: failedMsg,
      });
    }

    const wamid = providerResponse?.messages?.[0]?.id || null;

    // Automatically enable human takeover on manual message send
    try {
      await supabase
        .from("conversations")
        .update({ human_takeover: true, last_message_at: new Date().toISOString() })
        .eq("id", conversationId);

      if (process.env.UPSTASH_REDIS_REST_URL && conversation?.wa_contact_phone) {
        const { setTakeoverStatus } = await import("../db.js");
        await setTakeoverStatus(conversation.wa_contact_phone, true).catch(() => {});
      }
    } catch (takeoverErr) {
      console.error("send.js: Failed to auto-enable human takeover on send:");
    }

    // 4. Store outbound message with sender = 'human'
    const storedMessage = await storeOutboundMessage({
      conversationId,
      waMessageId: wamid,
      sender: "human",
      type: "text",
      body: trimmedText,
      status: "sent",
    });

    return res.status(200).json({
      ok: true,
      message: storedMessage,
      wamid,
    });
  } catch (err) {
    console.error("send.js: POST /api/admin/send error:");
    return adminFailure(res);
  }
}
