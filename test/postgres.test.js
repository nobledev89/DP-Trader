import test from "node:test";
import assert from "node:assert/strict";
import { hasDatabase } from "../apps/api/db/postgres.js";

test("database is optional when DATABASE_URL is not configured", () => {
  assert.equal(hasDatabase({}), false);
  assert.equal(hasDatabase({ DATABASE_URL: "" }), false);
  assert.equal(hasDatabase({ DATABASE_URL: "postgresql://example" }), true);
});
