import { PUBLIC_OFFER, PRICE_SUMMARY, PLAN_LIMITS, LIMITS_NOTICE, PRO_FEATURES } from "./public-offer.js";

export function normalizePublicPhone(value) {
  const raw = String(value || "").trim();
  if (!/^\+[0-9\s().-]+$/.test(raw)) throw new Error("Please include + and your country code, e.g. +1 305 555 0123.");
  const digits = raw.replace(/\D/g, "");
  if (!/^[1-9]\d{6,14}$/.test(digits)) throw new Error("Please enter a valid international WhatsApp number.");
  return `+${digits}`;
}
export function buildLeadRequest(values, search = "", reference = "") {
  const intent = new URLSearchParams(search).get("intent") === "demo" ? "demo" : "setup";
  if (!values.acceptedTerms) throw new Error("Please agree to be contacted about your request.");
  return {
    fullname: values.fullname.trim(), business: values.business.trim(), activity: values.activity,
    phone: normalizePublicPhone(values.phone), email: values.email.trim(),
    offer: PUBLIC_OFFER.name, mode: "monthly", price: PRICE_SUMMARY,
    setup: PUBLIC_OFFER.setup, monthly: PUBLIC_OFFER.monthly, annual: null,
    message: values.message.trim(), volume: values.volume, acceptedTerms: true, ref: reference, intent, website: String(values.website || ""),
  };
}
export function receiptRows(request) {
  return [
    ["Business", request.business], ["Request", request.intent === "demo" ? "Demo request" : "Setup inquiry"],
    ["Plan", PUBLIC_OFFER.name], ["Monthly subscription", "$99/month (USD)"],
    ["One-time setup", "$99 (USD)"], ["Languages", PUBLIC_OFFER.languages.join(", ")],
    ["Intended allowance", PLAN_LIMITS], ["Usage policy", LIMITS_NOTICE],
    ["Phone", request.phone], ["Email", request.email],
    ["Status", "Request received; no payment or booking confirmed"],
  ];
}
export function downloadRequestPdf(receipt, jspdf) {
  if (!receipt || !jspdf) return;
  const doc = new jspdf.jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth(); const height = doc.internal.pageSize.getHeight();
  const margin = 50; const valueX = 220; const lineHeight = 14;
  doc.setFillColor(17, 19, 24); doc.rect(0, 0, width, 96, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("RepliQ Pro", margin, 42);
  doc.setFontSize(11); doc.text("Request summary - not an invoice or confirmed booking", margin, 65);
  doc.setTextColor(17, 19, 24); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`${receipt.ref} - ${receipt.today}`, margin, 125);
  let y = 155;
  for (const [label, value] of receipt.rows) {
    doc.setFont("helvetica", "normal");
    const labels = doc.splitTextToSize(label, valueX - margin - 20);
    doc.setFont("helvetica", "bold");
    const lines = doc.splitTextToSize(String(value), width - valueX - margin);
    const needed = Math.max(labels.length, lines.length) * lineHeight + 18;
    if (y + needed > height - 50) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "normal"); doc.text(labels, margin, y);
    doc.setFont("helvetica", "bold"); doc.text(lines, valueX, y);
    y += needed;
  }
  doc.save(`repliq-request-${receipt.ref}.pdf`);
}
export function initSignup(document, window, send = window.fetch.bind(window)) {
  const get = id => document.getElementById(id);
  const demo = new URLSearchParams(window.location.search).get("intent") === "demo";
  if (demo) {
    get("requestHeading").textContent = "Book a Demo of RepliQ Pro.";
    get("requestIntro").textContent = "Tell us about your charter business. Our team will contact you to arrange a walkthrough; this is not an instant calendar reservation.";
  }
  get("submitRequest").textContent = demo ? "Request a Demo" : "Get Started";
  get("summaryFeatures").replaceChildren();
  for (const feature of PRO_FEATURES) {
    const item = document.createElement("li"); item.textContent = feature; get("summaryFeatures").appendChild(item);
  }
  let receipt = null;
  get("downloadReceipt").addEventListener("click", () => downloadRequestPdf(receipt, window.jspdf));
  get("signupForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (get("submitRequest").disabled) return;
    get("formError").hidden = true;
    try {
      const values = Object.fromEntries(["fullname", "business", "activity", "phone", "email", "message", "volume"].map(id => [id, get(id).value]));
      values.acceptedTerms = get("terms").checked;
      values.website = get("website")?.value || "";
      const reference = `RPLQ-${window.crypto.randomUUID()}`;
      const request = buildLeadRequest(values, window.location.search, reference);
      get("submitRequest").disabled = true;
      const response = await send("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("We couldn't confirm your request. Please try again or contact us on WhatsApp.");
      const confirmedReference = result.reference || reference;
      const rows = receiptRows(request);
      receipt = { ref: confirmedReference, today: new Date().toLocaleDateString("en-US"), rows };
      get("receiptTitle").textContent = `Thanks ${request.fullname.split(" ")[0]}, your request is received.`;
      get("receiptRef").textContent = confirmedReference;
      get("receiptTable").replaceChildren();
      for (const [label, value] of rows) {
        const row = document.createElement("div"); row.className = "receipt-row";
        const key = document.createElement("span"); key.className = "k"; key.textContent = label;
        const text = document.createElement("span"); text.className = "v"; text.textContent = value;
        row.append(key, text); get("receiptTable").appendChild(row);
      }
      const followUp = encodeURIComponent(`Hi RepliQ, I submitted a ${demo ? "demo request" : "setup inquiry"} for RepliQ Pro. Reference: ${confirmedReference}.`);
      get("waFollowUp").href = `https://wa.me/212712614398?text=${followUp}`;
      get("formLayout").classList.add("hidden"); get("receiptWrap").classList.add("show");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      get("formError").textContent = error.message.includes("country code") || error.message.includes("international WhatsApp") || error.message.includes("agree to be contacted")
        ? error.message : "We couldn't confirm your request. Please try again or contact us on WhatsApp.";
      get("formError").hidden = false;
    } finally { get("submitRequest").disabled = false; }
  });
}
if (typeof document !== "undefined") initSignup(document, window);
