/**
 * Security-safe storage error classification. No exception message, provider response,
 * credential, endpoint or customer record is ever echoed to users or logs.
 */
export function storageErrorCategory(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/Upstash error (401|403)\b/.test(message)) return "redis_auth";
  if (/Upstash error 429\b/.test(message)) return "redis_rate_limited";
  if (/Upstash error 5\d\d\b/.test(message)) return "redis_upstream";
  if (/UPSTASH_REDIS_REST_(URL|TOKEN) not set/.test(message)) return "redis_config_missing";
  if (/Redis command failed/.test(message)) return "redis_command_failure";
  if (/fetch failed|abort|timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test(message)) return "redis_network";
  return "storage_unknown";
}
