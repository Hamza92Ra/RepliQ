import { signedRequest } from "./signed-request.js";
import test, { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../lib/whatsapp.js";
import { looksLikeHumanRequest } from "../lib/notify.js";
import { splitWhatsAppMessages, generateReply, DEFAULT_SYSTEM_PROMPT } from "../lib/ai.js";
import webhookHandler from "../api/webhook.js";
import conversationHandler from "../api/conversation.js";
import { setTakeoverStatus, getTakeoverStatus } from "../lib/db.js";

describe("BUG 1 Fix: Plan Details & Non-Handoff Inquiries", () => {
  it("never triggers handoff on pack inquiries or feature questions", () => {
    const packQueries = [
      "c'est quoi les caractéristiques de chaque pack ?",
      "détaille la formule Standard",
      "chno kayn f Premium ?",
      "donne moi les détails de chaque formule",
      "quel est le prix de l'offre standard ?",
      "est-ce que le pack standard comprend le transfert vers un conseiller ?",
      "chno lfar9 bin Essentielle o Standard ?",
    ];

    for (const q of packQueries) {
      assert.equal(
        looksLikeHumanRequest(q),
        false,
        `Query should NOT trigger handoff: "${q}"`
      );
    }
  });

  it("triggers handoff only on explicit human/advisor requests", () => {
    const humanRequests = [
      "je veux parler à un conseiller",
      "bghit nhder m3a conseiller",
      "est-ce qu'il y a un humain ?",
      "passez-moi un conseiller svp",
      "un humain svp",
      "appelez-moi au téléphone",
      "speak to an agent please",
    ];

    for (const q of humanRequests) {
      assert.equal(
        looksLikeHumanRequest(q),
        true,
        `Query SHOULD trigger handoff: "${q}"`
      );
    }
  });

  it("splits 3-pack detailed descriptions into 3 separate WhatsApp messages", () => {
    const threePacksResponse = `*1. Formule Essentielle* : 200 MAD/mois (+ 400 MAD installation unique)
• Chatbot WhatsApp opérationnel 24h/24
• Tableau de bord pour consulter vos échanges
• Alertes WhatsApp pour le responsable
• Formation 1h à la prise en main
🎁 3 mois offerts avec le paiement annuel

*2. Formule Standard* : 400 MAD/mois (+ 600 MAD installation unique)
• Inclut tout Essentielle +
• Site web vitrine sur mesure pour votre activité
• Transfert fluide vers un conseiller humain
• Formation équipe de 2h
🎁 3 mois offerts avec le paiement annuel

*3. Formule Premium* : 800 MAD/mois (+ 1000 MAD installation unique)
• Inclut tout Standard +
• Nom de domaine personnalisé (.ma / .com)
• Gestion des fiches clients & CRM léger
• Confirmation automatique des commandes
🎁 3 mois offerts avec le paiement annuel`;

    const messages = splitWhatsAppMessages(threePacksResponse);
    assert.equal(messages.length, 3, "Should split into exactly 3 messages");
    assert.ok(messages[0].includes("Essentielle"));
    assert.ok(messages[1].includes("Standard"));
    assert.ok(messages[2].includes("Premium"));
    assert.ok(messages[1].includes("Inclut tout Essentielle +"));
    assert.ok(messages[2].includes("Inclut tout Standard +"));
  });

  it("keeps a single plan detail as 1 message", () => {
    const singlePackResponse = `*Formule Standard* : 400 MAD/mois (+ 600 MAD installation unique)
• Inclut tout Essentielle +
• Site web vitrine sur mesure pour votre activité
• Transfert vers un conseiller humain si besoin
• Formation de 2h pour votre équipe
🎁 3 mois offerts si vous optez pour le paiement annuel !

Souhaitez-vous planifier une démo de Standard ?`;

    const messages = splitWhatsAppMessages(singlePackResponse);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes("Formule Standard"));
  });
});

describe("AI Provider Fallback (Groq <-> Gemini)", () => {
  const origGroqKey = process.env.GROQ_API_KEY;
  const origGeminiKey = process.env.GEMINI_API_KEY;
  const origFetch = globalThis.fetch;

  afterEach(() => {
    process.env.GROQ_API_KEY = origGroqKey;
    process.env.GEMINI_API_KEY = origGeminiKey;
    globalThis.fetch = origFetch;
  });

  it("falls back to Gemini when Groq fails with 429 rate limit", async () => {
    process.env.GROQ_API_KEY = "test_groq_key";
    process.env.GEMINI_API_KEY = "test_gemini_key";

    let groqAttempted = false;
    let geminiAttempted = false;

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes("groq.com")) {
        groqAttempted = true;
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: "Rate limit reached" } }),
        };
      }
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        geminiAttempted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Voici les détails depuis Gemini." }],
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 500 };
    };

    const reply = await generateReply("Test question", []);
    assert.ok(groqAttempted, "Groq should be attempted first");
    assert.ok(geminiAttempted, "Gemini should be called as fallback");
    assert.equal(reply, "Voici les détails depuis Gemini.");
  });

  it("falls back to Groq when primary provider is Gemini and fails", async () => {
    process.env.PRIMARY_AI_PROVIDER = "gemini";
    process.env.GROQ_API_KEY = "test_groq_key";
    process.env.GEMINI_API_KEY = "test_gemini_key";

    let geminiAttempted = false;
    let groqAttempted = false;

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes("generativelanguage.googleapis.com")) {
        geminiAttempted = true;
        return {
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        };
      }
      if (urlStr.includes("groq.com")) {
        groqAttempted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "Voici la réponse depuis Groq." } }],
          }),
        };
      }
      return { ok: false, status: 500 };
    };

    try {
      const reply = await generateReply("Test question", []);
      assert.ok(geminiAttempted, "Gemini should be attempted first");
      assert.ok(groqAttempted, "Groq should be called as fallback");
      assert.equal(reply, "Voici la réponse depuis Groq.");
    } finally {
      delete process.env.PRIMARY_AI_PROVIDER;
    }
  });
});

describe("BUG 2 Fix: Human Takeover Guard & Phone Normalization", () => {
  it("normalizes phone numbers and preserves BSUID across formats", () => {
    assert.equal(normalizePhone("+212 6 12 34 56 78"), "212612345678");
    assert.equal(normalizePhone("0612345678"), "212612345678");
    assert.equal(normalizePhone("0712345678"), "212712345678");
    assert.equal(normalizePhone("00212612345678"), "212612345678");
    assert.equal(normalizePhone("212612345678"), "212612345678");
    assert.equal(normalizePhone("whatsapp:+212612345678"), "212612345678");
    assert.equal(normalizePhone("MA.1163080159477566"), "MA.1163080159477566");
    assert.equal(normalizePhone("whatsapp:MA.1163080159477566"), "MA.1163080159477566");
  });

  it("Webhook honors human_takeover flag before AI and remains silent", async () => {
    const testPhone = "212699887766";
    const store = new Map();

    const origFetch = globalThis.fetch;
    const outboundCalls = [];

    // Mock Redis pipeline & WhatsApp send
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes("upstash.io/pipeline")) {
        const body = JSON.parse(options.body);
        const results = body.map(([cmd, key, val]) => {
          if (cmd === "GET") {
            return { result: store.get(key) || null };
          }
          if (cmd === "SET") {
            store.set(key, val);
            return { result: "OK" };
          }
          if (cmd === "DEL") {
            store.delete(key);
            return { result: 1 };
          }
          if (cmd === "LPUSH") {
            return { result: 1 };
          }
          if (cmd === "LTRIM" || cmd === "SADD" || cmd === "SETNX") {
            return { result: 1 };
          }
          return { result: null };
        });
        return { ok: true, json: async () => results };
      }
      if (urlStr.includes("graph.facebook.com")) {
        outboundCalls.push(JSON.parse(options.body));
        return {
          ok: true,
          json: async () => ({ messages: [{ id: "wamid.outbound" }] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    process.env.UPSTASH_REDIS_REST_URL = "https://mock.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "mock_token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_id_123";

    try {
      // 1. Set human takeover to true
      await setTakeoverStatus(testPhone, true);

      // Verify takeover status is active
      const status = await getTakeoverStatus(testPhone);
      assert.equal(status.human_takeover, true);

      // 2. Incoming message arrives via webhook
      const webhookPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "phone_id_123" },
                  messages: [
                    {
                      id: "wamid.test_msg_001",
                      from: testPhone,
                      type: "text",
                      text: { body: "Bonjour, j'ai une question urgente" },
                      timestamp: Math.floor(Date.now() / 1000),
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      let resStatusCode = null;
      let resBody = null;
      const res = {
        status(code) {
          resStatusCode = code;
          return this;
        },
        send(body) {
          resBody = body;
          return this;
        },
      };

      // Handler returns 200 immediately
      await webhookHandler(signedRequest({ method: "POST", body: webhookPayload }), res);
      assert.equal(resStatusCode, 200);
      assert.equal(resBody, "EVENT_RECEIVED");

      // Give async queue a moment to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Bot MUST have remained silent: NO outbound WhatsApp messages
      assert.equal(
        outboundCalls.length,
        0,
        "Bot should NOT have sent any message while human takeover is active"
      );
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });
});
