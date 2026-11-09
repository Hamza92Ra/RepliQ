/**
 * Retention classification only; no Redis, Supabase, Meta, or live-data access.
 * Exports pure helpers for a 90-day retention rollout.
 * NEVER use a classification result as authorization for deletion.
 */
export const REPLIQ_RETENTION_DAYS = 90;
export const REPLIQ_RETENTION_MS = REPLIQ_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function retentionCutoff(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < REPLIQ_RETENTION_MS) {
    throw new TypeError("A valid millisecond timestamp is required");
  }
  return now - REPLIQ_RETENTION_MS;
}

function normalizedTime(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    // Reject seconds and implausible/far-future times rather than delete by mistake.
    return value >= 1e12 && value < 1e15 ? value : null;
  }
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Classify a single record based on a supported timestamp.
 * Strictly older than the cutoff is eligible for REVIEW (not auto-deletion).
 * Unknown and future timestamps are quarantined for manual investigation.
 */
export function classifyRetentionTimestamp(value, now = Date.now()) {
  const cutoff = retentionCutoff(now);
  const timestamp = normalizedTime(value);
  if (timestamp === null || timestamp > now) return "review";
  return timestamp < cutoff ? "past-target" : "within-target";
}

export function classifyRedisMessage(raw, now = Date.now()) {
  try {
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "review";
    return classifyRetentionTimestamp(entry.ts, now);
  } catch {
    return "review";
  }
}

export function classifySupabaseMessage(record, now = Date.now()) {
  if (!record || typeof record !== "object") return "review";
  return classifyRetentionTimestamp(record.created_at, now);
}

export function retentionReport(messages, classifier, now = Date.now()) {
  if (!Array.isArray(messages) || typeof classifier !== "function") throw new TypeError("Expected messages and classifier");
  const summary = { total: messages.length, pastTarget: 0, withinTarget: 0, needsReview: 0 };
  for (const message of messages) {
    const label = classifier(message, now);
    if (label === "past-target") summary.pastTarget++;
    else if (label === "within-target") summary.withinTarget++;
    else summary.needsReview++;
  }
  return summary; // Counts only; never emit PII, record IDs, or message contents.
}
