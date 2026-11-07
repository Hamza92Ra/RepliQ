// Optional integration check using public Vercel packages installed OUTSIDE the
// project. No Vercel CLI/account/project settings/deployment is involved.
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { fixtureEnvironment } from "../tests/admin-service-fixtures.js";
import { signAdminToken } from "../lib/admin-auth.js";

if (!process.argv[2]) {
  console.error("Usage: node scripts/verify-vercel-runtime.mjs <directory containing external node_modules/@vercel/node and @vercel/routing-utils>");
  process.exit(2);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const external = createRequire(join(resolve(process.argv[2]), "verify.cjs"));
const nodePackage = external.resolve("@vercel/node/package.json");
const runtime = join(dirname(nodePackage), "dist/dev-server.mjs");
const { getTransformedRoutes } = external("@vercel/routing-utils");
const config = JSON.parse(readFileSync(join(root, "vercel.json")));
const transformed = getTransformedRoutes(config);
assert.equal(transformed.error, null);
for (const rule of config.rewrites) {
  const matches = transformed.routes.filter(route => route.src && new RegExp(route.src).test(rule.source));
  assert.equal(matches.length, 1); assert.equal(matches[0].dest, "/api/admin");
}
console.log(`Routing config validated by @vercel/routing-utils ${external("@vercel/routing-utils/package.json").version}`);

const originalEnv = { ...process.env };
Object.assign(process.env, fixtureEnvironment);
const token = signAdminToken();
process.env = originalEnv;
let assertions = 0;
async function start(entrypoint) {
  const child = fork(runtime, [], {
    cwd: root, silent: true,
    execArgv: ["--import", fileURLToPath(new URL("../tests/vercel-runtime-mocks.js", import.meta.url))],
    // Explicit synthetic-only environment: never inherit actual credentials.
    env: { ...fixtureEnvironment, VERCEL_DEV_ENTRYPOINT: entrypoint, VERCEL_DEV_CONFIG: "{}" },
  });
  let log = "";
  child.stdout.on("data", value => { log += value; });
  child.stderr.on("data", value => { log += value; });
  let address;
  try {
    address = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`Local runtime startup timeout: ${entrypoint}`)), 10000);
      child.once("message", value => { clearTimeout(timer); accept(value); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Local runtime exit ${code}: ${log}`)); });
    });
  } catch (error) { child.kill(); throw error; }
  assert.ok(Number.isInteger(address.port));
  return {
    async request(path, method = "GET", body, headers = {}) {
      return new Promise((accept, reject) => {
        const bytes = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
        const request = http.request({ hostname: "127.0.0.1", port: address.port, path, method,
          headers: { "x-forwarded-host": "localhost", ...(body === undefined ? {} : { "content-type": "application/json", "content-length": bytes.length }), ...headers } }, response => {
          let text = ""; response.setEncoding("utf8");
          response.on("data", chunk => { text += chunk; });
          response.on("end", () => {
            let json; try { json = JSON.parse(text); } catch { /* plain text webhook ACK */ }
            accept({ status: response.statusCode, headers: response.headers, text, json });
          });
        });
        request.on("error", reject);
        request.setTimeout(10000, () => request.destroy(new Error("Local runtime request timeout")));
        // Split UTF-8 writes while preserving exact bytes. The Vercel dev proxy
        // forwards Content-Length; Node 26's undici rejects forwarded chunked TE.
        if (bytes !== undefined) {
          request.write(bytes.subarray(0, 7)); request.end(bytes.subarray(7));
        } else request.end();
      });
    },
    async close() {
      const exited = once(child, "exit");
      if (child.connected) child.send("shutdown"); else child.kill();
      const timer = setTimeout(() => child.kill(), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
}
function status(response, expected) { assert.equal(response.status, expected, response.text); assertions++; }
const auth = { authorization: `Bearer ${token}` };
const admin = await start("api/admin.js");
try {
  const login = await admin.request("/api/admin/login", "POST", { password: "dashboard-fixture" });
  status(login, 200); assert.ok(login.json.token); assert.ok(login.headers["set-cookie"][0].includes("admin_token="));
  status(await admin.request("/api/admin/login", "GET", undefined, auth), 200);
  status(await admin.request("/api/admin/login", "POST", { password: "wrong" }), 401);
  const conversations = await admin.request("/api/admin/conversations", "GET", undefined, auth);
  status(conversations, 200); assert.equal(conversations.json.conversations[0].id, "fixture-conversation");
  const messages = await admin.request("/api/admin/messages?conversationId=fixture-conversation&repeat=a&repeat=b&route=send", "GET", undefined, auth);
  status(messages, 200); assert.equal(messages.json.conversationId, "fixture-conversation"); assert.ok(messages.json.messages.length);
  const read = await admin.request("/api/admin/read", "POST", { conversationId: "fixture-conversation" }, { cookie: login.headers["set-cookie"][0].split(";")[0] });
  status(read, 200); assert.equal(read.json.unread_count, 0);
  const takeover = await admin.request("/api/admin/takeover", "POST", { conversationId: "fixture-conversation", enabled: true }, auth);
  status(takeover, 200); assert.equal(takeover.json.human_takeover, true);
  const send = await admin.request("/api/admin/send", "POST", { conversationId: "fixture-conversation", text: "Synthetic é reply" }, auth);
  status(send, 200); assert.equal(send.json.wamid, "wamid.fixture"); assert.equal(send.json.message.sender, "human");
  const legacy = await admin.request("/api/admin/legacy?key=dashboard-fixture", "POST", { phone: "15555550123", action: "human" });
  status(legacy, 200); assert.equal(legacy.json.mode, "human");
  const methods = { conversations: "GET", messages: "GET", read: "POST", takeover: "POST", send: "POST", legacy: "POST" };
  for (const [name, method] of Object.entries(methods)) {
    status(await admin.request(`/api/admin/${name}`, method, method === "POST" ? { phone: "15555550123", action: "human" } : undefined), 401);
  }
  for (const name of ["login", ...Object.keys(methods)]) status(await admin.request(`/api/admin/${name}`, "DELETE", undefined, auth), 405);
  status(await admin.request("/api/admin"), 404);
  status(await admin.request("/api/admin/unknown"), 404);
} finally { await admin.close(); }

const signed = body => ({ "x-hub-signature-256": "sha256=" + createHmac("sha256", fixtureEnvironment.META_APP_SECRET).update(body).digest("hex") });
for (const entrypoint of ["api/webhook.js", "api/conversation.js"]) {
  const runtimeHandler = await start(entrypoint);
  const path = "/" + entrypoint.replace(/\.js$/, "");
  try {
    status(await runtimeHandler.request(`${path}?hub.mode=subscribe&hub.verify_token=verify-fixture&hub.challenge=fixture`), 200);
    status(await runtimeHandler.request(`${path}?hub.mode=subscribe&hub.verify_token=wrong`), 403);
    const bytes = ' { "entry": [], "fixture": "é — fixture" }\n';
    const ok = await runtimeHandler.request(path, "POST", bytes, signed(bytes));
    status(ok, 200); assert.equal(ok.text, "EVENT_RECEIVED");
    status(await runtimeHandler.request(path, "POST", bytes), 401);
    status(await runtimeHandler.request(path, "POST", bytes + " ", signed(bytes)), 401);
    status(await runtimeHandler.request(path, "POST", "{invalid", signed("{invalid")), 400);
    if (entrypoint === "api/conversation.js") {
      const action = await runtimeHandler.request(`${path}?key=dashboard-fixture`, "POST", { phone: "15555550123", action: "human" });
      status(action, 200); assert.equal(action.json.mode, "human");
    } else {
      status(await runtimeHandler.request(`${path}?key=dashboard-fixture`, "POST", { phone: "15555550123", action: "human" }), 401);
    }
  } finally { await runtimeHandler.close(); }
}
console.log(`@vercel/node ${JSON.parse(readFileSync(nodePackage)).version}: ${assertions} real-runtime HTTP response checks passed, with external services mocked`);
