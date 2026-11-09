// Non-identifying region hint based only on Vercel's country header.
// No IP is persisted. This endpoint does not choose plans or prices server-side.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  const country = process.env.VERCEL === "1" ? String(req.headers?.["x-vercel-ip-country"] || "").toUpperCase() : "";
  return res.status(200).json({ market: country === "MA" ? "ma" : "us" });
}
