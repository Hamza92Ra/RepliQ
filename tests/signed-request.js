import { createHmac } from "node:crypto";
export function signedRequest(req) {
  process.env.META_APP_SECRET = "fixture-meta-secret";
  const rawBody = Buffer.from(JSON.stringify(req.body));
  return { ...req, rawBody, headers: { ...req.headers,
    "x-hub-signature-256": "sha256=" + createHmac("sha256", process.env.META_APP_SECRET).update(rawBody).digest("hex") } };
}
