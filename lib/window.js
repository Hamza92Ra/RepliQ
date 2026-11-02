// lib/window.js
// 24-hour Meta WhatsApp Customer Care Window helper functions.
//
// Meta policy: A business can send free-form messages to a customer ONLY within
// 24 hours of the customer's last INBOUND message. Outside this window, Meta
// rejects free-form messages with error 131047 ("Re-engagement message").
// Only pre-approved Template messages are permitted outside the 24-hour window.

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms

/**
 * Extract the timestamp (in ms) of the most recent INBOUND message
 * (role === "user") from a conversation.
 * Outbound messages (agent, assistant) do not count.
 *
 * @param {object|Array} conversation - Conversation object with .messages or an array of messages
 * @returns {number|null} Timestamp in ms, or null if no inbound message exists
 */
export function getLastInboundTimestamp(conversation) {
  if (!conversation) return null;
  const messages = Array.isArray(conversation)
    ? conversation
    : Array.isArray(conversation?.messages)
      ? conversation.messages
      : null;

  if (!messages || messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user" && msg.ts) {
      const ts = typeof msg.ts === "number" ? msg.ts : new Date(msg.ts).getTime();
      if (!Number.isNaN(ts) && ts > 0) {
        return ts;
      }
    }
  }

  return null;
}

/**
 * Check whether a conversation is currently within the Meta 24-hour window.
 * The window is calculated exclusively from the last INBOUND message (role === "user").
 *
 * Boundary condition:
 * - At exactly 24 hours (now - lastInboundTs === TWENTY_FOUR_HOURS_MS), the window is OPEN (<= 24h).
 * - Beyond 24 hours (now - lastInboundTs > TWENTY_FOUR_HOURS_MS), the window is EXPIRED.
 * - If no inbound message exists, the window is EXPIRED (false).
 *
 * @param {object|Array} conversation - Conversation object or message array
 * @param {number} [now=Date.now()] - Current timestamp for evaluation
 * @returns {boolean} true if inside the 24h window, false otherwise
 */
export function isWithin24hWindow(conversation, now = Date.now()) {
  const lastInboundTs = getLastInboundTimestamp(conversation);
  if (lastInboundTs === null) return false;

  const elapsed = now - lastInboundTs;
  return elapsed >= 0 && elapsed <= TWENTY_FOUR_HOURS_MS;
}

/**
 * Detailed window state for a conversation (used by server endpoints and dashboard).
 *
 * @param {object|Array} conversation
 * @param {number} [now=Date.now()]
 * @returns {{
 *   isOpen: boolean,
 *   lastInboundTs: number|null,
 *   expiresAt: number|null,
 *   remainingMs: number
 * }}
 */
export function getWindowInfo(conversation, now = Date.now()) {
  const lastInboundTs = getLastInboundTimestamp(conversation);
  const isOpen = lastInboundTs !== null && isWithin24hWindow(conversation, now);
  const expiresAt = lastInboundTs !== null ? lastInboundTs + TWENTY_FOUR_HOURS_MS : null;
  const remainingMs = expiresAt !== null ? Math.max(0, expiresAt - now) : 0;

  return {
    isOpen,
    lastInboundTs,
    expiresAt,
    remainingMs,
  };
}

/**
 * Detect whether an error corresponds to Meta error 131047 ("Re-engagement message" / window expired).
 *
 * @param {string|Error|any} error
 * @param {number|string} [code]
 * @returns {boolean}
 */
export function isWindowExpiredError(error, code) {
  const str = String(error?.message || error || "");
  const c = Number(code || error?.code);
  const sub = Number(error?.subcode || error?.error_subcode);

  return (
    c === 131047 ||
    sub === 2494010 ||
    code === "WINDOW_EXPIRED" ||
    str.includes("131047") ||
    str.includes("2494010") ||
    str.includes("WINDOW_EXPIRED") ||
    /re-engagement/i.test(str) ||
    /fenêtre de 24h/i.test(str)
  );
}

/**
 * Check whether an error is retryable (network, timeout, rate limit, server error).
 * Non-retryable errors include expired 24h window, invalid recipient, unwhitelisted recipient.
 *
 * @param {string|Error|any} error
 * @param {number|string} [code]
 * @returns {boolean}
 */
export function isRetryableError(error, code) {
  if (isWindowExpiredError(error, code)) return false;

  const str = String(error?.message || error || "");
  const c = Number(code || error?.code);

  // Meta test recipient not whitelisted
  if (c === 131030 || str.includes("131030")) return false;

  // Undeliverable / invalid phone number
  if (c === 131026 || str.includes("131026")) return false;

  // Rate limits, network failures, timeouts, 5xx server errors are retryable
  return true;
}

/**
 * Map raw Meta or backend error strings into clean, human-readable French descriptions.
 *
 * @param {string|Error|any} error
 * @param {number|string} [code]
 * @returns {string}
 */
export function formatFriendlyError(error, code) {
  if (isWindowExpiredError(error, code)) {
    return "Fenêtre de 24h Meta expirée : envoyez un modèle WhatsApp pour réengager ce client.";
  }

  const str = String(error?.message || error || "");
  const c = Number(code || error?.code);

  if (c === 131030 || str.includes("131030")) {
    return "Numéro non autorisé en mode test Meta. Ajoutez ce numéro dans WhatsApp Manager > Configuration de l'API.";
  }

  if (c === 131026 || str.includes("131026")) {
    return "Numéro introuvable ou inactif sur WhatsApp.";
  }

  if (c === 130429 || c === 429 || str.includes("130429") || /rate limit/i.test(str)) {
    return "Limite d'envoi atteinte. Veuillez patienter un instant avant de réessayer.";
  }

  // Truncate overly long technical payloads
  if (str.length > 140) {
    return str.slice(0, 137) + "…";
  }

  return str || "Échec d'envoi WhatsApp";
}
