import { assertDemoInboundScope, resolveBusinessPrompt } from "../lib/business-prompt.js";
import { authenticateMetaRequest, readRawBody } from "../lib/webhook-security.js";
import { resolveWhatsAppCredentials } from "../lib/whatsapp-credentials.js";

export const config = { api: { bodyParser: false } };

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
    extractCustomerIdentity,
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
    saveMessage,
    getHistory,
    getConversation,
    getConversationMode,
    setConversationMode,
    getTakeoverStatus,
    setTakeoverStatus,
    getConversationOwner,
    setConversationOwner,
    claimMessage,
    deleteConversation,
    deleteMessage,
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

/**
 * Handles admin actions sent from dashboard.html:
 *   POST /api/conversation?key=DASHBOARD_SECRET
 *   body: { phone, action: "human"|"bot"|"completed"|"reply"|"delete", message? }
 * This is a completely different request shape from Meta's webhook payload
 * (which has no "phone"/"action" fields and no ?key=), so it's safe to
 * branch on that before touching any webhook logic.
 */
async function handleAdminAction(req, res) {
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
                await setTakeoverStatus(phone, true);
            } else if (action === "bot") {
                await setTakeoverStatus(phone, false);
            } else {
                await setConversationMode(phone, action);
            }
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

            // Enforce Meta 24-hour customer service window on backend BEFORE calling Meta
            const convo = await getConversation(recipient);
            if (!isWithin24hWindow(convo)) {
                return res.status(409).json({
                    ok: false,
                    code: "WINDOW_EXPIRED",
                    error: "WINDOW_EXPIRED",
                    details: "Fenêtre de 24h Meta expirée : Meta bloque les messages libres hors de cette fenêtre. Utilisez un modèle WhatsApp approuvé pour relancer ce client.",
                });
            }

            resolveWhatsAppCredentials(phoneNumberId);

            // Backfill owner key so future replies continue using this number
            setConversationOwner(phone, phoneNumberId).catch((e) =>
                console.error("conversation.js: Owner backfill failed:")
            );

            let providerResponse;
            try {
                providerResponse = await sendWhatsAppText(phoneNumberId, recipient, text);
            } catch (sendErr) {
                console.error("conversation.js: WhatsApp send failed for agent reply:");
                const is131047 = isWindowExpiredError(sendErr?.message, sendErr?.code || sendErr?.status);
                const errCode = is131047 ? "WINDOW_EXPIRED" : (sendErr.code || "SEND_FAILED");
                const friendlyErr = formatFriendlyError(sendErr?.message, sendErr?.code);

                // Save failed message so agent sees the failed state in dashboard
                try {
                    await saveMessage(recipient, "agent", text, phoneNumberId, {
                        status: "failed",
                        error: friendlyErr,
                        errorCode: errCode,
                    });
                } catch (saveErr) {
                    console.error("conversation.js: Failed to save failed message record:");
                }

                const status = is131047 ? 409 : (Number(sendErr?.status) || 502);
                return res.status(status).json({
                    ok: false,
                    code: errCode,
                    error: is131047 ? "WINDOW_EXPIRED" : "Échec de l'envoi WhatsApp",
                    details: friendlyErr,
                });
            }

            const wamid = providerResponse?.messages?.[0]?.id || null;

            // Automatically enable takeover on manual agent reply
            await setTakeoverStatus(recipient, true).catch(() => {});

            try {
                await saveMessage(recipient, "agent", text, phoneNumberId, {
                    wamid,
                    status: "sent",
                });
            } catch (dbErr) {
                console.error("conversation.js: Admin reply storage failed after send:");
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

            let templateComponents = req.body.components || null;
            if (!templateComponents && Array.isArray(req.body.variables) && req.body.variables.length > 0) {
                templateComponents = buildTemplateComponents(req.body.variables);
            }

            let providerResponse;
            try {
                providerResponse = await sendWhatsAppTemplate(phoneNumberId, recipient, chosenTemplate, chosenLang, templateComponents);
            } catch (sendErr) {
                console.error("conversation.js: WhatsApp template send failed:");
                const status = Number(sendErr?.status) || 400;
                return res.status(status).json({
                    ok: false,
                    error: "Échec de l'envoi du modèle WhatsApp",
                    code: sendErr.code,
                    details: sendErr.message,
                });
            }

            const wamid = providerResponse?.messages?.[0]?.id || null;
            const content = req.body.previewText || `📨 Modèle WhatsApp envoyé : ${chosenTemplate} (${chosenLang})`;
            try {
                await saveMessage(recipient, "agent", content, phoneNumberId, {
                    wamid,
                    status: "sent",
                    template: chosenTemplate,
                });
            } catch (dbErr) {
                console.error("conversation.js: Admin template reply storage failed after send:");
            }

            return res.status(200).json({ ok: true, wamid, status: "sent", template: chosenTemplate });
        }

        if (action === "get_templates" || action === "templates") {
            let phoneNumberId = String(requestedPhoneNumberId || "").trim();
            if (!phoneNumberId) {
                phoneNumberId = await getConversationOwner(phone);
            }
            const templates = await getApprovedTemplates(phoneNumberId);
            return res.status(200).json({ ok: true, templates });
        }

        if (action === "delete_message") {
            const { messageId } = req.body;
            if (!messageId) {
                return res.status(400).json({ error: "Missing messageId" });
            }
            const removed = await deleteMessage(phone, messageId);
            return res.status(200).json({ ok: true, removed });
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
        console.error("conversation.js: Admin action failed:");
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

        if (mode === "subscribe" && process.env.VERIFY_TOKEN && token === process.env.VERIFY_TOKEN) {
            console.log("conversation.js: Webhook verified.");
            return res.status(200).send(challenge);
        }
        return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
        // Plain Node/Vercel streams are read explicitly. Object bodies remain
        // supported for direct admin handler callers; Meta always needs bytes.
        if (typeof req.on === "function") {
            try {
                req.rawBody = await readRawBody(req);
                req.body = JSON.parse(req.rawBody.toString("utf8"));
            } catch (err) {
                return res.status(err.status || 400).send("Invalid request body");
            }
        }
        // --- Dashboard admin actions (Prendre en charge / Rendre au bot /
        // Terminer / Supprimer / manual reply) arrive here with a
        // { phone, action } body, never with "entry" (that's Meta's webhook
        // shape). Branch on that first so these get real JSON responses
        // instead of falling into the webhook's "EVENT_RECEIVED" ack path. ---
        if (req.body && typeof req.body === "object" && req.body.action && req.body.phone && !req.body.entry && !req.body.object) {
            return handleAdminAction(req, res);
        }

        if (!(await authenticateMetaRequest(req, res))) return;

        // --- 2. Incoming messages (Meta calls this with POST every time a message arrives) ---
        try {
            const entry = req.body?.entry?.[0];
            const change = entry?.changes?.[0];
            const value = change?.value;
            if (value?.metadata?.phone_number_id) {
                resolveWhatsAppCredentials(value.metadata.phone_number_id, { requireToken: false });
            }
            const message = value?.messages?.[0];
            const contact = value?.contacts?.[0];

            const statusUpdate = value?.statuses?.[0];
            if (statusUpdate) {
                const wamid = statusUpdate.id;
                const status = statusUpdate.status; // "sent", "delivered", "read", "failed"
                const recipientId = statusUpdate.recipient_id;
                let errorDetail = null;
                let errorCode = null;
                if (statusUpdate.errors && statusUpdate.errors.length > 0) {
                    const e = statusUpdate.errors[0];
                    if (isWindowExpiredError(e.message || e.title, e.code)) {
                        errorDetail = "Fenêtre de 24h Meta expirée : envoyez un modèle WhatsApp pour réengager ce client.";
                        errorCode = "WINDOW_EXPIRED";
                    } else {
                        errorDetail = formatFriendlyError(e.title ? `${e.title}: ${e.message || ""}` : e.message, e.code);
                        errorCode = e.code;
                    }
                }
                console.log("conversation.js: WhatsApp delivery status received");
                res.status(200).send("EVENT_RECEIVED");
                waitUntil(updateMessageStatus(recipientId, wamid, status, errorDetail, errorCode));
                return;
            }

            if (!message) {
                // Other events — just ACK.
                return res.status(200).send("EVENT_RECEIVED");
            }

            const phoneNumberId = value.metadata.phone_number_id;

            // Respond to Meta immediately so it never times out and retries.
            res.status(200).send("EVENT_RECEIVED");

            waitUntil(processMessage({ message, contact, phoneNumberId, authenticatedPhoneNumberId: value?.metadata?.phone_number_id }));
        } catch (err) {
            console.error("conversation.js: Webhook handler error:");
            if (!res.headersSent) {
                return res.status(200).send("EVENT_RECEIVED");
            }
        }
        return;
    }

    return res.status(405).send("Method Not Allowed");
}

async function processMessage({ message, contact, phoneNumberId, authenticatedPhoneNumberId }) {
    try {
        const identity = extractCustomerIdentity(message, contact);
        const from = identity.primaryId;
        if (!from) {
            console.error("conversation.js: processMessage: message has no identifiable recipient, skipping:");
            return;
        }

        await assertDemoInboundScope({ phoneNumberId, authenticatedPhoneNumberId, identity });

        // --- Dedup: Meta retries deliveries, so the same message can arrive 2-3x ---
        let claimed = false;
        try {
            claimed = await claimMessage(message.id);
        } catch (dbErr) {
            console.error("conversation.js: Dedup via Redis failed, using memory fallback:");
            claimed = claimMessageLocally(message.id);
        }
        if (!claimed) {
            console.log("conversation.js: Duplicate inbound delivery skipped");
            return;
        }

        // --- Admin state check FIRST (Fail-Safe): read takeover BEFORE any AI call ---
        let isHumanTakeover = false;
        try {
            const takeover = await getTakeoverStatus(from);
            isHumanTakeover = Boolean(takeover.human_takeover);
        } catch (dbErr) {
            // FAIL SAFE: if the lookup fails, do not auto-reply, log the error
            console.error("conversation.js: Takeover state unavailable; bot stopped");
            return;
        }

        if (isHumanTakeover) {
            console.log("conversation.js: Human takeover active");
            try {
                await saveMessage(from, "user", describeInbound(message), phoneNumberId, {
                    userId: identity.userId,
                    phone: identity.phone,
                    profileName: identity.profileName,
                });
            } catch (dbErr) {
                console.error("conversation.js: DB save (silent mode) failed:");
            }
            return;
        }

        console.log("conversation.js: Bot processing event");

        // --- Extract text: voice notes get transcribed, everything else falls back ---
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
                console.error("conversation.js: Voice message handling failed:");
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

        // --- Check if client asks for a human / advisor ---
        if (looksLikeHumanRequest(text)) {
            console.log("conversation.js: Bot processing event");
            const handoffMsg = getHandoffMessage(text);
            try {
                await sendWhatsAppText(phoneNumberId, from, handoffMsg);
            } catch (sendErr) {
                console.error("conversation.js: Failed to send handoff message:");
            }
            await setTakeoverStatus(from, true).catch(() => {});
            await saveMessage(from, "assistant", handoffMsg, phoneNumberId, {
                status: "sent",
                userId: identity.userId,
                phone: identity.phone,
                profileName: identity.profileName,
            }).catch(() => {});
            notifyHandoff({
                from,
                message: text,
                reason: "Le client a demandé à parler à un conseiller",
            }).catch((e) => console.error("conversation.js: notifyHandoff error:"));
            return;
        }

        // Shared server-controlled selection; enabled lookup errors stop processing.
        const systemPrompt = await resolveBusinessPrompt({ phoneNumberId, authenticatedPhoneNumberId });

        // --- Save the customer's message and pull recent history so the bot
        // actually remembers the conversation. Voice notes are labeled in the
        // dashboard so the admin can see it was a transcription. ---
        let history = [];
        try {
            const displayText = voiceNote ? `🎙️ Message vocal (transcription) : ${text}` : text;
            const inboundTs = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();
            await saveMessage(from, "user", displayText, phoneNumberId, {
                ts: inboundTs,
                userId: identity.userId,
                phone: identity.phone,
                profileName: identity.profileName,
            });
            history = await getHistory(from, 10);
            // getHistory includes the message we just saved — drop the last one
            // since generateReply adds the current message itself.
            history = history.slice(0, -1);
        } catch (dbErr) {
            console.error("conversation.js: DB error (continuing without history):");
        }

        if (looksLikeFinalizeIntent(text)) {
            notifyTeam({ from, message: text }).catch((e) =>
                console.error("conversation.js: notifyTeam failed:")
            );
        }

        // --- Bot auto-reply check: Meta 24-hour customer service window ---
        const convo = await getConversation(from);
        if (!isWithin24hWindow(convo)) {
            console.warn("conversation.js: [Bot] 24h Meta window is expired for ");
            return;
        }

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
            console.error("conversation.js: generateReply failed, triggering handoff:");
            handoffRequired = true;
            handoffReason = `Erreur IA : ${aiErr.message}`;
            reply = getHandoffMessage(text);
        }

        if (handoffRequired) {
            try {
                await sendWhatsAppText(phoneNumberId, from, reply);
            } catch (sendErr) {
                console.error("conversation.js: Failed to send handoff message:");
            }
            await setTakeoverStatus(from, true).catch(() => {});
            await saveMessage(from, "assistant", reply, phoneNumberId, { status: "sent" }).catch(() => {});
            notifyHandoff({
                from,
                message: text,
                reason: handoffReason || "Conseiller requis",
            }).catch((e) => console.error("conversation.js: notifyHandoff error:"));
            return;
        }

        const messageParts = splitWhatsAppMessages(reply);
        let providerResponse = null;
        try {
            providerResponse = await sendSequentialWhatsAppTexts(phoneNumberId, from, messageParts, 1000);
            console.log("conversation.js: Bot processing event");
        } catch (sendErr) {
            if (isWindowExpiredError(sendErr?.message, sendErr?.code)) {
                console.warn("conversation.js: [Bot] Send failed with 131047 (window expired) for ");
                return;
            }
            console.error("conversation.js: Final WhatsApp send failed for");
            return;
        }

        const botWamid = providerResponse?.messages?.[0]?.id || null;
        saveMessage(from, "assistant", reply, phoneNumberId, {
            wamid: botWamid,
            status: "sent",
        }).catch((e) => console.error("conversation.js: DB save (assistant) failed:"));
    } catch (bgErr) {
        console.error("conversation.js: Background webhook processing error:");
    }
}