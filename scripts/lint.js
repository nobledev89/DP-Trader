import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "scripts", "test"];
const failures = [];

for (const file of await listFiles(process.cwd(), roots)) {
  const text = await readFile(file, "utf8");
  if (/\t/.test(text)) failures.push(`${file}: contains tabs`);
  if (/[ \t]+$/m.test(text)) failures.push(`${file}: contains trailing whitespace`);
  const marker = ["TO", "DO"].join("");
  if (text.includes(marker)) failures.push(`${file}: contains ${marker}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Lint passed");

async function listFiles(base, rootsToScan) {
  const found = [];
  for (const root of rootsToScan) {
    found.push(...await walk(join(base, root)));
  }
  return found.filter((file) => /\.(js|css|html)$/.test(file));
}

async function walk(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await walk(path));
      if (entry.isFile()) files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}
