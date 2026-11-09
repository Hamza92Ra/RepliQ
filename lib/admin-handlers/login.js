import { denyAdminAuth } from "../admin-errors.js";
import { signAdminToken, verifyAdminToken, extractAdminToken } from "../admin-auth.js";

export default async function handler(req, res) {
  const adminSecret = process.env.DASHBOARD_SECRET || process.env.ADMIN_PASSWORD;
  if (!adminSecret) {
    return denyAdminAuth(res);
  }

  // GET: Verify existing session
  if (req.method === "GET") {
    const token = extractAdminToken(req);
    const valid = verifyAdminToken(token);
    if (!valid) {
      return res.status(401).json({ authenticated: false });
    }
    return res.status(200).json({ authenticated: true });
  }

  // POST: Login with password
  if (req.method === "POST") {
    const { password } = req.body || {};

    if (!password || password !== adminSecret) {
      return res.status(401).json({ error: "Mot de passe administrateur incorrect." });
    }

    const token = signAdminToken({ role: "admin" });

    // Set secure cookie for browser sessions
    const isProduction = process.env.NODE_ENV === "production";
    const cookieFlags = [
      `admin_token=${encodeURIComponent(token)}`,
      "Path=/",
      "Max-Age=604800", // 7 days
      "SameSite=Lax",
      isProduction ? "Secure" : "",
    ].filter(Boolean).join("; ");

    res.setHeader("Set-Cookie", cookieFlags);

    return res.status(200).json({
      ok: true,
      token,
    });
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
