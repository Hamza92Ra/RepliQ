// Synthetic services shared by router and optional real-runtime tests.
export function installAdminFixtures() {
  const state = {
    calls: [],
    conversation: { id: "fixture-conversation", wa_contact_phone: "15555550123", contact_name: "Fixture",
      human_takeover: false, unread_count: 1, last_inbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() },
    redis: new Map(),
  };
  state.redis.set("conv:15555550123", [JSON.stringify({ role: "user", content: "Synthetic fixture", ts: Date.now() })]);
  state.redis.set("conv:owner:15555550123", "1001");
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    state.calls.push({ url: url.href, method: options.method || "GET", body: options.body });
    if (url.hostname === "fixture.supabase.test") {
      const method = options.method || "GET";
      if (url.pathname === "/rest/v1/conversations") {
        if (method === "PATCH") {
          Object.assign(state.conversation, JSON.parse(options.body));
          return Response.json([{ ...state.conversation }]);
        }
        if (url.searchParams.has("id") || url.searchParams.has("wa_contact_phone")) return Response.json({ ...state.conversation });
        return Response.json([{ ...state.conversation, messages: [] }]);
      }
      if (url.pathname === "/rest/v1/messages") {
        if (method === "POST") return Response.json({ id: "stored-fixture", ...JSON.parse(options.body) }, { status: 201 });
        return Response.json([{ id: "message-fixture", conversation_id: state.conversation.id, body: "Synthetic fixture", sender: "customer", created_at: new Date().toISOString() }]);
      }
    }
    if (url.hostname === "fixture.upstash.test" && url.pathname === "/pipeline") {
      return Response.json(JSON.parse(options.body).map(([command, key, ...args]) => {
        if (command === "GET") return { result: state.redis.get(key) ?? null };
        if (command === "SET") {
          if (args.includes("NX") && state.redis.has(key)) return { result: null };
          state.redis.set(key, args[0]); return { result: "OK" };
        }
        if (command === "DEL") { for (const k of [key, ...args]) state.redis.delete(k); return { result: 1 }; }
        if (command === "LRANGE") return { result: state.redis.get(key) || [] };
        if (command === "RPUSH") { state.redis.set(key, [...(state.redis.get(key) || []), ...args]); return { result: args.length }; }
        return { result: 1 };
      }));
    }
    if (url.hostname === "graph.facebook.com" && options.method === "POST") {
      return Response.json({ messages: [{ id: "wamid.fixture" }] });
    }
    throw new Error("Unexpected external service in router/runtime test");
  };
  return state;
}
export const fixtureEnvironment = {
  NODE_ENV: "production", DASHBOARD_SECRET: "dashboard-fixture", ADMIN_JWT_SECRET: "jwt-fixture",
  WHATSAPP_PHONE_NUMBER_ID: "1001", DEFAULT_PHONE_NUMBER_ID: "1001", WHATSAPP_TOKEN: "whatsapp-fixture",
  SUPABASE_URL: "https://fixture.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture",
  UPSTASH_REDIS_REST_URL: "https://fixture.upstash.test", UPSTASH_REDIS_REST_TOKEN: "redis-fixture",
  META_APP_SECRET: "meta-fixture", VERIFY_TOKEN: "verify-fixture",
};
