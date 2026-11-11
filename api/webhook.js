import { assertDemoInboundScope, assertDemoReceiptScope, resolveBusinessPrompt } from "../lib/business-prompt.js";
import { authenticateMetaRequest } from "../lib/webhook-security.js";
import { supabasePrimaryEnabled, shouldUseRedisMirror } from "../lib/storage-backend.js";
import { resolveWhatsAppCredentials } from "../lib/whatsapp-credentials.js";

export const config = { api: { bodyParser: false } };

import { waitUntil } from "@vercel/functions";
import {
  sendWhatsAppText,
  sendSequentialWhatsAppTexts,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  extractCustomerIdentity,
} from "../lib/whatsapp.js";
import {
  isWindowExpiredError,
  formatFriendlyError,
} from "../lib/window.js";
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
  upsertInboundConversation,
  storeInboundMessage,
  storeOutboundMessage,
  updateMessageStatusByWamid,
  getConversationHistoryForAI,
  setConversationTakeover,
  getSupabaseTakeoverStatus,
} from "../lib/supabase.js";
import {
  saveMessage as saveRedisMessage,
  getHistory as getRedisHistory,
  getTakeoverStatus as getRedisTakeoverStatus,
  setTakeoverStatus as setRedisTakeoverStatus,
  claimMessage as claimRedisMessage,
  updateMessageStatus as updateRedisMessageStatus,
} from "../lib/db.js";

const FALLBACK_REPLY =
  "Désolé, j'ai eu un petit souci technique 🙏 Un membre de l'équipe RepliQ va vous répondre rapidement.";

const VOICE_FAIL_REPLY =
  "Désolé, je n'ai pas réussi à écouter votre message vocal 🙏 Pouvez-vous le reformuler en texte, ou le renvoyer ?";

const UNSUPPORTED_REPLY =
  "Merci pour votre message ! Je sais lire les messages texte et vocaux 🙏 Pour les images et documents, un membre de l'équipe va vous répondre directement.";

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
    promise.catch((err) => console.error("webhook.js: Unhandled async error:"));
  }
}

export default async function handler(req, res) {
  // 1. Webhook verification from Meta (GET request)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && process.env.VERIFY_TOKEN && token === process.env.VERIFY_TOKEN) {
      console.log("webhook.js: Webhook verified successfully.");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // 2. Incoming Webhook Events from Meta (POST request)
  if (req.method === "POST") {
    if (!(await authenticateMetaRequest(req, res))) return;

    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      if (value?.metadata?.phone_number_id) {
        resolveWhatsAppCredentials(value.metadata.phone_number_id, { requireToken: false });
      }
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      // Handle delivery status webhooks (sent / delivered / read / failed)
      const statusUpdate = value?.statuses?.[0];
      if (statusUpdate) {
        const wamid = statusUpdate.id;
        const status = statusUpdate.status;
        const recipientId = statusUpdate.recipient_id;
        await assertDemoReceiptScope({
          phoneNumberId: value?.metadata?.phone_number_id,
          authenticatedPhoneNumberId: value?.metadata?.phone_number_id,
          recipientId, messageId: wamid,
        });

        let errorDetail = null;
        if (statusUpdate.errors && statusUpdate.errors.length > 0) {
          const e = statusUpdate.errors[0];
          errorDetail = isWindowExpiredError(e.message || e.title, e.code)
            ? "Fenêtre de 24h Meta expirée : envoyez un modèle WhatsApp pour réengager ce client."
            : formatFriendlyError(e.title ? `${e.title}: ${e.message || ""}` : e.message, e.code);
        }

        console.log("webhook.js: WhatsApp delivery status received");

        // Acknowledge receipt to Meta immediately
        res.status(200).send("EVENT_RECEIVED");

        runAsync(
          (async () => {
            if (isSupabaseConfigured()) {
              await updateMessageStatusByWamid(wamid, status, errorDetail);
            }
            if (shouldUseRedisMirror()) {
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

      runAsync(processIncomingMessage({ message, contact, phoneNumberId, authenticatedPhoneNumberId: value?.metadata?.phone_number_id }));
    } catch (err) {
      console.error("webhook.js: Webhook handler error:");
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
async function processIncomingMessage({ message, contact, phoneNumberId, authenticatedPhoneNumberId }) {
  try {
    const identity = extractCustomerIdentity(message, contact);
    const from = identity.primaryId;
    if (!from) {
      console.error("webhook.js: processIncomingMessage: message missing identifiable recipient ('from', 'from_user_id', or contact id)");
      return;
    }

    await assertDemoInboundScope({ phoneNumberId, authenticatedPhoneNumberId, identity });

    const contactName = identity.profileName;
    const userId = identity.userId;
    const phone = identity.phone;
    const inboundTs = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();

    // In Supabase-primary mode durable wa_message_id dedup happens when the
    // inbound row is stored. The local claim is only a short-lived optimization.
    // Redis remains the dedup source in legacy compatibility mode.
    let claimed = false;
    if (supabasePrimaryEnabled() && !isSupabaseConfigured()) {
      console.error("webhook.js: Supabase-primary storage unavailable; bot stopped");
      return;
    }
    if (shouldUseRedisMirror()) {
      try {
        claimed = await claimRedisMessage(message.id);
      } catch (redisErr) {
        claimed = claimMessageLocally(message.id);
      }
    } else {
      claimed = claimMessageLocally(message.id);
    }

    if (!claimed) {
      console.log("webhook.js: Duplicate inbound delivery skipped");
      return;
    }

    // 1. Human Takeover Check FIRST: Fail-Safe read BEFORE any AI call, voice transcription, or markAsRead
    let isHumanTakeover = false;
    try {
      const takeoverStatus = supabasePrimaryEnabled()
        ? await getSupabaseTakeoverStatus({ primaryId: from, phone, userId })
        : await getRedisTakeoverStatus(from);
      isHumanTakeover = Boolean(takeoverStatus?.human_takeover);
    } catch (lookupErr) {
      // FAIL SAFE: if the lookup fails, do not auto-reply, log the error
      console.error("webhook.js: Takeover state unavailable; bot stopped");
      return;
    }

    const initialDisplayBody = describeInbound(message);

    // If takeover is active:
    // Store message in database (Supabase + Redis) so dashboard sees it, and return immediately.
    // DO NOT call AI, do not transcribe voice, do not send any message.
    if (isHumanTakeover) {
      console.log("webhook.js: Human takeover active");

      if (isSupabaseConfigured()) {
        try {
          const conversation = await upsertInboundConversation(from, contactName, inboundTs, { userId, phone });
          await storeInboundMessage({
            conversationId: conversation.id,
            waMessageId: message.id,
            type: message.type || "text",
            body: initialDisplayBody,
            createdAt: inboundTs,
          });
        } catch (dbErr) {
          console.error("webhook.js: Human takeover storage failed");
        }
      }

      if (shouldUseRedisMirror()) {
        try {
          await saveRedisMessage(from, "user", initialDisplayBody, phoneNumberId, {
            id: message.id,
            wamid: message.id,
            ts: inboundTs,
            userId,
            phone,
            profileName: contactName,
          });
        } catch (redisErr) {
          console.error("webhook.js: Human takeover active");
        }
      }

      return;
    }

    console.log("webhook.js: Bot processing event");

    // Extract message content: transcribe audio or use text/interactive
    let text = message.text?.body?.trim();
    let voiceNote = false;

    if (!text && message.type === "audio" && message.audio?.id) {
      try {
        await markAsRead(phoneNumberId, message.id);
        const mediaUrl = await getMediaUrl(message.audio.id, phoneNumberId);
        const audioBytes = await downloadMedia(mediaUrl, phoneNumberId);
        text = await transcribeAudio(audioBytes, "voice.ogg");
        voiceNote = true;
      } catch (audioErr) {
        console.error("webhook.js: Voice message handling failed:");
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
        conversation = await upsertInboundConversation(from, contactName, inboundTs, { userId, phone });
        const storeResult = await storeInboundMessage({
          conversationId: conversation.id,
          waMessageId: message.id,
          type: message.type || "text",
          body: displayBody,
          createdAt: inboundTs,
        });

        if (storeResult?.duplicate) {
          console.log("webhook.js: Message already stored in database, skipping:");
          return;
        }
      } catch (dbErr) {
        console.error("webhook.js: Supabase storage error for inbound message:");
        // No AI reply without a durable inbound record during the cutover.
        if (supabasePrimaryEnabled()) return;
      }
    }

    if (shouldUseRedisMirror()) {
      try {
        await saveRedisMessage(from, "user", displayBody, phoneNumberId, {
          id: message.id,
          wamid: message.id,
          ts: inboundTs,
          userId,
          phone,
          profileName: contactName,
        });
      } catch (redisErr) {
        console.error("webhook.js: Redis mirror error:");
      }
    }

    await markAsRead(phoneNumberId, message.id);

    // 2. Check if client explicitly asks for a human / advisor
    if (looksLikeHumanRequest(text)) {
      console.log("webhook.js: Bot processing event");
      const handoffMsg = getHandoffMessage(text);
      let sendRes = null;
      try {
        sendRes = await sendWhatsAppText(phoneNumberId, from, handoffMsg);
      } catch (sendErr) {
        console.error("webhook.js: Failed to send handoff message:");
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
      if (shouldUseRedisMirror()) {
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
      }).catch((e) => console.error("webhook.js: notifyHandoff error:"));

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
        console.error("webhook.js: Error loading history from Supabase:");
      }
    } else if (shouldUseRedisMirror()) {
      try {
        const fullHistory = await getRedisHistory(from, 10);
        history = fullHistory.slice(0, -1);
      } catch (histErr) {
        console.error("webhook.js: Error loading history from Redis:");
      }
    }

    // Team notification if intent detected
    if (looksLikeFinalizeIntent(text)) {
      notifyTeam({ from, message: text }).catch((e) =>
        console.error("webhook.js: notifyTeam failed:")
      );
    }

    // Shared server-controlled selection; enabled lookup errors stop processing.
    const systemPrompt = await resolveBusinessPrompt({ phoneNumberId, authenticatedPhoneNumberId });

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
      console.error("webhook.js: generateReply failed, triggering handoff:");
      handoffRequired = true;
      handoffReason = `Erreur IA : ${aiErr.message}`;
      reply = getHandoffMessage(text);
    }

    if (handoffRequired) {
      let sendRes = null;
      try {
        sendRes = await sendWhatsAppText(phoneNumberId, from, reply);
      } catch (sendErr) {
        console.error("webhook.js: Failed to send handoff message:");
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
      if (shouldUseRedisMirror()) {
        await setRedisTakeoverStatus(from, true).catch(() => {});
        await saveRedisMessage(from, "assistant", reply, phoneNumberId, {
          wamid,
          status: "sent",
        }).catch(() => {});
      }

      console.log("webhook.js: Bot processing event");
      notifyHandoff({
        from,
        message: text,
        reason: handoffReason || "Conseiller requis",
      }).catch((e) => console.error("webhook.js: notifyHandoff error:"));

      return;
    }

    // 6. Send bot reply via WhatsApp Cloud API (split into short messages with ~1s delay if long)
    const messageParts = splitWhatsAppMessages(reply);
    let providerResponse = null;
    try {
      providerResponse = await sendSequentialWhatsAppTexts(phoneNumberId, from, messageParts, 1000);
      console.log("webhook.js: Bot processing event");
    } catch (sendErr) {
      if (isWindowExpiredError(sendErr?.message, sendErr?.code)) {
        console.warn("webhook.js: [Bot] Send failed with 131047 (window expired) for ");
        return;
      }
      console.error("webhook.js: Final WhatsApp send failed for");
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
        console.error("webhook.js: Failed to store bot outbound reply in Supabase:");
      }
    }

    if (shouldUseRedisMirror()) {
      saveRedisMessage(from, "assistant", reply, phoneNumberId, {
        wamid: botWamid,
        status: "sent",
      }).catch((e) => console.error("webhook.js: Redis save assistant reply failed:"));
    }
  } catch (err) {
    console.error("webhook.js: processIncomingMessage background error:");
  }
}
