import { resolveWhatsAppCredentials } from "./whatsapp-credentials.js";

// Thin wrapper around Meta's WhatsApp Cloud API (Graph API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//
// BSUID SUPPORT — Meta rolled out Business-Scoped User IDs (BSUIDs) during
// 2026. Users who set a WhatsApp username can be messaged/received without
// ever exposing a phone number: inbound webhooks then carry only
// message.from_user_id (format "XX.digits", e.g. "MA.1587668549511396"),
// and outbound sends to that user must use the "recipient" field instead
// of "to". If both are known, "to" (the phone number) takes precedence, so
// we only ever set one or the other here — never both.

const GRAPH_VERSION = "v21.0";

// BSUID format per Meta's docs: two-letter ISO country code, a period,
// then up to 128 alphanumeric characters. A real phone number never
// matches this (no letters, no period).
const BSUID_PATTERN = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/;

export function isBsuid(id) {
  return typeof id === "string" && BSUID_PATTERN.test(id.trim());
}

/**
 * Normalize a conversation recipient (phone number or BSUID).
 * - Digits only: strips '+', spaces, hyphens, and formats leading '00' or Moroccan '06...'/'07...'.
 * - Preserves BSUID identifiers intact (e.g. 'MA.1163080159477566').
 * - Strips optional 'whatsapp:' prefix.
 */
export function normalizePhone(id) {
  if (!id) return "";
  const str = String(id).trim();
  const clean = str.replace(/^whatsapp:/i, "").trim();
  if (isBsuid(clean)) return clean;
  let digits = clean.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = "212" + digits.slice(1);
  }
  return digits;
}

export const normalizeRecipient = normalizePhone;

/**
 * Format a phone number into readable display format (e.g. "+212 6XX XXXXXX").
 * Preserves BSUID intact if passed an ID.
 */
export function formatPhoneNumber(phone) {
  if (!phone) return "";
  const clean = String(phone).replace(/^whatsapp:/i, "").trim();
  if (isBsuid(clean)) return clean;
  let digits = clean.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 10) digits = "212" + digits.slice(1);

  // Moroccan format: +212 6XX XXXXXX (e.g. +212 673 046307)
  if (digits.startsWith("212") && digits.length === 12) {
    return `+212 ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return digits ? `+${digits}` : "";
}

/**
 * Extract customer identity fields from WhatsApp webhook objects (message & contact).
 * Separates user_id (BSUID), real phone number (digits only), and profile display name.
 */
export function extractCustomerIdentity(message, contact) {
  // 1. Identify BSUID / user_id
  let userId = null;
  const bsuidCandidate = [
    message?.from_user_id,
    contact?.user_id,
    message?.from,
    contact?.wa_id,
  ].find((val) => typeof val === "string" && isBsuid(val.replace(/^whatsapp:/i, "").trim()));

  if (bsuidCandidate) {
    userId = bsuidCandidate.replace(/^whatsapp:/i, "").trim();
  }

  // 2. Identify real phone number (must NOT be a BSUID, minimum 7 digits)
  let phone = null;
  const phoneCandidate = [
    message?.from,
    contact?.wa_id,
  ].find((val) => {
    if (typeof val !== "string") return false;
    const clean = val.replace(/^whatsapp:/i, "").trim();
    return !isBsuid(clean) && clean.replace(/\D/g, "").length >= 7;
  });

  if (phoneCandidate) {
    phone = normalizePhone(phoneCandidate);
  }

  // 3. Profile name
  const profileName = contact?.profile?.name?.trim() || null;

  // 4. Primary conversation ID:
  // If phone exists, use phone (digits only). Otherwise fallback to userId.
  const rawFallback = message?.from || message?.from_user_id || contact?.wa_id || contact?.user_id || "";
  const primaryId = phone || userId || normalizePhone(rawFallback);

  return {
    userId,
    phone,
    profileName,
    primaryId,
  };
}

/**
 * Send a plain text WhatsApp message.
 * @param {string} phoneNumberId - the "Phone number ID" from the Meta dashboard (not the phone number itself)
 * @param {string} to - recipient's phone number (international format, no "+", e.g. "212612345678")
 *   OR a BSUID (e.g. "MA.1587668549511396") for username-only contacts.
 * @param {string} text - message body
 */
export async function sendWhatsAppText(phoneNumberId, to, text, { signal } = {}) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId);
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    throw new Error("Invalid or empty WhatsApp recipient");
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`;
  const recipientField = isBsuid(recipient) ? { recipient: recipient } : { to: recipient };

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...recipientField,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    signal,
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const errBody = await res.text();
  let data = null;
  try {
    data = JSON.parse(errBody);
  } catch {
    data = null;
  }

  if (!res.ok) {
    console.error("whatsapp.js: WhatsApp send failed:");
    const parsedError = data?.error;
    let errorMessage = `WhatsApp API error ${res.status}: ${errBody}`;
    if (parsedError?.code === 131030) {
      errorMessage =
        "Meta test mode rejected this recipient (131030). Add the customer number to WhatsApp Manager > API Setup > To, or use a production WhatsApp Business number.";
    } else if (parsedError?.code === 131047 || parsedError?.error_subcode === 2494010) {
      errorMessage =
        "Fenêtre de 24h Meta expirée : Le client n'a pas répondu depuis plus de 24 heures. Meta bloque les messages libres hors de cette fenêtre. Utilisez un modèle (Template) approuvé pour le relancer.";
    } else if (parsedError?.code === 131026) {
      errorMessage =
        "Message non distribuable (131026) : Le destinataire n'est pas actif sur WhatsApp ou le numéro est invalide.";
    } else if (parsedError?.message) {
      errorMessage = `Meta WhatsApp API (${parsedError.code || res.status}): ${parsedError.message}`;
    }
    const error = new Error(errorMessage);
    error.status = res.status;
    error.code = parsedError?.code;
    error.subcode = parsedError?.error_subcode;
    if (parsedError?.code === 131047 || parsedError?.error_subcode === 2494010) {
      error.errorCode = "WINDOW_EXPIRED";
    }
    error.details = parsedError;
    throw error;
  }

  console.log("whatsapp.js: WhatsApp message sent successfully");
  return data;
}

/**
 * Send a bot reply composed of 1, 2, or 3 short messages with a ~1s pause between them.
 * Returns the provider response of the last sent message (for wamid tracking).
 */
export async function sendSequentialWhatsAppTexts(phoneNumberId, to, textParts, delayMs = 1000) {
  let lastResponse = null;
  for (let i = 0; i < textParts.length; i++) {
    const part = textParts[i]?.trim();
    if (!part) continue;
    if (i > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    lastResponse = await sendWhatsAppText(phoneNumberId, to, part);
  }
  return lastResponse;
}

/**
 * Send a pre-approved WhatsApp template message (e.g. to re-engage customers outside the 24-hour window).
 * @param {string} phoneNumberId - Business Phone Number ID
 * @param {string} to - Recipient phone number or BSUID
 * @param {string} [templateName] - Template name (defaults to WHATSAPP_TEMPLATE_NAME or 'hello_world')
 * @param {string} [languageCode] - Language code (defaults to WHATSAPP_TEMPLATE_LANG or 'en_US')
 * @param {Array<object>} [components=null] - Optional template components (parameters for {{1}}, {{2}} etc.)
 */
export async function sendWhatsAppTemplate(phoneNumberId, to, templateName, languageCode, components = null) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId);
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    throw new Error("Invalid or empty WhatsApp recipient for template");
  }

  const name = templateName || process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
  const lang = languageCode || process.env.WHATSAPP_TEMPLATE_LANG || "en_US";

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`;
  const recipientField = isBsuid(recipient) ? { recipient: recipient } : { to: recipient };

  const templatePayload = {
    name,
    language: { code: lang },
  };

  if (Array.isArray(components) && components.length > 0) {
    templatePayload.components = components;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...recipientField,
    type: "template",
    template: templatePayload,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const errBody = await res.text();
  let data = null;
  try {
    data = JSON.parse(errBody);
  } catch {
    data = null;
  }

  if (!res.ok) {
    console.error("whatsapp.js: WhatsApp template send failed:");
    const parsedError = data?.error;
    let errorMessage = `WhatsApp template API error ${res.status}: ${errBody}`;
    if (parsedError?.message) {
      errorMessage = `Meta Template Error (${parsedError.code || res.status}): ${parsedError.message}`;
    }
    const error = new Error(errorMessage);
    error.status = res.status;
    error.code = parsedError?.code;
    error.details = parsedError;
    throw error;
  }

  console.log("whatsapp.js: WhatsApp template sent successfully");
  return data;
}

/**
 * Mark an inbound message as read (shows the blue double-check to the customer).
 * Optional, but makes the bot feel more responsive.
 */
export async function markAsRead(phoneNumberId, messageId) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId);
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch((err) => console.error("whatsapp.js: markAsRead failed:"));
}

/**
 * Resolve a WhatsApp media ID (e.g. from an incoming voice note) to a
 * short-lived, authenticated download URL.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#retrieve-media-url
 * @param {string} mediaId - message.audio.id / message.image.id / etc.
 * @returns {Promise<string>} the temporary CDN url to fetch the raw bytes from
 */
export async function getMediaUrl(mediaId, phoneNumberId) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId);
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.token}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp getMediaUrl failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  if (!data?.url) {
    throw new Error("WhatsApp getMediaUrl: response had no url field");
  }
  return data.url;
}

/**
 * Download the raw bytes for a media URL returned by getMediaUrl().
 * The download itself also requires the WhatsApp bearer token.
 * @param {string} mediaUrl
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadMedia(mediaUrl, phoneNumberId) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId);
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${credentials.token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`WhatsApp downloadMedia failed: ${res.status}`);
  }

  return res.arrayBuffer();
}