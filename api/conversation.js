import { waitUntil } from "@vercel/functions";
import {
    sendWhatsAppText,
    markAsRead,
    getMediaUrl,
    downloadMedia,
} from "../lib/whatsapp.js";
import { generateReply, transcribeAudio } from "../lib/ai.js";
import { notifyTeam, looksLikeFinalizeIntent } from "../lib/notify.js";
import {
    saveMessage,
    getHistory,
    getConversationMode,
    setConversationMode,
    setConversationOwner,
    getBusinessConfig,
    claimMessage,
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
 *   body: { phone, action: "human"|"bot"|"completed"|"reply", message? }
 * This is a completely different request shape from Meta's webhook payload
 * (which has no "phone"/"action" fields and no ?key=), so it's safe to
 * branch on that before touching any webhook logic.
 */
async function handleAdminAction(req, res) {
    const key = req.query.key;
    if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { phone, phoneNumberId: requestedPhoneNumberId, action, message } = req.body;
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
            // A dashboard reply must use the owner attached to this exact
            // conversation. Do not silently use DEFAULT_PHONE_NUMBER_ID:
            // that can send from the wrong WhatsApp Business number when
            // several numbers are connected to the same deployment.
            const phoneNumberId = String(requestedPhoneNumberId || "").trim();
            if (!phoneNumberId) {
                return res.status(400).json({
                    error: "This conversation has no WhatsApp Business number assigned. Send a new customer message first so ownership can be recorded."
                });
            }
            const recipient = String(phone).replace(/\D/g, "");
            if (!recipient) {
                return res.status(400).json({ error: "Invalid conversation phone number" });
            }
            // Backfill the owner key for conversations created before owner
            // tracking was added.
            setConversationOwner(phone, phoneNumberId).catch((e) =>
                console.error("Owner backfill failed:", e)
            );
            await sendWhatsAppText(phoneNumberId, recipient, text);
            // Save with role "agent" (NOT "assistant") so the takeover stays
            // visible in the dashboard and, crucially, so the bot can tell —
            // when the conversation is handed back to it — that a human spoke
            // in the middle of the thread. getHistory() in lib/db.js folds
            // this into a marked assistant turn for the AI, keeping the whole
            // exchange as ONE continuous conversation under the same number.
            try {
                await saveMessage(recipient, "agent", text, phoneNumberId);
            } catch (dbErr) {
                // The WhatsApp message has already been delivered. Do not
                // report a false send failure that would make the dashboard
                // resend the same message if Redis has a transient problem.
                console.error("Admin reply storage failed after send:", dbErr);
            }
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
        console.error("Admin action failed:", err);
        const status = Number(err?.status);
        const error = err?.message || "Action failed";
        return res.status(status >= 400 && status < 600 ? 502 : 500).json({
            error: "WhatsApp message could not be sent",
            details: error,
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
        // Terminer / manual reply) arrive here with a { phone, action } body,
        // never with "entry" (that's Meta's webhook shape). Branch on that
        // first so these get real JSON responses instead of falling into the
        // webhook's "EVENT_RECEIVED" ack path. ---
        if (req.body && typeof req.body === "object" && req.body.action && req.body.phone) {
            return handleAdminAction(req, res);
        }

        // --- 2. Incoming messages (Meta calls this with POST every time a message arrives) ---
        try {
            const entry = req.body?.entry?.[0];
            const change = entry?.changes?.[0];
            const value = change?.value;
            const message = value?.messages?.[0];

            if (!message) {
                // Status updates (delivered/read receipts) and other events — just ACK.
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
        const from = message.from; // customer's WhatsApp number

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
