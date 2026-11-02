// tests/window.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TWENTY_FOUR_HOURS_MS,
  getLastInboundTimestamp,
  isWithin24hWindow,
  getWindowInfo,
  isWindowExpiredError,
  isRetryableError,
  formatFriendlyError,
} from "../lib/window.js";
import {
  buildTemplateComponents,
  renderTemplatePreview,
  DEFAULT_APPROVED_TEMPLATES,
} from "../lib/templates.js";

describe("Meta 24-hour Customer Care Window Helper", () => {
  const BASE_TIME = 1700000000000;

  it("identifies the last inbound (role === 'user') timestamp correctly", () => {
    const conversation = {
      messages: [
        { role: "user", content: "Bonjour", ts: BASE_TIME },
        { role: "assistant", content: "Bonjour, comment vous aider ?", ts: BASE_TIME + 60000 },
        { role: "agent", content: "Un conseiller prend le relais", ts: BASE_TIME + 120000 },
      ],
    };

    assert.equal(getLastInboundTimestamp(conversation), BASE_TIME);
  });

  it("returns null if no inbound message exists in conversation", () => {
    const conversation = {
      messages: [
        { role: "assistant", content: "Offre promo", ts: BASE_TIME },
        { role: "agent", content: "Bonjour !", ts: BASE_TIME + 1000 },
      ],
    };

    assert.equal(getLastInboundTimestamp(conversation), null);
    assert.equal(getLastInboundTimestamp([]), null);
    assert.equal(getLastInboundTimestamp(null), null);
  });

  it("handles string ISO timestamps gracefully", () => {
    const isoString = new Date(BASE_TIME).toISOString();
    const conversation = {
      messages: [{ role: "user", content: "Test ISO", ts: isoString }],
    };

    assert.equal(getLastInboundTimestamp(conversation), BASE_TIME);
  });

  it("is within window when inbound message is recent (< 24h)", () => {
    const conversation = {
      messages: [{ role: "user", content: "Salut", ts: BASE_TIME }],
    };

    const oneHourLater = BASE_TIME + 60 * 60 * 1000;
    assert.equal(isWithin24hWindow(conversation, oneHourLater), true);
  });

  it("strictly enforces boundary at EXACTLY 24 hours (86,400,000 ms)", () => {
    const conversation = {
      messages: [{ role: "user", content: "Demande", ts: BASE_TIME }],
    };

    // 1ms before 24h -> OPEN (true)
    assert.equal(isWithin24hWindow(conversation, BASE_TIME + TWENTY_FOUR_HOURS_MS - 1), true);

    // Exactly 24h -> OPEN (true, boundary is inclusive)
    assert.equal(isWithin24hWindow(conversation, BASE_TIME + TWENTY_FOUR_HOURS_MS), true);

    // 1ms after 24h -> EXPIRED (false)
    assert.equal(isWithin24hWindow(conversation, BASE_TIME + TWENTY_FOUR_HOURS_MS + 1), false);

    // 25h -> EXPIRED (false)
    assert.equal(isWithin24hWindow(conversation, BASE_TIME + 25 * 60 * 60 * 1000), false);
  });

  it("outbound messages do NOT extend the 24h window", () => {
    const conversation = {
      messages: [
        { role: "user", content: "Message client", ts: BASE_TIME },
        // Outbound sent 23h later
        { role: "assistant", content: "Réponse bot", ts: BASE_TIME + 23 * 60 * 60 * 1000 },
        // Outbound sent 25h later
        { role: "agent", content: "Réponse conseiller", ts: BASE_TIME + 25 * 60 * 60 * 1000 },
      ],
    };

    // Current time is 24h + 10 minutes from customer message
    const now = BASE_TIME + 24 * 60 * 60 * 1000 + 10 * 60 * 1000;
    assert.equal(isWithin24hWindow(conversation, now), false);
  });

  it("a new inbound message correctly resets the 24h window", () => {
    const conversation = {
      messages: [
        { role: "user", content: "Ancien message il y a 3 jours", ts: BASE_TIME },
        { role: "assistant", content: "Réponse ancienne", ts: BASE_TIME + 1000 },
      ],
    };

    // 48h after first message -> expired
    const timeLater = BASE_TIME + 48 * 60 * 60 * 1000;
    assert.equal(isWithin24hWindow(conversation, timeLater), false);

    // Customer sends a new message!
    conversation.messages.push({
      role: "user",
      content: "Nouveau message client",
      ts: timeLater,
    });

    // Window is now open again!
    assert.equal(isWithin24hWindow(conversation, timeLater + 1000), true);
    assert.equal(isWithin24hWindow(conversation, timeLater + TWENTY_FOUR_HOURS_MS), true);
    assert.equal(isWithin24hWindow(conversation, timeLater + TWENTY_FOUR_HOURS_MS + 1), false);
  });

  it("returns expired window if no inbound message exists", () => {
    assert.equal(isWithin24hWindow({ messages: [] }, BASE_TIME), false);
    assert.equal(isWithin24hWindow(null, BASE_TIME), false);
  });

  it("getWindowInfo returns complete and accurate window status", () => {
    const conversation = {
      messages: [{ role: "user", content: "Question", ts: BASE_TIME }],
    };

    const halfWindow = BASE_TIME + 12 * 60 * 60 * 1000;
    const info = getWindowInfo(conversation, halfWindow);

    assert.equal(info.isOpen, true);
    assert.equal(info.lastInboundTs, BASE_TIME);
    assert.equal(info.expiresAt, BASE_TIME + TWENTY_FOUR_HOURS_MS);
    assert.equal(info.remainingMs, 12 * 60 * 60 * 1000);
  });
});

describe("Error 131047 Mapping and Friendly Error Formatter", () => {
  it("detects error 131047 by numeric code, subcode, string, or WINDOW_EXPIRED", () => {
    assert.equal(isWindowExpiredError(null, 131047), true);
    assert.equal(isWindowExpiredError(null, "WINDOW_EXPIRED"), true);
    assert.equal(isWindowExpiredError({ code: 131047 }), true);
    assert.equal(isWindowExpiredError({ error_subcode: 2494010 }), true);
    assert.equal(isWindowExpiredError("Re-engagement message (131047): Re-engagement message"), true);
    assert.equal(isWindowExpiredError("Fenêtre de 24h Meta expirée"), true);
    assert.equal(isWindowExpiredError("Something else", 500), false);
  });

  it("maps error 131047 to human-readable French explanation", () => {
    const friendly = formatFriendlyError("Re-engagement message (131047): Re-engagement message", 131047);
    assert.equal(friendly, "Fenêtre de 24h Meta expirée : envoyez un modèle WhatsApp pour réengager ce client.");
  });

  it("differentiates retryable vs non-retryable errors", () => {
    // Expired window is not retryable with free text
    assert.equal(isRetryableError("Re-engagement message", 131047), false);
    assert.equal(isRetryableError(null, "WINDOW_EXPIRED"), false);

    // Unwhitelisted test number is not retryable
    assert.equal(isRetryableError("Recipient not in whitelist", 131030), false);

    // Invalid number is not retryable
    assert.equal(isRetryableError("Undeliverable", 131026), false);

    // Network error, server 502, rate limit 429 are retryable
    assert.equal(isRetryableError("Network timeout", 504), true);
    assert.equal(isRetryableError("Rate limit hit", 429), true);
    assert.equal(isRetryableError("Server error", 500), true);
  });
});

describe("WhatsApp Template Variable Formatting & Preview", () => {
  it("replaces {{1}}, {{2}} in template preview correctly", () => {
    const body = "Bonjour {{1}}, nous faisons suite à votre demande concernant {{2}}.";
    const preview = renderTemplatePreview(body, ["Fatima", "votre commande CMD-123"]);
    assert.equal(preview, "Bonjour Fatima, nous faisons suite à votre demande concernant votre commande CMD-123.");
  });

  it("displays fallback placeholder when variable is missing", () => {
    const body = "Bonjour {{1}}, votre code est {{2}}.";
    const preview = renderTemplatePreview(body, ["Karim"]);
    assert.equal(preview, "Bonjour Karim, votre code est [Variable 2].");
  });

  it("builds Meta Cloud API component parameters payload", () => {
    const components = buildTemplateComponents(["Mohamed", "Devis #123"]);
    assert.deepEqual(components, [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Mohamed" },
          { type: "text", text: "Devis #123" },
        ],
      },
    ]);
  });
});
