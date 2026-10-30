import { waitUntil } from "@vercel/functions";
import {
    sendWhatsAppText,
    sendWhatsAppTemplate,
    markAsRead,
    getMediaUrl,
    downloadMedia,
    normalizeRecipient,
} from "../lib/whatsapp.js";
import { generateReply, transcribeAudio } from "../lib/ai.js";
import { notifyTeam, looksLikeFinalizeIntent } from "../lib/notify.js";
import {
    saveMessage,
    getHistory,
    getConversationMode,
    setConversationMode,
    getConversationOwner,
    setConversationOwner,
    getBusinessConfig,
    claimMessage,
    deleteConversation,
    updateMessageStatus,
} from "../lib/db.js";

const FALLBACK_REPLY =
    "Désolé, j'ai eu un petit souci technique 🙏 Un membre de l'équipe RepliQ va vous répondre rapidement.";

const VOICE_FAIL_REPLY =
    "Désolé, je n'ai pas réussi à écouter votre message vocal 🙏 Pouvez-vous le reformuler en texte, ou le renvoyer ?";

const UNSUPPORTED_REPLY =
    "Merci pour votre message ! Je sais lire les messages texte et vocaux 🙏 Pour les images et documents, un membre de l'équipe va vous répondre directement.";

const VALID_MODES = new Set(["bot", "human", "completed"]);

// In-memory fallback only used if Redis is briefly unreachable — Redis
// (claimMessage) is the real dedup, because Meta retries deliveries and
// Vercel runs multiple instances of this function.
const seenMessageIds = new Set();
function claimMessageLocally(messageId) {
    if (seenMessageIds.has(messageId)) return false;
    seenMessageIds.add(messageId);
    setTimeout(() => seenMessageIds.delete(messageId), 10 * 60 * 1000);
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

/**
 * Handles admin actions sent from dashboard.html:
 *   POST /api/conversation?key=DASHBOARD_SECRET
 *   body: { phone, action: "human"|"bot"|"completed"|"reply"|"delete", message? }
 * This is a completely different request shape from Meta's webhook payload
 * (which has no "phone"/"action" fields and no ?key=), so it's safe to
 * branch on that before touching any webhook logic.
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
            await setConversationMode(phone, action);
            return res.status(200).json({ ok: true, mode: action });
        }

        if (action === "reply") {
            const text = (message || "").trim();
            if (!text) {
                return res.status(400).json({ error: "Missing message" });
            }

            let phoneNumberId = String(requestedPhoneNumberId || "").trim();
            if (!phoneNumberId) {
                phoneNumberId = await getConversationOwner(phone);
            }
            if (!phoneNumberId && process.env.DEFAULT_PHONE_NUMBER_ID) {
                phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
            }
            if (!phoneNumberId) {
                return res.status(400).json({
                    error: "Aucun numéro WhatsApp Business associé à cette conversation.",
                    details: "Définissez DEFAULT_PHONE_NUMBER_ID dans vos variables d'environnement Vercel ou attendez un message client."
                });
            }

            const recipient = normalizeRecipient(phone);
            if (!recipient) {
                return res.status(400).json({ error: "Format de numéro de destinataire invalide." });
            }

            // Backfill owner key so future replies continue using this number
            setConversationOwner(phone, phoneNumberId).catch((e) =>
                console.error("Owner backfill failed:", e)
            );

            let providerResponse;
            try {
                providerResponse = await sendWhatsAppText(phoneNumberId, recipient, text);
            } catch (sendErr) {
                console.error("WhatsApp send failed for agent reply:", sendErr);
                // Save failed message so agent sees the failed state with retry button in dashboard
                try {
                    await saveMessage(recipient, "agent", text, phoneNumberId, {
                        status: "failed",
                        error: sendErr.message,
                    });
                } catch (saveErr) {
                    console.error("Failed to save failed message record:", saveErr);
                }

                const status = Number(sendErr?.status) || (sendErr?.code === 131047 || sendErr?.code === 131030 ? 400 : 502);
                return res.status(status).json({
                    ok: false,
                    error: "Échec de l'envoi WhatsApp",
                    code: sendErr.code,
                    details: sendErr.message,
                });
            }

            const wamid = providerResponse?.messages?.[0]?.id || null;
            try {
                await saveMessage(recipient, "agent", text, phoneNumberId, {
                    wamid,
                    status: "sent",
                });
            } catch (dbErr) {
                console.error("Admin reply storage failed after send:", dbErr);
            }

            return res.status(200).json({ ok: true, wamid, status: "sent" });
        }

        if (action === "template") {
            let phoneNumberId = String(requestedPhoneNumberId || "").trim();
            if (!phoneNumberId) {
                phoneNumberId = await getConversationOwner(phone);
            }
            if (!phoneNumberId && process.env.DEFAULT_PHONE_NUMBER_ID) {
                phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
            }
            if (!phoneNumberId) {
                return res.status(400).json({
                    error: "Aucun numéro WhatsApp Business associé",
                    details: "Définissez DEFAULT_PHONE_NUMBER_ID dans Vercel."
                });
            }

            const recipient = normalizeRecipient(phone);
            if (!recipient) {
                return res.status(400).json({ error: "Format de destinataire invalide." });
            }

            const chosenTemplate = templateName || process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
            const chosenLang = languageCode || process.env.WHATSAPP_TEMPLATE_LANG || "en_US";

            let providerResponse;
            try {
                providerResponse = await sendWhatsAppTemplate(phoneNumberId, recipient, chosenTemplate, chosenLang);
            } catch (sendErr) {
                console.error("WhatsApp template send failed:", sendErr);
                const status = Number(sendErr?.status) || 400;
                return res.status(status).json({
                    ok: false,
                    error: "Échec de l'envoi du modèle WhatsApp",
                    code: sendErr.code,
                    details: sendErr.message,
                });
            }

            const wamid = providerResponse?.messages?.[0]?.id || null;
            const content = `📨 Modèle WhatsApp envoyé : ${chosenTemplate} (${chosenLang})`;
            try {
                await saveMessage(recipient, "agent", content, phoneNumberId, {
                    wamid,
                    status: "sent",
                });
            } catch (dbErr) {
                console.error("Admin template reply storage failed after send:", dbErr);
            }

            return res.status(200).json({ ok: true, wamid, status: "sent", template: chosenTemplate });
        }

        // Permanently remove a conversation
        if (action === "delete") {
            const recipient = normalizeRecipient(phone);
            if (!recipient) {
                return res.status(400).json({ error: "Invalid conversation phone number" });
            }
            await deleteConversation(recipient);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
        console.error("Admin action failed:", err);
        const status = Number(err?.status) || 500;
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            ok: false,
            error: "Action impossible",
            details: err?.message || "Action failed",
        });
    }
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

    if (req.method === "POST") {
        // --- Dashboard admin actions (Prendre en charge / Rendre au bot /
        // Terminer / Supprimer / manual reply) arrive here with a
        // { phone, action } body, never with "entry" (that's Meta's webhook
        // shape). Branch on that first so these get real JSON responses
        // instead of falling into the webhook's "EVENT_RECEIVED" ack path. ---
        if (req.body && typeof req.body === "object" && req.body.action && req.body.phone) {
            return handleAdminAction(req, res);
        }

        // --- 2. Incoming messages (Meta calls this with POST every time a message arrives) ---
        try {
            const entry = req.body?.entry?.[0];
            const change = entry?.changes?.[0];
            const value = change?.value;
            const message = value?.messages?.[0];

            const statusUpdate = value?.statuses?.[0];
            if (statusUpdate) {
                const wamid = statusUpdate.id;
                const status = statusUpdate.status; // "sent", "delivered", "read", "failed"
                const recipientId = statusUpdate.recipient_id;
                let errorDetail = null;
                if (statusUpdate.errors && statusUpdate.errors.length > 0) {
                    const e = statusUpdate.errors[0];
                    errorDetail = e.title ? `${e.title} (${e.code}): ${e.message || ""}` : `Erreur ${e.code}: ${e.message || ""}`;
                }
                console.log(`WhatsApp delivery status update: wamid=${wamid}, status=${status}, recipient=${recipientId}, error=${errorDetail}`);
                res.status(200).send("EVENT_RECEIVED");
                waitUntil(updateMessageStatus(recipientId, wamid, status, errorDetail));
                return;
            }

            if (!message) {
                // Other events — just ACK.
                return res.status(200).send("EVENT_RECEIVED");
            }

            const phoneNumberId = value.metadata.phone_number_id;

            // Respond to Meta immediately so it never times out and retries.
            res.status(200).send("EVENT_RECEIVED");

            waitUntil(processMessage({ message, phoneNumberId }));
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

async function processMessage({ message, phoneNumberId }) {
    try {
        const rawFrom = message.from || message.from_user_id;
        if (!rawFrom) {
            console.error("processMessage: message has no 'from' or 'from_user_id' field, skipping:", JSON.stringify(message));
            return;
        }
        const from = normalizeRecipient(rawFrom);

        // --- Dedup: Meta retries deliveries, so the same message can arrive 2-3x ---
        let claimed = false;
        try {
            claimed = await claimMessage(message.id);
        } catch (dbErr) {
            console.error("Dedup via Redis failed, using memory fallback:", dbErr);
            claimed = claimMessageLocally(message.id);
        }
        if (!claimed) {
            console.log("Duplicate delivery for message, skipping:", message.id);
            return;
        }

        // --- Admin state check FIRST: the admin can complete or take over a
        // conversation at any moment, and the bot must respect that instantly —
        // even mid-thread. We still record the customer's message so the admin
        // sees it in the dashboard, we just never auto-reply. ---
        let convMode = "bot";
        try {
            convMode = await getConversationMode(from);
        } catch (dbErr) {
            // Fail open: if Redis hiccups we keep auto-replying rather than going silent.
            console.error("Mode check failed, defaulting to bot:", dbErr);
        }

        if (convMode === "completed" || convMode === "human") {
            try {
                await saveMessage(from, "user", describeInbound(message), phoneNumberId);
            } catch (dbErr) {
                console.error("DB save (silent mode) failed:", dbErr);
            }
            return;
        }

        // --- Extract text: voice notes get transcribed, everything else falls back ---
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

        // Interactive replies (button / list buttons from templates) carry their
        // answer in .title — treat them like a normal text message.
        if (!text && message.interactive) {
            text =
                message.interactive.button_reply?.title ||
                message.interactive.list_reply?.title ||
                "";
        }

        if (!text) {
            await sendWhatsAppText(phoneNumberId, from, UNSUPPORTED_REPLY);
            return;
        }

        await markAsRead(phoneNumberId, message.id);

        // --- Load this business's own config (project + ideas) so one deployment
        // adapts to any customer instead of the one hardcoded prompt. ---
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
            console.error("Business config load failed, using default prompt:", cfgErr);
        }

        // --- Save the customer's message and pull recent history so the bot
        // actually remembers the conversation. Voice notes are labeled in the
        // dashboard so the admin can see it was a transcription. ---
        let history = [];
        try {
            const displayText = voiceNote ? `🎙️ Message vocal (transcription) : ${text}` : text;
            await saveMessage(from, "user", displayText, phoneNumberId);
            history = await getHistory(from, 10);
            // getHistory includes the message we just saved — drop the last one
            // since generateReply adds the current message itself.
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
            reply = await generateReply(text, history, systemPrompt);
        } catch (aiErr) {
            console.error("generateReply failed, using fallback:", aiErr);
            reply = FALLBACK_REPLY;
        }

        await sendWhatsAppText(phoneNumberId, from, reply);

        saveMessage(from, "assistant", reply, phoneNumberId).catch((e) =>
            console.error("DB save (assistant) failed:", e)
        );
    } catch (bgErr) {
        console.error("Background webhook processing error:", bgErr);
    }
}