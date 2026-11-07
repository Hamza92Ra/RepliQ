import { adminRoute } from "./admin-router-request.js";
// tests/admin-inbox.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { signAdminToken, verifyAdminToken, extractAdminToken } from "../lib/admin-auth.js";
const loginHandler = adminRoute("login");
const sendHandler = adminRoute("send");
const takeoverHandler = adminRoute("takeover");
const readHandler = adminRoute("read");
const conversationsHandler = adminRoute("conversations");
const messagesHandler = adminRoute("messages");

// Helper to create mock response object
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
    send(data) {
      res.body = data;
      return res;
    },
    setHeader(name, val) {
      res.headers[name] = val;
      return res;
    },
  };
  return res;
}

describe("Admin Inbox - Authentication & Token Security", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "secret_admin_password_123";
    process.env.ADMIN_JWT_SECRET = "test_jwt_secret_456";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("signs and verifies valid admin tokens", () => {
    const token = signAdminToken({ user: "admin1" });
    assert.ok(token);
    const verified = verifyAdminToken(token);
    assert.ok(verified);
    assert.equal(verified.role, "admin");
    assert.equal(verified.user, "admin1");
  });

  it("rejects forged or modified tokens", () => {
    const token = signAdminToken({ user: "admin1" });
    const parts = token.split(".");
    // Tamper with payload
    const tamperedPayload = Buffer.from(JSON.stringify({ role: "admin", user: "hacker" })).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const result = verifyAdminToken(tamperedToken);
    assert.equal(result, false);
  });

  it("extracts token from Bearer header and Cookie", () => {
    const token = signAdminToken();

    // From Authorization header
    const req1 = { headers: { authorization: `Bearer ${token}` } };
    assert.equal(extractAdminToken(req1), token);

    // From Cookie
    const req2 = { headers: { cookie: `other=123; admin_token=${token}; test=abc` } };
    assert.equal(extractAdminToken(req2), token);
  });

  it("protects endpoints and rejects unauthenticated requests with 401", async () => {
    const testCases = [
      { handler: conversationsHandler, method: "GET" },
      { handler: messagesHandler, method: "GET" },
      { handler: sendHandler, method: "POST" },
      { handler: takeoverHandler, method: "POST" },
      { handler: readHandler, method: "POST" },
    ];

    for (const { handler, method } of testCases) {
      const req = { method, headers: {}, query: {} };
      const res = createMockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 401, `Expected 401 for ${handler.name}`);
    }
  });
});

describe("Admin Inbox - Login Endpoint", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "my_correct_password";
    process.env.ADMIN_JWT_SECRET = "jwt_secret_xyz";
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_ANON_KEY = "mock_anon_key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects incorrect password with 401", async () => {
    const req = {
      method: "POST",
      body: { password: "wrong_password" },
      headers: {},
    };
    const res = createMockRes();
    await loginHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.ok(res.body.error);
  });

  it("accepts correct password and sets session cookie", async () => {
    const req = {
      method: "POST",
      body: { password: "my_correct_password" },
      headers: {},
    };
    const res = createMockRes();
    await loginHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.supabaseUrl, undefined);
    assert.equal(res.body.supabaseAnonKey, undefined);
    assert.ok(res.headers["Set-Cookie"].includes("admin_token="));
  });
});

describe("Admin Inbox - Send Endpoint & 24h Window Enforcement", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test_password";
    process.env.ADMIN_JWT_SECRET = "test_secret";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_id_123";
    process.env.WHATSAPP_TOKEN = "wa_token_123";
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("rejects sending when 24-hour window has expired with HTTP 409 WINDOW_EXPIRED", async () => {
    const token = signAdminToken();
    const expiredTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago

    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes("/rest/v1/conversations")) {
        return new Response(
          JSON.stringify({
            id: "convo-123",
            wa_contact_phone: "212611223344",
            last_inbound_at: expiredTimestamp,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const req = {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { conversationId: "convo-123", text: "Bonjour !" },
    };
    const res = createMockRes();

    await sendHandler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "WINDOW_EXPIRED");
    assert.ok(res.body.message.includes("24h"));
  });

  it("allows sending when within 24-hour window and stores message as sender = 'human'", async () => {
    const token = signAdminToken();
    const recentTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    let metaCalled = false;
    let storedMessagePayload = null;

    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);

      // 1. Meta WhatsApp send API
      if (urlStr.includes("graph.facebook.com")) {
        metaCalled = true;
        return new Response(
          JSON.stringify({
            messaging_product: "whatsapp",
            messages: [{ id: "wamid.HBgL9999" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Supabase insert message
      if (urlStr.includes("/rest/v1/messages")) {
        storedMessagePayload = JSON.parse(opts.body);
        return new Response(
          JSON.stringify({
            id: "msg-stored-1",
            conversation_id: "convo-active",
            ...storedMessagePayload,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3. Supabase query conversation
      if (urlStr.includes("/rest/v1/conversations")) {
        return new Response(
          JSON.stringify({
            id: "convo-active",
            wa_contact_phone: "212611223344",
            last_inbound_at: recentTimestamp,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const req = {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { conversationId: "convo-active", text: "Bonjour, je prends la suite." },
    };
    const res = createMockRes();

    await sendHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(metaCalled, true);
    assert.ok(storedMessagePayload);
    assert.equal(storedMessagePayload.sender, "human");
    assert.equal(storedMessagePayload.direction, "outbound");
    assert.equal(storedMessagePayload.body, "Bonjour, je prends la suite.");
    assert.equal(res.body.wamid, "wamid.HBgL9999");
  });
});

describe("Admin Inbox - Missing Environment Variables Validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails login with 'Missing DASHBOARD_SECRET' when DASHBOARD_SECRET is unset", async () => {
    delete process.env.DASHBOARD_SECRET;
    delete process.env.ADMIN_PASSWORD;
    const req = { method: "POST", body: { password: "123" }, headers: {} };
    const res = createMockRes();
    await loginHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.error.includes("Missing DASHBOARD_SECRET"));
  });

  it("fails conversations with 'Missing SUPABASE_URL' when SUPABASE_URL is unset", async () => {
    process.env.ADMIN_PASSWORD = "test_password";
    const token = signAdminToken();
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test_key";

    const req = { method: "GET", headers: { authorization: `Bearer ${token}` } };
    const res = createMockRes();
    await conversationsHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.error.includes("Missing SUPABASE_URL"));
  });

  it("fails conversations with 'Missing SUPABASE_SERVICE_ROLE_KEY' when unset", async () => {
    process.env.ADMIN_PASSWORD = "test_password";
    const token = signAdminToken();
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const req = { method: "GET", headers: { authorization: `Bearer ${token}` } };
    const res = createMockRes();
    await conversationsHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.error.includes("Missing SUPABASE_SERVICE_ROLE_KEY"));
  });

  it("fails send with 'Missing WHATSAPP_TOKEN' when WHATSAPP_TOKEN is unset", async () => {
    process.env.ADMIN_PASSWORD = "test_password";
    const token = signAdminToken();
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test_key";
    delete process.env.WHATSAPP_TOKEN;

    const req = {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { conversationId: "c1", text: "Hello" },
    };
    const res = createMockRes();
    await sendHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.error.includes("Missing WHATSAPP_TOKEN"));
  });
});
