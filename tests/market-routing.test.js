import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(read("privacy-en.html"), /individual in a personal capacity/);
  assert.match(read("privacy.html"), /personne physique en son nom propre/);
});
