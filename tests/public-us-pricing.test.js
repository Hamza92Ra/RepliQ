import { leadEval } from "./lead-service-fixtures.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { PUBLIC_OFFER, PRICE_SUMMARY, PLAN_LIMITS, LIMITS_NOTICE } from "../public-offer.js";
import { buildLeadRequest, receiptRows, normalizePublicPhone, downloadRequestPdf, initSignup } from "../signup.js";
import lead from "../api/lead.js";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const form = readFileSync(new URL("../formulaire.html", import.meta.url), "utf8");
const values = { fullname: "Guest Fixture", business: "Charter Fixture", activity: "Yacht charter", phone: "+1 305 555 0123", email: "fixture@example.invalid", message: "Demo inquiry", volume: "150", acceptedTerms: true };
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

describe("Public US charter offer", () => {
  it("presents one English USD plan consistently on landing and form", () => {
    assert.deepEqual({ name: PUBLIC_OFFER.name, currency: PUBLIC_OFFER.currency, monthly: PUBLIC_OFFER.monthly, setup: PUBLIC_OFFER.setup }, { name: "RepliQ Pro", currency: "USD", monthly: 99, setup: 99 });
    for (const html of [landing, form]) {
      assert.match(html, /<html lang="en">/); assert.match(html, /\$99.*\/month/);
      assert.match(html, /\$99 one-time setup fee/); assert.match(html, /English.*Spanish.*French/s);
      assert.match(html, /data-choose-market="ma"/);
      const usSalesContent = html.replace(/<div class="market-switch-bar"[\s\S]*?<\/div>/, "");
      assert.doesNotMatch(usSalesContent, /\bMAD\b|Essentielle|Standard|Premium|mois offerts|loyalty|annual payment/i);
      assert.match(html, /1,000 outbound replies per billing period/); assert.match(html, /12 AI replies per customer per rolling 24 hours/);
      assert.match(html, /Usage caps are not enforced yet/);
    }
    assert.equal((landing.match(/class="price-card featured"/g) || []).length, 1);
    assert.equal((form.match(/<option value="RepliQ Pro">/g) || []).length, 1);
  });
  it("targets actual charter inquiries without inventing booking/payment integration", () => {
    for (const term of ["yacht", "boat", "South Florida", "Puerto Rico", "Miami", "Fort Lauderdale", "San Juan"]) assert.ok(landing.includes(term), term);
    assert.match(landing, /Your team confirms availability/);
    assert.match(landing, /no calendar reservation/i); assert.match(landing, /No online checkout/);
    assert.doesNotMatch(landing, /calendly\.com|checkout\.stripe|pay\.paypal/);
  });
  it("routes every primary CTA to the existing form with the correct intent", () => {
    const anchors = [...landing.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)];
    let count = 0;
    for (const [, href, label] of anchors) {
      if (!/Book a Demo|Get Started/.test(label)) continue;
      const url = new URL(href.replaceAll("&amp;", "&"), "https://fixture.invalid/");
      assert.equal(url.pathname, "/formulaire.html"); assert.equal(url.searchParams.get("offer"), "RepliQ Pro");
      assert.equal(url.searchParams.get("intent"), label.includes("Demo") ? "demo" : "setup");
      assert.ok(existsSync(new URL("../formulaire.html", import.meta.url))); count++;
    }
    assert.ok(count >= 5);
    for (const [, href] of anchors) if (href.startsWith("#")) assert.ok(landing.includes(`id="${href.slice(1)}"`), href);
  });
  it("ignores old offer/annual query parameters and browser-supplied prices", () => {
    const request = buildLeadRequest({ ...values, price: "$1", monthly: 1 }, "?offer=Premium&billing=annual&intent=demo", "fixture-ref");
    assert.equal(request.offer, "RepliQ Pro"); assert.equal(request.mode, "monthly"); assert.equal(request.price, PRICE_SUMMARY);
    assert.equal(request.monthly, 99); assert.equal(request.setup, 99); assert.equal(request.annual, null); assert.equal(request.intent, "demo");
    assert.equal(buildLeadRequest(values, "?intent=unknown").intent, "setup");
  });
  it("requires consent and international numbers including Puerto Rico", () => {
    assert.equal(normalizePublicPhone("+1 (305) 555-0123"), "+13055550123");
    assert.equal(normalizePublicPhone("+1 787 555 0123"), "+17875550123");
    assert.equal(normalizePublicPhone("+33 6 12 34 56 78"), "+33612345678");
    for (const phone of ["3055550123", "+000", "+1abc3055550123", ""]) assert.throws(() => normalizePublicPhone(phone));
    assert.throws(() => buildLeadRequest({ ...values, acceptedTerms: false }), /agree to be contacted/);
  });
  it("keeps intended quotas explicitly inactive and out of receipt billing", () => {
    assert.equal(PUBLIC_OFFER.limitsEnforced, false); assert.equal(PUBLIC_OFFER.outboundRepliesPerBillingPeriod, 1000);
    assert.equal(PUBLIC_OFFER.aiRepliesPerCustomerPerRolling24Hours, 12);
    const rows = receiptRows(buildLeadRequest(values));
    assert.ok(rows.some(([, value]) => value === PLAN_LIMITS)); assert.ok(rows.some(([, value]) => value === LIMITS_NOTICE));
    assert.match(rows.at(-1)[1], /no payment or booking confirmed/);
    assert.doesNotMatch(JSON.stringify(rows), /MAD|annual|free months|12-month commitment/i);
  });
  it("retains PDF request summaries with wrapping and pagination", () => {
    const calls = [];
    class Pdf {
      internal = { pageSize: { getWidth: () => 595, getHeight: () => 250 } };
      setFillColor() {} rect() {} setTextColor() {} setFont() {} setFontSize() {}
      text(value) { calls.push(value); } splitTextToSize(value) { return [value]; }
      addPage() { calls.push("page"); } save(name) { calls.push(name); }
    }
    downloadRequestPdf({ ref: "fixture", today: "11/7/2026", rows: receiptRows(buildLeadRequest(values)) }, { jsPDF: Pdf });
    assert.ok(calls.includes("page")); assert.ok(calls.includes("repliq-request-fixture.pdf"));
    assert.ok(calls.some(value => typeof value === "string" && value.includes("not an invoice")));
  });
  it("does not show a received summary when the lead API fails", async () => {
    const nodes = new Map();
    function node() {
      return { value: "", textContent: "", hidden: false, checked: false, disabled: false, events: {}, children: [], classes: new Set(),
        classList: { add() { assert.fail("must not show a successful summary"); } },
        replaceChildren() { this.children = []; }, addEventListener(name, fn) { this.events[name] = fn; }, appendChild(child) { this.children.push(child); } };
    }
    const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node };
    for (const [id, value] of Object.entries(values)) {
      const element = document.getElementById(id === "acceptedTerms" ? "terms" : id);
      if (typeof value === "boolean") element.checked = value; else element.value = value;
    }
    const window = { location: { search: "?intent=demo" }, crypto: { randomUUID: () => "fixture" }, scrollTo() { assert.fail(); } };
    let sent;
    initSignup(document, window, async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { ok: false, json: async () => ({ error: "fixture failure" }) }; });
    await nodes.get("signupForm").events.submit({ preventDefault() {} });
    assert.equal(sent.url, "/api/lead"); assert.equal(sent.body.intent, "demo"); assert.equal(nodes.get("formError").hidden, false);
    assert.match(nodes.get("formError").textContent, /couldn't confirm/); assert.equal(nodes.get("submitRequest").disabled, false);
  });
});

describe("New-offer lead handling preserves legacy behavior", () => {
  let env, originalFetch, calls, commands, failure, store, expires;
  beforeEach(() => {
    env = { ...process.env }; originalFetch = globalThis.fetch; calls = []; commands = []; failure = null; store = new Map(); expires = new Map();
    process.env = { WHATSAPP_PHONE_NUMBER_ID: "1001", DEFAULT_PHONE_NUMBER_ID: "1001", WHATSAPP_TOKEN: "fixture", UPSTASH_REDIS_REST_URL: "https://fixture.upstash.test", UPSTASH_REDIS_REST_TOKEN: "fixture", RESEND_API_KEY: "fixture", NOTIFY_EMAIL_TO: "fixture@example.invalid" };
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/pipeline")) {
        const batch = JSON.parse(options.body); commands.push(...batch);
        if (failure === "redis") throw new Error("fixture failure");
        return Response.json(batch.map(([command,key,...args]) => {
          if(command==='EVAL') return {result:leadEval([command,key,...args],store,expires)};
          if(command==='GET') return {result:store.get(key) ?? null};
          if(command==='LLEN') return {result:(store.get(key)||[]).length};
          if(command==='EXISTS') return {result:[key,...args].filter(key=>store.has(key)).length};
          if(command==='SET') store.set(key,args[0]);
          if(command==='RPUSH') store.set(key,[...(store.get(key)||[]),...args]);
          return {result:'OK'};
        }));
      }
      if (String(url).includes("graph.facebook.com")) {
        if (failure === "meta") return Response.json({ error: { message: "fixture failure" } }, { status: 502 });
        return Response.json({ messages: [{ id: "accepted-fixture" }] });
      }
      if (String(url) === "https://api.resend.com/emails") return Response.json({ id: "fixture" });
      throw new Error("Unexpected external service");
    };
  });
  afterEach(() => { process.env = env; globalThis.fetch = originalFetch; });
  it("uses canonical US pricing and copy in storage, acknowledgements and notifications", async () => {
    const request = { ...buildLeadRequest(values, "?intent=demo", "fixture"), price: "$1", mode: "annual" };
    const result = response(); await lead({ method: "POST", body: request }, result);
    assert.equal(result.statusCode, 200); assert.equal(result.body.ok, true);
    const stored = commands.filter(([cmd]) => cmd === "RPUSH").map(([, , value]) => JSON.parse(value));
    assert.match(stored[0].content, /Demo request/); assert.ok(stored[0].content.includes(PRICE_SUMMARY));
    assert.match(stored[0].content, /no subscription activated/); assert.doesNotMatch(stored[0].content, /engagement 12 mois|\$1\b/);
    const meta = calls.find(call => call.url.includes("graph.facebook.com")); const outbound = JSON.parse(meta.options.body);
    assert.match(meta.url, /1001\/messages$/); assert.equal(outbound.to, "13055550123");
    assert.ok(outbound.text.body.includes(PRICE_SUMMARY)); assert.ok(outbound.text.body.includes(LIMITS_NOTICE));
    assert.doesNotMatch(outbound.text.body, /MAD|Essentielle|félicitations/i);
    const mail = JSON.parse(calls.find(call => call.url.includes("resend.com")).options.body);
    assert.ok(mail.text.includes(PRICE_SUMMARY));
    assert.equal(commands.some(([, key]) => /quota|usage|business:|rq:v2/.test(key)), false);
  });
  it("leaves the old offer, local-number normalization and acknowledgement unchanged", async () => {
    const result = response(); await lead({ method: "POST", body: { fullname: "Fixture", business: "Legacy fixture", phone: "0612345678", offer: "Standard", mode: "monthly", price: "Legacy price" } }, result);
    assert.equal(result.statusCode, 200);
    const outbound = JSON.parse(calls.find(call => call.url.includes("graph.facebook.com")).options.body);
    assert.equal(outbound.to, "212612345678"); assert.match(outbound.text.body, /Félicitations/);
    assert.match(outbound.text.body, /Site web qui présente votre business/); assert.doesNotMatch(outbound.text.body, /RepliQ Pro|\$99/);
  });
  it("rejects new-offer missing consent and bad international numbers before service calls", async () => {
    for (const override of [{ acceptedTerms: false }, { phone: "3055550123" }]) {
      const result = response(); await lead({ method: "POST", body: { ...buildLeadRequest(values), ...override } }, result);
      assert.equal(result.statusCode, 400);
    }
    assert.equal(calls.length, 0);
  });
  it("keeps saved lead success when optional WhatsApp acknowledgement fails", async () => {
    failure = "meta";
    const result = response(); await lead({ method: "POST", body: buildLeadRequest(values) }, result);
    assert.equal(result.statusCode, 200); assert.equal(result.body.ok, true); assert.ok(result.body.whatsapp_error);
    assert.equal(commands.filter(([cmd]) => cmd === "RPUSH").length, 1);
  });
  it("returns an error before sending when the lead cannot be persisted", async () => {
    failure = "redis";
    const result = response(); await lead({ method: "POST", body: buildLeadRequest(values) }, result);
    assert.equal(result.statusCode, 503); assert.equal(calls.some(call => call.url.includes("graph.facebook.com")), false);
  });
});
