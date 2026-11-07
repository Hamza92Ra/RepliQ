import handleAdminAction from "../../lib/legacy-admin-action.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  if (!req.body || req.body.entry || req.body.object) return res.status(400).json({ error: "Admin actions only" });
  return handleAdminAction(req, res);
}
