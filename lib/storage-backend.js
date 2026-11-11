/**
 * Storage migration cutover switch.
 *
 * Production remains in compatibility mode until operators deliberately set
 * REPLIQ_STORAGE_BACKEND=supabase after a data reconciliation and smoke test.
 * Do not infer readiness from the presence of Supabase credentials alone.
 */
export function supabasePrimaryEnabled(env = process.env) {
  return env.REPLIQ_STORAGE_BACKEND === "supabase";
}

export function shouldUseRedisMirror(env = process.env) {
  return !supabasePrimaryEnabled(env) &&
    Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}
