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
 * index so the dashboard can list it.
 */
export async function saveMessage(phone, role, content) {
    const key = `conv:${phone}`;
    const entry = JSON.stringify({ role, content, ts: Date.now() });

    await redisPipeline([
        ["RPUSH", key, entry],
        ["LTRIM", key, -MAX_HISTORY, -1],
        ["SADD", "conv:index", phone],
    ]);
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

/**
 * For the dashboard: list every phone number we've ever talked to, along
 * with their full message history.
 */
export async function listConversations() {
    const indexResult = await redisPipeline([["SMEMBERS", "conv:index"]]);
    const phones = indexResult?.[0]?.result || [];

    if (phones.length === 0) return [];

    const historyCommands = phones.map((phone) => ["LRANGE", `conv:${phone}`, 0, -1]);
    const historyResults = await redisPipeline(historyCommands);

    return phones.map((phone, i) => {
        const raw = historyResults[i]?.result || [];
        const messages = raw.map((item) => JSON.parse(item));
        return { phone, messages };
    });
}