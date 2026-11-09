import conversations from "../lib/admin-handlers/conversations.js";
import legacy from "../lib/admin-handlers/legacy.js";
import login from "../lib/admin-handlers/login.js";
import messages from "../lib/admin-handlers/messages.js";
import read from "../lib/admin-handlers/read.js";
import send from "../lib/admin-handlers/send.js";
import takeover from "../lib/admin-handlers/takeover.js";

// Vercel rewrites preserve the original request URL. Dispatch by pathname only;
// query strings, bodies and forwarded headers cannot select a different handler.
// Keep body parsing, authentication and method checks in the original handlers.
const routes = new Map([
  ["/api/admin/conversations", conversations],
  ["/api/admin/legacy", legacy],
  ["/api/admin/login", login],
  ["/api/admin/messages", messages],
  ["/api/admin/read", read],
  ["/api/admin/send", send],
  ["/api/admin/takeover", takeover],
]);

export default function handler(req, res) {
  const pathname = (req.url || "").split("?")[0].replace(/\/$/, "");
  const endpoint = routes.get(pathname);
  if (!endpoint) return res.status(404).json({ error: "Not Found" });
  return endpoint(req, res);
}
