import { denyAdminAuth } from "../admin-errors.js";
import handleAdminAction from "../legacy-admin-action.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  if (!process.env.DASHBOARD_SECRET || req.query?.key !== process.env.DASHBOARD_SECRET) return denyAdminAuth(res);
  if (!req.body || req.body.entry || req.body.object) return res.status(400).json({ error: "Admin actions only" });
  return handleAdminAction(req, res);
}
