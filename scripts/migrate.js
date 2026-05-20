import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closePool, hasDatabase, query } from "../apps/api/db/postgres.js";

if (!hasDatabase()) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const schema = await readFile(join(process.cwd(), "db/schema.sql"), "utf8");
await query(schema);
await closePool();

console.log("Database migration complete");
