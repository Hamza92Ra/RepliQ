// Phase 1A is deliberately single-business. Never select a token using client
// supplied tenant IDs. Phase 1B must add authenticated membership + storage scope
// before this resolver can return credentials for additional businesses.
export function resolveWhatsAppCredentials(phoneNumberId, { requireToken = true } = {}) {
  const configuredId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.DEFAULT_PHONE_NUMBER_ID || "").trim();
  const requestedId = String(phoneNumberId || configuredId).trim();
  if (!configuredId) throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID or DEFAULT_PHONE_NUMBER_ID");
  if (requestedId !== configuredId) {
    throw Object.assign(new Error("WhatsApp business number is not authorized"), { status: 403 });
  }
  const token = process.env.WHATSAPP_TOKEN;
  if (requireToken && !token) throw new Error("Missing WHATSAPP_TOKEN");
  return { phoneNumberId: configuredId, token,
    wabaId: process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null };
}
