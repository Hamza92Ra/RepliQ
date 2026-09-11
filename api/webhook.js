import { waitUntil } from "@vercel/functions";
import { sendWhatsAppText, markAsRead } from "../lib/whatsapp.js";
import { generateReply } from "../lib/ai.js";
import { notifyTeam, looksLikeFinalizeIntent } from "../lib/notify.js";

const FALLBACK_REPLY =
  "Désolé, j'ai eu un petit souci technique 🙏 Un membre de l'équipe RepliQ va vous répondre rapidement.";

// Best-effort in-memory dedup: WhatsApp/Meta retries a webhook delivery if it
// doesn't get a fast 200 response, which was causing the same inbound message
// to be processed 2-3 times and sent back multiple different replies.
// This Set remembers recently-seen message IDs so retries are skipped.
// Note: this resets on cold start, so it's not 100% guaranteed — for a
// bulletproof version later, swap this for Vercel KV / Redis with a TTL.
const seenMessageIds = new Set();
function alreadyProcessed(messageId) {
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
  // Keep the set small; we only need to remember the last few minutes.
  setTimeout(() => seenMessageIds.delete(messageId), 5 * 60 * 1000);
  return false;
}

export default async function handler(req, res) {
  // --- 1. Webhook verification (Meta calls this once, with GET, when you save the webhook URL) ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Webhook verified.");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // --- 2. Incoming messages (Meta calls this with POST every time a message arrives) ---
  if (req.method === "POST") {
    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      // Meta also POSTs delivery/read status updates — ignore those, we only act on real messages.
      if (!message) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      // Skip if we've already started handling this exact message (Meta retry).
      if (alreadyProcessed(message.id)) {
        console.log("Duplicate delivery for message, skipping:", message.id);
        return res.status(200).send("EVENT_RECEIVED");
      }

      const phoneNumberId = value.metadata.phone_number_id;
      const from = message.from; // customer's WhatsApp number
      const text = message.text?.body;

      // --- Respond to Meta immediately so it never times out and retries. ---
      // All the actual work (calling Gemini, calling WhatsApp API) happens
      // afterwards via waitUntil, which keeps the function alive in the
      // background without blocking Meta's webhook response.
      res.status(200).send("EVENT_RECEIVED");

      waitUntil(
        (async () => {
          try {
            if (!text) {
              // Non-text message (image, audio, etc). Handle later — for now, send a fallback.
              await sendWhatsAppText(
                phoneNumberId,
                from,
                "Merci pour votre message ! Pour l'instant je ne peux traiter que du texte 🙏 Un membre de l'équipe va vous répondre."
              );
              return;
            }

            await markAsRead(phoneNumberId, message.id);

            // If the customer is signaling they want to finalize/sign up,
            // email the team right away so a human can jump into this chat.
            if (looksLikeFinalizeIntent(text)) {
              notifyTeam({ from, message: text }).catch((e) =>
                console.error("notifyTeam failed:", e)
              );
            }

            let reply;
            try {
              reply = await generateReply(text);
            } catch (aiErr) {
              console.error("generateReply failed, using fallback:", aiErr);
              reply = FALLBACK_REPLY;
            }

            await sendWhatsAppText(phoneNumberId, from, reply);
          } catch (bgErr) {
            console.error("Background webhook processing error:", bgErr);
          }
        })()
      );
    } catch (err) {
      // Always return 200 to Meta even on our own errors, or Meta will retry
      // the same webhook repeatedly and can eventually disable it.
      console.error("Webhook handler error:", err);
      if (!res.headersSent) {
        return res.status(200).send("EVENT_RECEIVED");
      }
    }
    return;
  }

  return res.status(405).send("Method Not Allowed");
}