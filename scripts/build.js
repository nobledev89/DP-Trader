import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const required = [
  "vercel.json",
  "api/state.js",
  "api/settings/integrations.js",
  "api/kill-switch.js",
  "api/orders/simulate.js",
  "apps/web/index.html",
  "apps/web/styles.css",
  "apps/web/app.js",
  "apps/api/server.js"
];

for (const file of required) {
  await access(join(process.cwd(), file));
}

const html = await readFile(join(process.cwd(), "apps/web/index.html"), "utf8");
for (const asset of ["/styles.css", "/app.js"]) {
  if (!html.includes(asset)) {
    throw new Error(`index.html missing ${asset}`);
  }
}

console.log("Build validation passed");
