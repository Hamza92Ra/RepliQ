import test, { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isBsuid,
  normalizePhone,
  formatPhoneNumber,
  extractCustomerIdentity,
  sendWhatsAppText,
} from "../lib/whatsapp.js";
import {
  saveMessage,
  listConversations,
  mergeRedisConversation,
  getTakeoverStatus,
  setTakeoverStatus,
} from "../lib/db.js";
import {
  upsertInboundConversation,
  listAdminConversations,
} from "../lib/supabase.js";

describe("BSUID & Identity Resolution - Helper Functions", () => {
  it("identifies BSUID vs standard phone numbers", () => {
    assert.equal(isBsuid("MA.1163080159477566"), true);
    assert.equal(isBsuid("US.1349120865530274"), true);
    assert.equal(isBsuid("212673046307"), false);
    assert.equal(isBsuid("+212673046307"), false);
    assert.equal(isBsuid("0673046307"), false);
  });

  it("formats Moroccan phone numbers as +212 6XX XXXXXX and preserves BSUID", () => {
    assert.equal(formatPhoneNumber("212673046307"), "+212 673 046307");
    assert.equal(formatPhoneNumber("0673046307"), "+212 673 046307");
    assert.equal(formatPhoneNumber("+212 6 73 04 63 07"), "+212 673 046307");
    assert.equal(formatPhoneNumber("0712345678"), "+212 712 345678");
    assert.equal(formatPhoneNumber("33612345678"), "+33612345678");
    // BSUID must be preserved without adding '+'
    assert.equal(formatPhoneNumber("MA.1163080159477566"), "MA.1163080159477566");
  });

  it("extracts identity when both phone and BSUID are present in webhook payload", () => {
    const rawWebhookPayload = {
      contacts: [
        {
          profile: { name: "Hamza Ra" },
          wa_id: "212673046307",
          user_id: "MA.1163080159477566",
        },
      ],
      messages: [
        {
          from: "212673046307",
          from_user_id: "MA.1163080159477566",
          id: "wamid.HBgM...",
          timestamp: "1730908800",
          type: "text",
          text: { body: "Bonjour RepliQ" },
        },
      ],
    };

    const identity = extractCustomerIdentity(
      rawWebhookPayload.messages[0],
      rawWebhookPayload.contacts[0]
    );

    assert.equal(identity.phone, "212673046307");
    assert.equal(identity.userId, "MA.1163080159477566");
    assert.equal(identity.profileName, "Hamza Ra");
    assert.equal(identity.primaryId, "212673046307"); // Phone preferred as primary
  });

  it("extracts identity when client has username privacy enabled (NO phone number)", () => {
    const maskedWebhookPayload = {
      contacts: [
        {
          profile: { name: "Yassine Masqué" },
          user_id: "MA.1163080159477566",
        },
      ],
      messages: [
        {
          from_user_id: "MA.1163080159477566",
          id: "wamid.HBgM_MASKED...",
          timestamp: "1730908900",
          type: "text",
          text: { body: "Je teste avec mon username" },
        },
      ],
    };

    const identity = extractCustomerIdentity(
      maskedWebhookPayload.messages[0],
      maskedWebhookPayload.contacts[0]
    );

    assert.equal(identity.phone, null);
    assert.equal(identity.userId, "MA.1163080159477566");
    assert.equal(identity.profileName, "Yassine Masqué");
    assert.equal(identity.primaryId, "MA.1163080159477566"); // Fallback to BSUID as key
  });
});

describe("BSUID & Identity Resolution - Outbound Cloud API Dispatch", () => {
  const origFetch = globalThis.fetch;
  const origToken = process.env.WHATSAPP_TOKEN;
  const origPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = origToken;
    if (origPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneNumberId;
  });

  it("sends using recipient field for BSUID and to field for real phone", async () => {
    process.env.WHATSAPP_TOKEN = "mock_whatsapp_token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_id_test";
    const sentPayloads = [];

    globalThis.fetch = async (url, options) => {
      sentPayloads.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.success" }] }),
        json: async () => ({ messages: [{ id: "wamid.success" }] }),
      };
    };

    // 1. Send to real phone number
    await sendWhatsAppText("phone_id_test", "212673046307", "Hello phone");
    assert.equal(sentPayloads[0].to, "212673046307");
    assert.equal(sentPayloads[0].recipient, undefined);

    // 2. Send to BSUID-only recipient
    await sendWhatsAppText("phone_id_test", "MA.1163080159477566", "Hello BSUID");
    assert.equal(sentPayloads[1].recipient, "MA.1163080159477566");
    assert.equal(sentPayloads[1].to, undefined);
  });
});

describe("BSUID & Identity Resolution - Conversation Merging & Redis Storage", () => {
  const origFetch = globalThis.fetch;
  const origUrl = process.env.UPSTASH_REDIS_REST_URL;
  const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env.UPSTASH_REDIS_REST_URL = origUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
  });

  it("merges an ID-only conversation into a phone conversation when phone becomes available", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://mock.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "mock_token";

    // In-memory mock redis store
    const store = new Map();
    const sets = new Map();

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.includes("/pipeline")) {
        const commands = JSON.parse(options.body);
        const results = commands.map(([cmd, ...args]) => {
          if (cmd === "GET") {
            const val = store.get(args[0]) || null;
            return { result: val };
          }
          if (cmd === "SET") {
            store.set(args[0], args[1]);
            return { result: "OK" };
          }
          if (cmd === "DEL") {
            for (const k of args) store.delete(k);
            return { result: args.length };
          }
          if (cmd === "RPUSH") {
            const key = args[0];
            const list = store.get(key) || [];
            list.push(args[1]);
            store.set(key, list);
            return { result: list.length };
          }
          if (cmd === "LPUSH") {
            const key = args[0];
            const list = store.get(key) || [];
            list.unshift(args[1]);
            store.set(key, list);
            return { result: list.length };
          }
          if (cmd === "LRANGE") {
            const list = store.get(args[0]) || [];
            return { result: list };
          }
          if (cmd === "LTRIM") {
            return { result: "OK" };
          }
          if (cmd === "SADD") {
            const setKey = args[0];
            if (!sets.has(setKey)) sets.set(setKey, new Set());
            sets.get(setKey).add(args[1]);
            return { result: 1 };
          }
          if (cmd === "SREM") {
            const setKey = args[0];
            if (sets.has(setKey)) sets.get(setKey).delete(args[1]);
            return { result: 1 };
          }
          if (cmd === "SMEMBERS") {
            const set = sets.get(args[0]) || new Set();
            return { result: Array.from(set) };
          }
          return { result: null };
        });
        return { ok: true, json: async () => results };
      }
      return { ok: true, json: async () => ({}) };
    };

    const bsuid = "MA.1163080159477566";
    const realPhone = "212673046307";

    // 1. Initial inbound message arrives with ONLY BSUID
    await saveMessage(bsuid, "user", "Message 1 (ID only)", "phone_owner_1", {
      id: "msg_001",
      userId: bsuid,
      phone: null,
      profileName: "Anas Client",
    });

    // Takeover enabled during ID interaction
    await setTakeoverStatus(bsuid, true);

    // Verify conversation listed under BSUID with is_masked = true
    let convos = await listConversations();
    assert.equal(convos.length, 1);
    assert.equal(convos[0].phone, bsuid);
    assert.equal(convos[0].phoneNumber, null);
    assert.equal(convos[0].user_id, bsuid);
    assert.equal(convos[0].profile_name, "Anas Client");
    assert.equal(convos[0].is_masked, true);
    assert.equal(convos[0].human_takeover, true);

    // 2. Client later sends message with PHONE NUMBER
    await saveMessage(realPhone, "user", "Message 2 (revealing phone)", "phone_owner_1", {
      id: "msg_002",
      userId: bsuid,
      phone: realPhone,
      profileName: "Anas Client",
    });

    // 3. Verify conversation merged:
    // - Now indexed under real phone number
    // - Both Message 1 and Message 2 are in history
    // - human_takeover flag carried over
    // - is_masked is now false and phoneNumber is populated
    convos = await listConversations();
    assert.equal(convos.length, 1, "Should NOT create duplicate conversation; must be merged");
    assert.equal(convos[0].phone, realPhone);
    assert.equal(convos[0].phoneNumber, realPhone);
    assert.equal(convos[0].user_id, bsuid);
    assert.equal(convos[0].profile_name, "Anas Client");
    assert.equal(convos[0].is_masked, false);
    assert.equal(convos[0].human_takeover, true, "Takeover flag must be preserved");

    // Message history must contain both messages
    const contents = convos[0].messages.map((m) => m.content);
    assert.ok(contents.includes("Message 1 (ID only)"));
    assert.ok(contents.includes("Message 2 (revealing phone)"));

    // 4. Subsequent check of takeover for the old BSUID resolves to mapped phone
    const bsuidStatus = await getTakeoverStatus(bsuid);
    assert.equal(bsuidStatus.human_takeover, true);
  });
});

describe("BSUID & Identity Resolution - Supabase List & Merge", () => {
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_role_key";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
  });

  it("lists conversations with visible phone number vs masked BSUID properly formatted", async () => {
    const mockDbConversations = [
      {
        id: "convo-phone-1",
        wa_contact_phone: "212673046307",
        contact_name: "Hamza Ra",
        human_takeover: false,
        unread_count: 0,
        last_message_at: "2026-11-06T15:00:00Z",
        last_inbound_at: "2026-11-06T15:00:00Z",
        messages: [{ body: "Bonjour", direction: "inbound", created_at: "2026-11-06T15:00:00Z" }],
      },
      {
        id: "convo-bsuid-2",
        wa_contact_phone: "MA.1163080159477566",
        contact_name: "Anas Masqué",
        human_takeover: true,
        unread_count: 1,
        last_message_at: "2026-11-06T15:05:00Z",
        last_inbound_at: "2026-11-06T15:05:00Z",
        messages: [{ body: "Salam", direction: "inbound", created_at: "2026-11-06T15:05:00Z" }],
      },
    ];

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/rest/v1/conversations")) {
        return new Response(JSON.stringify(mockDbConversations), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const convos = await listAdminConversations();
    assert.equal(convos.length, 2);

    // Client 1: Has visible phone number
    const phoneClient = convos.find((c) => c.id === "convo-phone-1");
    assert.equal(phoneClient.phone, "212673046307");
    assert.equal(phoneClient.phoneNumber, "212673046307");
    assert.equal(phoneClient.user_id, null);
    assert.equal(phoneClient.profile_name, "Hamza Ra");
    assert.equal(phoneClient.is_masked, false);
    assert.equal(formatPhoneNumber(phoneClient.phoneNumber), "+212 673 046307");

    // Client 2: ID-only (BSUID)
    const bsuidClient = convos.find((c) => c.id === "convo-bsuid-2");
    assert.equal(bsuidClient.phone, "MA.1163080159477566");
    assert.equal(bsuidClient.phoneNumber, null);
    assert.equal(bsuidClient.user_id, "MA.1163080159477566");
    assert.equal(bsuidClient.profile_name, "Anas Masqué");
    assert.equal(bsuidClient.is_masked, true);
  });

  it("merges ID-only Supabase conversation record into phone record when phone arrives", async () => {
    let convosTable = [
      {
        id: "convo-id-uuid",
        wa_contact_phone: "MA.1163080159477566",
        contact_name: "Anas Masqué",
        human_takeover: true,
        unread_count: 1,
      },
    ];

    globalThis.fetch = async (url, opts = {}) => {
      const urlStr = String(url);
      const method = opts.method || "GET";

      if (urlStr.includes("/rest/v1/conversations")) {
        if (method === "GET") {
          if (urlStr.includes("wa_contact_phone=eq.MA.1163080159477566")) {
            const found = convosTable.find((c) => c.wa_contact_phone === "MA.1163080159477566");
            return new Response(JSON.stringify(found ? [found] : []), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (urlStr.includes("wa_contact_phone=eq.212673046307")) {
            const found = convosTable.find((c) => c.wa_contact_phone === "212673046307");
            return new Response(JSON.stringify(found ? [found] : []), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        if (method === "PATCH") {
          const body = JSON.parse(opts.body);
          if (urlStr.includes("id=eq.convo-id-uuid")) {
            convosTable[0] = { ...convosTable[0], ...body };
            return new Response(JSON.stringify(convosTable[0]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const merged = await upsertInboundConversation({
      phone: "212673046307",
      userId: "MA.1163080159477566",
      contactName: "Anas Masqué",
    });

    assert.equal(merged.id, "convo-id-uuid");
    assert.equal(merged.wa_contact_phone, "212673046307");
    assert.equal(merged.human_takeover, true, "Preserves takeover state across migration");
  });
});

