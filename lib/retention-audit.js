/**
 * Read-only Redis retention inventory.
 * It deliberately exposes only aggregate counts: never IDs, phone numbers or text.
 * This is a PREVIEW AUDIT, not an automatic deletion procedure.
 */
import { classifyRedisMessage, retentionCutoff } from "./retention-policy.js";

export async function auditRedisConversations(readPipeline, {
  now = Date.now(), maxConversations = 500, batchSize = 20,
} = {}) {
  if (typeof readPipeline !== "function") throw new TypeError("Read pipeline function required");
  retentionCutoff(now);
  if (!Number.isInteger(maxConversations) || maxConversations < 1 || maxConversations > 5000 ||
      !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new RangeError("Invalid audit batch limits");
  }
  const indexed = await readPipeline([["SMEMBERS", "conv:index"]]);
  const ids = indexed?.[0]?.result;
  if (!Array.isArray(ids)) throw new Error("Redis conversation index unavailable");
  if (ids.length > maxConversations) throw new Error("Audit limit exceeded; no partial totals returned");
  if (!ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 256)) {
    throw new Error("Unexpected conversation identifiers; no partial totals returned");
  }
  const summary = {
    indexedConversations: ids.length,
    fullyPastTargetConversations: 0,
    activeOrRecentConversations: 0,
    conversationsNeedingReview: 0,
    oldMessages: 0,
    recentMessages: 0,
    messagesNeedingReview: 0,
  };
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const current = ids.slice(offset, offset + batchSize);
    const response = await readPipeline(current.map(id => ["LRANGE", `conv:${id}`, 0, -1]));
    if (!Array.isArray(response) || response.length !== current.length) {
      throw new Error("Incomplete Redis audit batch; no results should be published");
    }
    for (const record of response) {
      const messages = record?.result;
      if (!Array.isArray(messages) || !messages.length) {
        summary.conversationsNeedingReview++;
        continue;
      }
      let hasRecent = false;
      let hasUnknown = false;
      for (const msg of messages) {
        const status = classifyRedisMessage(msg, now);
        if (status === "past-target") summary.oldMessages++;
        else if (status === "within-target") { summary.recentMessages++; hasRecent = true; }
        else { summary.messagesNeedingReview++; hasUnknown = true; }
      }
      if (hasUnknown) summary.conversationsNeedingReview++;
      else if (hasRecent) summary.activeOrRecentConversations++;
      else summary.fullyPastTargetConversations++;
    }
  }
  return summary;
}
