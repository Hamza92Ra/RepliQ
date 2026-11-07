import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function nodeFunctionFiles(directory = new URL("../api/", import.meta.url), prefix = "api/") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = resolve(fileURLToPath(directory), entry.name);
    if (entry.isDirectory()) return nodeFunctionFiles(pathToFileURL(`${location}/`), `${prefix}${entry.name}/`);
    return /\.(?:js|mjs|cjs|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [`${prefix}${entry.name}`] : [];
  }).sort();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = nodeFunctionFiles();
  console.log(`${files.length} Node serverless entry points (Hobby budget: 12)`);
  for (const file of files) console.log(file);
  if (files.length > 12) process.exitCode = 1;
}
