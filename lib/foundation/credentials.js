// INACTIVE: external secret-manager boundary, with no global-token fallback.
// No credential provisioning/rotation or Meta requests are performed here.
import { assertAccess } from "./authorization.js";

export async function withOwnedCredentials(context, { loadCredentialVersion, readSecret }, operation) {
  assertAccess(context, "send");
  const version = await loadCredentialVersion(context.businessId, context.numberId);
  if (!version || version.business_id !== context.businessId || version.whatsapp_number_id !== context.numberId ||
      version.phone_number_id !== context.phoneNumberId || version.waba_id !== context.wabaId ||
      version.status !== "active" || !Number.isSafeInteger(version.version) || version.version < 1 ||
      typeof version.secret_ref !== "string" || !version.secret_ref) throw new Error("Credential unavailable");
  // Provider must resolve an exact immutable secret VERSION, not a mutable alias.
  const secret = await readSecret(version.secret_ref, version.version);
  assertAccess(context, "send"); // session could expire while consulting the vault
  if (typeof secret !== "string" || !secret) throw new Error("Credential unavailable");
  // Callbacks must remain server-side; never return tokens from HTTP handlers.
  return operation({ token: secret, phoneNumberId: context.phoneNumberId, wabaId: context.wabaId });
}
