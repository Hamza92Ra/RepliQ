// Acquisition-only path for the new public offer. Never writes business config,
// subscriptions, tenant ownership, credentials or quota counters.
import { PUBLIC_OFFER, PRICE_SUMMARY, PLAN_LIMITS, LIMITS_NOTICE, PRO_FEATURES } from "../public-offer.js";
import { saveMessage } from "./db.js";
import { sendWhatsAppText } from "./whatsapp.js";
import { notifyTeam } from "./notify.js";

export async function handlePublicProLead(req, res) {
  const body = req.body || {};
  // Only the API's validated/admitted request can enter the side-effect path.
  if (typeof req.leadSecurity?.complete !== "function") return res.status(503).json({ error: "Service unavailable" });
  const phone = body.phone.replace(/^\+/, "");
  const requestType = body.intent === "demo" ? "Demo request" : "Setup inquiry";
  const text = [
    "RepliQ Pro public website inquiry - no subscription activated",
    `Request: ${requestType}`, `Name: ${body.fullname.trim()}`, `Business: ${body.business.trim()}`,
    `Business type: ${String(body.activity || "").slice(0, 160)}`, `Email: ${String(body.email || "").slice(0, 254)}`,
    `Offer: ${PUBLIC_OFFER.name}`, `Price: ${PRICE_SUMMARY}`, PLAN_LIMITS, LIMITS_NOTICE,
    "Consent: contact about this request only; no payment or booking confirmed",
    `Guest inquiries/month (estimate): ${String(body.volume || "").slice(0, 20)}`,
    `Message: ${String(body.message || "").slice(0, 3000)}`, `Reference: ${String(body.ref || "").slice(0, 100)}`,
  ].join("\n");
  try { await saveMessage(phone, "lead", text, undefined, { source: "public-lead", signal: AbortSignal.timeout(3000) }); await req.leadSecurity.complete(); }
  catch {
    console.error("Public RepliQ Pro inquiry storage failed");
    return res.status(503).json({ error: "Service unavailable" });
  }
  let whatsappError = null;
  const phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID;
  if (phoneNumberId && req.leadSecurity.acknowledge) {
    try {
      const acknowledgement = [
        `Thanks ${body.fullname.trim().split(/\s+/)[0]}! We received your ${requestType.toLowerCase()} for *${PUBLIC_OFFER.name}*.`,
        PRICE_SUMMARY, ...PRO_FEATURES.map(feature => `• ${feature}`), PLAN_LIMITS, LIMITS_NOTICE,
        "Our team will follow up to arrange the next step. This request does not confirm a payment, booking or subscription activation.",
      ].join("\n\n");
      const sent = await sendWhatsAppText(phoneNumberId, phone, acknowledgement, { signal: AbortSignal.timeout(4000) });
      await saveMessage(phone, "assistant", acknowledgement, phoneNumberId, { wamid: sent?.messages?.[0]?.id || null, status: "sent", source: "public-lead", signal: AbortSignal.timeout(3000) });
    } catch {
      console.warn("Public RepliQ Pro acknowledgement unavailable");
      whatsappError = { message: "WhatsApp acknowledgement unavailable; request saved" };
    }
  } else whatsappError = { message: "WhatsApp acknowledgement unavailable; request saved" };
  await notifyTeam({ from: phone, message: text, signal: AbortSignal.timeout(4000) });
  return res.status(200).json({ ok: true, whatsapp_error: whatsappError, reference: body.ref });
}
