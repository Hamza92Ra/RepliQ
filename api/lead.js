import { saveMessage } from "../lib/db.js";

/**
 * Receives a submission from formulaire.html and registers it as a
 * conversation entry so it shows up in the dashboard (dashboard.html ->
 * /api/dashboard -> listConversations()) exactly like a real WhatsApp
 * message would — just tagged with role "lead" instead of "user" so it
 * renders distinctly.
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
    // person would use (e.g. "+212 6 12-34-56" -> "212612345678").
    const cleanPhone = String(phone).replace(/\D/g, "");
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
        // the first time they actually message in on WhatsApp.
        await saveMessage(cleanPhone, "lead", lines.join("\n"));
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error("Lead save failed:", err);
        return res.status(500).json({ error: "Failed to save lead" });
    }
}