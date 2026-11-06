import { waitUntil } from "@vercel/functions";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendSequentialWhatsAppTexts,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  normalizePhone,
  normalizeRecipient,
} from "../lib/whatsapp.js";
import {
  isWithin24hWindow,
  isWindowExpiredError,
  formatFriendlyError,
} from "../lib/window.js";
import {
  getApprovedTemplates,
  buildTemplateComponents,
} from "../lib/templates.js";
import { generateReply, transcribeAudio, splitWhatsAppMessages } from "../lib/ai.js";
import {
  notifyTeam,
  looksLikeFinalizeIntent,
  notifyHandoff,
  looksLikeHumanRequest,
  getHandoffMessage,
} from "../lib/notify.js";
import {
  isSupabaseConfigured,
  getSupabaseAdmin,
  upsertInboundConversation,
  storeInboundMessage,
  storeOutboundMessage,
  updateMessageStatusByWamid,
  getConversationHistoryForAI,
  setConversationTakeover,
} from "../lib/supabase.js";
import {
  saveMessage as saveRedisMessage,
  getHistory as getRedisHistory,
  getConversation as getRedisConversation,
  getConversationMode as getRedisMode,
  setConversationMode as setRedisMode,
  getTakeoverStatus as getRedisTakeoverStatus,
  setTakeoverStatus as setRedisTakeoverStatus,
  getConversationOwner as getRedisOwner,
  setConversationOwner as setRedisOwner,
  getBusinessConfig,
  claimMessage as claimRedisMessage,
  deleteConversation as deleteRedisConversation,
  deleteMessage as deleteRedisMessage,
  updateMessageStatus as updateRedisMessageStatus,
} from "../lib/db.js";

const FALLBACK_REPLY =
  "Désolé, j'ai eu un petit souci technique 🙏 Un membre de l'équipe RepliQ va vous répondre rapidement.";

const VOICE_FAIL_REPLY =
  "Désolé, je n'ai pas réussi à écouter votre message vocal 🙏 Pouvez-vous le reformuler en texte, ou le renvoyer ?";

const UNSUPPORTED_REPLY =
  "Merci pour votre message ! Je sais lire les messages texte et vocaux 🙏 Pour les images et documents, un membre de l'équipe va vous répondre directement.";

const VALID_MODES = new Set(["bot", "human", "completed"]);

// In-memory fallback dedup set
const seenMessageIds = new Set();
function claimMessageLocally(messageId) {
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  const timer = setTimeout(() => seenMessageIds.delete(messageId), 10 * 60 * 1000);
  if (timer?.unref) timer.unref();
  return true;
}

/** Short human-readable description of a non-text inbound message, for history. */
function describeInbound(message) {
  if (message.text?.body) return message.text.body;
  if (message.type === "audio") return "🎙️ Message vocal";
  if (message.type === "image") return "🖼️ Image";
  if (message.type === "document") return "📄 Document";
  if (message.type === "video") return "🎬 Vidéo";
  if (message.type === "location") return "📍 Position partagée";
  return `[${message.type || "message"}]`;
}

function runAsync(promise) {
  try {
    waitUntil(promise);
  } catch {
    promise.catch((err) => console.error("Unhandled async error:", err));
  }
}

/**
 * Handles legacy dashboard admin actions (for backwards compatibility).
 */
async function handleAdminAction(req, res) {
  const key = req.query.key;
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
    console.error("Admin action failed:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Action failed" });
  }
}

export default async function handler(req, res) {
  // 1. Webhook verification from Meta (GET request)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Webhook verified successfully.");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // 2. Incoming Webhook Events from Meta (POST request)
  if (req.method === "POST") {
    // Legacy dashboard actions
    if (req.body && typeof req.body === "object" && req.body.action && req.body.phone) {
      return handleAdminAction(req, res);
    }

    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      // Handle delivery status webhooks (sent / delivered / read / failed)
      const statusUpdate = value?.statuses?.[0];
      if (statusUpdate) {
        const wamid = statusUpdate.id;
        const status = statusUpdate.status;
        const recipientId = statusUpdate.recipient_id;

        let errorDetail = null;
        if (statusUpdate.errors && statusUpdate.errors.length > 0) {
          const e = statusUpdate.errors[0];
          errorDetail = isWindowExpiredError(e.message || e.title, e.code)
            ? "Fenêtre de 24h Meta expirée : envoyez un modèle WhatsApp pour réengager ce client."
            : formatFriendlyError(e.title ? `${e.title}: ${e.message || ""}` : e.message, e.code);
        }

        console.log(`WhatsApp delivery status update: wamid=${wamid}, status=${status}, error=${errorDetail}`);

        // Acknowledge receipt to Meta immediately
        res.status(200).send("EVENT_RECEIVED");

        runAsync(
          (async () => {
            if (isSupabaseConfigured()) {
              await updateMessageStatusByWamid(wamid, status, errorDetail);
            }
            if (process.env.UPSTASH_REDIS_REST_URL) {
              await updateRedisMessageStatus(recipientId, wamid, status, errorDetail).catch(() => {});
            }
          })()
        );
        return;
      }

      if (!message) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      const phoneNumberId =
        value?.metadata?.phone_number_id ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        process.env.DEFAULT_PHONE_NUMBER_ID;

      // Always return 200 quickly to Meta
      res.status(200).send("EVENT_RECEIVED");

      runAsync(processIncomingMessage({ message, contact, phoneNumberId }));
    } catch (err) {
      console.error("Webhook handler error:", err);
      if (!res.headersSent) {
        return res.status(200).send("EVENT_RECEIVED");
      }
    }
    return;
  }

  return res.status(405).send("Method Not Allowed");
}

/**
 * Process inbound WhatsApp message:
 * - Upsert conversation in Supabase
 * - Store inbound message (dedup by wa_message_id)
 * - Check human_takeover flag: if true, bot stays silent
 * - Otherwise: load last ~10 messages as history, call generateReply(), and store bot reply
 */
async function processIncomingMessage({ message, contact, phoneNumberId }) {
  try {
    const rawFrom = message.from || message.from_user_id;
    if (!rawFrom) {
      console.error("processIncomingMessage: message missing 'from' and 'from_user_id'", JSON.stringify(message));
      return;
    }

    const from = normalizePhone(rawFrom);
    const contactName = contact?.profile?.name || null;
    const inboundTs = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();

    // Deduplication check via local cache & Redis if available
    let claimed = false;
    if (process.env.UPSTASH_REDIS_REST_URL) {
      try {
        claimed = await claimRedisMessage(message.id);
      } catch (redisErr) {
        claimed = claimMessageLocally(message.id);
      }
    } else {
      claimed = claimMessageLocally(message.id);
    }

    if (!claimed) {
      console.log(`[takeover=unknown] [${from}] Duplicate delivery detected for message, skipping: ${message.id}`);
      return;
    }

    // 1. Human Takeover Check FIRST: Fail-Safe read BEFORE any AI call, voice transcription, or markAsRead
    let isHumanTakeover = false;
    try {
      const takeoverStatus = await getRedisTakeoverStatus(from);
      isHumanTakeover = Boolean(takeoverStatus?.human_takeover);
    } catch (lookupErr) {
      // FAIL SAFE: if the lookup fails, do not auto-reply, log the error
      console.error(`[Fail-safe] [takeover=error] [${from}] Error checking takeover flag. Halting bot to prevent accidental reply:`, lookupErr);
      return;
    }

    const initialDisplayBody = describeInbound(message);

    // If takeover is active:
    // Store message in database (Supabase + Redis) so dashboard sees it, and return immediately.
    // DO NOT call AI, do not transcribe voice, do not send any message.
    if (isHumanTakeover) {
      console.log(`[takeover=true] [${from}] Bot silent (human takeover active)`);

      if (isSupabaseConfigured()) {
        try {
          const conversation = await upsertInboundConversation(from, contactName, inboundTs);
          await storeInboundMessage({
            conversationId: conversation.id,
            waMessageId: message.id,
            type: message.type || "text",
            body: initialDisplayBody,
            createdAt: inboundTs,
          });
        } catch (dbErr) {
          console.error(`[takeover=true] [${from}] Supabase store failed:`, dbErr);
        }
      }

      if (process.env.UPSTASH_REDIS_REST_URL) {
        try {
          await saveRedisMessage(from, "user", initialDisplayBody, phoneNumberId, {
            id: message.id,
            wamid: message.id,
            ts: inboundTs,
          });
        } catch (redisErr) {
          console.error(`[takeover=true] [${from}] Redis store failed:`, redisErr);
        }
      }

      return;
    }

    console.log(`[takeover=false] [${from}] Bot auto-reply processing`);

    // Extract message content: transcribe audio or use text/interactive
    let text = message.text?.body?.trim();
    let voiceNote = false;

    if (!text && message.type === "audio" && message.audio?.id) {
      try {
        await markAsRead(phoneNumberId, message.id);
        const mediaUrl = await getMediaUrl(message.audio.id);
        const audioBytes = await downloadMedia(mediaUrl);
        text = await transcribeAudio(audioBytes, "voice.ogg");
        voiceNote = true;
      } catch (audioErr) {
        console.error("Voice message handling failed:", audioErr);
        await sendWhatsAppText(phoneNumberId, from, VOICE_FAIL_REPLY);
        return;
      }
    }

    if (!text && message.interactive) {
      text =
        message.interactive.button_reply?.title ||
        message.interactive.list_reply?.title ||
        "";
    }

    // If message is unsupported media (e.g. image, video, doc) and no text could be extracted
    if (!text) {
      await sendWhatsAppText(phoneNumberId, from, UNSUPPORTED_REPLY);
      return;
    }

    const displayBody = voiceNote ? `🎙️ Message vocal (transcription) : ${text}` : text;
    let conversation = null;

    // Store inbound message now that text/transcription is complete
    if (isSupabaseConfigured()) {
      try {
        conversation = await upsertInboundConversation(from, contactName, inboundTs);
        const storeResult = await storeInboundMessage({
          conversationId: conversation.id,
          waMessageId: message.id,
          type: message.type || "text",
          body: displayBody,
          createdAt: inboundTs,
        });

        if (storeResult?.duplicate) {
          console.log("Message already stored in database, skipping:", message.id);
          return;
        }
      } catch (dbErr) {
        console.error("Supabase storage error for inbound message:", dbErr);
      }
    }

    if (process.env.UPSTASH_REDIS_REST_URL) {
      try {
        await saveRedisMessage(from, "user", displayBody, phoneNumberId, {
          id: message.id,
          wamid: message.id,
          ts: inboundTs,
        });
      } catch (redisErr) {
        console.error("Redis mirror error:", redisErr);
      }
    }

    await markAsRead(phoneNumberId, message.id);

    // 2. Check if client explicitly asks for a human / advisor
    if (looksLikeHumanRequest(text)) {
      console.log(`[takeover=false] [${from}] Customer requested human advisor -> handoff triggered`);
      const handoffMsg = getHandoffMessage(text);
      let sendRes = null;
      try {
        sendRes = await sendWhatsAppText(phoneNumberId, from, handoffMsg);
      } catch (sendErr) {
        console.error("Failed to send handoff message:", sendErr);
      }
      const handoffWamid = sendRes?.messages?.[0]?.id || null;

      // Enable human takeover so bot stays silent
      if (isSupabaseConfigured() && conversation?.id) {
        await setConversationTakeover(conversation.id, true).catch(() => {});
        await storeOutboundMessage({
          conversationId: conversation.id,
          waMessageId: handoffWamid,
          sender: "bot",
          type: "text",
          body: handoffMsg,
          status: "sent",
        }).catch(() => {});
      }
      if (process.env.UPSTASH_REDIS_REST_URL) {
        await setRedisTakeoverStatus(from, true).catch(() => {});
        await saveRedisMessage(from, "assistant", handoffMsg, phoneNumberId, {
          wamid: handoffWamid,
          status: "sent",
        }).catch(() => {});
      }

      notifyHandoff({
        from,
        message: text,
        reason: "Le client a demandé à parler à un conseiller humain",
      }).catch((e) => console.error("notifyHandoff error:", e));

      return;
    }

    // 3. Load conversation memory: last ~10 messages
    let history = [];
    if (isSupabaseConfigured() && conversation?.id) {
      try {
        const fullHistory = await getConversationHistoryForAI(conversation.id, 10);
        // Exclude the current message we just stored so generateReply doesn't duplicate it
        history = fullHistory.slice(0, -1);
      } catch (histErr) {
        console.error("Error loading history from Supabase:", histErr);
      }
    } else if (process.env.UPSTASH_REDIS_REST_URL) {
      try {
        const fullHistory = await getRedisHistory(from, 10);
        history = fullHistory.slice(0, -1);
      } catch (histErr) {
        console.error("Error loading history from Redis:", histErr);
      }
    }

    // Team notification if intent detected
    if (looksLikeFinalizeIntent(text)) {
      notifyTeam({ from, message: text }).catch((e) =>
        console.error("notifyTeam failed:", e)
      );
    }

    // 4. Per-business prompt configuration (if configured)
    let systemPrompt;
    try {
      const config = await getBusinessConfig(phoneNumberId);
      if (config?.systemPrompt) {
        systemPrompt = config.systemPrompt;
        if (config.notes) {
          systemPrompt += `\n\nNotes / idées spécifiques du projet :\n${config.notes}`;
        }
      }
    } catch (cfgErr) {
      console.error("Business config load failed:", cfgErr);
    }

    // 5. Generate AI Reply with Handoff Detection
    let reply;
    let handoffRequired = false;
    let handoffReason = null;

    try {
      reply = await generateReply(text, history, systemPrompt);
      if (reply.includes("[HANDOFF]") || reply.toLowerCase().includes("transmets votre demande à un conseiller")) {
        handoffRequired = true;
        handoffReason = "Question hors contexte ou transfert conseiller";
        reply = reply.replace(/\[HANDOFF\]/g, "").trim();
        if (!reply) reply = getHandoffMessage(text);
      }
    } catch (aiErr) {
      console.error("generateReply failed, triggering handoff:", aiErr);
      handoffRequired = true;
      handoffReason = `Erreur IA : ${aiErr.message}`;
      reply = getHandoffMessage(text);
    }

    if (handoffRequired) {
      let sendRes = null;
      try {
        sendRes = await sendWhatsAppText(phoneNumberId, from, reply);
      } catch (sendErr) {
        console.error("Failed to send handoff message:", sendErr);
      }
      const wamid = sendRes?.messages?.[0]?.id || null;

      // Enable takeover and notify
      if (isSupabaseConfigured() && conversation?.id) {
        await setConversationTakeover(conversation.id, true).catch(() => {});
        await storeOutboundMessage({
          conversationId: conversation.id,
          waMessageId: wamid,
          sender: "bot",
          type: "text",
          body: reply,
          status: "sent",
        }).catch(() => {});
      }
      if (process.env.UPSTASH_REDIS_REST_URL) {
        await setRedisTakeoverStatus(from, true).catch(() => {});
        await saveRedisMessage(from, "assistant", reply, phoneNumberId, {
          wamid,
          status: "sent",
        }).catch(() => {});
      }

      console.log(`[takeover=false] [${from}] Handoff triggered by AI response -> takeover enabled (${handoffReason})`);
      notifyHandoff({
        from,
        message: text,
        reason: handoffReason || "Conseiller requis",
      }).catch((e) => console.error("notifyHandoff error:", e));

      return;
    }

    // 6. Send bot reply via WhatsApp Cloud API (split into short messages with ~1s delay if long)
    const messageParts = splitWhatsAppMessages(reply);
    let providerResponse = null;
    try {
      providerResponse = await sendSequentialWhatsAppTexts(phoneNumberId, from, messageParts, 1000);
      console.log(`[takeover=false] [${from}] Bot replied successfully (${messageParts.length} message(s))`);
    } catch (sendErr) {
      if (isWindowExpiredError(sendErr?.message, sendErr?.code)) {
        console.warn(`[Bot] Send failed with 131047 (window expired) for ${from}`);
        return;
      }
      console.error("Final WhatsApp send failed for", from, ":", sendErr);
      return;
    }

    const botWamid = providerResponse?.messages?.[0]?.id || null;

    // 7. Store outbound message with sender = 'bot'
    if (isSupabaseConfigured() && conversation?.id) {
      try {
        await storeOutboundMessage({
          conversationId: conversation.id,
          waMessageId: botWamid,
          sender: "bot",
          type: "text",
          body: reply,
          status: "sent",
        });
      } catch (dbErr) {
        console.error("Failed to store bot outbound reply in Supabase:", dbErr);
      }
    }

    if (process.env.UPSTASH_REDIS_REST_URL) {
      saveRedisMessage(from, "assistant", reply, phoneNumberId, {
        wamid: botWamid,
        status: "sent",
      }).catch((e) => console.error("Redis save assistant reply failed:", e));
    }
  } catch (err) {
    console.error("processIncomingMessage background error:", err);
  }
}
