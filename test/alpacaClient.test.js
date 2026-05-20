import test from "node:test";
import assert from "node:assert/strict";
import { alpacaApiRoot, assertPaperTradingEndpoint, fetchAlpacaAccount } from "../apps/api/services/alpacaClient.js";

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
