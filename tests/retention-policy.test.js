import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPLIQ_RETENTION_DAYS, REPLIQ_RETENTION_MS, retentionCutoff,
  classifyRetentionTimestamp, classifyRedisMessage, classifySupabaseMessage, retentionReport,
} from "../lib/retention-policy.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9);
test("90-day cutoff and exact boundary without accidental deletion", () => {
  assert.equal(REPLIQ_RETENTION_DAYS, 90);
  assert.equal(REPLIQ_RETENTION_MS, 90 * DAY);
  assert.equal(retentionCutoff(NOW), NOW - 90 * DAY);
  assert.equal(classifyRetentionTimestamp(NOW - 91 * DAY, NOW), "past-target");
  assert.equal(classifyRetentionTimestamp(NOW - 90 * DAY, NOW), "within-target");
  assert.equal(classifyRetentionTimestamp(NOW - 1 * DAY, NOW), "within-target");
});
test("untrusted, missing, epoch-seconds and future timestamps always require review", () => {
  for (const ts of [null, undefined, "", "invalid", -42, 0, 1762660800, NOW + DAY, 1e15, {}, []]) {
    assert.equal(classifyRetentionTimestamp(ts, NOW), "review", String(ts));
  }
  assert.throws(() => retentionCutoff(NaN), TypeError);
});
test("classify Redis data and Supabase data without exposing values", () => {
  const old = NOW - 91 * DAY;
  assert.equal(classifyRedisMessage(JSON.stringify({ ts: old, content: "private" }), NOW), "past-target");
  assert.equal(classifyRedisMessage("not json", NOW), "review");
  assert.equal(classifyRedisMessage(JSON.stringify({ content: "private" }), NOW), "review");
  assert.equal(classifySupabaseMessage({ created_at: new Date(old).toISOString(), body: "private" }, NOW), "past-target");
  assert.equal(classifySupabaseMessage({ created_at: "invalid" }, NOW), "review");
});
test("reports counts only, including quarantined uncertain records", () => {
  const report = retentionReport(
    [{ ts: NOW - 91 * DAY, content: "secret" }, { ts: NOW }, { ts: "bad" }],
    classifyRedisMessage, NOW
  );
  assert.deepEqual(report, { total: 3, pastTarget: 1, withinTarget: 1, needsReview: 1 });
  assert.equal(JSON.stringify(report).includes("secret"), false);
});
