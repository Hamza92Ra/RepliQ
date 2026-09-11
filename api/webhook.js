import { waitUntil } from "@vercel/functions";
import { sendWhatsAppText, markAsRead } from "../lib/whatsapp.js";
import { generateReply } from "../lib/ai.js";
import { notifyTeam, looksLikeFinalizeIntent } from "../lib/notify.js";
import { saveMessage, getHistory } from "../lib/db.js";

const FALLBACK_REPLY =
  "Désolé, j'ai eu un petit souci technique 🙏 Un membre de l'équipe RepliQ va vous répondre rapidement.";

// Best-effort in-memory dedup: WhatsApp/Meta retries a webhook delivery if it
// doesn't get a fast 200 response, which was causing the same inbound message
// to be processed 2-3 times and sent back multiple different replies.
const seenMessageIds = new Set();
function alreadyProcessed(messageId) {
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
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

      if (!message) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      if (alreadyProcessed(message.id)) {
        console.log("Duplicate delivery for message, skipping:", message.id);
        return res.status(200).send("EVENT_RECEIVED");
      }

      const phoneNumberId = value.metadata.phone_number_id;
      const from = message.from; // customer's WhatsApp number
      const text = message.text?.body;

      // Respond to Meta immediately so it never times out and retries.
      res.status(200).send("EVENT_RECEIVED");

      waitUntil(
        (async () => {
          try {
            if (!text) {
              await sendWhatsAppText(
                phoneNumberId,
                from,
                "Merci pour votre message ! Pour l'instant je ne peux traiter que du texte 🙏 Un membre de l'équipe va vous répondre."
              );
              return;
            }

            await markAsRead(phoneNumberId, message.id);

            // Save the customer's message, and pull recent history so the
            // bot actually remembers the conversation instead of treating
            // every message as brand new.
            let history = [];
            try {
              await saveMessage(from, "user", text);
              history = await getHistory(from, 10);
              // getHistory includes the message we just saved — drop the
              // last one since generateReply adds the current message itself.
              history = history.slice(0, -1);
            } catch (dbErr) {
              console.error("DB error (continuing without history):", dbErr);
            }

            if (looksLikeFinalizeIntent(text)) {
              notifyTeam({ from, message: text }).catch((e) =>
                console.error("notifyTeam failed:", e)
              );
            }

            let reply;
            try {
              reply = await generateReply(text, history);
            } catch (aiErr) {
              console.error("generateReply failed, using fallback:", aiErr);
              reply = FALLBACK_REPLY;
            }

            await sendWhatsAppText(phoneNumberId, from, reply);

            saveMessage(from, "assistant", reply).catch((e) =>
              console.error("DB save (assistant) failed:", e)
            );
          } catch (bgErr) {
            console.error("Background webhook processing error:", bgErr);
          }
        })()
      );
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