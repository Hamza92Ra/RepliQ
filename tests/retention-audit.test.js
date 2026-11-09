import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRedisConversations } from "../lib/retention-audit.js";
const DAY = 86400000;
const now = Date.UTC(2026, 10, 9);
const old = JSON.stringify({ ts: now - 91 * DAY, content: "private" });
const fresh = JSON.stringify({ ts: now - DAY, content: "private" });
test("read-only batch audit produces aggregate counts and never issues writes", async () => {
  const calls = [];
  const read = async cmds => {
    calls.push(cmds);
    if (cmds[0][0] === "SMEMBERS") return [{ result: ["customer-a", "customer-b", "customer-c"] }];
    return cmds.map(c => ({ result: c[1] === "conv:customer-a" ? [old] : c[1] === "conv:customer-b" ? [old, fresh] : ["invalid"] }));
  };
  const report = await auditRedisConversations(read, { now, batchSize: 2 });
  assert.deepEqual(report, {
    indexedConversations: 3, fullyPastTargetConversations: 1, activeOrRecentConversations: 1,
    conversationsNeedingReview: 1, oldMessages: 2, recentMessages: 1, messagesNeedingReview: 1,
  });
  assert.ok(calls.flat().every(x => ["SMEMBERS", "LRANGE"].includes(x[0])));
  assert.equal(JSON.stringify(report).includes("private"), false);
  assert.equal(JSON.stringify(report).includes("customer"), false);
});
test("rejects unbounded scans, bad index and incomplete Redis results", async () => {
  await assert.rejects(auditRedisConversations(async () => [{ result: Array(501).fill("id") }], { now }), /limit exceeded/);
  await assert.rejects(auditRedisConversations(async () => [{ result: null }], { now }), /unavailable/);
  const partial = async commands => commands[0][0] === "SMEMBERS" ? [{ result: ["id"] }] : [];
  await assert.rejects(auditRedisConversations(partial, { now }), /Incomplete/);
  await assert.rejects(auditRedisConversations(async () => [], { now, batchSize: 0 }), RangeError);
});
