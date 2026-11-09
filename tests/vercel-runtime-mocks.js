// Preloaded only by scripts/verify-vercel-runtime.mjs. Replaces every external
// fetch before the real Vercel runtime imports application modules.
import { installAdminFixtures } from "./admin-service-fixtures.js";
installAdminFixtures();
// Probe messages contain booleans only, never prompts, customer data or secrets.
if (process.env.REPLIQ_US_DEMO_SALES_ENABLED === "true") {
  const { buildUsSalesPrompt } = await import("../lib/us-sales-prompt.js");
  const fixtureFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      const exact = JSON.parse(options.body).messages[0].content === buildUsSalesPrompt();
      process.send?.({ type: "us-demo-prompt-probe", exact });
      if (!exact) throw new Error("Synthetic prompt mismatch");
      return Response.json({ choices: [{ message: { content: "Synthetic RepliQ Pro reply" }, finish_reason: "stop" }] });
    }
    const result = await fixtureFetch(input, options);
    if (url.endsWith("/pipeline") && options.body) {
      const commands = JSON.parse(options.body);
      if (commands.some(([command, key]) => command === "SET" && key === "msg:phone:wamid.fixture")) {
        process.send?.({ type: "us-demo-receipt-mapping-probe", exact: true });
      }
      for (const [command, key, ...values] of commands) {
        if (command === "RPUSH" && values.some(value => { try { return JSON.parse(value).status === "delivered"; } catch { return false; } })) {
          process.send?.({ type: "us-demo-receipt-update-probe", exact: key === "conv:15555550123" });
        }
      }
    }
    if (url.includes("graph.facebook.com") && options.body && JSON.parse(options.body).type === "text") {
      process.send?.({ type: "us-demo-send-probe", exact: url.includes("/1001/messages") });
    }
    return result;
  };
}
