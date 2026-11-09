import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import dashboard from "../api/dashboard.js";
import orders from "../api/orders.js";
import { installAdminFixtures, fixtureEnvironment } from "./admin-service-fixtures.js";
import { storageErrorCategory } from "../lib/storage-error-category.js";
import { readFileSync } from "node:fs";

const result = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
let savedEnv, savedFetch;
beforeEach(() => {
  savedEnv = process.env;
  savedFetch = globalThis.fetch;
  process.env = { ...fixtureEnvironment };
  installAdminFixtures();
});
afterEach(() => { process.env = savedEnv; globalThis.fetch = savedFetch; });

test("dashboard rejects a wrong password before any storage access", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected outbound read"); };
  const res = result();
  await dashboard({ method: "GET", query: { key: "bad" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Unauthorized");
});

test("dashboard keeps normal Redis mode when Redis is healthy", async () => {
  // The shared synthetic Redis fixture does not implement SMEMBERS; add a
  // read-only index response for this dedicated dashboard-path test.
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("fixture.upstash.test") &&
        JSON.parse(options.body || "[]")[0]?.[0] === "SMEMBERS") {
      return Response.json([{ result: [] }]);
    }
    return original(url, options);
  };
  const res = result();
  await dashboard({ method: "GET", query: { key: "dashboard-fixture" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "redis");
  assert.equal(res.body.degraded, false);
});

test("authenticated Redis outage switches to explicitly partial Supabase view without any mutation", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).includes("fixture.upstash.test")) throw new Error("fetch failed");
    return original(url, options);
  };
  const res = result();
  await dashboard({ method: "GET", query: { key: "dashboard-fixture" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "supabase");
  assert.equal(res.body.degraded, true);
  assert.equal(res.body.conversations[0].phone, "15555550123");
  assert.equal(calls.some(c => c.method === "POST" && c.url.includes("fixture.supabase.test")), false);
});

test("both stores unavailable fails closed without exposing provider or credentials", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async () => { throw new Error("fetch failed with PRIVATE_TOKEN"); };
  const res = result();
  await dashboard({ method: "GET", query: { key: "dashboard-fixture" } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Conversation storage unavailable", code: "STORAGE_UNAVAILABLE" });
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_TOKEN|REDIS_REST/);
});

test("order storage failure returns sanitized 503 rather than generic login error", async () => {
  globalThis.fetch = async () => { throw new Error("fetch failed with PRIVATE_TOKEN"); };
  const res = result();
  await orders({ method: "GET", query: { key: "dashboard-fixture" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "STORAGE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_TOKEN/);
});

test("safe diagnostic classification never returns raw exception content", () => {
  assert.equal(storageErrorCategory(new Error("Upstash error 401: secret payload")), "redis_auth");
  assert.equal(storageErrorCategory(new Error("Upstash error 429: private")), "redis_rate_limited");
  assert.equal(storageErrorCategory(new Error("fetch failed")), "redis_network");
  assert.equal(storageErrorCategory(new Error("PRIVATE_TOKEN: abc")), "storage_unknown");
});
test("dashboard prominently identifies partial view and does not overwrite a backend message", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  assert.match(html, /id="storageWarning"/);
  assert.match(html, /data\.degraded === true/);
  assert.match(html, /storage-degraded #composerContainer/);
  assert.match(html, /loginError"\)\.textContent = message/);
});
