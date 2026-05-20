import test from "node:test";
import assert from "node:assert/strict";
import { configWithStoredCredentials, storedIntegrationStatus } from "../apps/api/services/requestCredentials.js";

test("layers Postgres-stored keys onto the per-request config", () => {
  const config = {
    alpaca: { key: "", secret: "", baseUrl: "https://paper-api.alpaca.markets" },
    anthropic: {},
    openai: {}
  };
  const store = {
    integrationSecrets: {
      alpaca: { apiKey: "paper-key", secretKey: "paper-secret" },
      anthropic: { apiKey: "anthropic-key" },
      openai: { apiKey: "openai-key" }
    }
  };

  const result = configWithStoredCredentials(config, store);
  assert.equal(result.alpaca.key, "paper-key");
  assert.equal(result.alpaca.secret, "paper-secret");
  assert.equal(result.anthropic.key, "anthropic-key");
  assert.equal(result.openai.key, "openai-key");
});

test("does not touch alpaca config when only one half of the pair is stored", () => {
  const config = { alpaca: { key: "env-key", secret: "env-secret" } };
  const store = { integrationSecrets: { alpaca: { apiKey: "paper-key" } } };

  const result = configWithStoredCredentials(config, store);
  assert.equal(result.alpaca.key, "env-key");
  assert.equal(result.alpaca.secret, "env-secret");
});

test("reports stored integration status from the in-memory store", () => {
  const store = {
    integrations: { alpaca: {}, anthropic: {}, openai: {}, finnhub: {} },
    integrationSecrets: {
      alpaca: { apiKey: "a", secretKey: "b" },
      anthropic: { apiKey: "c" }
    }
  };

  const status = storedIntegrationStatus(store);
  assert.equal(status.alpaca, true);
  assert.equal(status.anthropic, true);
  assert.equal(status.openai, false);
  assert.equal(status.finnhub, false);
});
