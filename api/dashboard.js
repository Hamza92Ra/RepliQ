import { listConversations } from "../lib/db.js";
import { storageErrorCategory } from "../lib/storage-error-category.js";
import { supabasePrimaryEnabled } from "../lib/storage-backend.js";

// Keep legacy single-password authentication untouched for existing operators.
export default async function handler(req, res) {
    const key = req.query?.key;
    if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    let source = "redis";
    let degraded = false;
    try {
        let conversations = [];
        const supabaseReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
        if (supabasePrimaryEnabled()) {
            if (!supabaseReady) {
                console.error("dashboard.js: Supabase-primary configuration missing");
                return res.status(503).json({ error: "Conversation storage unavailable", code: "STORAGE_UNAVAILABLE" });
            }
            const { listAdminConversations } = await import("../lib/supabase.js");
            conversations = await listAdminConversations();
            source = "supabase";
            // Redis-backed legacy agent actions and historic leads are not fully migrated.
            // Keep the original dashboard read-only until the migration is complete.
            degraded = true;
        } else if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                conversations = await listConversations();
            } catch (error) {
                console.error("dashboard.js: Redis conversation read failed:", storageErrorCategory(error));
                if (!supabaseReady) throw error;
                // Read-only fallback: do not write to Redis, Supabase, or account data.
                // Explicitly mark degraded mode so this can never be mistaken for a complete Redis view.
                const { listAdminConversations } = await import("../lib/supabase.js");
                conversations = await listAdminConversations();
                source = "supabase";
                degraded = true;
            }
        } else if (supabaseReady) {
            const { listAdminConversations } = await import("../lib/supabase.js");
            conversations = await listAdminConversations();
            source = "supabase";
            degraded = true;
            console.warn("dashboard.js: Redis credentials unavailable; using read-only Supabase view");
        } else {
            console.error("dashboard.js: No conversation storage configured");
            return res.status(503).json({ error: "Conversation storage unavailable", code: "STORAGE_UNAVAILABLE" });
        }

        conversations.sort((a, b) => {
            const lastA = (a.messages && a.messages[a.messages.length - 1]?.ts) || (a.last_message_at ? new Date(a.last_message_at).getTime() : 0);
            const lastB = (b.messages && b.messages[b.messages.length - 1]?.ts) || (b.last_message_at ? new Date(b.last_message_at).getTime() : 0);
            return lastB - lastA;
        });
        const storageNotice = supabasePrimaryEnabled() ? "Migration Supabase en cours : conversations consultables ; certaines actions et données historiques restent indisponibles." : undefined;
        return res.status(200).json({ conversations, serverTime: Date.now(), source, degraded, storageNotice });
    } catch (error) {
        console.error("dashboard.js: Conversation storage unavailable:", storageErrorCategory(error));
        return res.status(503).json({ error: "Conversation storage unavailable", code: "STORAGE_UNAVAILABLE" });
    }
}
