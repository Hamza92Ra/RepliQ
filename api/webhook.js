import { sendWhatsAppText, markAsRead } from "../lib/whatsapp.js";
import { generateReply } from "../lib/ai.js";

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

      const phoneNumberId = value.metadata.phone_number_id;
      const from = message.from; // customer's WhatsApp number
      const text = message.text?.body;

      if (!text) {
        // Non-text message (image, audio, etc). Handle later — for now, send a fallback.
        await sendWhatsAppText(
          phoneNumberId,
          from,
          "Merci pour votre message ! Pour l'instant je ne peux traiter que du texte 🙏 Un membre de l'équipe va vous répondre."
        );
        return res.status(200).send("EVENT_RECEIVED");
      }

      await markAsRead(phoneNumberId, message.id);

      const reply = await generateReply(text);
      await sendWhatsAppText(phoneNumberId, from, reply);

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      // Always return 200 to Meta even on our own errors, or Meta will retry
      // the same webhook repeatedly and can eventually disable it.
      console.error("Webhook handler error:", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method Not Allowed");
}
