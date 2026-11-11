import { getSupabaseAdmin } from "./supabase.js";

/** Only service-role server calls; keep the table unavailable to clients. */
function query() { return getSupabaseAdmin().from("orders"); }
function mapOrder(row) {
  if (!row) return null;
  return { id: row.id, phone: row.phone, phoneNumberId: row.phone_number_id,
    items: row.items || [], amount: row.amount === null ? null : Number(row.amount),
    status: row.status, createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime() };
}
function checked({ data, error }) {
  if (error) { console.error("supabase-orders: Query failed"); throw new Error("Order storage unavailable"); }
  return data;
}
export async function createSupabaseOrder({ phone, phoneNumberId, items, amount = null }) {
  if (!phone || !phoneNumberId) throw new Error("createOrder requires phone and phoneNumberId");
  const data = checked(await query().insert({
    phone, phone_number_id: phoneNumberId, items: Array.isArray(items) ? items : [],
    amount: typeof amount === "number" ? amount : null
  }).select().single());
  return mapOrder(data);
}
export async function getSupabaseOrder(id) {
  const data = checked(await query().select("*").eq("id", id).maybeSingle());
  return mapOrder(data);
}
export async function updateSupabaseOrderStatus(id, status) {
  if (!["pending","confirmed","shipped","cancelled"].includes(status)) throw new Error("Invalid order status");
  const data = checked(await query().update({status,updated_at:new Date().toISOString()}).eq("id",id).select().maybeSingle());
  if (!data) throw new Error("Order not found");
  return mapOrder(data);
}
export async function listSupabaseOrders({ phone, phoneNumberId } = {}) {
  let q = query().select("*");
  if (phone) q = q.eq("phone", phone);
  if (phoneNumberId) q = q.eq("phone_number_id", phoneNumberId);
  return checked(await q.order("created_at",{ascending:false})).map(mapOrder);
}
