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
  return typeof id === "string" && BSUID_PATTERN.test(id);
}

/**
 * Send a plain text WhatsApp message.
 * @param {string} phoneNumberId - the "Phone number ID" from the Meta dashboard (not the phone number itself)
 * @param {string} to - recipient's phone number (international format, no "+", e.g. "212612345678")
 *   OR a BSUID (e.g. "MA.1587668549511396") for username-only contacts.
 * @param {string} text - message body
 */
export async function sendWhatsAppText(phoneNumberId, to, text) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const recipientField = isBsuid(to) ? { recipient: to } : { to };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...recipientField,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("WhatsApp send failed:", res.status, errBody);
    let parsedError;
    try {
      parsedError = JSON.parse(errBody)?.error;
    } catch {
      parsedError = null;
    }
    const errorMessage =
      parsedError?.code === 131030
        ? "Meta test mode rejected this recipient (131030). Add the customer number to WhatsApp Manager > API Setup > To, or use a production WhatsApp Business number."
        : `WhatsApp API error ${res.status}: ${errBody}`;
    const error = new Error(errorMessage);
    error.status = res.status;
    error.code = parsedError?.code;
    throw error;
  }

  return res.json();
}

/**
 * Mark an inbound message as read (shows the blue double-check to the customer).
 * Optional, but makes the bot feel more responsive.
 */
export async function markAsRead(phoneNumberId, messageId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch((err) => console.error("markAsRead failed:", err));
}

/**
 * Resolve a WhatsApp media ID (e.g. from an incoming voice note) to a
 * short-lived, authenticated download URL.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#retrieve-media-url
 * @param {string} mediaId - message.audio.id / message.image.id / etc.
 * @returns {Promise<string>} the temporary CDN url to fetch the raw bytes from
 */
export async function getMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
export async function downloadMedia(mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`WhatsApp downloadMedia failed: ${res.status}`);
  }

  return res.arrayBuffer();
}