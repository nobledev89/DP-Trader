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
  let submittedLimit = null;
  globalThis.fetch = mockAlpacaFetch({
    onOrderPost: (body) => {
      submittedLimit = Number(body.limit_price);
      assert.equal(body.order_class, "bracket");
      assert.equal(body.type, "limit");
    }
  });

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
    // The limit must be above the live ask (200.04) by the marketable buffer
    assert.ok(submittedLimit >= 200.04, `expected limit above live ask, got ${submittedLimit}`);
    assert.ok(submittedLimit <= 200.6, `limit overshot, got ${submittedLimit}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not submit when configured LLM rejects the heuristic candidate", async () => {
  const originalFetch = globalThis.fetch;
  let orderPosted = false;
  globalThis.fetch = mockAlpacaFetch({
    rejectLlm: true,
    onOrderPost: () => {
      orderPosted = true;
    }
  });

  try {
    const store = createStore();
    const result = await runAutoTradeCycle({
      config: {
        ...config,
        openai: { key: "test-openai-key", model: "gpt-test" },
        risk: { ...config.risk, minAutoConfidence: 0.62 }
      },
      store,
      now: new Date("2026-05-20T14:00:00-04:00")
    });
    assert.equal(result.status, "no_trade");
    assert.equal(result.reason, "ai_rejected_all_candidates");
    assert.match(result.rejected[0], /LLM \d+%/);
    assert.match(result.rejected[0], /advisory rejection/);
    assert.equal(orderPosted, false);
    assert.equal(store.orders.length, 0);
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

function mockAlpacaFetch({ onOrderPost, onOrderCancel, onPositionClose, rejectLlm = false } = {}) {
  return async (url, options = {}) => {
    const target = url.toString();
    if (target === "https://api.openai.com/v1/chat/completions" && options.method === "POST" && rejectLlm) {
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              approve: false,
              confidence: 0.2,
              rationale: "advisory rejection",
              reasonCodes: ["advisory_reject"]
            })
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      });
    }
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/trades/latest")) {
      return Response.json({
        trades: Object.fromEntries(SYMBOL_LIST.map((symbol, index) => [symbol, {
          p: 200 + index * 0.5,
          t: "2026-05-20T18:00:00Z"
        }]))
      });
    }
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/quotes/latest")) {
      return Response.json({
        quotes: Object.fromEntries(SYMBOL_LIST.map((symbol, index) => [symbol, {
          bp: 199.98 + index * 0.5,
          ap: 200.02 + index * 0.5,
          bs: 5,
          as: 5,
          t: "2026-05-20T18:00:00Z"
        }]))
      });
    }
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/bars")) {
      const bars = Array.from({ length: 60 }, (_, i) => ({
        t: new Date(Date.UTC(2026, 4, 20, 17, i)).toISOString(),
        o: 200 + Math.sin(i / 4) * 0.5,
        h: 200.4 + Math.sin(i / 4) * 0.5,
        l: 199.6 + Math.sin(i / 4) * 0.5,
        c: 200 + Math.sin((i + 1) / 4) * 0.5,
        v: 3500000 + i * 1000,
        vw: 200 + Math.sin(i / 4) * 0.5
      }));
      return Response.json({
        bars: Object.fromEntries(SYMBOL_LIST.map((symbol) => [symbol, bars]))
      });
    }
    if (target === "https://paper-api.alpaca.markets/v2/orders" && options.method === "POST") {
      const body = JSON.parse(options.body);
      onOrderPost?.(body);
      return Response.json({
        id: "alpaca-order-1",
        client_order_id: "client-1",
        status: "accepted",
        limit_price: body.limit_price,
        filled_qty: "0",
        created_at: "2026-05-20T18:00:00Z"
      });
    }
    if (target === "https://paper-api.alpaca.markets/v2/orders/exit-order" && options.method === "DELETE") {
      onOrderCancel?.();
      return new Response(null, { status: 204 });
    }
    if (target === "https://paper-api.alpaca.markets/v2/positions/QQQ" && options.method === "DELETE") {
      onPositionClose?.();
      return Response.json({ symbol: "QQQ", status: "closed" });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };
}

const SYMBOL_LIST = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL", "IBIT", "ETHE", "GLD", "SLV", "USO", "TLT", "UUP"];

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
  assert.equal(result.reason, "active_order");
});

test("allows another trade when an existing position is below the configured max", async () => {
  const originalFetch = globalThis.fetch;
  let orderPosted = false;
  globalThis.fetch = mockAlpacaFetch({
    onOrderPost: () => {
      orderPosted = true;
    }
  });

  try {
    const store = createStore();
    store.positions.push({
      symbol: "QQQ",
      qty: 10,
      side: "long",
      marketValue: 2000
    });
    const result = await runAutoTradeCycle({
      config: {
        ...config,
        risk: { ...config.risk, maxOpenPositions: 5 }
      },
      store,
      now: new Date("2026-05-20T14:00:00-04:00")
    });
    assert.equal(result.status, "submitted");
    assert.equal(orderPosted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submits a scalping exit when quick profit is reached", async () => {
  const originalFetch = globalThis.fetch;
  let canceledOrder = false;
  let closedPosition = false;
  globalThis.fetch = mockAlpacaFetch({
    onOrderCancel: () => {
      canceledOrder = true;
    },
    onPositionClose: () => {
      closedPosition = true;
    }
  });

  try {
    const store = createStore();
    store.positions.push({
      symbol: "QQQ",
      qty: 10,
      side: "long",
      marketValue: 2050,
      currentPrice: 205,
      avgEntryPrice: 200,
      unrealizedPnl: 50,
      unrealizedPnlPct: 0.004
    });
    store.orders.push({
      id: "entry",
      symbol: "QQQ",
      side: "buy",
      status: "filled",
      filledQty: 10,
      createdAt: new Date("2026-05-20T13:50:00-04:00").toISOString(),
      filledAt: new Date("2026-05-20T13:50:00-04:00").toISOString()
    }, {
      id: "exit-order",
      symbol: "QQQ",
      side: "sell",
      status: "new",
      createdAt: new Date("2026-05-20T13:50:01-04:00").toISOString()
    });
    const result = await runAutoTradeCycle({
      config: {
        ...config,
        risk: {
          ...config.risk,
          scalpingEnabled: true,
          minHoldMinutes: 5,
          maxHoldMinutes: 120,
          quickProfitPct: 0.35,
          quickStopPct: 0.25
        }
      },
      store,
      now: new Date("2026-05-20T14:00:00-04:00")
    });
    assert.equal(result.status, "exit_submitted");
    assert.equal(result.reason, "quick_profit_hit");
    assert.equal(result.symbol, "QQQ");
    assert.equal(canceledOrder, true);
    assert.equal(closedPosition, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
