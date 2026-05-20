import test from "node:test";
import assert from "node:assert/strict";
import { generateMarketSnapshot } from "../apps/api/domain/strategyEngine.js";

test("market snapshot changes between short tick intervals", () => {
  const first = generateMarketSnapshot(new Date("2026-05-20T14:00:00.000Z"));
  const second = generateMarketSnapshot(new Date("2026-05-20T14:00:05.000Z"));
  const changed = first.some((bar, index) => bar.price !== second[index].price || bar.changePct !== second[index].changePct);
  assert.equal(changed, true);
});
