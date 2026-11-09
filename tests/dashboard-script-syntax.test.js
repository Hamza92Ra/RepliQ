import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

test("dashboard inline JavaScript parses without redeclared lexical bindings", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let checked = 0;
  for (const [, attrs, source] of scriptTags) {
    if (/\bsrc\s*=/.test(attrs) || !source.trim()) continue;
    assert.doesNotThrow(() => new Script(source, { filename: "dashboard.html" }));
    checked++;
  }
  assert.ok(checked >= 1, "Expected dashboard inline JavaScript");
  assert.match(html, /function tryLogin\s*\(/);
  assert.equal((html.match(/const convo = conversations\.find\(c => c\.phone === phone\);/g) || []).length, 1);
});
