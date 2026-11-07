import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import webhook from "../api/webhook.js";
import conversation from "../api/conversation.js";
import legacy from "../api/admin/legacy.js";
import { verifyMetaSignature, readRawBody } from "../lib/webhook-security.js";
import { resolveWhatsAppCredentials } from "../lib/whatsapp-credentials.js";
import { tenantKey } from "../lib/tenant-keys.js";
import { sendWhatsAppText, sendWhatsAppTemplate, markAsRead, getMediaUrl, downloadMedia } from "../lib/whatsapp.js";
import { getApprovedTemplates } from "../lib/templates.js";
import { getTakeoverStatus } from "../lib/db.js";

const BUSINESS = "business-fixture";
const CUSTOMER = "15555550123";
const SECRET = "fixture-secret";
function signature(bytes) {
  return "sha256=" + createHmac("sha256", SECRET).update(bytes).digest("hex");
}
function response() {
  return { code: 200, body: null, headersSent: false,
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; this.headersSent = true; return this; },
    json(body) { return this.send(body); } };
}
function request(body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { method: "POST", query: {}, rawBody, headers: { "x-hub-signature-256": signature(rawBody) } };
}
function payload(message = {}, metadata = BUSINESS) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
    metadata: { phone_number_id: metadata },
    messages: [{ id: "inbound-fixture", from: CUSTOMER, timestamp: String(Math.floor(Date.now()/1000)), type: "text", text: { body: "Hello fixture" }, ...message }],
  } }] }] };
}

describe("Phase 1A signed webhook and single-business regressions", () => {
  let env, fetchOriginal, store, calls, pending, context;
  const symbol = Symbol.for("@vercel/request-context");
  beforeEach(() => {
    env = { ...process.env }; fetchOriginal = globalThis.fetch;
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "NOTIFY_EMAIL_TO", "TAKEOVER_TIMEOUT_HOURS"]) delete process.env[name];
    Object.assign(process.env, { META_APP_SECRET: SECRET, VERIFY_TOKEN: "verify-fixture", DASHBOARD_SECRET: "dashboard-fixture", WHATSAPP_TOKEN: "token-fixture", WHATSAPP_PHONE_NUMBER_ID: BUSINESS, DEFAULT_PHONE_NUMBER_ID: BUSINESS, GROQ_API_KEY: "groq-fixture", PRIMARY_AI_PROVIDER: "groq", UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-fixture" });
    store = new Map(); calls = []; pending = [];
    context = globalThis[symbol];
    globalThis[symbol] = { get: () => ({ waitUntil: promise => pending.push(promise) }) };
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/pipeline")) {
        const result = JSON.parse(options.body).map(([cmd, key, ...args]) => {
          if (cmd === "GET") return { result: store.get(key) ?? null };
          if (cmd === "SET") {
            if (args.includes("NX") && store.has(key)) return { result: null };
            store.set(key, args[0]); return { result: "OK" };
          }
          if (cmd === "RPUSH") { const items = [...(store.get(key) || []), ...args]; store.set(key, items); return { result: items.length }; }
          if (cmd === "LRANGE") return { result: store.get(key) || [] };
          if (cmd === "DEL") { for (const k of [key, ...args]) store.delete(k); return { result: 1 }; }
          return { result: 1 };
        });
        return Response.json(result);
      }
      if (String(url).includes("api.groq.com")) {
        if (String(url).includes("transcriptions")) return Response.json({ text: "Voice fixture" });
        return Response.json({ choices: [{ message: { content: "Fixture reply" }, finish_reason: "stop" }] });
      }
      if (String(url).includes("graph.facebook.com")) {
        if (!options.body) return Response.json({ url: "https://fixture.fbsbx.com/audio" });
        return Response.json({ messages: [{ id: "outbound-fixture" }] });
      }
      if (String(url) === "https://fixture.fbsbx.com/audio") return new Response(new Uint8Array([1, 2, 3]));
      throw new Error("Unexpected service in fixture");
    };
  });
  afterEach(async () => {
    await Promise.all(pending);
    process.env = env; globalThis.fetch = fetchOriginal;
    if (context === undefined) delete globalThis[symbol]; else globalThis[symbol] = context;
  });
  async function invoke(body, handler = webhook) {
    const res = response(); await handler(request(body), res); await Promise.all(pending);
    await new Promise(resolve => setImmediate(resolve));
    return res;
  }
  function outbound() { return calls.filter(c => typeof c.options.body === "string" && JSON.parse(c.options.body)?.type === "text"); }

  it("verifies exact bytes including whitespace and Unicode; rejects all malformed signatures", () => {
    const bytes = Buffer.from('{ "name": "é", "entry": [] }\n');
    assert.equal(verifyMetaSignature(bytes, signature(bytes), SECRET), true);
    assert.equal(verifyMetaSignature(Buffer.from(JSON.stringify(JSON.parse(bytes))), signature(bytes), SECRET), false);
    for (const sig of [null, "", "sha1=abc", "sha256=abc", "sha256=" + "z".repeat(64), [signature(bytes)], "sha256=" + "0".repeat(64)]) {
      assert.equal(verifyMetaSignature(bytes, sig, SECRET), false);
    }
    assert.equal(verifyMetaSignature(bytes, signature(bytes), "wrong-secret"), false);
  });
  it("preserves GET challenge and rejects missing or incorrect verification tokens", async () => {
    for (const handler of [webhook, conversation]) {
      const res = response(); await handler({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-fixture", "hub.challenge": "challenge-fixture" } }, res);
      assert.equal(res.code, 200); assert.equal(res.body, "challenge-fixture");
      const bad = response(); await handler({ method: "GET", query: { "hub.mode": "subscribe" } }, bad); assert.equal(bad.code, 403);
      delete process.env.VERIFY_TOKEN;
      const missing = response(); await handler({ method: "GET", query: { "hub.mode": "subscribe" } }, missing); assert.equal(missing.code, 403);
      process.env.VERIFY_TOKEN = "verify-fixture";
    }
  });
  it("rejects unsigned and forged events before any external effect on either ingress", async () => {
    for (const handler of [webhook, conversation]) {
      for (const headers of [{}, { "x-hub-signature-256": "sha256=" + "0".repeat(64) }]) {
        const req = request(payload()); req.headers = headers;
        const res = response(); await handler(req, res); assert.equal(res.code, 401);
      }
    }
    assert.equal(calls.length, 0);
  });
  it("fails closed without app secret, and never authenticates a reserialized object", async () => {
    const req = request(payload()); delete req.rawBody; req.body = payload();
    const res = response(); await webhook(req, res); assert.equal(res.code, 400);
    delete process.env.META_APP_SECRET;
    const missing = response(); await webhook(request(payload()), missing); assert.equal(missing.code, 503);
    assert.equal(calls.length, 0);
  });
  it("reads chunked request data without touching a lazy parsed-body getter", async () => {
    const bytes = Buffer.from('{ "entry": [] }\n');
    const req = Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]);
    Object.defineProperty(req, "body", { configurable: true, get() { throw new Error("must not parse before auth"); }, set(value) { Object.defineProperty(this, "body", { value }); } });
    Object.assign(req, { method: "POST", query: {}, headers: { "x-hub-signature-256": signature(bytes) } });
    const res = response(); await webhook(req, res); assert.equal(res.code, 200);
    await assert.rejects(readRawBody({ rawBody: Buffer.alloc(4 * 1024 * 1024 + 1) }), { status: 413 });
  });
  it("rejects signed malformed JSON", async () => {
    const rawBody = Buffer.from('{ broken'); const res = response();
    await webhook({ method: "POST", rawBody, headers: { "x-hub-signature-256": signature(rawBody) } }, res);
    assert.equal(res.code, 400); assert.equal(calls.length, 0);
  });
  it("auto replies, persists legacy Redis history and owner, and deduplicates retries", async () => {
    const body = payload(); const res = await invoke(body);
    assert.equal(res.body, "EVENT_RECEIVED"); assert.equal(outbound().length, 1);
    const history = store.get(`conv:${CUSTOMER}`).map(JSON.parse);
    assert.equal(history[0].content, "Hello fixture"); assert.equal(history[1].content, "Fixture reply");
    assert.equal(store.get(`conv:owner:${CUSTOMER}`), BUSINESS);
    await invoke(body); assert.equal(outbound().length, 1);
    assert.equal(calls.some(c => c.url.includes("/chat/completions")), true);
    assert.equal([...store.keys()].some(k => k.startsWith("rq:v2:")), false);
  });
  it("preserves silent human takeover and inbound persistence", async () => {
    store.set(`conv:mode:${CUSTOMER}`, "human");
    await invoke(payload());
    assert.equal(outbound().length, 0); assert.equal(calls.some(c => c.url.includes("api.groq.com")), false);
    assert.equal(store.get(`conv:${CUSTOMER}`).map(JSON.parse)[0].content, "Hello fixture");
  });
  it("keeps bot silent when Redis cannot determine takeover", async () => {
    globalThis.fetch = async () => { throw new Error("provider response contains private data"); };
    await assert.rejects(getTakeoverStatus(CUSTOMER), /Takeover state unavailable/);
    await invoke(payload()); assert.equal(outbound().length, 0);
  });
  it("handles voice media, transcription and unsupported image replies", async () => {
    await invoke(payload({ type: "audio", text: undefined, audio: { id: "media-fixture" } }));
    assert.equal(calls.some(c => c.url.includes("transcriptions")), true);
    assert.equal(calls.find(c => c.url.includes("/media-fixture")).options.headers.Authorization, "Bearer token-fixture");
    assert.equal(calls.find(c => c.url.includes("fixture.fbsbx.com")).options.headers.Authorization, "Bearer token-fixture");
    assert.match(store.get(`conv:${CUSTOMER}`).map(JSON.parse)[0].content, /Voice fixture/);
    assert.equal(outbound().length, 1);
    await invoke(payload({ id: "image-fixture", type: "image", text: undefined, image: { id: "image-media" } }));
    assert.equal(outbound().length, 2);
  });
  it("updates delivered and failed statuses without sending a reply", async () => {
    store.set(`conv:${CUSTOMER}`, [JSON.stringify({ wamid: "outbound-fixture", content: "Fixture reply", status: "sent" })]);
    for (const status of ["delivered", "read", "failed"]) {
      const body = payload(); const value = body.entry[0].changes[0].value; delete value.messages;
      value.statuses = [{ id: "outbound-fixture", recipient_id: CUSTOMER, status }];
      await invoke(body);
      assert.equal(JSON.parse(store.get(`conv:${CUSTOMER}`)[0]).status, status);
    }
    assert.equal(outbound().length, 0);
  });
  it("preserves legacy actions at authenticated migration endpoint; webhook never bypasses signature", async () => {
    const body = { phone: CUSTOMER, action: "human" };
    const unsigned = response(); await webhook({ method: "POST", query: { key: "dashboard-fixture" }, body }, unsigned); assert.equal(unsigned.code, 401);
    const denied = response(); await legacy({ method: "POST", query: {}, body }, denied); assert.equal(denied.code, 401);
    const ok = response(); await legacy({ method: "POST", query: { key: "dashboard-fixture" }, body }, ok); assert.equal(ok.body.mode, "human");
    assert.equal(store.get(`conv:mode:${CUSTOMER}`), "human");
    for (const action of ["bot", "completed"]) {
      const res = response(); await legacy({ method: "POST", query: { key: "dashboard-fixture" }, body: { ...body, action } }, res); assert.equal(res.body.mode, action);
    }
  });
  it("preserves reply, template and template-list contracts on the legacy migration route", async () => {
    store.set(`conv:${CUSTOMER}`, [JSON.stringify({ role: "user", ts: Date.now(), content: "fixture" })]);
    for (const action of ["reply", "template", "get_templates"]) {
      const res = response();
      await legacy({ method: "POST", query: { key: "dashboard-fixture" }, body: { phone: CUSTOMER, action, message: "Manual fixture", templateName: "hello_world" } }, res);
      assert.equal(res.code, 200); assert.equal(res.body.ok, true);
      if (action !== "get_templates") assert.equal(res.body.wamid, "outbound-fixture");
      else assert.ok(Array.isArray(res.body.templates));
    }
    assert.equal(store.get(`conv:mode:${CUSTOMER}`), "human");
    assert.equal(store.get(`conv:${CUSTOMER}`).map(JSON.parse).at(-1).role, "agent");
  });
  it("never treats a mixed Meta/admin envelope as an unsigned dashboard action", async () => {
    for (const handler of [webhook, conversation]) {
      const res = response();
      await handler({ method: "POST", query: { key: "dashboard-fixture" }, body: { ...payload(), phone: CUSTOMER, action: "human" } }, res);
      assert.equal(res.code, 401);
    }
    assert.equal(calls.length, 0);
  });
  it("reads dashboard actions from raw Node request streams", async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ phone: CUSTOMER, action: "human" }))]);
    Object.assign(req, { method: "POST", query: { key: "dashboard-fixture" }, headers: {} });
    const res = response(); await conversation(req, res);
    assert.equal(res.code, 200); assert.equal(res.body.mode, "human");
  });
  it("binds text, templates, reads, media and template listing to the configured business", async () => {
    assert.equal(resolveWhatsAppCredentials().phoneNumberId, BUSINESS);
    const before = calls.length;
    for (const operation of [() => sendWhatsAppText("other", CUSTOMER, "fixture"), () => sendWhatsAppTemplate("other", CUSTOMER), () => markAsRead("other", "inbound"), () => getMediaUrl("media", "other"), () => downloadMedia("https://fixture.fbsbx.com/audio", "other"), () => getApprovedTemplates("other")]) {
      await assert.rejects(operation(), /not authorized/);
    }
    assert.equal(calls.length, before);
    await sendWhatsAppTemplate(BUSINESS, CUSTOMER, "hello_world", "en_US");
    assert.equal(JSON.parse(calls.at(-1).options.body).type, "template");
    await sendWhatsAppText(undefined, CUSTOMER, "Default number fixture");
    assert.match(calls.at(-1).url, /business-fixture\/messages$/);
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    assert.equal(resolveWhatsAppCredentials().phoneNumberId, BUSINESS);
    delete process.env.DEFAULT_PHONE_NUMBER_ID;
    assert.throws(() => resolveWhatsAppCredentials(BUSINESS), /Missing WHATSAPP_PHONE_NUMBER_ID/);
  });
  it("does not process another business or let a dashboard reply backfill a foreign owner", async () => {
    await invoke(payload({}, "other-business")); assert.equal(calls.length, 0);
    store.set(`conv:${CUSTOMER}`, [JSON.stringify({ role: "user", ts: Date.now(), content: "fixture" })]);
    const res = response(); await conversation({ method: "POST", query: { key: "dashboard-fixture" }, body: { phone: CUSTOMER, action: "reply", message: "fixture", phoneNumberId: "other-business" } }, res);
    assert.equal(res.code, 403); assert.equal(store.has(`conv:owner:${CUSTOMER}`), false); assert.equal(outbound().length, 0);
  });
  it("mirrors status receipts to Supabase with mocked service credentials", async () => {
    process.env.SUPABASE_URL = "https://fixture.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-fixture";
    const mock = globalThis.fetch;
    let update;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("fixture.supabase.co/rest/v1/messages")) {
        update = { url: String(url), method: options.method, body: JSON.parse(options.body) };
        return Response.json([{ status: "delivered" }]);
      }
      return mock(url, options);
    };
    const body = payload(); const value = body.entry[0].changes[0].value;
    delete value.messages;
    value.statuses = [{ id: "outbound-fixture", recipient_id: CUSTOMER, status: "delivered" }];
    await invoke(body);
    assert.equal(update.method, "PATCH"); assert.deepEqual(update.body, { status: "delivered" });
    assert.match(update.url, /wa_message_id=eq.outbound-fixture/);
  });
  it("does not log provider error bodies, credentials or customer text", async () => {
    const logs = []; const original = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 999, message: "PRIVATE_CUSTOMER_SENTINEL token-fixture" } }), { status: 502 });
      await assert.rejects(sendWhatsAppText(BUSINESS, CUSTOMER, "PRIVATE_CUSTOMER_SENTINEL"));
      assert.ok(logs.length > 0);
      assert.equal(logs.join(" ").includes("PRIVATE_CUSTOMER_SENTINEL"), false);
      assert.equal(logs.join(" ").includes("token-fixture"), false);
    } finally { console.error = original; }
  });
  it("designs collision-safe tenant keys without writing or migrating data", () => {
    assert.notEqual(tenantKey("business-a", "conversation", CUSTOMER), tenantKey("business-b", "conversation", CUSTOMER));
    assert.notEqual(tenantKey("a:b", "c"), tenantKey("a", "b:c"));
    assert.throws(() => tenantKey("", "conversation"));
    assert.equal(calls.length, 0);
  });
});
