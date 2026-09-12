import { saveMessage } from "../lib/db.js";
import { sendWhatsAppText } from "../lib/whatsapp.js";
import { notifyTeam } from "../lib/notify.js";

// Short, friendly highlights per offer — used to build the WhatsApp congrats
// message so the client gets a real explanation of what they picked, not
// just a generic "thank you". Keep this in sync with the OFFERS features
// shown in formulaire.html if those ever change.
const OFFER_HIGHLIGHTS = {
    "Essai gratuit": [
        "Connexion de votre numéro WhatsApp Business",
        "Confirmation automatique des commandes / RDV",
        "Rappels automatiques programmés",
    ],
    "Essentielle": [
        "Confirmation automatique des commandes / RDV",
        "Rappels automatiques programmés",
        "Suivi des statuts en temps réel",
        "1h de formation incluse",
    ],
    "Standard": [
        "Tout le contenu de l'offre Essentielle",
        "Réponses automatiques par IA aux questions fréquentes",
        "Transfert automatique vers un agent humain",
        "Tableau de bord unifié de toutes vos conversations",
    ],
    "Premium": [
        "Tout le contenu de l'offre Standard",
        "Statistiques détaillées (réponse, confirmation, conversions)",
        "Accès multi-utilisateurs pour votre équipe",
        "Liens de paiement intégrés dans la conversation",
        "Détection automatique de la langue du client",
    ],
};

/**
 * Receives a submission from formulaire.html and registers it as a
 * conversation entry so it shows up in the dashboard (dashboard.html ->
 * /api/dashboard -> listConversations()) exactly like a real WhatsApp
 * message would — just tagged with role "lead" instead of "user" so it
 * renders distinctly. It also (best-effort) sends the client a WhatsApp
 * congrats message explaining their chosen plan, and pings the team so
 * someone follows up ASAP.
 *
 * POST /api/lead
 * body: { fullname, business, activity, phone, email, offer, mode, price, message?, ref? }
 *
 * No dashboard secret is required here since this is called from the public
 * signup form, not the admin dashboard.
 */
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { fullname, business, activity, phone, email, offer, mode, price, message, ref } =
        req.body || {};

    if (!fullname || !business || !phone) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Normalize the same way the webhook/admin action does, so this lands
    // under the same conversation key a future WhatsApp message from this
    // person would use. WhatsApp always reports numbers in full
    // international format (e.g. "212673046307"), but people naturally type
    // local numbers into a form (e.g. "0673046307" or "06 73 04 63 07") —
    // without this conversion those would create a SEPARATE, duplicate
    // conversation instead of merging with their real WhatsApp thread.
    let cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.startsWith("00")) {
        cleanPhone = cleanPhone.slice(2); // "00212..." -> "212..."
    } else if (cleanPhone.startsWith("0") && cleanPhone.length === 10) {
        cleanPhone = "212" + cleanPhone.slice(1); // "0673046307" -> "212673046307"
    }
    if (!cleanPhone) {
        return res.status(400).json({ error: "Invalid phone number" });
    }

    const modeLabel = mode === "unique" ? "Paiement unique" : "Abonnement mensuel";

    const lines = [
        "📋 Nouvelle demande via le formulaire RepliQ",
        "",
        `Nom : ${fullname}`,
        `Entreprise : ${business}`,
        `Type d'activité : ${activity || "—"}`,
        `Offre choisie : ${offer || "—"}`,
        `Mode : ${modeLabel}`,
        `Tarif : ${price || "—"}`,
        `Email : ${email || "—"}`,
    ];
    if (message && String(message).trim()) {
        lines.push("", `Message : ${String(message).trim()}`);
    }
    if (ref) {
        lines.push("", `Réf. ${ref}`);
    }

    try {
        // No phoneNumberId: this lead isn't yet tied to a WhatsApp Business
        // number — that gets attached automatically (setConversationOwner)
        // the first time they actually message in on WhatsApp, or below if
        // we successfully send the congrats message from our own number.
        await saveMessage(cleanPhone, "lead", lines.join("\n"));
    } catch (err) {
        console.error("Lead save failed:", err);
        return res.status(500).json({ error: "Failed to save lead" });
    }

    // Everything below is best-effort: the lead is already saved and the
    // client already sees their receipt in the browser, so a WhatsApp or
    // notification hiccup here should never turn into an error response —
    // it just gets logged.
    const phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
    if (phoneNumberId) {
        try {
            const firstName = String(fullname).trim().split(/\s+/)[0];
            const highlights = OFFER_HIGHLIGHTS[offer] || OFFER_HIGHLIGHTS["Essai gratuit"];
            const congratsText =
                `🎉 Félicitations ${firstName} ! Votre demande pour l'offre *${offer || "RepliQ"}* a bien été reçue.\n\n` +
                `Voici ce que votre plan inclut :\n` +
                highlights.map((h) => `• ${h}`).join("\n") +
                `\n\n💰 Tarif : ${price || "—"} (${modeLabel})\n\n` +
                `Un membre de notre équipe va vous contacter très prochainement pour connecter votre numéro WhatsApp Business et activer votre offre. En attendant, n'hésitez pas à poser vos questions ici, je suis là pour vous aider ! 🙌`;

            await sendWhatsAppText(phoneNumberId, cleanPhone, congratsText);

            // Record it in the same conversation, and set phoneNumberId so
            // this becomes the recognized owner of the thread — this is
            // what lets a dashboard admin reply to this person later.
            await saveMessage(cleanPhone, "assistant", congratsText, phoneNumberId);
        } catch (waErr) {
            console.error("Lead congrats WhatsApp message failed:", waErr);
        }
    } else {
        console.warn("DEFAULT_PHONE_NUMBER_ID not set — skipping lead congrats WhatsApp message.");
    }

    try {
        await notifyTeam({
            from: cleanPhone,
            message: `Nouvelle commande via le formulaire — ${fullname} (${business}) a choisi l'offre "${offer}" (${modeLabel}, ${price || "—"}). À contacter dès que possible.`,
        });
    } catch (notifyErr) {
        console.error("Lead team notification failed:", notifyErr);
    }

    return res.status(200).json({ ok: true });
}