import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supabasePrimaryEnabled, shouldUseRedisMirror } from "../lib/storage-backend.js";
import { getSupabaseTakeoverStatus } from "../lib/supabase.js";
import dashboard from "../api/dashboard.js";
import { listAllOrders, createOrder, updateOrderStatus } from "../lib/orders.js";
import { admitLead } from "../lib/lead-abuse.js";
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

test("orders in Supabase-primary mode do not attempt Redis access", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push(target);
    if (target.includes("upstash")) throw new Error("Unexpected Redis order access");
    if (target.includes("fixture.supabase.test") && target.includes("/rest/v1/orders")) {
      if ((options.method || "GET") === "POST") {
        const input = JSON.parse(options.body);
        return Response.json({ id: "a1111111-1111-4111-8111-111111111111", phone: input.phone,
          phone_number_id: input.phone_number_id, items: input.items, amount: input.amount,
          status: "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      if ((options.method || "GET") === "PATCH") {
        return Response.json({ id: "a1111111-1111-4111-8111-111111111111", phone: "15550000001",
          phone_number_id: "1001", items: [], amount: 5, status: "confirmed",
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      return Response.json([]);
    }
    return original(url, options);
  };
  const created = await createOrder({phone:"15550000001",phoneNumberId:"1001",items:[],amount:5});
  assert.equal(created.status, "pending");
  const orders = await listAllOrders();
  assert.deepEqual(orders, []);
  const changed = await updateOrderStatus(created.id, "confirmed");
  assert.equal(changed.status, "confirmed");
  assert.equal(requests.some(x=>x.includes("upstash")), false);
});

test("public leads use atomic Supabase RPC, not Redis, in primary mode", async () => {
  const calls = [];
  globalThis.fetch = async (url, options={}) => {
    calls.push(String(url));
    assert.equal(String(url).includes("upstash"), false);
    if (String(url).includes("/rest/v1/rpc/admit_repliq_lead")) {
      const args = JSON.parse(options.body);
      assert.equal(args.p_business_phone_number_id, "1001");
      assert.match(args.p_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(args.p_payload.business, "Fixture Boats");
      return Response.json({status:201,reference:"RPLQ-fixture",acknowledge:false});
    }
    throw new Error("Unexpected external call");
  };
  const body={ fullname:"Fixture User",business:"Fixture Boats",activity:"Boat charter",
    phone:"+15555550123",email:"test@example.com",offer:"RepliQ Pro",intent:"demo",
    message:"I want a demo",volume:"50",acceptedTerms:true,ref:"RPLQ-fixture" };
  const req={headers:{"x-forwarded-for":"192.0.2.10"},socket:{remoteAddress:"192.0.2.10"}};
  const result=await admitLead(req,body);
  assert.equal(result.duplicate,false);
  assert.equal(result.reference,"RPLQ-fixture");
  assert.equal(result.acknowledge,false);
  await result.complete();
  assert.equal(calls.length,1);
});

test("public lead RPC outage fails closed and does not fallback to Redis", async () => {
  globalThis.fetch = async () => { throw new Error("Database unavailable"); };
  const body={fullname:"Fixture User",business:"Fixture Boats",activity:"Boat charter",
    phone:"+15555550123",email:"test@example.com",offer:"RepliQ Pro",intent:"demo",
    message:"I want a demo",volume:"50",acceptedTerms:true,ref:"RPLQ-fixture"};
  await assert.rejects(admitLead({headers:{},socket:{}},body), {status:503});
});

test("public lead and order writers skip Redis in Supabase-primary mode", () => {
  const publicLead = readFileSync(new URL("../lib/public-pro-lead.js",import.meta.url),"utf8");
  const lead = readFileSync(new URL("../api/lead.js",import.meta.url),"utf8");
  assert.match(publicLead,/!supabasePrimaryEnabled\(\).*saveMessage/);
  assert.match(lead,/!supabasePrimaryEnabled\(\).*saveMessage/);
});
