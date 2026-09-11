import { getBusinessConfig, saveBusinessConfig } from "../lib/db.js";

// Per-business configuration so ONE deployment adapts to ANY project/idea:
// each WhatsApp phone_number_id can have its own system prompt + notes.
//   GET  /api/business-config?key=DASHBOARD_SECRET&phoneNumberId=XXX
//   POST /api/business-config?key=DASHBOARD_SECRET
//        body: { phoneNumberId, businessName, systemPrompt, notes }
//
// Auth uses the same DASHBOARD_SECRET as /api/dashboard.

function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

export default async function handler(req, res) {
  const key = req.query.key || req.headers["x-dashboard-key"];
  if (!process.env.DASHBOARD_SECRET || key !== process.env.DASHBOARD_SECRET) {
    return unauthorized(res);
  }

  try {
    if (req.method === "GET") {
      const { phoneNumberId } = req.query;
      if (!phoneNumberId) {
        return res.status(400).json({ error: "Missing 'phoneNumberId' query param" });
      }
      const config = await getBusinessConfig(phoneNumberId);
      return res.status(200).json({ config });
    }

    if (req.method === "POST") {
      const { phoneNumberId, businessName, systemPrompt, notes } = req.body || {};
      if (!phoneNumberId || !systemPrompt?.trim()) {
        return res
          .status(400)
          .json({ error: "Missing 'phoneNumberId' or 'systemPrompt'" });
      }
      const config = {
        businessName: businessName || "",
        systemPrompt: systemPrompt.trim(),
        notes: (notes || "").trim(),
        updatedAt: Date.now(),
      };
      await saveBusinessConfig(phoneNumberId, config);
      return res.status(200).json({ ok: true, config });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("Business config error:", err);
    return res.status(500).json({ error: "Business config failed" });
  }
}