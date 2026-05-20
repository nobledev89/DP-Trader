import test from "node:test";
import assert from "node:assert/strict";
import { runAutoTradeCycle } from "../apps/api/domain/autoTrader.js";
import { createStore } from "../apps/api/store.js";

const config = {
  alpaca: {
    key: "paper-key",
    secret: "paper-secret",
    baseUrl: "https://paper-api.alpaca.markets/v2"
  },
  risk: {
    maxDailyLossPct: 0.75,
    maxRiskPerTradePct: 0.1,
    maxOpenPositions: 1,
    maxTradesPerHour: 3,
    maxTradesPerDay: 8,
    minRewardRisk: 1.5,
    maxSpreadPct: 0.08,
    minAvgVolume: 2000000,
    maxExecutionErrors: 3,
    maxPositionValuePct: 20
  }
};

test("submits the top approved signal to Alpaca paper trading", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://paper-api.alpaca.markets/v2/orders");
    const body = JSON.parse(options.body);
    assert.equal(body.order_class, "bracket");
    assert.equal(body.type, "limit");
    assert.ok(Number(body.limit_price) > 100);
    return Response.json({
      id: "alpaca-order-1",
      client_order_id: "client-1",
      status: "accepted",
      limit_price: body.limit_price,
      filled_qty: "0",
      created_at: "2026-05-20T18:00:00Z"
    });
  };

  try {
    const store = createStore();
    const result = await runAutoTradeCycle({
      config,
      store,
      now: new Date("2026-05-20T14:00:00-04:00")
    });
    assert.equal(result.status, "submitted");
    assert.equal(store.orders.length, 1);
    assert.equal(store.orders[0].type, "alpaca_paper_bracket");
    assert.equal(store.orders[0].filledQty, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not auto trade while kill switch is enabled", async () => {
  const store = createStore();
  store.killSwitch = true;
  const result = await runAutoTradeCycle({
    config,
    store,
    now: new Date("2026-05-20T14:00:00-04:00")
  });
  assert.equal(result.status, "paused");
  assert.equal(store.orders.length, 0);
});

test("does not auto trade when an active order already exists", async () => {
  const store = createStore();
  store.orders.push({
    id: "existing",
    symbol: "AAPL",
    status: "new",
    createdAt: new Date("2026-05-20T14:00:00-04:00").toISOString()
  });
  const result = await runAutoTradeCycle({
    config,
    store,
    now: new Date("2026-05-20T14:00:00-04:00")
  });
  assert.equal(result.status, "no_trade");
  assert.equal(result.reason, "active_order_or_position");
});
