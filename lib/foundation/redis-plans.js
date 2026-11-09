// INACTIVE pure command plans. No transport, environment variables or legacy
// fallback. These are NOT a complete replacement for lib/db.js (see report).
import { assertAccess } from "./authorization.js";
import { tenantKey } from "../tenant-keys.js";
import { normalizeRecipient, isBsuid } from "../whatsapp.js";

export function customerIdentity(value) {
  if (typeof value !== "string") throw new Error("Customer identity required");
  const raw = value.replace(/^whatsapp:/i, "").trim();
  if (isBsuid(raw)) return raw;
  if (!/^[+\d\s()-]+$/.test(raw)) throw new Error("Invalid customer identity");
  const normalized = normalizeRecipient(raw);
  if (!/^\d{7,15}$/.test(normalized)) throw new Error("Invalid customer identity");
  return normalized;
}
const kinds = new Set(["history", "conversation-index", "mode", "takeover", "owner", "meta", "identity",
  "receipt", "dedup", "config", "templates", "order", "order-index", "customer-orders", "media"]);
export function scopedKey(context, kind, ...ids) {
  assertAccess(context, "read");
  if (!kinds.has(kind)) throw new Error("Unknown key kind");
  return tenantKey(context.businessId, "number", context.numberId, kind, ...ids);
}
export function historyPlan(context, customer) {
  return [["LRANGE", scopedKey(context, "history", customerIdentity(customer)), 0, -1]];
}
export function takeoverPlan(context, customer, enabled) {
  assertAccess(context, "takeover");
  if (typeof enabled !== "boolean") throw new Error("Boolean takeover required");
  const id = customerIdentity(customer);
  // Execute as MULTI/EXEC or one Lua script at activation, NOT a REST pipeline.
  return [["SET", scopedKey(context, "takeover", id), JSON.stringify({ human_takeover: enabled })],
    ["SET", scopedKey(context, "mode", id), enabled ? "human" : "bot"]];
}
export function receiptPlan(context, wamid) {
  return [["GET", scopedKey(context, "receipt", wamid)]];
}
export function templatesPlan(context) {
  return [["GET", scopedKey(context, "templates")]];
}
export function orderPlan(context, orderId) {
  return [["GET", scopedKey(context, "order", orderId)]];
}
export function identityPlan(context, bsuid) {
  if (!isBsuid(bsuid)) throw new Error("BSUID required");
  return [["GET", scopedKey(context, "identity", bsuid)]];
}
