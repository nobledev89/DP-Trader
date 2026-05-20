import test from "node:test";
import assert from "node:assert/strict";
import { scoreSignal } from "../apps/api/domain/aiScorer.js";

test("scores a high quality long setup as a candidate", () => {
  const result = scoreSignal({
    direction: "long",
    relativeVolume: 1.8,
    aboveVwap: true,
    emaSlope: 0.12,
    rsi: 58,
    expectedR: 2.1,
    spreadPct: 0.02,
    atrPct: 1.2
  }, { spyTrend: "up" });

  assert.equal(result.decision, "candidate");
  assert.ok(result.probabilityOfSuccess >= 0.62);
  assert.ok(result.reasonCodes.includes("reward_risk_strong"));
});

test("penalizes wide spreads", () => {
  const clean = scoreSignal({
    direction: "long",
    relativeVolume: 1.8,
    aboveVwap: true,
    emaSlope: 0.12,
    rsi: 58,
    expectedR: 2.1,
    spreadPct: 0.02,
    atrPct: 1.2
  }, { spyTrend: "up" });
  const wide = scoreSignal({
    direction: "long",
    relativeVolume: 1.8,
    aboveVwap: true,
    emaSlope: 0.12,
    rsi: 58,
    expectedR: 2.1,
    spreadPct: 0.12,
    atrPct: 1.2
  }, { spyTrend: "up" });

  assert.ok(wide.probabilityOfSuccess < clean.probabilityOfSuccess);
});
