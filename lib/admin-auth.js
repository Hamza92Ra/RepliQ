import { denyAdminAuth } from "./admin-errors.js";
import crypto from "node:crypto";

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.DASHBOARD_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error("Missing DASHBOARD_SECRET");
  }
  return secret;
}

/**
 * Generate a cryptographically signed HMAC token for the admin session.
 */
export function signAdminToken(payload = {}) {
  const secret = getSecret();
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const data = {
    role: "admin",
    exp: Date.now() + TOKEN_EXPIRY_MS,
    ...payload,
  };
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

/**
 * Verify a signed admin token.
 */
export function verifyAdminToken(token) {
  if (!token || typeof token !== "string") return false;

  // Direct password match fallback
  if (process.env.ADMIN_PASSWORD && token === process.env.ADMIN_PASSWORD) {
    return { role: "admin" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [header, body, signature] = parts;
  let secret;
  try {
    secret = getSecret();
  } catch {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) {
      return false;
    }
    return payload;
  } catch {
    return false;
  }
}

/**
 * Extract admin token from Authorization header, Cookie, or query param.
 */
export function extractAdminToken(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // 2. Cookie: admin_token=<token>
  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader === "string") {
    const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch { return null; }
    }
  }

  // 3. Query parameter: ?token=<token>
  if (req.query?.token) {
    return req.query.token;
  }

  return null;
}

/**
 * Helper to require authentication for admin endpoints.
 * Returns true if authenticated, false (and sends 401 response) if not.
 */
export function requireAdminAuth(req, res) {
  if (!process.env.DASHBOARD_SECRET && !process.env.ADMIN_PASSWORD && !process.env.ADMIN_JWT_SECRET) {
    denyAdminAuth(res);
    return false;
  }

  const token = extractAdminToken(req);
  if (!token) {
    denyAdminAuth(res);
    return false;
  }

  const user = verifyAdminToken(token);
  if (!user) {
    denyAdminAuth(res);
    return false;
  }

  return true;
}
