// Public errors must not disclose configuration names, values or provider text.
export function denyAdminAuth(res) {
  return res.status(401).json({ error: "Unauthorized" });
}
export function adminUnavailable(res) {
  return res.status(503).json({ error: "Service unavailable" });
}
export function adminFailure(res) {
  return res.status(500).json({ error: "Internal server error" });
}
