// Thin wrapper around Meta's WhatsApp Cloud API (Graph API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

const GRAPH_VERSION = "v21.0";

/**
 * Send a plain text WhatsApp message.
 * @param {string} phoneNumberId - the "Phone number ID" from the Meta dashboard (not the phone number itself)
 * @param {string} to - recipient's phone number in international format, no "+", e.g. "212612345678"
 * @param {string} text - message body
 */
export async function sendWhatsAppText(phoneNumberId, to, text) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("WhatsApp send failed:", res.status, errBody);
    throw new Error(`WhatsApp API error ${res.status}: ${errBody}`);
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