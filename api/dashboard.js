import { listConversations } from "../lib/db.js";

// Simple password protection — pass ?key=YOUR_SECRET in the URL.
// Set DASHBOARD_SECRET in Vercel env vars to whatever password you want.
export default async function handler(req, res) {
    const key = req.query.key;

    if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const conversations = await listConversations();
        // Most recently active conversations first.
        conversations.sort((a, b) => {
            const lastA = a.messages[a.messages.length - 1]?.ts || 0;
            const lastB = b.messages[b.messages.length - 1]?.ts || 0;
            return lastB - lastA;
        });
        return res.status(200).json({ conversations });
    } catch (err) {
        console.error("Dashboard fetch error:", err);
        return res.status(500).json({ error: "Failed to load conversations" });
    }
}