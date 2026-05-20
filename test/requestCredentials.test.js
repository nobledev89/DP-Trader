import test from "node:test";
import assert from "node:assert/strict";
import { configWithRequestCredentials, requestIntegrationStatus } from "../apps/api/services/requestCredentials.js";

test("overrides Alpaca credentials from browser request headers", () => {
  const config = {
    alpaca: {
      key: "",
      secret: "",
      baseUrl: "https://paper-api.alpaca.markets"
    }
  };

  const result = configWithRequestCredentials(config, {
    "x-dpt-alpaca-key": "paper-key",
    "x-dpt-alpaca-secret": "paper-secret"
  });

  assert.equal(result.alpaca.key, "paper-key");
  assert.equal(result.alpaca.secret, "paper-secret");
});

test("reports unlocked browser integrations from headers", () => {
  const status = requestIntegrationStatus({}, {
    "x-dpt-alpaca-key": "paper-key",
    "x-dpt-alpaca-secret": "paper-secret",
    "x-dpt-openai-key": "openai-key",
    "x-dpt-anthropic-key": "anthropic-key"
  });

  assert.equal(status.alpaca, true);
  assert.equal(status.openai, true);
  assert.equal(status.anthropic, true);
  assert.equal(status.finnhub, false);
});
