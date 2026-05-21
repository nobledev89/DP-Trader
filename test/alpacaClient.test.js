import test from "node:test";
import assert from "node:assert/strict";
import { alpacaApiRoot, assertPaperTradingEndpoint, cancelAllAlpacaOrders, closeAllAlpacaPositions, closeAlpacaPosition, fetchAlpacaAccount, fetchAlpacaBars, fetchAlpacaCryptoBars, fetchAlpacaLatestCryptoQuotes, fetchAlpacaLatestMarket, marketableLimitPrice, submitAlpacaAutoOrder } from "../apps/api/services/alpacaClient.js";

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

test("falls back to recent historical bars when latest bars are empty", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url.toString());
    assert.equal(options.headers["APCA-API-KEY-ID"], "key");
    if (url.searchParams.get("sort") === "desc") {
      const symbol = url.searchParams.get("symbols");
      return Response.json({
        bars: {
          [symbol]: [
            { t: "2026-05-20T19:59:00Z", o: 101, h: 102, l: 100, c: 101.5, v: 2000, vw: 101.2 },
            { t: "2026-05-20T19:58:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000, vw: 100.2 }
          ]
        }
      });
    }
    return Response.json({ bars: {}, next_page_token: null });
  };
  try {
    const bars = await fetchAlpacaBars({
      alpaca: {
        key: "key",
        secret: "secret",
        dataFeed: "iex"
      }
    }, ["AAPL", "MSFT"], { limit: 2 });
    assert.equal(requests.length, 3);
    assert.equal(bars.AAPL.length, 2);
    assert.equal(bars.AAPL[0].t, "2026-05-20T19:58:00Z");
    assert.equal(bars.AAPL[1].t, "2026-05-20T19:59:00Z");
    assert.equal(bars.MSFT[0].close, 100.5);
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

test("uses a small marketable limit offset for paper entry orders without a quote", () => {
  assert.equal(marketableLimitPrice({ direction: "long", entryPrice: 100 }), 100.25);
  assert.equal(marketableLimitPrice({ direction: "short", entryPrice: 100 }), 99.75);
});

test("pegs the marketable limit to live ask/bid when a quote is supplied", () => {
  assert.equal(marketableLimitPrice({ direction: "long" }, { bid: 199.98, ask: 200.02 }), 200.52);
  assert.equal(marketableLimitPrice({ direction: "short" }, { bid: 199.98, ask: 200.02 }), 199.48);
});

test("uses simple extended-hours limit orders outside regular session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(body.extended_hours, true);
    assert.equal(body.type, "limit");
    assert.equal(body.time_in_force, "day");
    assert.equal(body.order_class, undefined);
    return Response.json({ id: "extended-order", status: "accepted", order_class: "" });
  };
  try {
    const result = await submitAlpacaAutoOrder(
      {
        alpaca: { key: "key", secret: "secret", baseUrl: "https://paper-api.alpaca.markets" },
        risk: { allowExtendedHours: true }
      },
      { symbol: "SPY", direction: "long", entryPrice: 100 },
      { shares: 1 },
      new Date("2026-05-21T21:00:00-04:00")
    );
    assert.equal(result.id, "extended-order");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closes crypto positions with an IOC market order", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(body.symbol, "BTC/USD");
    assert.equal(body.qty, "0.02");
    assert.equal(body.side, "sell");
    assert.equal(body.type, "market");
    assert.equal(body.time_in_force, "ioc");
    return Response.json({ id: "crypto-close", status: "accepted" });
  };
  try {
    const result = await closeAlpacaPosition(
      { alpaca: { key: "key", secret: "secret", baseUrl: "https://paper-api.alpaca.markets" }, risk: { allowExtendedHours: true } },
      { symbol: "BTCUSD", qty: 0.02, side: "long" },
      new Date("2026-05-21T21:00:00-04:00")
    );
    assert.equal(result.id, "crypto-close");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetches Alpaca crypto quotes and bars", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers["APCA-API-KEY-ID"], "key");
    if (url.toString().startsWith("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes")) {
      assert.equal(url.searchParams.get("symbols"), "BTC/USD,ETH/USD");
      return Response.json({
        quotes: {
          "BTC/USD": { bp: 77677.9, ap: 77741.1, bs: 0.5, as: 0.4, t: "2026-05-21T07:51:46Z" },
          "ETH/USD": { bp: 2131.08, ap: 2132.69, bs: 10, as: 10, t: "2026-05-21T07:48:30Z" }
        }
      });
    }
    if (url.toString().startsWith("https://data.alpaca.markets/v1beta3/crypto/us/bars")) {
      const symbol = url.searchParams.get("symbols");
      return Response.json({
        bars: {
          [symbol]: [
            { t: "2026-05-21T07:51:00Z", o: 100, h: 102, l: 99, c: 101, v: 0.25, vw: 100.5 },
            { t: "2026-05-21T07:50:00Z", o: 99, h: 100, l: 98, c: 99.5, v: 0.2, vw: 99.2 }
          ]
        }
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
  try {
    const config = { alpaca: { key: "key", secret: "secret" } };
    const quotes = await fetchAlpacaLatestCryptoQuotes(config, ["BTC/USD", "ETH/USD"]);
    const bars = await fetchAlpacaCryptoBars(config, ["BTC/USD"], { limit: 2 });
    assert.equal(quotes.length, 2);
    assert.equal(quotes[0].assetClass, "crypto");
    assert.equal(quotes[0].avgVolume > 0, true);
    assert.equal(bars["BTC/USD"][0].t, "2026-05-21T07:50:00Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submits crypto entries as fractional spot limit orders", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(body.symbol, "BTC/USD");
    assert.equal(body.qty, "0.00123456");
    assert.equal(body.side, "buy");
    assert.equal(body.time_in_force, "gtc");
    assert.equal(body.order_class, undefined);
    return Response.json({ id: "crypto-order", status: "accepted", limit_price: body.limit_price });
  };
  try {
    const result = await submitAlpacaAutoOrder(
      {
        alpaca: { key: "key", secret: "secret", baseUrl: "https://paper-api.alpaca.markets" },
        risk: { allowExtendedHours: true }
      },
      { symbol: "BTC/USD", assetClass: "crypto", direction: "long", entryPrice: 77700, quote: { bid: 77677, ask: 77741 } },
      { shares: 0.00123456 },
      new Date("2026-05-21T21:00:00-04:00")
    );
    assert.equal(result.id, "crypto-order");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
