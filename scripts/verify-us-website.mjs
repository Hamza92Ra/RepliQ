// Optional local browser regression. External Playwright/jsPDF tools live outside
// the project. All remote requests and lead submissions are intercepted.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
if (!process.argv[2]) throw new Error("Usage: node scripts/verify-us-website.mjs <external tools directory>");
const tools = createRequire(join(resolve(process.argv[2]), "browser-check.cjs"));
const { chromium } = tools("playwright");
const pdfLibrary = await readFile(join(dirname(tools.resolve("jspdf/package.json")), "dist/jspdf.umd.min.js"));
const root = fileURLToPath(new URL("../", import.meta.url));
const files = new Set(["index.html", "formulaire.html", "styles.css", "signup.js", "marketing.js", "public-offer.js", "privacy.html"]);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (req.method !== "GET" || !files.has(name)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": `${types[extname(name)]}; charset=utf-8` }); res.end(await readFile(join(root, name)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const artifacts = "/tmp/repliq-us-website-review"; await mkdir(artifacts, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce", acceptDownloads: true });
  const submissions = []; let failLead = false;
  await context.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname === "/api/lead") {
        assert.equal(request.method(), "POST"); submissions.push(request.postDataJSON());
        return route.fulfill({ status: failLead ? 500 : 200, contentType: "application/json", body: JSON.stringify(failLead ? { error: "synthetic failure" } : { ok: true }) });
      }
      return route.continue();
    }
    if (url.href.includes("jspdf.umd.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: pdfLibrary });
    return route.fulfill({ status: 204, body: "" });
  });
  const errors = [];
  for (const [label, viewport, intent] of [["desktop", { width: 1440, height: 1000 }, "demo"], ["mobile", { width: 390, height: 844 }, "setup"]]) {
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); await page.setViewportSize(viewport);
    await page.goto(origin); await page.addStyleTag({ content: "* { animation-delay: 0s !important; transition-delay: 0s !important; }" });
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator(".price-card").count(), 1);
    assert.ok(await page.locator(".phone-stage .bubble").evaluateAll(bubbles => bubbles.every(bubble => getComputedStyle(bubble).opacity === "1")), "Reduced-motion phone demo must remain visible");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} landing overflows`);
    assert.ok(await page.locator(".phone-stage .chat-area").evaluate(chat => chat.scrollHeight <= chat.clientHeight), "Phone demo must not clip replies");
    if (label === "mobile") {
      const cta = await page.locator(".hero .btn-primary").boundingBox();
      assert.ok(cta.y + cta.height < viewport.height - 64, "Mobile demo CTA must be above the bottom navigation");
    }
    await page.screenshot({ path: `${artifacts}/${label}-hero.png` });
    await page.locator("#tarifs").screenshot({ path: `${artifacts}/${label}-pricing.png` });
    const faq = page.locator(".faq-q"); await faq.nth(0).click(); assert.equal(await faq.nth(0).getAttribute("aria-expanded"), "true");
    await faq.nth(1).click(); assert.equal(await faq.nth(0).getAttribute("aria-expanded"), "false");
    await page.locator(`a[href*="intent=${intent}"]`).first().click();
    await page.waitForFunction(() => document.getElementById("summaryFeatures").children.length === 4);
    assert.ok(page.url().includes("formulaire.html"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} form overflows`);
    await page.screenshot({ path: `${artifacts}/${label}-form.png`, fullPage: true });
    await page.locator("#fullname").fill("Alex Fixture"); await page.locator("#business").fill('<img src=x onerror="window.fixtureXss=1">');
    await page.locator("#activity").selectOption({ label: "Yacht charter" }); await page.locator("#phone").fill("+1 787 555 0123");
    await page.locator("#email").fill("fixture@example.invalid"); await page.locator("#terms").check();
    await page.locator("#submitRequest").click(); await page.locator("#receiptWrap").waitFor({ state: "visible" });
    const sent = submissions.at(-1); assert.equal(sent.offer, "RepliQ Pro"); assert.equal(sent.intent, intent);
    assert.equal(sent.monthly, 99); assert.equal(sent.setup, 99); assert.equal(sent.mode, "monthly"); assert.equal(sent.phone, "+17875550123");
    assert.equal(await page.locator("#receiptTable img").count(), 0); assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
    assert.match(await page.locator("#receiptTable").innerText(), /\$99\/month/);
    const downloadReady = page.waitForEvent("download"); await page.locator("#downloadReceipt").click();
    const download = await downloadReady; const pdfPath = `${artifacts}/${intent}-request.pdf`; await download.saveAs(pdfPath);
    const pdf = await readFile(pdfPath); assert.equal(pdf.subarray(0, 5).toString(), "%PDF-"); assert.ok(pdf.includes(Buffer.from("RepliQ Pro")));
    if (label === "desktop") {
      await page.goto(`${origin}/formulaire.html?offer=Premium&billing=annual&intent=demo`);
      await page.locator("#fullname").fill("Alex Fixture"); await page.locator("#business").fill("Charter Fixture");
      await page.locator("#activity").selectOption({ label: "Yacht charter" }); await page.locator("#phone").fill("3055550123");
      await page.locator("#email").fill("fixture@example.invalid"); await page.locator("#terms").check();
      const before = submissions.length; await page.locator("#submitRequest").click(); await page.locator("#formError").waitFor({ state: "visible" });
      assert.equal(submissions.length, before);
      await page.locator("#phone").fill("+1 305 555 0123"); failLead = true;
      await page.locator("#submitRequest").click(); await page.waitForFunction(() => !document.getElementById("submitRequest").disabled);
      assert.equal(await page.locator("#receiptWrap").isVisible(), false); assert.equal(await page.locator("#formError").isVisible(), true);
      failLead = false;
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: desktop/mobile layout, both CTAs, FAQ, consent/phone, mocked submission, error handling, escaped receipt and real PDF downloads. No page errors.");
  console.log(`Screenshots and synthetic PDFs: ${artifacts}`);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
