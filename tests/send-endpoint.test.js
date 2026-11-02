// tests/send-endpoint.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/conversation.js";
import { TWENTY_FOUR_HOURS_MS } from "../lib/window.js";

describe("Conversation API - 24-hour Window Enforcement & Template Behavior", () => {
  const SECRET = "test_secret_123";
  const PHONE_NUMBER_ID = "1234567890";
  const CUSTOMER_PHONE = "212600112233";

  let originalEnv;
  let originalFetch;
  let redisStorage = {};
  let metaApiCalls = [];

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DASHBOARD_SECRET = SECRET;
    process.env.DEFAULT_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
    process.env.WHATSAPP_TOKEN = "test_whatsapp_token";
    process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "mock_token";

    redisStorage = {};
    metaApiCalls = [];
    originalFetch = globalThis.fetch;

    // Mock fetch for both Redis and Meta Graph API
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // 1. Meta Graph API
      if (urlStr.includes("graph.facebook.com")) {
        metaApiCalls.push({
          url: urlStr,
          method: options.method || "GET",
          body: options.body ? JSON.parse(options.body) : null,
        });

        const bodyObj = options.body ? JSON.parse(options.body) : {};

        // Simulate Meta error 131047 if message content triggers it
        if (bodyObj?.text?.body === "TRIGGER_META_131047") {
          return {
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({
                error: {
                  message: "Re-engagement message (131047): Re-engagement message",
                  type: "OAuthException",
                  code: 131047,
                  error_subcode: 2494010,
                  fbtrace_id: "test_trace",
                },
              }),
          };
        }

        // Default successful Meta response
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              messaging_product: "whatsapp",
              contacts: [{ input: CUSTOMER_PHONE, wa_id: CUSTOMER_PHONE }],
              messages: [{ id: `wamid.HBgL${Date.now()}` }],
            }),
        };
      }

      // 2. Upstash Redis REST API Pipeline
      if (urlStr.includes("mock-redis.upstash.io/pipeline")) {
        const commands = JSON.parse(options.body || "[]");
        const results = commands.map(([cmd, ...args]) => {
          if (cmd === "LRANGE") {
            const key = args[0];
            const list = redisStorage[key] || [];
            return { result: list };
          }
          if (cmd === "GET") {
            const key = args[0];
            return { result: redisStorage[key] || null };
          }
          if (cmd === "SET") {
            const [key, val] = args;
            redisStorage[key] = val;
            return { result: "OK" };
          }
          if (cmd === "RPUSH") {
            const [key, ...items] = args;
            if (!redisStorage[key]) redisStorage[key] = [];
            redisStorage[key].push(...items);
            return { result: redisStorage[key].length };
          }
          if (cmd === "LTRIM") {
            return { result: "OK" };
          }
          if (cmd === "SADD") {
            return { result: 1 };
          }
          if (cmd === "DEL") {
            const keys = args;
            for (const k of keys) delete redisStorage[k];
            return { result: keys.length };
          }
          return { result: null };
        });

        return {
          ok: true,
          status: 200,
          json: async () => results,
          text: async () => JSON.stringify(results),
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => "Not found",
      };
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  function createMockReqRes({ method = "POST", query = {}, body = {} } = {}) {
    const req = {
      method,
      query: { key: SECRET, ...query },
      body,
    };
    let statusCode = 200;
    let responseData = null;
    let sent = false;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        sent = true;
        return this;
      },
      send(data) {
        responseData = data;
        sent = true;
        return this;
      },
      get statusCode() {
        return statusCode;
      },
      get body() {
        return responseData;
      },
      get headersSent() {
        return sent;
      },
    };
    return { req, res };
  }

  it("REJECTS free text with HTTP 409 and code WINDOW_EXPIRED when 24h window is expired", async () => {
    // Setup: Customer sent message 25 hours ago
    const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [
      JSON.stringify({
        id: "msg_1",
        role: "user",
        content: "Question ancienne",
        ts: expiredTimestamp,
      }),
    ];

    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "reply",
        message: "Bonjour, avez-vous toujours besoin d'aide ?",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, "WINDOW_EXPIRED");
    assert.match(res.body.details, /Fenêtre de 24h Meta expirée/);

    // CRITICAL: Meta Graph API must NOT be called
    assert.equal(metaApiCalls.length, 0);

    // CRITICAL: Must NOT create a "failed" message in the DB
    const storedMessages = (redisStorage[`conv:${CUSTOMER_PHONE}`] || []).map((m) => JSON.parse(m));
    const agentMessages = storedMessages.filter((m) => m.role === "agent");
    assert.equal(agentMessages.length, 0);
  });

  it("REJECTS free text when no customer inbound message exists", async () => {
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [];

    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "reply",
        message: "Premier contact libre",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "WINDOW_EXPIRED");
    assert.equal(metaApiCalls.length, 0);
  });

  it("ALLOWS free text when within 24h window", async () => {
    // Setup: Customer sent message 2 hours ago
    const recentTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [
      JSON.stringify({
        id: "msg_1",
        role: "user",
        content: "Besoin d'un renseignement",
        ts: recentTimestamp,
      }),
    ];

    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "reply",
        message: "Bien sûr, je vous écoute !",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "sent");

    // Meta API WAS called
    assert.equal(metaApiCalls.length, 1);
    assert.equal(metaApiCalls[0].body.type, "text");
    assert.equal(metaApiCalls[0].body.text.body, "Bien sûr, je vous écoute !");

    // Message saved as "sent" in DB
    const storedMessages = (redisStorage[`conv:${CUSTOMER_PHONE}`] || []).map((m) => JSON.parse(m));
    const sentMsg = storedMessages.find((m) => m.role === "agent");
    assert.ok(sentMsg);
    assert.equal(sentMsg.status, "sent");
  });

  it("ALLOWS template messages even when the 24h window is EXPIRED", async () => {
    // Setup: Customer sent message 3 days ago (window expired)
    const expiredTimestamp = Date.now() - 72 * 60 * 60 * 1000;
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [
      JSON.stringify({
        id: "msg_old",
        role: "user",
        content: "Message ancien",
        ts: expiredTimestamp,
      }),
    ];

    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "template",
        templateName: "reengagement_fr",
        languageCode: "fr",
        variables: ["Mohamed", "votre devis"],
        previewText: "Bonjour Mohamed, nous n'avons pas eu de vos nouvelles...",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.template, "reengagement_fr");

    // Meta API was called with template payload
    assert.equal(metaApiCalls.length, 1);
    assert.equal(metaApiCalls[0].body.type, "template");
    assert.equal(metaApiCalls[0].body.template.name, "reengagement_fr");
    assert.deepEqual(metaApiCalls[0].body.template.components, [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Mohamed" },
          { type: "text", text: "votre devis" },
        ],
      },
    ]);

    // Template recorded in conversation
    const stored = (redisStorage[`conv:${CUSTOMER_PHONE}`] || []).map((m) => JSON.parse(m));
    const templateMsg = stored.find((m) => m.template === "reengagement_fr");
    assert.ok(templateMsg);
    assert.equal(templateMsg.status, "sent");
  });

  it("handles Meta error 131047 defensively: maps to WINDOW_EXPIRED and records failure reason", async () => {
    // Setup: Conversation appears open locally (e.g. clock drift or edge race condition)
    const justUnder24h = Date.now() - 23.9 * 60 * 60 * 1000;
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [
      JSON.stringify({
        id: "msg_user",
        role: "user",
        content: "Message",
        ts: justUnder24h,
      }),
    ];

    // Trigger mocked 131047 from Meta
    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "reply",
        message: "TRIGGER_META_131047",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, "WINDOW_EXPIRED");
    assert.equal(res.body.error, "WINDOW_EXPIRED");
    assert.match(res.body.details, /Fenêtre de 24h Meta expirée/);

    // Check failed message record in Redis
    const stored = (redisStorage[`conv:${CUSTOMER_PHONE}`] || []).map((m) => JSON.parse(m));
    const failedMsg = stored.find((m) => m.status === "failed");
    assert.ok(failedMsg);
    assert.equal(failedMsg.errorCode, "WINDOW_EXPIRED");
    assert.match(failedMsg.error, /Fenêtre de 24h Meta expirée/);
  });

  it("lists approved templates via action: get_templates", async () => {
    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "get_templates",
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.templates));
    assert.ok(res.body.templates.some((t) => t.name === "hello_world"));
    assert.ok(res.body.templates.some((t) => t.name === "reengagement_fr"));
  });

  it("deletes a failed message via action: delete_message", async () => {
    const failedId = "failed_msg_456";
    redisStorage[`conv:${CUSTOMER_PHONE}`] = [
      JSON.stringify({ id: "good_msg_1", role: "user", content: "Bonjour", ts: Date.now() }),
      JSON.stringify({ id: failedId, role: "agent", content: "Test échec", status: "failed", error: "131047", ts: Date.now() }),
    ];

    const { req, res } = createMockReqRes({
      body: {
        phone: CUSTOMER_PHONE,
        action: "delete_message",
        messageId: failedId,
      },
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.removed, true);

    const remaining = (redisStorage[`conv:${CUSTOMER_PHONE}`] || []).map((m) => JSON.parse(m));
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "good_msg_1");
  });

  it("Bot auto-reply path checks 24h window and never sends free text outside it", async () => {
    // Webhook delivers a delayed message where message.timestamp was 25 hours ago
    const expiredSeconds = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000);

    const webhookPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    id: `wamid.msg_${Date.now()}`,
                    from: CUSTOMER_PHONE,
                    timestamp: String(expiredSeconds),
                    type: "text",
                    text: { body: "Ancien message retardé" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const req = {
      method: "POST",
      query: {},
      body: webhookPayload,
    };
    let resData = null;
    const res = {
      status(code) { return this; },
      send(data) { resData = data; return this; },
      get headersSent() { return true; },
    };

    await handler(req, res);
    assert.equal(resData, "EVENT_RECEIVED");

    // Wait a brief tick for async background processing
    await new Promise((r) => setTimeout(r, 50));

    // Bot MUST NOT have called Meta Graph API to send free text
    const textSends = metaApiCalls.filter((call) => call.body?.type === "text");
    assert.equal(textSends.length, 0);
  });
});
