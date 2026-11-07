// INACTIVE: dependency-injected foundation. No production endpoint imports this.
const issued = new WeakMap();
const permissions = Object.freeze({
  viewer: ["read"],
  agent: ["read", "send", "takeover", "mark_read"],
  manager: ["read", "send", "takeover", "mark_read", "delete", "templates", "config", "orders"],
  owner: ["read", "send", "takeover", "mark_read", "delete", "templates", "config", "orders", "credentials", "memberships"],
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuid(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Invalid identifier");
  return value.toLowerCase();
}
function denied(status = 403) {
  return Object.assign(new Error(status === 401 ? "Authentication required" : "Access denied"), { status });
}

// verifySession MUST verify the token server-side against the identity/session
// provider; passing a decoded browser JWT or existing global admin token is invalid.
export async function authorizeTenant(input, { verifySession, loadMembership, loadNumber, now = Date.now }) {
  const principal = await verifySession(input.sessionToken);
  if (!principal?.userId || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now()) throw denied(401);
  const userId = requireUuid(principal.userId);
  const businessId = requireUuid(input.businessId);
  const numberId = requireUuid(input.numberId);
  const membership = await loadMembership(userId, businessId);
  if (!membership || membership.user_id !== userId || membership.business_id !== businessId ||
      membership.status !== "active" || membership.user_status !== "active" || membership.business_status !== "active" || !Object.hasOwn(permissions, membership.role)) throw denied();
  const number = await loadNumber(numberId, businessId);
  if (!number || number.id !== numberId || number.business_id !== businessId || number.status !== "active" ||
      typeof number.phone_number_id !== "string" || !number.phone_number_id || !number.waba_id) throw denied();
  const context = Object.freeze({ businessId, numberId, phoneNumberId: number.phone_number_id,
    wabaId: number.waba_id, userId, role: membership.role });
  issued.set(context, { expiresAt: principal.expiresAt, now });
  // Check action on creation as well as at every repository operation.
  assertAccess(context, input.action);
  return context;
}
export function assertAccess(context, action) {
  const entry = issued.get(context);
  if (!entry || entry.expiresAt <= entry.now()) throw denied(401);
  if (!permissions[context.role]?.includes(action)) throw denied();
  return context;
}
