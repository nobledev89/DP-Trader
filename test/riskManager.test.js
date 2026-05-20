import test from "node:test";
import assert from "node:assert/strict";
import { calculatePositionSize, evaluateRisk } from "../apps/api/domain/riskManager.js";

const baseSignal = {
  symbol: "NVDA",
  entryPrice: 100,
  stopPrice: 99,
  targetPrice: 102,
  spreadPct: 0.02
};

const baseAccount = { equity: 100000, dayPnl: 0 };
const baseState = { killSwitch: false, openPositions: 0, tradesLastHour: 0, tradesToday: 0, dataStale: false };
const baseConfig = {
  maxDailyLossPct: 0.75,
  maxRiskPerTradePct: 0.1,
  maxOpenPositions: 1,
  maxTradesPerHour: 3,
  maxTradesPerDay: 8,
  minRewardRisk: 1.5,
  maxSpreadPct: 0.08
};

test("calculates shares from account risk and stop distance", () => {
  assert.deepEqual(calculatePositionSize({
    equity: 100000,
    entryPrice: 100,
    stopPrice: 99,
    maxRiskPerTradePct: 0.1
  }), {
    shares: 100,
    riskAmount: 100,
    riskPerShare: 1
  });
});

test("approves a signal that passes all hard risk gates", () => {
  const decision = evaluateRisk({
    signal: baseSignal,
    account: baseAccount,
    state: baseState,
    config: baseConfig,
    now: new Date("2026-05-20T14:00:00-04:00")
  });
  assert.equal(decision.decision, "approved");
  assert.equal(decision.shares, 100);
});

test("rejects when kill switch and daily loss limits are hit", () => {
  const decision = evaluateRisk({
    signal: baseSignal,
    account: { equity: 100000, dayPnl: -900 },
    state: { ...baseState, killSwitch: true },
    config: baseConfig,
    now: new Date("2026-05-20T14:00:00-04:00")
  });
  assert.equal(decision.decision, "rejected");
  assert.ok(decision.reasonCodes.includes("kill_switch_enabled"));
  assert.ok(decision.reasonCodes.includes("daily_loss_limit_reached"));
});
