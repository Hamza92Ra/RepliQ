import { sendWhatsAppText, sendWhatsAppTemplate, normalizeRecipient } from "./whatsapp.js";
import { isWithin24hWindow } from "./window.js";
import { getApprovedTemplates, buildTemplateComponents } from "./templates.js";
import { isSupabaseConfigured, setConversationTakeover } from "./supabase.js";
import { setTakeoverStatus as setRedisTakeoverStatus, setConversationMode as setRedisMode, getConversationOwner as getRedisOwner, getConversation as getRedisConversation, saveMessage as saveRedisMessage, deleteMessage as deleteRedisMessage, deleteConversation as deleteRedisConversation } from "./db.js";
const VALID_MODES = new Set(["bot", "human", "completed"]);
/**
 * Handles legacy dashboard admin actions (for backwards compatibility).
 */
export default async function handleAdminAction(req, res) {
  const key = req.query?.key;
  if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { phone, phoneNumberId: requestedPhoneNumberId, action, message, templateName, languageCode } = req.body;
  if (!phone || !action) {
    return res.status(400).json({ error: "Missing phone or action" });
  }

  try {
    if (VALID_MODES.has(action)) {
      if (action === "human") {
        await setRedisTakeoverStatus(phone, true);
        if (isSupabaseConfigured()) await setConversationTakeover(phone, true).catch(() => {});
      } else if (action === "bot") {
        await setRedisTakeoverStatus(phone, false);
        if (isSupabaseConfigured()) await setConversationTakeover(phone, false).catch(() => {});
      } else {
        await setRedisMode(phone, action);
      }
      return res.status(200).json({ ok: true, mode: action });
    }

    if (action === "reply") {
      const text = (message || "").trim();
      if (!text) return res.status(400).json({ error: "Missing message" });

      let phoneNumberId = String(requestedPhoneNumberId || "").trim() ||
        (await getRedisOwner(phone)) ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        process.env.DEFAULT_PHONE_NUMBER_ID;

      if (!phoneNumberId) {
        return res.status(400).json({ error: "Aucun numéro WhatsApp Business associé" });
      }

      const recipient = normalizeRecipient(phone);
      if (!recipient) return res.status(400).json({ error: "Numéro de destinataire invalide" });

      const convo = await getRedisConversation(recipient);
      if (!isWithin24hWindow(convo)) {
        return res.status(409).json({
          ok: false,
          code: "WINDOW_EXPIRED",
          error: "WINDOW_EXPIRED",
          details: "Fenêtre de 24h Meta expirée.",
        });
      }

      const providerResponse = await sendWhatsAppText(phoneNumberId, recipient, text);
      const wamid = providerResponse?.messages?.[0]?.id || null;

      // Automatically enable takeover on manual agent reply
      await setRedisTakeoverStatus(recipient, true).catch(() => {});
      if (isSupabaseConfigured()) {
        await setConversationTakeover(recipient, true).catch(() => {});
      }

      await saveRedisMessage(recipient, "agent", text, phoneNumberId, { wamid, status: "sent" }).catch(() => {});
      return res.status(200).json({ ok: true, wamid, status: "sent" });
    }

    if (action === "template") {
      let phoneNumberId = String(requestedPhoneNumberId || "").trim() ||
        (await getRedisOwner(phone)) ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        process.env.DEFAULT_PHONE_NUMBER_ID;

      const recipient = normalizeRecipient(phone);
      const chosenTemplate = templateName || process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
      const chosenLang = languageCode || process.env.WHATSAPP_TEMPLATE_LANG || "en_US";

      let templateComponents = req.body.components || null;
      if (!templateComponents && Array.isArray(req.body.variables) && req.body.variables.length > 0) {
        templateComponents = buildTemplateComponents(req.body.variables);
      }

      const providerResponse = await sendWhatsAppTemplate(phoneNumberId, recipient, chosenTemplate, chosenLang, templateComponents);
      const wamid = providerResponse?.messages?.[0]?.id || null;
      return res.status(200).json({ ok: true, wamid, status: "sent", template: chosenTemplate });
    }

    if (action === "get_templates" || action === "templates") {
      const phoneNumberId = String(requestedPhoneNumberId || "").trim() || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.DEFAULT_PHONE_NUMBER_ID;
      const templates = await getApprovedTemplates(phoneNumberId);
      return res.status(200).json({ ok: true, templates });
    }

    if (action === "delete_message") {
      const removed = await deleteRedisMessage(phone, req.body.messageId);
      return res.status(200).json({ ok: true, removed });
    }

    if (action === "delete") {
      const recipient = normalizeRecipient(phone);
      await deleteRedisConversation(recipient);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error("legacy-admin-action.js: Admin action failed:");
    return res.status(500).json({ ok: false, error: "Action failed" });
  }
}

