import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import router from "../api/admin.js";
import { signAdminToken, verifyAdminToken } from "../lib/admin-auth.js";
import { installAdminFixtures, fixtureEnvironment } from "./admin-service-fixtures.js";
import { nodeFunctionFiles } from "../scripts/check-function-count.mjs";

function res() {
  return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}
function req(endpoint, method, body, authenticated = true) {
  return { url: `/api/admin/${endpoint}`, method, body, query: {},
    headers: authenticated ? { authorization: `Bearer ${signAdminToken()}` } : {} };
}
describe("Consolidated admin Node router", () => {
  let env, originalFetch, state;
  beforeEach(() => { env = { ...process.env }; originalFetch = globalThis.fetch; process.env = { ...fixtureEnvironment }; state = installAdminFixtures(); });
  afterEach(() => { process.env = env; globalThis.fetch = originalFetch; });

  it("preserves login POST token/cookie and GET session contracts", async () => {
    const response = res(); await router(req("login", "POST", { password: "dashboard-fixture" }, false), response);
    assert.equal(response.statusCode, 200); assert.equal(verifyAdminToken(response.body.token).role, "admin");
    assert.match(response.headers["Set-Cookie"], /admin_token=.*Path=\/.*SameSite=Lax.*Secure/);
    const session = req("login", "GET"); session.headers = { cookie: response.headers["Set-Cookie"].split(";")[0] };
    const check = res(); await router(session, check); assert.deepEqual(check.body, { authenticated: true });
  });
  it("preserves conversation listing with bearer authentication", async () => {
    const response = res(); await router(req("conversations", "GET"), response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.conversations[0].id, "fixture-conversation");
  });
  it("preserves message queries and query-token authentication", async () => {
    const request = req("messages", "GET", undefined, false); request.query = { conversationId: "fixture-conversation", token: signAdminToken() };
    request.url += "?conversationId=fixture-conversation";
    const response = res(); await router(request, response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.conversationId, "fixture-conversation");
    assert.equal(response.body.messages[0].body, "Synthetic fixture");
  });
  it("preserves unread reset and cookie authentication", async () => {
    const request = req("read", "POST", { conversationId: "fixture-conversation" });
    request.headers = { cookie: `admin_token=${signAdminToken()}` };
    const response = res(); await router(request, response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.unread_count, 0); assert.equal(state.conversation.unread_count, 0);
  });
  it("preserves takeover and Redis synchronization", async () => {
    const response = res(); await router(req("takeover", "POST", { conversationId: "fixture-conversation", enabled: true }), response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.human_takeover, true);
    assert.equal(state.redis.get("conv:mode:15555550123"), "human");
  });
  it("preserves manual sends, wamid, human storage and takeover", async () => {
    const response = res(); await router(req("send", "POST", { conversationId: "fixture-conversation", text: "Synthetic manual reply" }), response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.wamid, "wamid.fixture");
    assert.equal(response.body.message.sender, "human"); assert.equal(state.conversation.human_takeover, true);
    const meta = state.calls.find(call => call.url.includes("graph.facebook.com"));
    assert.equal(JSON.parse(meta.body).text.body, "Synthetic manual reply");
  });
  it("preserves legacy dashboard key/actions and rejects bearer-only substitution", async () => {
    const request = req("legacy", "POST", { phone: "15555550123", action: "human" }, false);
    request.query.key = "dashboard-fixture";
    const response = res(); await router(request, response); assert.equal(response.body.mode, "human");
    const denied = res(); await router(req("legacy", "POST", request.body), denied); assert.equal(denied.statusCode, 401);
  });
  const methods = { conversations: "GET", messages: "GET", read: "POST", takeover: "POST", send: "POST", legacy: "POST" };
  for (const [endpoint, method] of Object.entries(methods)) {
    it(`keeps ${endpoint} unauthorized requests at 401`, async () => {
      const response = res(); await router(req(endpoint, method, { phone: "15555550123", action: "human" }, false), response);
      assert.equal(response.statusCode, 401); assert.equal(state.calls.length, 0);
    });
  }
  for (const endpoint of ["login", ...Object.keys(methods)]) {
    it(`preserves ${endpoint} method rejection`, async () => {
      const response = res(); await router(req(endpoint, "DELETE", {}), response);
      assert.equal(response.statusCode, 405); assert.equal(state.calls.length, 0);
    });
  }
  it("cannot change endpoint through query strings, headers or bodies", async () => {
    const request = req("messages", "GET", { action: "reply", text: "must not send" });
    request.url += "?route=send&path=send&__route=login&conversationId=fixture-conversation";
    request.query = { route: "send", path: "send", __route: "login", conversationId: "fixture-conversation" };
    request.headers["x-original-url"] = "/api/admin/send";
    const response = res(); await router(request, response);
    assert.equal(response.statusCode, 200); assert.ok(Array.isArray(response.body.messages));
    assert.equal(state.calls.some(call => call.url.includes("graph.facebook.com")), false);
  });
  it("passes request objects unchanged and never pre-parses bodies", async () => {
    const request = req("messages", "GET"); const query = { conversationId: "fixture-conversation", repeat: ["a", "b"] };
    request.query = query;
    Object.defineProperty(request, "body", { get() { assert.fail("router must not access body"); } });
    const response = res(); await router(request, response);
    assert.equal(response.statusCode, 200); assert.equal(request.query, query); assert.deepEqual(query.repeat, ["a", "b"]);
  });
  it("returns 404 for unknown/internal/prototype/traversal paths", async () => {
    for (const path of ["/api/admin", "/api/admin/unknown", "/api/admin/toString", "/api/admin/../send", "/api/admin/%73end"]) {
      const request = req("login", "POST", { password: "dashboard-fixture" }); request.url = path;
      const response = res(); await router(request, response); assert.equal(response.statusCode, 404);
    }
  });
  it("uses seven exact admin rewrites and eight deployable function entry points", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url)));
    const sources = ["login", ...Object.keys(methods)].map(name => `/api/admin/${name}`).sort();
    assert.deepEqual(config.rewrites.map(rule => rule.source).sort(), sources);
    assert.ok(config.rewrites.every(rule => rule.destination === "/api/admin" && !rule.methods));
    const files = nodeFunctionFiles();
    assert.equal(files.length, 8); assert.ok(files.length <= 12);
    assert.deepEqual(files, ["api/admin.js", "api/business-config.js", "api/conversation.js", "api/dashboard.js", "api/lead.js", "api/market.js", "api/orders.js", "api/webhook.js"]);
  });
});
