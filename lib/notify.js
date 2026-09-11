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