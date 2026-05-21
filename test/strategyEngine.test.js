import test from "node:test";
import assert from "node:assert/strict";
import { buildSignals, generateMarketSnapshot } from "../apps/api/domain/strategyEngine.js";

const baseBar = {
  symbol: "SPY",
  price: 100,
  bid: 99.99,
  ask: 100.01,
  vwap: 99.9,
  changePct: 0.2,
  relativeVolume: 1.2,
  spreadPct: 0.02,
  avgVolume: 3000000,
  emaSlope: 0.04,
  atr14: 0.4,
  atrPct: 0.4,
  updatedAt: "2026-05-20T18:00:00Z",
  source: "test"
};

test("market snapshot changes between short tick intervals", () => {
  const first = generateMarketSnapshot(new Date("2026-05-20T14:00:00.000Z"));
  const second = generateMarketSnapshot(new Date("2026-05-20T14:00:05.000Z"));
  const changed = first.some((bar, index) => bar.price !== second[index].price || bar.changePct !== second[index].changePct);
  assert.equal(changed, true);
});

test("skips signal generation when core indicators are missing", () => {
  const signals = buildSignals([{ ...baseBar, rsi14: null, aboveVwap: true }]);

  assert.equal(signals.length, 0);
});

test("emits short signals when price is below VWAP and trend slopes down", () => {
  const signals = buildSignals([{
    ...baseBar,
    rsi14: 58,
    aboveVwap: false,
    emaSlope: -0.04,
    changePct: -0.2
  }], { spyTrend: "down" });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].direction, "short");
  assert.ok(signals[0].targetPrice < signals[0].entryPrice);
  assert.ok(signals[0].stopPrice > signals[0].entryPrice);
});
