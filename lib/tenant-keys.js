// Pure Phase 1B key design. Intentionally unused by production readers/writers.
// A complete storage + authorization migration is required before adoption.
function segment(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Key scope required");
  return encodeURIComponent(value.trim());
}
export function tenantKey(businessPhoneNumberId, kind, ...identifiers) {
  return `rq:v2:{${segment(businessPhoneNumberId)}}:${[kind, ...identifiers].map(segment).join(":")}`;
}
