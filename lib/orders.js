// lib/orders.js
// Order storage for e-commerce clients — same Upstash Redis REST approach as
// lib/db.js, so this needs no new env vars and no new service to set up.
//
// Key layout:
//   order:<id>                      -> JSON blob (the order itself)
//   orders:index                    -> SET of ALL order ids (mirrors conv:index in lib/db.js —
//                                        the dashboard is single-tenant and lists everything,
//                                        same as listConversations())
//   orders:business:<phoneNumberId> -> SET of order ids, kept for potential future per-business use
//   orders:phone:<phone>            -> SET of order ids, for a customer's order history

const BASE_URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisPipeline(commands) {
    if (!BASE_URL || !TOKEN) {
        throw new Error("UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set");
    }
    const res = await fetch(`${BASE_URL}/pipeline`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
    });
    if (!res.ok) {
        throw new Error(`Upstash error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

const VALID_STATUSES = new Set(["pending", "confirmed", "shipped", "cancelled"]);

/**
 * Create a new order. Call this once a customer has confirmed what they
 * want to buy (see extractOrder() in lib/ai.js for how that gets detected).
 * @param {object} params
 * @param {string} params.phone - customer's WhatsApp number
 * @param {string} params.phoneNumberId - which business this order belongs to
 * @param {Array<{name: string, quantity: number, price?: number}>} params.items
 * @param {number|null} [params.amount] - total order amount, if known
 * @returns {Promise<object>} the created order
 */
export async function createOrder({ phone, phoneNumberId, items, amount = null }) {
    if (!phone || !phoneNumberId) {
        throw new Error("createOrder requires phone and phoneNumberId");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const order = {
        id,
        phone,
        phoneNumberId,
        items: Array.isArray(items) ? items : [],
        amount: typeof amount === "number" ? amount : null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };

    await redisPipeline([
        ["SET", `order:${id}`, JSON.stringify(order)],
        ["SADD", "orders:index", id],
        ["SADD", `orders:business:${phoneNumberId}`, id],
        ["SADD", `orders:phone:${phone}`, id],
    ]);

    return order;
}

/** Fetch a single order by id. */
export async function getOrder(id) {
    const result = await redisPipeline([["GET", `order:${id}`]]);
    const raw = result?.[0]?.result;
    return raw ? JSON.parse(raw) : null;
}

/**
 * Update an order's status (pending -> confirmed -> shipped, or cancelled).
 * This is what the dashboard's status buttons call.
 */
export async function updateOrderStatus(id, status) {
    if (!VALID_STATUSES.has(status)) {
        throw new Error(`Invalid order status: ${status}`);
    }
    const order = await getOrder(id);
    if (!order) {
        throw new Error(`Order not found: ${id}`);
    }
    order.status = status;
    order.updatedAt = Date.now();
    await redisPipeline([["SET", `order:${id}`, JSON.stringify(order)]]);
    return order;
}

/**
 * List every order, newest first — same "global, single-tenant" shape as
 * listConversations() in lib/db.js. This is what api/orders.js reads from.
 */
export async function listAllOrders() {
    const indexResult = await redisPipeline([["SMEMBERS", "orders:index"]]);
    const ids = indexResult?.[0]?.result || [];
    if (ids.length === 0) return [];

    const results = await redisPipeline(ids.map((id) => ["GET", `order:${id}`]));
    const orders = results.map((r) => (r?.result ? JSON.parse(r.result) : null)).filter(Boolean);

    return orders.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * List every order for one business. Kept for future multi-tenant use —
 * not currently called by api/orders.js.
 */
export async function listOrdersForBusiness(phoneNumberId) {
    const indexResult = await redisPipeline([["SMEMBERS", `orders:business:${phoneNumberId}`]]);
    const ids = indexResult?.[0]?.result || [];
    if (ids.length === 0) return [];

    const results = await redisPipeline(ids.map((id) => ["GET", `order:${id}`]));
    const orders = results.map((r) => (r?.result ? JSON.parse(r.result) : null)).filter(Boolean);

    return orders.sort((a, b) => b.createdAt - a.createdAt);
}

/** A single customer's past orders with one business — useful in the conversation panel. */
export async function listOrdersForPhone(phone) {
    const indexResult = await redisPipeline([["SMEMBERS", `orders:phone:${phone}`]]);
    const ids = indexResult?.[0]?.result || [];
    if (ids.length === 0) return [];

    const results = await redisPipeline(ids.map((id) => ["GET", `order:${id}`]));
    return results
        .map((r) => (r?.result ? JSON.parse(r.result) : null))
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt);
}