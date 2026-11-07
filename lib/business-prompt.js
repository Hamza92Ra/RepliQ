// Feature OFF by default. Only trusted server environment can request activation.
// A review reference is an operator attestation, NOT automatic proof of ownership.
import { getBusinessConfig, redisPipeline, normalizeId } from "./db.js";
import { resolveWhatsAppCredentials } from "./whatsapp-credentials.js";
import { buildUsSalesPrompt, US_SALES_PROMPT_VERSION } from "./us-sales-prompt.js";

function requested() {
  const value = process.env.REPLIQ_US_DEMO_SALES_ENABLED;
  return value !== undefined && value !== "" && value !== "false";
}
function blocked() { return new Error("US demo sales activation or ownership verification unavailable"); }

function verifiedBinding(phoneNumberId, authenticatedPhoneNumberId) {
  if (process.env.REPLIQ_US_DEMO_SALES_ENABLED !== "true") throw blocked();
  let binding;
  try { binding = JSON.parse(process.env.REPLIQ_US_DEMO_SALES_BINDING || "null"); }
  catch { throw blocked(); }
  if (!binding || binding.purpose !== "repliq-us-demo-sales" || binding.promptVersion !== US_SALES_PROMPT_VERSION ||
      typeof binding.phoneNumberId !== "string" || !/^[1-9]\d{0,31}$/.test(binding.phoneNumberId) ||
      ![binding.ownershipReview, binding.isolationReview].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 200) ||
      binding.storageMode !== "isolated-redis-only") throw blocked();
  // Neither a configured default nor a browser/admin identifier substitutes for
  // metadata.phone_number_id taken AFTER successful Meta raw-body authentication.
  if (typeof authenticatedPhoneNumberId !== "string" || authenticatedPhoneNumberId !== binding.phoneNumberId || phoneNumberId !== binding.phoneNumberId) throw blocked();
  const credentials = resolveWhatsAppCredentials(authenticatedPhoneNumberId, { requireToken: false });
  if (credentials.phoneNumberId !== binding.phoneNumberId) throw blocked();
  // Existing Supabase histories have no tenant scope. Do not reuse them for an
  // enabled demo. A coordinated storage rollout needs a separate approval.
  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) throw blocked();
  return binding;
}

// Run BEFORE dedup/takeover/history/voice/persistence so legacy writers cannot
// overwrite a foreign owner before the check. No default-owner or alias fallback.
// This guard does not replace storage isolation or implement multi-tenancy.
export async function assertDemoInboundScope({ phoneNumberId, authenticatedPhoneNumberId, identity }) {
  if (!requested()) return;
  verifiedBinding(phoneNumberId, authenticatedPhoneNumberId);
  const ids = [...new Set([identity.primaryId, identity.userId, identity.phone].filter(Boolean).map(value => {
    if (typeof value !== "string") throw blocked();
    const id = normalizeId(value);
    if (!/^(?:[1-9]\d{0,31}|[A-Za-z]{2}\.[A-Za-z0-9]{1,128})$/.test(id)) throw blocked();
    return id;
  }))];
  if (!ids.length) throw blocked();
  const commands = ids.flatMap(id => [
    ["GET", `conv:owner:${id}`],
    ["GET", `conv:user_map:${id}`],
    ["EXISTS", `conv:${id}`, `conv:mode:${id}`, `conv:takeover:${id}`, `conv:meta:${id}`, `conv:user_map:${id}`],
  ]);
  const results = await redisPipeline(commands);
  if (results.length !== commands.length) throw blocked();
  ids.forEach((id, index) => {
    const owner = results[index * 3]?.result;
    const mapping = results[index * 3 + 1]?.result;
    const existing = results[index * 3 + 2]?.result;
    if (!Number.isInteger(existing) || existing < 0 || existing > 5 ||
        (owner !== null && owner !== phoneNumberId) || (existing > 0 && owner !== phoneNumberId) ||
        (mapping !== null && (typeof mapping !== "string" || !ids.includes(mapping)))) throw blocked();
  });
}

export async function resolveBusinessPrompt({ phoneNumberId, authenticatedPhoneNumberId }) {
  const enabled = requested();
  if (enabled) verifiedBinding(phoneNumberId, authenticatedPhoneNumberId);
  let config;
  try { config = await getBusinessConfig(phoneNumberId); }
  catch {
    // Preserve legacy fallback while inactive; enabled demo never guesses that a
    // failed configuration lookup means a business-specific prompt is absent.
    console.error("Business prompt configuration unavailable");
    if (enabled) throw blocked();
    return undefined;
  }
  // Preserve the existing prompt/notes exactly, including its precedence.
  if (config?.systemPrompt) {
    let systemPrompt = config.systemPrompt;
    if (config.notes) systemPrompt += `\n\nNotes / idées spécifiques du projet :\n${config.notes}`;
    return systemPrompt;
  }
  if (!enabled) return undefined; // generateReply retains the Moroccan default.
  // Notes-only/malformed configs may still express customer intent; never mask.
  if (config !== null) throw blocked();
  return buildUsSalesPrompt();
}
