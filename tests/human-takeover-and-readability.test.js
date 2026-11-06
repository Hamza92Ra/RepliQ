// tests/human-takeover-and-readability.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/conversation.js";
import {
  getTakeoverStatus,
  setTakeoverStatus,
  saveMessage,
  getConversation,
} from "../lib/db.js";
import {
  looksLikeHumanRequest,
  getHandoffMessage,
  notifyHandoff,
} from "../lib/notify.js";
import {
  splitWhatsAppMessages,
  formatForWhatsApp,
  DEFAULT_SYSTEM_PROMPT,
} from "../lib/ai.js";

describe("Part 1: Human Takeover & Fail-Safe Silent Bot", () => {
  const SECRET = "test_secret_123";
  const PHONE = "212611223344";

  let originalEnv;
  let originalFetch;
  let redisStore = {};
  let sentMails = [];
  let metaSentTexts = [];

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DASHBOARD_SECRET = SECRET;
    process.env.DEFAULT_PHONE_NUMBER_ID = "123456789";
    process.env.WHATSAPP_TOKEN = "test_token";
    process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "mock_token";
    process.env.RESEND_API_KEY = "mock_resend_key";
    process.env.NOTIFY_EMAIL_TO = "owner@example.com";

    redisStore = {};
    sentMails = [];
    metaSentTexts = [];
    originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // Upstash Redis mock
      if (urlStr.includes("mock-redis.upstash.io")) {
        const commands = JSON.parse(options.body || "[]");
        const results = commands.map(([cmd, ...args]) => {
          if (cmd === "GET") {
            return { result: redisStore[args[0]] ?? null };
          }
          if (cmd === "SET") {
            const [key, val] = args;
            redisStore[key] = String(val);
            return { result: "OK" };
          }
          if (cmd === "DEL") {
            for (const key of args) {
              delete redisStore[key];
            }
            return { result: 1 };
          }
          if (cmd === "RPUSH") {
            const [key, ...items] = args;
            if (!redisStore[key]) redisStore[key] = [];
            if (Array.isArray(redisStore[key])) {
              redisStore[key].push(...items);
            }
            return { result: items.length };
          }
          if (cmd === "LRANGE") {
            const [key] = args;
            const list = Array.isArray(redisStore[key]) ? redisStore[key] : [];
            return { result: list };
          }
          if (cmd === "LTRIM" || cmd === "SADD" || cmd === "SREM" || cmd === "SMEMBERS") {
            return { result: cmd === "SMEMBERS" ? [PHONE] : "OK" };
          }
          return { result: null };
        });
        return new Response(JSON.stringify(results), { status: 200 });
      }

      // Resend mock
      if (urlStr.includes("api.resend.com/emails")) {
        const mailBody = JSON.parse(options.body || "{}");
        sentMails.push(mailBody);
        return new Response(JSON.stringify({ id: "mail_123" }), { status: 200 });
      }

      // Meta WhatsApp send mock
      if (urlStr.includes("graph.facebook.com")) {
        const msgBody = JSON.parse(options.body || "{}");
        metaSentTexts.push(msgBody?.text?.body || "");
        return new Response(
          JSON.stringify({
            messaging_product: "whatsapp",
            messages: [{ id: "wamid.mock" + Date.now() }],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("stores human_takeover flag and timestamp in Redis", async () => {
    await setTakeoverStatus(PHONE, true, 1700000000000);
    const status = await getTakeoverStatus(PHONE);
    assert.equal(status.human_takeover, true);
    assert.equal(status.takeover_at, 1700000000000);

    await setTakeoverStatus(PHONE, false);
    const released = await getTakeoverStatus(PHONE);
    assert.equal(released.human_takeover, false);
    assert.equal(released.takeover_at, null);
  });

  it("auto-releases takeover after TAKEOVER_TIMEOUT_HOURS", async () => {
    process.env.TAKEOVER_TIMEOUT_HOURS = "2";
    const twoHoursAndOneMinuteAgo = Date.now() - (2 * 3600 * 1000 + 60000);

    await setTakeoverStatus(PHONE, true, twoHoursAndOneMinuteAgo);
    const status = await getTakeoverStatus(PHONE);
    assert.equal(status.human_takeover, false);
    assert.equal(status.autoReleased, true);
  });

  it("automatically enables human_takeover when agent sends manual reply", async () => {
    // Populate an inbound user message so 24h window is open
    await saveMessage(PHONE, "user", "Bonjour, question", "123456789", { ts: Date.now() });

    const req = {
      method: "POST",
      query: { key: SECRET },
      body: {
        phone: PHONE,
        action: "reply",
        message: "Bonjour, je prends le relais",
      },
    };
    let responseStatus = 200;
    let responseBody = {};
    const res = {
      status(s) {
        responseStatus = s;
        return this;
      },
      json(b) {
        responseBody = b;
        return this;
      },
    };

    await handler(req, res);
    assert.equal(responseStatus, 200);
    assert.equal(responseBody.ok, true);

    const takeover = await getTakeoverStatus(PHONE);
    assert.equal(takeover.human_takeover, true);
  });

  it("stops bot from replying when human_takeover is active", async () => {
    await setTakeoverStatus(PHONE, true);

    const webhookReq = {
      method: "POST",
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "123456789" },
                  messages: [
                    {
                      from: PHONE,
                      id: "wamid.msg1",
                      type: "text",
                      text: { body: "Allô ?" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    let ackStatus = 0;
    const res = {
      status(s) {
        ackStatus = s;
        return this;
      },
      send(t) {
        return this;
      },
    };

    await handler(webhookReq, res);
    assert.equal(ackStatus, 200);

    // Wait for waitUntil background task to finish processing
    await new Promise((r) => setTimeout(r, 50));

    // Meta API should NOT have been called with an automatic reply
    assert.equal(metaSentTexts.length, 0);

    // Message must be stored in conversation history for the admin
    const convo = await getConversation(PHONE);
    assert.ok(convo.messages.some((m) => m.content.includes("Allô ?")));
  });

  it("detects when customer asks for a human and triggers handoff with Resend email alert", async () => {
    assert.ok(looksLikeHumanRequest("je veux parler à un conseiller"));
    assert.ok(looksLikeHumanRequest("bghit nhder m3a conseiller"));
    assert.ok(looksLikeHumanRequest("est-ce qu'il y a un humain ?"));

    const handoffFr = getHandoffMessage("je veux parler à un conseiller");
    assert.equal(handoffFr, "Je transmets votre demande à un conseiller, il vous répond très vite 🙏");

    const handoffDarija = getHandoffMessage("bghit nhder m3a chi wa7d");
    assert.ok(handoffDarija.includes("المستشارين"));

    // Send handoff notification via Resend
    await notifyHandoff({
      from: PHONE,
      message: "Je veux un humain svp",
      reason: "Demande client",
    });

    assert.equal(sentMails.length, 1);
    assert.ok(sentMails[0].subject.includes(PHONE));
    assert.ok(sentMails[0].text.includes("Je veux un humain svp"));
  });

  it("fail-safe: if takeover lookup throws error, bot stays silent and logs error", async () => {
    // Simulate Redis failure specifically during takeover check
    globalThis.fetch = async (url) => {
      if (String(url).includes("mock-redis.upstash.io")) {
        throw new Error("Redis cluster unavailable");
      }
      return new Response("{}", { status: 200 });
    };

    const webhookReq = {
      method: "POST",
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "123456789" },
                  messages: [
                    {
                      from: PHONE,
                      id: "wamid.msg_fail_safe",
                      type: "text",
                      text: { body: "Quel est le prix ?" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const res = {
      status() {
        return this;
      },
      send() {
        return this;
      },
    };

    await handler(webhookReq, res);
    await new Promise((r) => setTimeout(r, 50));

    // Fail-safe requirement: Bot must NOT auto-reply when lookup fails
    assert.equal(metaSentTexts.length, 0);
  });
});

describe("Part 2: WhatsApp Answer Readability & Formatting", () => {
  it("formats markdown bold from **text** to *text* for WhatsApp", () => {
    const raw = "Voici les **formules** disponibles :\n## Titre\n- Item 1\n- Item 2";
    const formatted = formatForWhatsApp(raw);
    assert.ok(formatted.includes("*formules*"));
    assert.ok(!formatted.includes("**"));
    assert.ok(!formatted.includes("##"));
    assert.ok(formatted.includes("• Item 1"));
  });

  it("splits long messages into 2 or 3 short messages", () => {
    const longText = `Voici nos 3 formules 👇

*1. Essentielle* : 200 MAD/mois
Chatbot WhatsApp 24h/24 + tableau de bord

*2. Standard* : 400 MAD/mois
Essentielle + site web + transfert vers un conseiller

*3. Premium* : 800 MAD/mois
Standard + domaine perso + fiches clients + statistiques

🎁 3 mois offerts après l'installation.
Laquelle vous intéresse ? Je vous détaille la formule choisie.

Option de paiement annuel disponible avec réduction fidélité dès l'année 2.
Contactez-nous pour toute question !`;

    const parts = splitWhatsAppMessages(longText);
    assert.ok(parts.length >= 2 && parts.length <= 3);
    for (const part of parts) {
      assert.ok(part.split("\n").length <= 10);
    }
  });

  it("keeps short messages intact as 1 message", () => {
    const shortText = "Bonjour ! Comment puis-je vous aider aujourd'hui ? 😊";
    const parts = splitWhatsAppMessages(shortText);
    assert.equal(parts.length, 1);
    assert.equal(parts[0], shortText);
  });

  it("system prompt enforces short overview for pricing with 200, 400, 800 MAD", () => {
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("*1. Essentielle* : 200 MAD/mois"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("*2. Standard* : 400 MAD/mois"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("*3. Premium* : 800 MAD/mois"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("🎁 3 mois offerts"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("MAXIMUM 6 à 8 lignes"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("NE JAMAIS ENVOYER LES 3 FORMULES EN DÉTAIL D'UN COUP"));
  });
});
