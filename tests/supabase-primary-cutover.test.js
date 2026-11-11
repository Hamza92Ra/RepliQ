import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supabasePrimaryEnabled, shouldUseRedisMirror } from "../lib/storage-backend.js";
import { getSupabaseTakeoverStatus } from "../lib/supabase.js";
import dashboard from "../api/dashboard.js";
import { fixtureEnvironment, installAdminFixtures } from "./admin-service-fixtures.js";

const response = () => ({
  statusCode: 200, body: null,
  status(n) { this.statusCode = n; return this; },
  json(data) { this.body = data; return this; },
});
let savedEnv, savedFetch;
beforeEach(() => {
  savedEnv = process.env; savedFetch = globalThis.fetch;
  process.env = { ...fixtureEnvironment, REPLIQ_STORAGE_BACKEND: "supabase" };
  installAdminFixtures();
});
afterEach(() => { process.env = savedEnv; globalThis.fetch = savedFetch; });

test("cutover is explicitly opt-in and suppresses Redis mirror", () => {
  assert.equal(supabasePrimaryEnabled({}), false);
  assert.equal(shouldUseRedisMirror({ UPSTASH_REDIS_REST_URL: "https://a", UPSTASH_REDIS_REST_TOKEN: "b" }), true);
  assert.equal(supabasePrimaryEnabled(process.env), true);
  assert.equal(shouldUseRedisMirror(process.env), false);
});

test("dashboard reads Supabase directly without contacting Redis", async () => {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    if (String(url).includes("upstash")) throw new Error("Redis must not be called");
    return original(url, options);
  };
  const res = response();
  await dashboard({ method: "GET", query: { key: "dashboard-fixture" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, "supabase");
  assert.equal(res.body.degraded, false);
  assert.equal(res.body.conversations.length, 1);
  assert.equal(requests.some(x => x.includes("upstash")), false);
});

test("Supabase takeover state detects human ownership", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("fixture.supabase.test") && String(url).includes("human_takeover")) {
      return Response.json({ human_takeover: true });
    }
    return original(url, options);
  };
  const state = await getSupabaseTakeoverStatus({ primaryId: "15555550123" });
  assert.equal(state.human_takeover, true);
});

test("Supabase takeover read failure throws to prevent AI auto-reply", async () => {
  globalThis.fetch = async () => { throw new Error("database outage"); };
  await assert.rejects(getSupabaseTakeoverStatus({ primaryId: "15555550123" }), /Supabase takeover state unavailable/);
});

test("webhook cutover removes Redis calls and requires durable inbound storage", () => {
  const src = readFileSync(new URL("../api/webhook.js", import.meta.url), "utf8");
  assert.match(src, /supabasePrimaryEnabled\(\)/);
  assert.match(src, /getSupabaseTakeoverStatus\(\{ primaryId: from, phone, userId \}\)/);
  assert.match(src, /if \(supabasePrimaryEnabled\(\)\) return;/);
  assert.match(src, /if \(shouldUseRedisMirror\(\)\)/);
});
