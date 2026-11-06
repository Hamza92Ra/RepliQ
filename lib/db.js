// Lightweight storage using Upstash Redis's REST API (no SDK needed, works
// fine with plain fetch — good for serverless functions on Vercel).
// Free tier: https://upstash.com — no credit card required.
//
// Env vars needed:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// (If you add "Upstash for Redis" via Vercel's Storage tab / Marketplace,
// these two get injected automatically into your project.)

import { isBsuid, normalizeRecipient } from "./whatsapp.js";
import { getWindowInfo } from "./window.js";

const BASE_URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// How many past messages to keep per conversation (both for storage size
// and for how much history we feed back into the AI as context).
const MAX_HISTORY = 30;

// How long a message ID is remembered for dedup purposes, in seconds.
// Meta's retries all happen within minutes, so 10 minutes is plenty.
const DEDUP_TTL_SECONDS = 600;

// FIX: "human" mode used to be stored with no expiry. If an admin took over
// a conversation on the dashboard and forgot to hand it back, the bot would
// stay silent for that customer FOREVER — this is why "some people" were
// getting no reply. Auto-revert to "bot" after this many hours of no one
// resolving it manually. "completed" is NOT affected by this — that stays
// permanent, since it means an admin deliberately closed the conversation.
const HUMAN_TAKEOVER_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export async function redisPipeline(commands) {
    const baseUrl = process.env.UPSTASH_REDIS_REST_URL || BASE_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || TOKEN;
    if (!baseUrl || !token) {
        throw new Error("UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set");
    }
    const res = await fetch(`${baseUrl}/pipeline`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
    });
    if (!res.ok) {
        throw new Error(`Upstash error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

/**
 * Normalize a conversation identifier for Redis keys. Real phone numbers
 * get non-digit characters stripped (WhatsApp sometimes sends "+"-prefixed
 * or formatted numbers). BSUIDs (e.g. "MA.1587668549511396", used for
 * WhatsApp-username-only customers with no known phone number — see
 * lib/whatsapp.js) must NOT be touched: stripping their letters/period
 * turns them into a different, wrong Redis key and silently splits one
 * customer into two separate conversations. Every function below that
 * builds a `conv:*` key from a raw identifier goes through this so they
 * all agree on the same key for the same customer.
 */
export function normalizeId(id) {
    return normalizeRecipient(id);
}

/**
 * Save one message (from the customer, bot, or human agent) into that phone
 * number's conversation history, and register the phone number in the
 * conversation index so the dashboard can list it. Pass phoneNumberId so
 * admin replies and per-business config can find their way back to the right number.
 * Supports extra fields such as id, wamid, status ('sent'|'delivered'|'read'|'failed'), and error.
 */
export async function saveMessage(phone, role, content, phoneNumberId, extra = {}) {
    const id = normalizeId(phone);
    if (!id) return;
    const key = `conv:${id}`;
    const msgId = extra.id || (extra.wamid ? extra.wamid : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const entry = JSON.stringify({
        id: msgId,
        wamid: extra.wamid || null,
        role,
        content,
        ts: extra.ts || Date.now(),
        status: extra.status || (role === "agent" ? "sent" : undefined),
        error: extra.error || null,
        errorCode: extra.errorCode || null,
        template: extra.template || null,
    });

    const commands = [
        ["RPUSH", key, entry],
        ["LTRIM", key, -MAX_HISTORY, -1],
        ["SADD", "conv:index", id],
    ];
    if (phoneNumberId) {
        commands.push(["SET", `conv:owner:${id}`, phoneNumberId]);
    }
    if (extra.wamid) {
        // Map wamid -> conversation id so webhook delivery receipts can find the right conversation
        commands.push(["SET", `msg:phone:${extra.wamid}`, id, "EX", 604800]); // 7 days TTL
    }

    await redisPipeline(commands);
}

/**
 * Update the delivery status ('sent' | 'delivered' | 'read' | 'failed') and optional error
 * for an agent message identified by wamid or internal id.
 */
export async function updateMessageStatus(phone, wamidOrId, status, errorInfo = null, errorCode = null) {
    if (!wamidOrId) return;
    let id = phone ? normalizeId(phone) : null;
    if (!id) {
        // Try looking up the conversation phone from msg:phone:<wamid>
        try {
            const lookup = await redisPipeline([["GET", `msg:phone:${wamidOrId}`]]);
            id = lookup?.[0]?.result || null;
        } catch (e) {
            console.error("wamid phone lookup error:", e);
        }
    }
    if (!id) return;

    const key = `conv:${id}`;
    const result = await redisPipeline([["LRANGE", key, 0, -1]]);
    const raw = result?.[0]?.result || [];
    if (!raw.length) return;

    let modified = false;
    const updated = raw.map((item) => {
        try {
            const m = JSON.parse(item);
            if (m.wamid === wamidOrId || m.id === wamidOrId) {
                m.status = status;
                if (errorInfo) m.error = errorInfo;
                if (errorCode) m.errorCode = errorCode;
                modified = true;
            }
            return JSON.stringify(m);
        } catch {
            return item;
        }
    });

    if (modified) {
        await redisPipeline([["DEL", key], ["RPUSH", key, ...updated]]);
    }
}

/**
 * Get the last `limit` messages for a phone number, oldest first, in the
 * {role, content} shape generateReply() expects as history.
 */
export async function getHistory(phone, limit = 10) {
    const id = normalizeId(phone);
    const key = `conv:${id}`;
    const result = await redisPipeline([["LRANGE", key, -limit, -1]]);
    const raw = result?.[0]?.result || [];
    return raw.map(item => {
        const parsed = JSON.parse(item);

        // Groq accepts "user" and "assistant", not our internal "agent" role.
        const role =
            parsed.role === "agent"
                ? "assistant"
                : parsed.role === "user"
                    ? "user"
                    : "assistant";

        return {
            role,
            content: parsed.content
        };
    });
}

/**
 * Which WhatsApp business number (phone_number_id) a conversation belongs to.
 * Falls back to DEFAULT_PHONE_NUMBER_ID (set this in your Vercel env vars to
 * your single business number's phone_number_id) for conversations that
 * predate this tracking, or that somehow never got an owner recorded. This
 * only matters if you run more than one business number isn't the case —
 * if you serve multiple businesses from one deployment, don't rely on the
 * fallback and instead backfill conv:owner:<phone> keys directly.
 */
export async function getConversationOwner(phone) {
    const id = normalizeId(phone);
    const result = await redisPipeline([["GET", `conv:owner:${id}`]]);
    return result?.[0]?.result || process.env.DEFAULT_PHONE_NUMBER_ID || null;
}

/** Explicitly (re)set which business number owns a conversation. */
export async function setConversationOwner(phone, phoneNumberId) {
    if (!phoneNumberId) return;
    const id = normalizeId(phone);
    await redisPipeline([["SET", `conv:owner:${id}`, phoneNumberId]]);
}

/**
 * Retrieve takeover status for a conversation:
 * - human_takeover (boolean)
 * - takeover_at (timestamp in ms, or null)
 *
 * Supports optional auto-release via TAKEOVER_TIMEOUT_HOURS env var (default: 0 = never).
 * If TAKEOVER_TIMEOUT_HOURS > 0 and the elapsed time since takeover_at exceeds the threshold,
 * the conversation automatically reverts to bot.
 */
export async function getTakeoverStatus(phone) {
    const id = normalizeId(phone);
    if (!id) return { human_takeover: false, takeover_at: null };

    let takeoverAt = null;
    let humanTakeover = false;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        try {
            const result = await redisPipeline([
                ["GET", `conv:takeover:${id}`],
                ["GET", `conv:mode:${id}`],
            ]);

            const rawTakeover = result?.[0]?.result;
            const mode = result?.[1]?.result || "bot";

            humanTakeover = mode === "human";

            if (rawTakeover) {
                try {
                    const parsed = JSON.parse(rawTakeover);
                    if (typeof parsed.human_takeover === "boolean") {
                        humanTakeover = parsed.human_takeover;
                    }
                    if (parsed.takeover_at) {
                        takeoverAt = Number(parsed.takeover_at) || null;
                    }
                } catch {
                    const num = Number(rawTakeover);
                    if (Number.isFinite(num)) {
                        takeoverAt = num;
                        humanTakeover = true;
                    }
                }
            }
        } catch (redisErr) {
            console.error("Redis takeover check error:", redisErr);
        }
    }

    if (!humanTakeover) {
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            try {
                const { getSupabaseAdmin } = await import("./supabase.js");
                const supabase = getSupabaseAdmin();
                const { data: conv } = await supabase
                    .from("conversations")
                    .select("human_takeover")
                    .eq("wa_contact_phone", id)
                    .maybeSingle();
                if (conv?.human_takeover) {
                    humanTakeover = true;
                }
            } catch (e) {
                console.error("Supabase takeover check error:", e);
            }
        }
    }

    if (!humanTakeover) {
        return { human_takeover: false, takeover_at: null };
    }

    // Optional auto-release check
    const timeoutHours = Number(process.env.TAKEOVER_TIMEOUT_HOURS) || 0;
    if (timeoutHours > 0 && takeoverAt) {
        const elapsedMs = Date.now() - takeoverAt;
        const maxMs = timeoutHours * 3600 * 1000;
        if (elapsedMs > maxMs) {
            console.log(`[Takeover] Auto-release: ${timeoutHours}h elapsed since takeover for ${id}. Reverting to bot.`);
            // Asynchronously reset to bot
            setTakeoverStatus(id, false).catch((err) =>
                console.error("Auto-release reset error:", err)
            );
            return { human_takeover: false, takeover_at: null, autoReleased: true };
        }
    }

    return { human_takeover: true, takeover_at: takeoverAt };
}

/**
 * Set the human_takeover flag and takeover_at timestamp for a conversation.
 * Also keeps conv:mode in sync ('human' vs 'bot').
 */
export async function setTakeoverStatus(phone, enabled, takeoverAt = Date.now()) {
    const id = normalizeId(phone);
    if (!id) return;

    const timeoutHours = Number(process.env.TAKEOVER_TIMEOUT_HOURS) || 0;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        try {
            if (enabled) {
                const payload = JSON.stringify({
                    human_takeover: true,
                    takeover_at: takeoverAt || Date.now(),
                });
                const commands = [
                    ["SET", `conv:takeover:${id}`, payload],
                    ["SET", `conv:mode:${id}`, "human"],
                ];
                if (timeoutHours > 0) {
                    const ttlSeconds = Math.round(timeoutHours * 3600);
                    commands[0].push("EX", ttlSeconds);
                    commands[1].push("EX", ttlSeconds);
                }
                await redisPipeline(commands);
            } else {
                await redisPipeline([
                    ["DEL", `conv:takeover:${id}`],
                    ["DEL", `conv:mode:${id}`],
                ]);
            }
        } catch (redisErr) {
            console.error("Redis setTakeoverStatus error:", redisErr);
        }
    }

    // Keep Supabase in sync if configured
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
            const { setConversationTakeover } = await import("./supabase.js");
            await setConversationTakeover(id, enabled, { syncRedis: false });
        } catch (sbErr) {
            console.error("Failed to sync takeover to Supabase:", sbErr);
        }
    }
}

/**
 * "bot" (default), "human", or "completed" — whether an admin has taken
 * over or closed this conversation from the dashboard. While not "bot",
 * the webhook skips auto-replies for that phone number.
 */
export async function getConversationMode(phone) {
    const id = normalizeId(phone);
    const takeover = await getTakeoverStatus(id);
    if (takeover.human_takeover) return "human";

    const result = await redisPipeline([["GET", `conv:mode:${id}`]]);
    return result?.[0]?.result || "bot";
}

/**
 * Setting mode to "human" enables human_takeover with timestamp.
 * Setting mode back to "bot" clears takeover and mode.
 * "completed" is stored as a permanent close.
 */
export async function setConversationMode(phone, mode) {
    const id = normalizeId(phone);
    const key = `conv:mode:${id}`;

    if (mode === "bot") {
        await setTakeoverStatus(id, false);
        return;
    }

    if (mode === "human") {
        await setTakeoverStatus(id, true);
        return;
    }

    // "completed" (or any other explicit mode) — stays until changed or deleted
    await redisPipeline([
        ["SET", key, mode],
        ["DEL", `conv:takeover:${id}`],
    ]);
}

/** Permanently remove a conversation and all of its dashboard metadata. */
export async function deleteConversation(phone) {
    // FIX: this used to unconditionally strip everything but digits, which
    // mangled BSUID identifiers (e.g. "MA.1587668549511396" -> just the
    // digits) into an unrelated key — deleting nothing for that customer's
    // real conversation while silently creating/touching a bogus one.
    const id = normalizeId(phone);
    if (!id) {
        throw new Error("Invalid conversation identifier");
    }

    await redisPipeline([
        ["DEL", `conv:${id}`, `conv:mode:${id}`, `conv:owner:${id}`],
        ["SREM", "conv:index", id],
    ]);
}

/**
 * Permanently delete a single message from a conversation history by its ID or wamid.
 * Useful for cleaning up failed or obsolete messages.
 * @param {string} phone - Recipient phone number or BSUID
 * @param {string} messageId - Message internal ID or wamid
 * @returns {Promise<boolean>} true if removed, false if not found
 */
export async function deleteMessage(phone, messageId) {
    if (!phone || !messageId) return false;
    const id = normalizeId(phone);
    if (!id) return false;

    const key = `conv:${id}`;
    const result = await redisPipeline([["LRANGE", key, 0, -1]]);
    const raw = result?.[0]?.result || [];
    if (!raw.length) return false;

    let removed = false;
    const remaining = [];
    for (const item of raw) {
        try {
            const m = JSON.parse(item);
            if (m.id === messageId || m.wamid === messageId) {
                removed = true;
                continue;
            }
            remaining.push(item);
        } catch {
            remaining.push(item);
        }
    }

    if (removed) {
        const commands = [["DEL", key]];
        if (remaining.length > 0) {
            commands.push(["RPUSH", key, ...remaining]);
        }
        await redisPipeline(commands);
    }
    return removed;
}

/**
 * Retrieve a single conversation object for a phone number / BSUID,
 * including its full message history, current mode, and owning phone_number_id.
 * @param {string} phone
 * @returns {Promise<{phone: string, messages: Array, mode: string, phoneNumberId: string|null}|null>}
 */
export async function getConversation(phone) {
    const id = normalizeId(phone);
    if (!id) return null;

    const results = await redisPipeline([
        ["LRANGE", `conv:${id}`, 0, -1],
        ["GET", `conv:mode:${id}`],
        ["GET", `conv:owner:${id}`],
        ["GET", `conv:takeover:${id}`],
    ]);

    const raw = results?.[0]?.result || [];
    const messages = raw.map((item) => JSON.parse(item));
    let mode = results?.[1]?.result || "bot";
    const phoneNumberId = results?.[2]?.result || process.env.DEFAULT_PHONE_NUMBER_ID || null;
    const rawTakeover = results?.[3]?.result || null;

    let human_takeover = mode === "human";
    let takeover_at = null;

    if (rawTakeover) {
        try {
            const parsed = JSON.parse(rawTakeover);
            if (typeof parsed.human_takeover === "boolean") human_takeover = parsed.human_takeover;
            if (parsed.takeover_at) takeover_at = Number(parsed.takeover_at) || null;
        } catch {
            takeover_at = Number(rawTakeover) || null;
            human_takeover = true;
        }
    }

    const timeoutHours = Number(process.env.TAKEOVER_TIMEOUT_HOURS) || 0;
    if (timeoutHours > 0 && human_takeover && takeover_at) {
        if (Date.now() - takeover_at > timeoutHours * 3600 * 1000) {
            human_takeover = false;
            mode = "bot";
        }
    }

    if (human_takeover && mode !== "completed") {
        mode = "human";
    }

    return { phone: id, messages, mode, phoneNumberId, human_takeover, takeover_at };
}

/**
 * Per-business system prompt / config, keyed by WhatsApp phone_number_id.
 * Lets one deployment serve several RepliQ customers instead of one
 * hardcoded business.
 */
export async function getBusinessConfig(phoneNumberId) {
    const result = await redisPipeline([["GET", `business:${phoneNumberId}`]]);
    const raw = result?.[0]?.result;
    return raw ? JSON.parse(raw) : null;
}

export async function saveBusinessConfig(phoneNumberId, config) {
    await redisPipeline([["SET", `business:${phoneNumberId}`, JSON.stringify(config)]]);
}

/**
 * For the dashboard: list every phone number we've ever talked to, along
 * with their full message history, current mode, owning business number,
 * human_takeover flag, and server-computed 24h Meta customer care window status.
 */
export async function listConversations() {
    const indexResult = await redisPipeline([["SMEMBERS", "conv:index"]]);
    const phones = indexResult?.[0]?.result || [];

    if (phones.length === 0) return [];

    const commands = phones.flatMap((phone) => [
        ["LRANGE", `conv:${phone}`, 0, -1],
        ["GET", `conv:mode:${phone}`],
        ["GET", `conv:owner:${phone}`],
        ["GET", `conv:takeover:${phone}`],
    ]);
    const results = await redisPipeline(commands);
    const now = Date.now();
    const timeoutHours = Number(process.env.TAKEOVER_TIMEOUT_HOURS) || 0;

    return phones.map((phone, i) => {
        const base = i * 4;
        const raw = results[base]?.result || [];
        const messages = raw.map((item) => JSON.parse(item));
        let mode = results[base + 1]?.result || "bot";
        const phoneNumberId = results[base + 2]?.result || null;
        const rawTakeover = results[base + 3]?.result || null;

        let human_takeover = mode === "human";
        let takeover_at = null;

        if (rawTakeover) {
            try {
                const parsed = JSON.parse(rawTakeover);
                if (typeof parsed.human_takeover === "boolean") human_takeover = parsed.human_takeover;
                if (parsed.takeover_at) takeover_at = Number(parsed.takeover_at) || null;
            } catch {
                takeover_at = Number(rawTakeover) || null;
                human_takeover = true;
            }
        }

        if (timeoutHours > 0 && human_takeover && takeover_at) {
            if (now - takeover_at > timeoutHours * 3600 * 1000) {
                human_takeover = false;
                mode = "bot";
            }
        }

        if (human_takeover && mode !== "completed") {
            mode = "human";
        }

        const convo = { phone, messages, mode, phoneNumberId, human_takeover, takeover_at };
        const winInfo = getWindowInfo(convo, now);

        return {
            ...convo,
            isWindowOpen: winInfo.isOpen,
            lastInboundTs: winInfo.lastInboundTs,
            windowExpiresAt: winInfo.expiresAt,
            windowRemainingMs: winInfo.remainingMs,
        };
    });
}

/**
 * Claim a WhatsApp message ID for processing, using Redis as the source of
 * truth (Vercel runs multiple instances of this function, so an in-memory
 * Set alone isn't reliable). Returns true the first time a given message ID
 * is seen, false on every retry Meta sends after that.
 * Uses SET ... NX (only set if not already present) with an expiry so the
 * dedup key cleans itself up.
 * @param {string} messageId
 * @returns {Promise<boolean>} true if this call claimed it (i.e. process it), false if it's a duplicate
 */
export async function claimMessage(messageId) {
    const key = `msgid:${messageId}`;
    const result = await redisPipeline([
        ["SET", key, "1", "NX", "EX", DEDUP_TTL_SECONDS],
    ]);
    // Upstash returns "OK" when the SET succeeded, null when NX blocked it
    // because the key already existed.
    return result?.[0]?.result === "OK";
}