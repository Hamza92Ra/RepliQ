// INACTIVE: illustrative, limited repository for migration review and tests.
// No raw query builder escapes this boundary. RLS does not protect service-role
// callers: every operation below includes business + owned WhatsApp number.
import { assertAccess, requireUuid } from "./authorization.js";

export function createTenantStore(context, client) {
  const scoped = (table, action = "read") => {
    assertAccess(context, action);
    return client.from(table);
  };
  const filter = query => query.eq("business_id", context.businessId).eq("whatsapp_number_id", context.numberId);
  const result = async query => {
    const { data, error } = await query;
    if (error) throw new Error("Tenant data operation failed");
    return data;
  };
  const conversation = id => result(filter(scoped("conversations").select("*")).eq("id", requireUuid(id)).maybeSingle());
  return Object.freeze({
    listConversations: () => result(filter(scoped("conversations").select("*")).order("last_message_at", { ascending: false })),
    conversation,
    receipt(wamid) {
      if (typeof wamid !== "string" || !wamid.trim()) throw new Error("Message ID required");
      return result(filter(scoped("messages").select("*")).eq("wa_message_id", wamid).maybeSingle());
    },
    async messages(id) {
      // Missing/foreign identifiers have the same empty response; no existence leak.
      if (!await conversation(id)) return [];
      return result(filter(scoped("messages").select("*")).eq("conversation_id", requireUuid(id)).order("created_at"));
    },
    async setTakeover(id, enabled) {
      assertAccess(context, "takeover");
      if (typeof enabled !== "boolean") throw new Error("Boolean takeover required");
      return result(filter(scoped("conversations", "takeover").update({ human_takeover: enabled })).eq("id", requireUuid(id)).select("*"));
    },
    async appendHumanMessage(id, message) {
      assertAccess(context, "send");
      if (!await conversation(id)) throw Object.assign(new Error("Conversation unavailable"), { status: 404 });
      // Whitelist fields; supplied business/conversation/sender IDs cannot override scope.
      if (typeof message.body !== "string" || !message.body.trim()) throw new Error("Message body required");
      if (typeof message.wamid !== "string" || !message.wamid.trim()) throw new Error("Accepted provider message ID required");
      return result(scoped("messages", "send").insert({ business_id: context.businessId,
        whatsapp_number_id: context.numberId, conversation_id: requireUuid(id), sender: "human",
        direction: "outbound", type: "text", body: message.body, wa_message_id: message.wamid,
        status: "sent" }).select("*"));
    },
  });
}
