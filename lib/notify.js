// Sends an email alert to you (the RepliQ team) whenever a customer signals
// they want to finalize/sign up. Uses Resend (resend.com) — free tier, no
// credit card required, generous enough for lead notifications.
export async function notifyTeam({ from, message }) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO;
    // Resend's free tier lets you send from "onboarding@resend.dev" without
    // verifying your own domain — fine for now, swap later if you verify one.
    const NOTIFY_EMAIL_FROM = process.env.NOTIFY_EMAIL_FROM || "RepliQ Bot <onboarding@resend.dev>";

    if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO) {
        console.warn("Lead notification skipped: RESEND_API_KEY or NOTIFY_EMAIL_TO not set.");
        return;
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: NOTIFY_EMAIL_FROM,
                to: NOTIFY_EMAIL_TO,
                subject: `🔥 Nouveau lead RepliQ prêt à finaliser`,
                text: `Un client sur WhatsApp veut finaliser son abonnement RepliQ.\n\nNuméro : +${from}\nDernier message : "${message}"\n\nRépondez-lui directement ici : https://wa.me/${from}`,
            }),
        });

        if (!res.ok) {
            console.error("Lead notification email failed:", res.status, await res.text());
        }
    } catch (err) {
        console.error("Lead notification error:", err);
    }
}

// Simple keyword check on the customer's own message — more reliable than
// asking the AI to flag it, since it doesn't depend on the model's phrasing.
const FINALIZE_KEYWORDS = [
    "finaliz", "finalys", "finalis",
    "procéder", "proceder", "procced", "proceed",
    "signer", "s'inscrire", "inscrire",
    "payer", "paiement", "pay now",
    "on commence", "commencer maintenant", "d'accord allons",
];

export function looksLikeFinalizeIntent(text) {
    const lower = text.toLowerCase();
    return FINALIZE_KEYWORDS.some((kw) => lower.includes(kw));
}

// Keywords signaling the customer wants to speak with a human agent
const HUMAN_REQUEST_KEYWORDS = [
    "humain", "conseiller", "agent", "responsable", "personne",
    "parler à quelqu'un", "parler a quelqu'un", "parler à un", "parler a un",
    "service client", "support humain", "appel", "appelez", "appeler",
    "quelqu'un de vrai", "bghit nhder", "bghit nhedar", "chi wa7d", "massoul", "moussa3id"
];

export function looksLikeHumanRequest(text) {
    if (!text || typeof text !== "string") return false;
    const lower = text.toLowerCase().trim();
    return HUMAN_REQUEST_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Returns the standard handoff message in the client's detected language.
 */
export function getHandoffMessage(text = "") {
    const lower = String(text || "").toLowerCase();

    // Arabic script
    if (/[\u0600-\u06FF]/.test(lower)) {
        return "سأقوم بتحويل طلبك إلى أحد مستشارينا، وسيتواصل معك في أقرب وقت 🙏";
    }

    // Darija in latin characters (3, 7, 9 or common darija words)
    if (/[379]|\b(ch7al|bghit|fin|kifash|wach|dyal|dyalk|salam|labas|chokran)\b/i.test(lower)) {
        return "غادي ندوز الطلب ديالك لواحد من المستشارين ديالنا، يجاوبك دابا شوية 🙏";
    }

    // English
    if (/\b(how|what|price|cost|hello|hi|please|human|agent)\b/i.test(lower) && !/\b(bonjour|merci|prix|combien|formule)\b/i.test(lower)) {
        return "I'm passing your request to an advisor, they'll reply to you very soon 🙏";
    }

    // French (default)
    return "Je transmets votre demande à un conseiller, il vous répond très vite 🙏";
}

/**
 * Sends an email notification to the business owner when human takeover is triggered
 * (client request, AI unsure, outside business context, or AI failure).
 */
export async function notifyHandoff({ from, message, reason = "Demande d'intervention humaine" }) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO;
    const NOTIFY_EMAIL_FROM = process.env.NOTIFY_EMAIL_FROM || "RepliQ Bot <onboarding@resend.dev>";

    if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO) {
        console.warn("Handoff notification skipped: RESEND_API_KEY or NOTIFY_EMAIL_TO not set.");
        return;
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: NOTIFY_EMAIL_FROM,
                to: NOTIFY_EMAIL_TO,
                subject: `🚨 Intervention conseiller requise — Client WhatsApp +${from}`,
                text: `Un client sur WhatsApp nécessite une intervention humaine.\n\nMotif : ${reason}\nNuméro client : +${from}\nDernier message reçu : "${message || '(aucun texte)'}"\n\nLe bot est maintenant en pause (human_takeover activé).\nPour répondre au client directement : https://wa.me/${from}`,
            }),
        });

        if (!res.ok) {
            console.error("Handoff notification email failed:", res.status, await res.text());
        }
    } catch (err) {
        console.error("Handoff notification error:", err);
    }
}