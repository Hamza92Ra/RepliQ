import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { authorizeTenant, assertAccess } from "../lib/foundation/authorization.js";
import { createTenantStore } from "../lib/foundation/supabase-store.js";
import { scopedKey, historyPlan, takeoverPlan, receiptPlan, templatesPlan, orderPlan, identityPlan, customerIdentity } from "../lib/foundation/redis-plans.js";
import { withOwnedCredentials } from "../lib/foundation/credentials.js";
import { resolveWhatsAppCredentials } from "../lib/whatsapp-credentials.js";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NA = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const UA = "33333333-3333-4333-8333-333333333333";
const UB = "44444444-4444-4444-8444-444444444444";
const CA = "55555555-5555-4555-8555-555555555555";
const CB = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "15555550123";

function deps(role = "owner") {
  return {
    now: () => 100,
    verifySession: async token => token === "session-a" ? { userId: UA, expiresAt: 200 } : token === "session-b" ? { userId: UB, expiresAt: 200 } : null,
    loadMembership: async (user, business) => (user === UA && business === A) || (user === UB && business === B)
      ? { user_id: user, business_id: business, status: "active", user_status: "active", business_status: "active", role } : null,
    loadNumber: async (id, business) => id === NA && business === A ? { id, business_id: A, phone_number_id: "1001", waba_id: "9001", status: "active" }
      : id === NB && business === B ? { id, business_id: B, phone_number_id: "1002", waba_id: "9002", status: "active" } : null,
  };
}
async function context(business = A, role = "owner", overrides = {}) {
  return authorizeTenant({ sessionToken: business === A ? "session-a" : "session-b", businessId: business, numberId: business === A ? NA : NB, action: "read" }, { ...deps(role), ...overrides });
}
function database() {
  const tables = {
    conversations: [
      { id: CA, business_id: A, whatsapp_number_id: NA, wa_contact_phone: CUSTOMER, human_takeover: false },
      { id: CB, business_id: B, whatsapp_number_id: NB, wa_contact_phone: CUSTOMER, human_takeover: false },
    ],
    messages: [
      { id: "message-a", conversation_id: CA, business_id: A, whatsapp_number_id: NA, body: "Fixture A", wa_message_id: "same-wamid", status: "sent" },
      { id: "message-b", conversation_id: CB, business_id: B, whatsapp_number_id: NB, body: "Fixture B", wa_message_id: "same-wamid", status: "delivered" },
    ],
  };
  const calls = [];
  return { tables, calls, from(table) {
    const operation = { table, filters: [], action: "select" }; calls.push(operation);
    let single = false;
    const query = {
      select() { return this; }, order() { return this; },
      eq(key, val) { operation.filters.push([key, val]); return this; },
      maybeSingle() { single = true; return this; },
      update(value) { operation.action = "update"; operation.value = value; return this; },
      insert(value) { operation.action = "insert"; operation.value = value; return this; },
      then(resolve, reject) {
        try {
          let rows = tables[table].filter(row => operation.filters.every(([key, val]) => row[key] === val));
          if (operation.action === "update") rows.forEach(row => Object.assign(row, operation.value));
          if (operation.action === "insert") { tables[table].push(operation.value); rows = [operation.value]; }
          return Promise.resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return query;
  } };
}

describe("Inactive Phase 1B tenant foundation", () => {
  it("rejects missing, forged and expired server sessions", async () => {
    const input = { businessId: A, numberId: NA, action: "read" };
    await assert.rejects(authorizeTenant(input, deps()), { status: 401 });
    await assert.rejects(authorizeTenant({ ...input, sessionToken: "browser-claimed-owner" }, deps()), { status: 401 });
    await assert.rejects(context(A, "owner", { verifySession: async () => ({ userId: UA, expiresAt: 99 }) }), { status: 401 });
  });
  it("does not trust a browser-selected business or number", async () => {
    await assert.rejects(authorizeTenant({ sessionToken: "session-a", businessId: B, numberId: NB, action: "send" }, deps()), { status: 403 });
    await assert.rejects(authorizeTenant({ sessionToken: "session-a", businessId: A, numberId: NB, action: "send" }, deps()), { status: 403 });
    await assert.rejects(context(A, "owner", { loadNumber: async () => ({ id: NA, business_id: B, status: "active", phone_number_id: "1001", waba_id: "9001" }) }), { status: 403 });
  });
  it("denies revoked memberships, disabled users, suspended businesses and numbers", async () => {
    for (const field of ["status", "user_status", "business_status"]) {
      const dependencies = deps(); const original = dependencies.loadMembership;
      dependencies.loadMembership = async (...args) => ({ ...await original(...args), [field]: "disabled" });
      await assert.rejects(context(A, "owner", dependencies), { status: 403 });
    }
    const dependencies = deps(); const original = dependencies.loadNumber;
    dependencies.loadNumber = async (...args) => ({ ...await original(...args), status: "disabled" });
    await assert.rejects(context(A, "owner", dependencies), { status: 403 });
  });
  it("checks capabilities and cannot escalate by forging a context or prototype role", async () => {
    const viewer = await context(A, "viewer");
    for (const action of ["send", "takeover", "delete", "templates", "config", "orders", "credentials", "memberships"]) {
      assert.throws(() => assertAccess(viewer, action), { status: 403 });
    }
    assert.throws(() => assertAccess({ ...viewer, role: "owner" }, "send"), { status: 401 });
    assert.throws(() => assertAccess(Object.create(viewer), "read"), { status: 401 });
    for (const role of ["admin", "__proto__", "constructor"]) await assert.rejects(context(A, role), { status: 403 });
    const agent = await context(A, "agent"); assertAccess(agent, "send"); assertAccess(agent, "takeover");
    assert.throws(() => assertAccess(agent, "credentials"), { status: 403 });
  });
  it("rechecks membership on each authorization and session expiry at every operation", async () => {
    let current = 100; const dependencies = deps(); dependencies.now = () => current;
    const ctx = await context(A, "owner", dependencies);
    current = 201;
    assert.throws(() => assertAccess(ctx, "read"), { status: 401 });
    dependencies.loadMembership = async () => null;
    await assert.rejects(context(A, "owner", dependencies), { status: 401 });
    current = 100;
    await assert.rejects(context(A, "owner", dependencies), { status: 403 });
  });
  it("isolates conversation lists for the same customer at two businesses", async () => {
    const db = database();
    const a = createTenantStore(await context(A), db); const b = createTenantStore(await context(B), db);
    assert.deepEqual((await a.listConversations()).map(row => row.id), [CA]);
    assert.deepEqual((await b.listConversations()).map(row => row.id), [CB]);
    assert.equal(await a.conversation(CB), null); assert.equal(await b.conversation(CA), null);
    assert.deepEqual(await a.messages(CB), []);
    assert.deepEqual((await a.messages(CA)).map(row => row.body), ["Fixture A"]);
    for (const call of db.calls) {
      assert.ok(call.filters.some(([key]) => key === "business_id"));
      assert.ok(call.filters.some(([key]) => key === "whatsapp_number_id"));
    }
  });
  it("scopes Supabase takeover writes and refuses viewer mutations", async () => {
    const db = database(); const a = createTenantStore(await context(A), db);
    assert.deepEqual(await a.setTakeover(CB, true), []);
    await a.setTakeover(CA, true);
    assert.equal(db.tables.conversations[0].human_takeover, true);
    assert.equal(db.tables.conversations[1].human_takeover, false);
    const viewer = createTenantStore(await context(A, "viewer"), db);
    await assert.rejects(viewer.setTakeover(CA, false), { status: 403 });
    await assert.rejects(a.setTakeover(CA, "false"), /Boolean/);
  });
  it("checks conversation ownership before inserting and prevents mass assignment", async () => {
    const db = database(); const a = createTenantStore(await context(A), db);
    await assert.rejects(a.appendHumanMessage(CB, { body: "fixture" }), { status: 404 });
    await a.appendHumanMessage(CA, { body: "fixture", wamid: "accepted-fixture", business_id: B, whatsapp_number_id: NB, conversation_id: CB, sender: "customer" });
    const row = db.tables.messages.at(-1);
    assert.equal(row.business_id, A); assert.equal(row.whatsapp_number_id, NA); assert.equal(row.conversation_id, CA); assert.equal(row.sender, "human");
  });
  it("scopes identical wamid lookups by business AND WhatsApp number", async () => {
    const db = database();
    assert.equal((await createTenantStore(await context(A), db).receipt("same-wamid")).body, "Fixture A");
    assert.equal((await createTenantStore(await context(B), db).receipt("same-wamid")).body, "Fixture B");
  });
  it("does not use a legacy Redis fallback when v2 history is absent", async () => {
    const a = await context(A); const b = await context(B);
    const store = new Map([[`conv:${CUSTOMER}`, ["PRIVATE LEGACY FIXTURE"]], [historyPlan(b, CUSTOMER)[0][1], ["B fixture"]]]);
    assert.deepEqual(store.get(historyPlan(a, CUSTOMER)[0][1]) || [], []);
    assert.deepEqual(store.get(historyPlan(b, CUSTOMER)[0][1]), ["B fixture"]);
    assert.notEqual(historyPlan(a, CUSTOMER)[0][1], historyPlan(b, CUSTOMER)[0][1]);
  });
  it("separates number scope within a business and normalizes customer aliases", async () => {
    const a = await context(A);
    const different = await authorizeTenant({ sessionToken: "session-a", businessId: A, numberId: NB, action: "read" }, {
      ...deps(), loadNumber: async (id, business) => ({ id, business_id: business, status: "active", phone_number_id: "1003", waba_id: "9001" }),
    });
    assert.notEqual(historyPlan(a, CUSTOMER)[0][1], historyPlan(different, CUSTOMER)[0][1]);
    assert.deepEqual(historyPlan(a, "+1 (555) 555-0123"), historyPlan(a, CUSTOMER));
    assert.equal(customerIdentity("MA.fixture123"), "MA.fixture123");
    assert.throws(() => customerIdentity("abc15555550123"));
  });
  it("isolates BSUID mappings, receipt keys, templates and identical order IDs", async () => {
    const a = await context(A); const b = await context(B);
    for (const fn of [ctx => identityPlan(ctx, "MA.fixture123"), ctx => receiptPlan(ctx, "same-wamid"), templatesPlan, ctx => orderPlan(ctx, "same-order")]) {
      const keyA = fn(a)[0][1]; const keyB = fn(b)[0][1];
      const store = new Map([[keyB, "B private fixture"]]);
      assert.notEqual(keyA, keyB); assert.equal(store.get(keyA), undefined);
      assert.match(keyA, /^rq:v2:/);
    }
  });
  it("generates takeover changes only in the authorized tenant namespace", async () => {
    const a = await context(A); const b = await context(B); const store = new Map();
    for (const [, key, value] of takeoverPlan(a, CUSTOMER, true)) store.set(key, value);
    assert.equal(JSON.parse(store.get(scopedKey(a, "takeover", CUSTOMER))).human_takeover, true);
    assert.equal(store.get(scopedKey(b, "takeover", CUSTOMER)), undefined);
    assert.throws(() => takeoverPlan({ ...a }, CUSTOMER, true), { status: 401 });
    assert.throws(() => takeoverPlan(a, CUSTOMER, "false"), /Boolean/);
  });
  it("rejects foreign/retired credentials before accessing the vault", async () => {
    const a = await context(A); let reads = 0;
    for (const overrides of [{ business_id: B }, { whatsapp_number_id: NB }, { phone_number_id: "1002" }, { waba_id: "9002" }, { status: "retired" }, { version: 0 }]) {
      await assert.rejects(withOwnedCredentials(a, { loadCredentialVersion: async () => ({ business_id: A, whatsapp_number_id: NA, phone_number_id: "1001", waba_id: "9001", status: "active", version: 1, secret_ref: "vault-fixture", ...overrides }), readSecret: async () => { reads++; return "token-fixture"; } }, () => {}), /Credential unavailable/);
    }
    assert.equal(reads, 0);
  });
  it("resolves an exact secret version for the authorized number without global fallback", async () => {
    const a = await context(A); const received = [];
    const value = await withOwnedCredentials(a, {
      loadCredentialVersion: async (businessId, numberId) => { assert.equal(businessId, A); assert.equal(numberId, NA); return { business_id: A, whatsapp_number_id: NA, phone_number_id: "1001", waba_id: "9001", status: "active", version: 2, secret_ref: "vault-fixture-version-2" }; },
      readSecret: async (...args) => { received.push(args); return "new-fixture-token"; },
    }, credentials => { assert.equal(credentials.phoneNumberId, "1001"); assert.equal(credentials.token, "new-fixture-token"); return "sent-fixture"; });
    assert.equal(value, "sent-fixture"); assert.deepEqual(received, [["vault-fixture-version-2", 2]]);
    await assert.rejects(withOwnedCredentials(a, { loadCredentialVersion: async () => null, readSecret: async () => assert.fail() }, () => assert.fail()), /Credential unavailable/);
  });
  it("preserves existing single-business credential behavior", () => {
    const original = { ...process.env };
    try {
      process.env.WHATSAPP_PHONE_NUMBER_ID = "1001"; process.env.WHATSAPP_TOKEN = "legacy-fixture";
      assert.equal(resolveWhatsAppCredentials("1001").token, "legacy-fixture");
      assert.throws(() => resolveWhatsAppCredentials("1002"), /not authorized/);
    } finally { process.env = original; }
  });
  it("keeps all new helpers unreachable from production module imports", () => {
    function scan(path) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const filename = `${path}/${entry.name}`;
        if (entry.isDirectory()) { if (entry.name !== "foundation") scan(filename); }
        else if (entry.name.endsWith(".js")) assert.doesNotMatch(readFileSync(filename, "utf8"), /(?:from\s*|import\s*\()["'][^"']*foundation\//);
      }
    }
    scan("api"); scan("lib");
  });
  it("keeps SQL outside automatic migrations, gated by explicit approval", () => {
    for (const name of ["001_expand.sql", "002_assign_reviewed_ownership.sql", "003_enforce_scope_and_rls.sql", "verify.sql", "rollback_002_before_cutover.sql"]) {
      const sql = readFileSync(`supabase/phase-1b-review/${name}`, "utf8");
      assert.match(sql, /current_setting\('repliq.phase1b_approved'/);
      assert.match(sql, /BEGIN(?: READ ONLY)?;/); assert.match(sql, /COMMIT;/);
    }
    const sql = readFileSync("supabase/phase-1b-review/003_enforce_scope_and_rls.sql", "utf8");
    assert.match(sql, /Unassigned\/quarantined legacy records block cutover/);
    assert.match(sql, /messages_conversation_scope_fk/);
    assert.match(sql, /DROP POLICY IF EXISTS "Allow read messages"/);
    assert.match(sql, /REVOKE ALL ON FUNCTION/);
    assert.match(sql, /SET search_path=''/);
  });
});
