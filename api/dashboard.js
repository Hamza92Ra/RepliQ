import { listConversations } from "../lib/db.js";

// Simple password protection — pass ?key=YOUR_SECRET in the URL.
// Set DASHBOARD_SECRET in Vercel env vars to whatever password you want.
export default async function handler(req, res) {
    const key = req.query.key;

    if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        let conversations = [];
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            conversations = await listConversations();
        } else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            const { listAdminConversations } = await import("../lib/supabase.js");
            conversations = await listAdminConversations();
        } else {
            conversations = await listConversations();
        }

        // Most recently active conversations first.
        conversations.sort((a, b) => {
            const lastA = (a.messages && a.messages[a.messages.length - 1]?.ts) || (a.last_message_at ? new Date(a.last_message_at).getTime() : 0);
            const lastB = (b.messages && b.messages[b.messages.length - 1]?.ts) || (b.last_message_at ? new Date(b.last_message_at).getTime() : 0);
            return lastB - lastA;
        });
        return res.status(200).json({ conversations, serverTime: Date.now() });
    } catch (err) {
        console.error("dashboard.js: Dashboard fetch error:");
        return res.status(500).json({ error: "Failed to load conversations" });
    }
}