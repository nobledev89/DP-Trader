import test from "node:test";
import assert from "node:assert/strict";
import { loadMarketSnapshot } from "../apps/api/domain/marketData.js";

test("keeps liquidity avgVolume separate from indicator bar volume", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = url.toString();
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/trades/latest")) {
      return Response.json({
        trades: {
          SPY: { p: 100, t: "2026-05-20T20:00:00Z" }
        }
      });
    }
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/quotes/latest")) {
      return Response.json({
        quotes: {
          SPY: { bp: 99.99, ap: 100.01, t: "2026-05-20T20:00:00Z" }
        }
      });
    }
    if (target.startsWith("https://data.alpaca.markets/v2/stocks/bars")) {
      const bars = Array.from({ length: 20 }, (_, index) => ({
        t: new Date(Date.UTC(2026, 4, 20, 19, index)).toISOString(),
        o: 100 + index * 0.01,
        h: 100.1 + index * 0.01,
        l: 99.9 + index * 0.01,
        c: 100 + index * 0.01,
        v: 5000,
        vw: 100 + index * 0.01
      }));
      return Response.json({ bars: { SPY: bars } });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };

  try {
    const market = await loadMarketSnapshot({
      alpaca: {
        key: "key",
        secret: "secret",
        dataFeed: "iex"
      }
    }, { lastMarketSnapshot: [], events: [] }, new Date("2026-05-20T20:01:00Z"));
    const spy = market.find((bar) => bar.symbol === "SPY");
    assert.equal(spy.avgVolume, 3000000);
    assert.equal(spy.indicatorAvgVolume, 5000);
    assert.equal(spy.rsi14 !== null, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
