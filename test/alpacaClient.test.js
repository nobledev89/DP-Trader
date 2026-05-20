import test from "node:test";
import assert from "node:assert/strict";
import { alpacaApiRoot, assertPaperTradingEndpoint, cancelAllAlpacaOrders, closeAllAlpacaPositions, fetchAlpacaAccount, fetchAlpacaLatestMarket } from "../apps/api/services/alpacaClient.js";

test("normalizes Alpaca paper base URL with or without v2 suffix", () => {
  assert.equal(alpacaApiRoot({ alpaca: { baseUrl: "https://paper-api.alpaca.markets" } }), "https://paper-api.alpaca.markets/v2");
  assert.equal(alpacaApiRoot({ alpaca: { baseUrl: "https://paper-api.alpaca.markets/v2" } }), "https://paper-api.alpaca.markets/v2");
});

test("auto trading rejects non-paper Alpaca endpoint", () => {
  assert.throws(() => assertPaperTradingEndpoint({
    alpaca: { baseUrl: "https://api.alpaca.markets/v2" }
  }), /paper endpoint/);
});

test("read-only Alpaca account calls are also paper-endpoint locked", async () => {
  await assert.rejects(() => fetchAlpacaAccount({
    alpaca: {
      key: "key",
      secret: "secret",
      baseUrl: "https://api.alpaca.markets/v2"
    }
  }), /paper endpoint/);
});

test("fetches Alpaca free latest market data from IEX feed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.toString(), "https://data.alpaca.markets/v2/stocks/trades/latest?symbols=AAPL%2CMSFT&feed=iex");
    assert.equal(options.headers["APCA-API-KEY-ID"], "key");
    return Response.json({
      trades: {
        AAPL: { p: 190.12, t: "2026-05-20T14:00:00Z" },
        MSFT: { p: 410.34, t: "2026-05-20T14:00:00Z" }
      }
    });
  };
  try {
    const market = await fetchAlpacaLatestMarket({
      alpaca: {
        key: "key",
        secret: "secret",
        dataFeed: "iex"
      }
    }, ["AAPL", "MSFT"]);
    assert.equal(market.length, 2);
    assert.equal(market[0].source, "alpaca_iex");
    assert.equal(market[0].price, 190.12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("can request emergency Alpaca order cancellation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(options.method, "DELETE");
    return Response.json([{ id: "cancelled" }]);
  };
  try {
    const result = await cancelAllAlpacaOrders({ alpaca: { key: "key", secret: "secret", baseUrl: "https://paper-api.alpaca.markets/v2" } });
    assert.equal(result[0].id, "cancelled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("can request emergency Alpaca position close", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://paper-api.alpaca.markets/v2/positions");
    assert.equal(options.method, "DELETE");
    return Response.json([{ symbol: "AAPL" }]);
  };
  try {
    const result = await closeAllAlpacaPositions({ alpaca: { key: "key", secret: "secret", baseUrl: "https://paper-api.alpaca.markets/v2" } });
    assert.equal(result[0].symbol, "AAPL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
