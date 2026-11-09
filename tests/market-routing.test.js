import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import marketHandler from "../api/market.js";

function read(name) { return readFileSync(new URL("../" + name, import.meta.url), "utf8"); }
function call(country, method = "GET", vercel = "1") {
  const original = process.env.VERCEL;
  process.env.VERCEL = vercel;
  const headers = {};
  const res = { setHeader(k,v) { headers[k] = v; }, status(code) { this.statusCode=code;return this; }, json(body) { this.body=body;return this; } };
  try { marketHandler({ method, headers: { "x-vercel-ip-country": country } }, res); return { ...res, headers }; }
  finally { if (original === undefined) delete process.env.VERCEL; else process.env.VERCEL = original; }
}
test("Moroccan visitors get Morocco market, US and unknown get US", () => {
  assert.equal(call("MA").body.market, "ma");
  assert.equal(call("US").body.market, "us");
  assert.equal(call("").body.market, "us");
  assert.equal(call("MA", "GET", "0").body.market, "us");
  assert.equal(call("MA", "POST").statusCode, 405);
  assert.equal(call("MA").headers["Cache-Control"], "private, no-store");
});
test("Moroccan landing retains all original MAD plans and signup links", () => {
  const page = read("maroc.html"), signup = read("formulaire-maroc.html");
  for(const [plan, price, setup] of [["Essentielle",200,400],["Standard",400,600],["Premium",800,1000]]) {
    assert.match(page, new RegExp(plan));
    assert.match(page, new RegExp(String(price)+"\\s*<span class=\"unit\">MAD / mois"));
    assert.match(signup, new RegExp(plan));
    assert.match(signup, new RegExp("base: "+price));
    assert.match(signup, new RegExp("setup: "+setup));
  }
  assert.match(page, /formulaire-maroc\.html\?offer=/);
  assert.doesNotMatch(page, /window\.location\.href\s*=\s*`formulaire\.html/);
});
test("US offer and market overrides stay available without guessing an exchange rate", () => {
  const us = read("index.html"), form = read("formulaire.html"), script = read("market-switch.js");
  assert.match(us, /\$99\/month/);
  assert.match(form, /\$99\/month/);
  assert.match(us, /data-choose-market="ma"/);
  assert.match(form, /data-choose-market="ma"/);
  assert.match(read("maroc.html"), /data-choose-market="us"/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /\/api\/market/);
});
test("privacy notices remain drafts while describing individual operator and local preference", () => {
  for(const name of ["privacy-en.html","privacy.html"]) {
    const page=read(name);
    assert.match(page, /name="robots" content="noindex"/);
    assert.match(page, /7amzaraddi@gmail\.com/);
  }
  assert.match(read("privacy-en.html"), /HAMZA RADDI in an individual capacity/);
  assert.match(read("privacy.html"), /HAMZA RADDI en nom propre/);
});

function runMarketScript(pathname, initialChoice = null, search = "", country = "MA") {
  const state = new Map(initialChoice ? [["repliq-market", initialChoice]] : []);
  const navigations = [];
  const links = [{ dataset: { chooseMarket: "us" }, addEventListener() {} }];
  let fetched = 0;
  const window = {
    location: { pathname, search, hash: "", replace(url) { navigations.push(url); } },
    localStorage: { getItem(key) { return state.get(key) ?? null; }, setItem(key, value) { state.set(key, value); } },
  };
  const fetch = async () => { fetched++; return { ok: true, json: async () => ({ market: country === "MA" ? "ma" : "us" }) }; };
  runInNewContext(read("market-switch.js"), { window, document: { querySelectorAll() { return links; } }, URLSearchParams, fetch });
  return { state, navigations, get fetched() { return fetched; } };
}
test("explicit US and Morocco URLs never redirect regardless of previous market choice", () => {
  for (const path of ["/index.html", "/formulaire.html"]) {
    const result = runMarketScript(path, "ma");
    assert.deepEqual(result.navigations, []);
    assert.equal(result.state.get("repliq-market"), "us");
    assert.equal(result.fetched, 0);
  }
  for (const path of ["/maroc.html", "/formulaire-maroc.html"]) {
    const result = runMarketScript(path, "us");
    assert.deepEqual(result.navigations, []);
    assert.equal(result.state.get("repliq-market"), "ma");
    assert.equal(result.fetched, 0);
  }
});
test("root honours explicit US override or saved Morocco preference", () => {
  const us = runMarketScript("/", "ma", "?market=us");
  assert.deepEqual(us.navigations, []);
  assert.equal(us.state.get("repliq-market"), "us");
  const ma = runMarketScript("/", "us", "?market=ma");
  assert.deepEqual(ma.navigations, ["/maroc.html"]);
  const saved = runMarketScript("/", "ma");
  assert.deepEqual(saved.navigations, ["/maroc.html"]);
});

test("Moroccan form never confirms a lead without API success", () => {
  const form = read("formulaire-maroc.html");
  assert.match(form, /addEventListener\('submit', async function/);
  assert.match(form, /const response = await fetch\('\/api\/lead'/);
  assert.match(form, /if \(!response\.ok \|\| !result \|\| result\.ok !== true\)/);
  assert.match(form, /formError\.hidden = false/);
  assert.match(form, /submitButton\.disabled = false/);
  assert.match(form, /href="privacy\.html"/);
  assert.doesNotMatch(form, /fire-and-forget:/);
});
