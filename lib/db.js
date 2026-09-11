// Lightweight storage using Upstash Redis's REST API (no SDK needed, works
// fine with plain fetch — good for serverless functions on Vercel).
// Free tier: https://upstash.com — no credit card required.
//
// Env vars needed:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// (If you add "Upstash for Redis" via Vercel's Storage tab / Marketplace,
// these two get injected automatically into your project.)

const BASE_URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// How many past messages to keep per conversation (both for storage size
// and for how much history we feed back into the AI as context).
const MAX_HISTORY = 30;

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

/**
 * Save one message (from the customer or the bot) into that phone number's
 * conversation history, and register the phone number in the conversation
 * index so the dashboard can list it. Pass phoneNumberId (the WhatsApp
 * business number that owns this conversation) so admin replies and
 * per-business config can find their way back to the right number.
 */
export async function saveMessage(phone, role, content, phoneNumberId) {
    const key = `conv:${phone}`;
    const entry = JSON.stringify({ role, content, ts: Date.now() });

    const commands = [
        ["RPUSH", key, entry],
        ["LTRIM", key, -MAX_HISTORY, -1],
        ["SADD", "conv:index", phone],
    ];
    if (phoneNumberId) {
        commands.push(["SET", `conv:owner:${phone}`, phoneNumberId]);
    }

    await redisPipeline(commands);
}

/**
 * Get the last `limit` messages for a phone number, oldest first, in the
 * {role, content} shape generateReply() expects as history.
 */
export async function getHistory(phone, limit = 10) {
    const key = `conv:${phone}`;
    const result = await redisPipeline([["LRANGE", key, -limit, -1]]);
    const raw = result?.[0]?.result || [];
    return raw.map((item) => {
        const parsed = JSON.parse(item);
        return { role: parsed.role, content: parsed.content };
    });
}

/** Which WhatsApp business number (phone_number_id) a conversation belongs to. */
export async function getConversationOwner(phone) {
    const result = await redisPipeline([["GET", `conv:owner:${phone}`]]);
    return result?.[0]?.result || null;
}

/**
 * "bot" (default) or "human" — whether an admin has taken over this
 * conversation from the dashboard. While "human", the webhook skips
 * auto-replies for that phone number.
 */
export async function getConversationMode(phone) {
    const result = await redisPipeline([["GET", `conv:mode:${phone}`]]);
    return result?.[0]?.result || "bot";
}

export async function setConversationMode(phone, mode) {
    await redisPipeline([["SET", `conv:mode:${phone}`, mode]]);
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
 * with their full message history, current mode, and owning business number.
 */
export async function listConversations() {
    const indexResult = await redisPipeline([["SMEMBERS", "conv:index"]]);
    const phones = indexResult?.[0]?.result || [];

    if (phones.length === 0) return [];

    const commands = phones.flatMap((phone) => [
        ["LRANGE", `conv:${phone}`, 0, -1],
        ["GET", `conv:mode:${phone}`],
        ["GET", `conv:owner:${phone}`],
    ]);
    const results = await redisPipeline(commands);

    return phones.map((phone, i) => {
        const base = i * 3;
        const raw = results[base]?.result || [];
        const messages = raw.map((item) => JSON.parse(item));
        const mode = results[base + 1]?.result || "bot";
        const phoneNumberId = results[base + 2]?.result || null;
        return { phone, messages, mode, phoneNumberId };
    });
}