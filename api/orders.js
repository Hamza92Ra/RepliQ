// api/orders.js
// HTTP route for lib/orders.js. Same auth pattern as api/dashboard.js:
// a shared `key` query param checked against DASHBOARD_SECRET, and no
// per-business filtering — the dashboard is single-tenant, same as
// listConversations().
//
//   GET  /api/orders?key=...                     -> { orders: [...] }
//   POST /api/orders?key=...  { orderId, status } -> { order: {...} }

import { listAllOrders, updateOrderStatus } from "../lib/orders.js";

export default async function handler(req, res) {
    const key = req.query.key;

    if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        if (req.method === "GET") {
            const orders = await listAllOrders();
            return res.status(200).json({ orders });
        }

        if (req.method === "POST") {
            const { orderId, status } = req.body || {};
            if (!orderId || !status) {
                return res.status(400).json({ error: "orderId and status are required" });
            }
            const order = await updateOrderStatus(orderId, status);
            return res.status(200).json({ order });
        }

        res.setHeader("Allow", "GET, POST");
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    } catch (err) {
        console.error("Orders fetch/update error:", err);
        return res.status(500).json({ error: err.message || "Failed to process orders request" });
    }
}