import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function verifyMetaSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== "string" ||
      !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

// Vercel's Node helpers restore the raw request via data/end events. Do not
// use JSON.stringify(req.body), or an async iterator over the consumed stream.
export async function readRawBody(req) {
  let bytes;
  if (Buffer.isBuffer(req.rawBody)) bytes = req.rawBody;
  else if (typeof req.on === "function") {
    bytes = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", chunk => {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        } else chunks.push(buffer);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => reject(new Error("Request body unavailable")));
      req.on("aborted", () => reject(new Error("Request body unavailable")));
    });
  } else if (Buffer.isBuffer(req.body)) bytes = req.body;
  else throw new Error("Original request bytes unavailable");
  if (bytes.length > MAX_BODY_BYTES) throw Object.assign(new Error("Payload too large"), { status: 413 });
  return bytes;
}

export async function authenticateMetaRequest(req, res) {
  if (!process.env.META_APP_SECRET) {
    res.status(503).send("Webhook authentication not configured");
    return false;
  }
  const signature = req.headers?.["x-hub-signature-256"];
  if (typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) {
    res.status(401).send("Invalid webhook signature");
    return false;
  }
  let raw;
  try { raw = await readRawBody(req); }
  catch (err) {
    res.status(err.status || 400).send("Invalid request body");
    return false;
  }
  if (!verifyMetaSignature(raw, signature, process.env.META_APP_SECRET)) {
    res.status(401).send("Invalid webhook signature");
    return false;
  }
  try {
    req.body = JSON.parse(raw.toString("utf8"));
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new Error();
  } catch {
    res.status(400).send("Invalid JSON");
    return false;
  }
  return true;
}
