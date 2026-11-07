import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Execute each file in its own process so fetch/env mocks stay isolated.
// Running files directly also avoids Node 26 reporting only file-level success.
let failed = 0;
const files = readdirSync(new URL("../tests/", import.meta.url)).filter(name => name.endsWith(".test.js")).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--import", "./tests/no-network.js", `tests/${file}`], { stdio: "inherit" });
  if (result.error || result.status !== 0) failed++;
}
console.log(`${files.length - failed}/${files.length} test files passed`);
process.exitCode = failed ? 1 : 0;
