import test from "node:test";
import assert from "node:assert/strict";
import { configWithStoredCredentials, storedIntegrationDetail, storedIntegrationStatus } from "../apps/api/services/requestCredentials.js";
import { configWithRiskOverrides, sanitizeRiskOverrides } from "../apps/api/services/riskSettings.js";

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

test("reports only last four characters for stored integration fields", () => {
  const store = {
    integrations: { alpaca: {}, openai: {} },
    integrationSecrets: {
      alpaca: { apiKey: "paper-key-1234", secretKey: "paper-secret-9876" },
      openai: { apiKey: "sk-test-abcd" }
    }
  };

  const detail = storedIntegrationDetail(store);
  assert.deepEqual(detail.alpaca.suffixes, { apiKey: "1234", secretKey: "9876" });
  assert.deepEqual(detail.openai.suffixes, { apiKey: "abcd" });
  assert.equal(JSON.stringify(detail).includes("paper-secret"), false);
});

test("layers saved risk overrides onto config", () => {
  const config = { risk: { maxTradesPerDay: 8, maxRiskPerTradePct: 0.1 } };
  const store = { riskOverrides: { maxTradesPerDay: 50 } };
  const result = configWithRiskOverrides(config, store);

  assert.equal(result.risk.maxTradesPerDay, 50);
  assert.equal(result.risk.maxRiskPerTradePct, 0.1);
});

test("validates risk setting overrides", () => {
  const defaults = { maxTradesPerDay: 8, maxSpreadPct: 0.08 };
  assert.deepEqual(sanitizeRiskOverrides({ maxTradesPerDay: "25", maxSpreadPct: "0.08" }, defaults), {
    maxTradesPerDay: 25
  });
  assert.throws(() => sanitizeRiskOverrides({ maxTradesPerDay: "-1" }, defaults), /Max trades per day/);
});
